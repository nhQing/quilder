/**
 * Phủ bản dịch lên một doc.
 *
 * Hàm thuần, không DB — cùng lý do như `text-units.ts`: đây là chỗ dễ sai nhất
 * của cả lớp i18n, và nó phải test được mà không dựng gì.
 *
 * ## Vì sao phủ chứ không fork doc
 *
 * Xem ghi chú model `Translation` trong schema. Ngắn gọn: một cây node duy nhất
 * nghĩa là bố cục không bao giờ lệch giữa các ngôn ngữ.
 *
 * ## Vì sao thiếu bản dịch thì trả về BẢN GỐC
 *
 * Một nút không chữ hỏng nặng hơn một nút còn tiếng Việt: chữ sai ngôn ngữ thì
 * người ta vẫn bấm được và vẫn báo lại được, còn nút trắng thì không. Trong
 * builder, chỗ đang dùng bản gốc được đánh dấu rõ — nếu không thì bảng Văn bản
 * trông như đã dịch xong trong khi thực tế chưa.
 */

import type { ContentOverride, Doc, Node, RichText } from '@/lib/doc/types';
import {
  parseInstanceAddress, type BaseTranslatableField, type TranslatableField,
} from '@/lib/builder/text-units';
import { applyParamMap, isParamField, paramPathOf } from '@/lib/render/param-paths';

export interface TranslationEntry {
  nodeId: string;
  field: TranslatableField;
  /** RichText cho `content`/`label`, chuỗi cho `alt`/`a11yLabel`. */
  value: unknown;
}

/**
 * Khoá phẳng dùng trong ảnh chụp của Release.
 *
 * ## Hai dạng khoá, và vì sao có dạng thứ hai (17/11/2026)
 *
 * - `locale:nodeId:field` — dạng CŨ, không mang trang. Một khoá áp cho MỌI trang có
 *   node trùng id. Đủ khi id là cuid, nhưng các trang dựng bằng clone mang id dạng
 *   `n0000130` lặp lại giữa các trang: publish bản tiếng Anh của /maicash và /maigreen
 *   cùng lúc làm `/en/maigreen` hiện 5 đoạn chữ của MaiCash+, và `$meta` (tiêu đề
 *   trang) của trang ghi sau cùng thành tiêu đề của mọi trang.
 * - `locale@pageId:nodeId:field` — dạng MỚI, của đúng một trang. Đi kèm cờ
 *   `@pageId` (xem `pageMarkerKey`): trang có cờ CHỈ đọc khoá của chính nó.
 *
 * Trang chưa có cờ (mọi trang trong release tạo trước bản sửa này) đọc dạng cũ y như
 * trước, nên lùi bản về một release cũ vẫn hiện đúng thứ nó đã từng hiện.
 *
 * `locale` không chứa `@` hay `:` (mã ngôn ngữ), `pageId` là cuid, `nodeId` không chứa
 * `:` (xem `zNodeId`). `field` CÓ THỂ chứa `:` (`param:index.0.label`).
 */
export function snapshotKey(locale: string, nodeId: string, field: string, pageId?: string): string {
  return pageId ? `${locale}@${pageId}:${nodeId}:${field}` : `${locale}:${nodeId}:${field}`;
}

/** Cờ "trang này được chụp theo dạng khoá mới" — giá trị `true`, không phải bản dịch. */
export function pageMarkerKey(pageId: string): string {
  return `@${pageId}`;
}

/** Mã ngôn ngữ của một khoá ảnh chụp, cả hai dạng. Cờ trang trả chuỗi rỗng. */
export function snapshotLocaleOf(key: string): string {
  return /^[^:@]*/.exec(key)?.[0] ?? '';
}

/**
 * Ảnh chụp của Release → danh sách bản dịch của một ngôn ngữ, cho MỘT trang.
 *
 * Có `pageId` và trang mang cờ → chỉ khoá `locale@pageId:`. Còn lại → khoá dạng cũ
 * `locale:` (release cũ, hoặc chỗ gọi chưa biết trang).
 */
export function entriesFromSnapshot(
  snapshot: unknown,
  locale: string,
  pageId?: string,
): TranslationEntry[] {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return [];
  const snap = snapshot as Record<string, unknown>;

  const scoped = pageId !== undefined && Object.hasOwn(snap, pageMarkerKey(pageId));
  const prefix = scoped ? `${locale}@${pageId}:` : `${locale}:`;

  const out: TranslationEntry[] = [];
  for (const [key, value] of Object.entries(snap)) {
    if (!key.startsWith(prefix)) continue;
    // Phần sau tiền tố là `nodeId:field`; cắt ở dấu ':' ĐẦU TIÊN và giữ nguyên phần còn
    // lại — `field` có thể là `param:index.0.label`, và `split(':')` sẽ cắt cụt nó.
    const rest = key.slice(prefix.length);
    const cut = rest.indexOf(':');
    if (cut < 0) continue;
    const nodeId = rest.slice(0, cut);
    const field = rest.slice(cut + 1);
    if (!nodeId || !field) continue;
    out.push({ nodeId, field: field as TranslatableField, value });
  }
  return out;
}

/**
 * Trường của đơn vị chữ → khoá trong `ContentOverride`.
 *
 * Gần trùng tên nhưng KHÔNG trùng: `a11yLabel` giữ tên, còn ba cái kia đổi từ
 * "trường của node" sang "khoá override". Một bảng tường minh thì lỗi gõ sai sẽ
 * là lỗi biên dịch, còn ghép chuỗi thì nó là một bản dịch im lặng không áp.
 */
const OVERRIDE_FIELD: Record<BaseTranslatableField, keyof ContentOverride | undefined> = {
  content: 'content',
  label: 'label',
  alt: 'alt',
  a11yLabel: 'a11yLabel',
  assetId: 'assetId',
  posterAssetId: 'posterAssetId',
  href: 'href',
};

/** Giá trị có đúng hình dạng cho trường đó không. */
function isValidFor(field: TranslatableField, value: unknown): boolean {
  if (isParamField(field)) return typeof value === 'string' && value.length > 0;
  if (field === 'content' || field === 'label') {
    // Mảng inline node. Không kiểm sâu ở đây — schema đã kiểm lúc ghi, và một bản
    // dịch hỏng chỉ nên bị BỎ QUA chứ không làm sập trang.
    return Array.isArray(value);
  }
  if (field === 'assetId' || field === 'posterAssetId') {
    // `null` là giá trị THẬT: "bản dịch này dùng lại asset của bản gốc". Khác hẳn
    // với không có hàng nào, vốn cũng cho ra bản gốc nhưng không nói ra chủ đích.
    return value === null || (typeof value === 'string' && value.length > 0);
  }
  return typeof value === 'string';
}

/**
 * Doc + bản dịch → doc mới.
 *
 * KHÔNG sửa tại chỗ: doc đến từ `unstable_cache` và có thể được nhiều request
 * dùng chung. Ghi vào nó nghĩa là bản dịch tiếng Anh rò rỉ sang request tiếng
 * Việt kế tiếp — loại lỗi chỉ xuất hiện dưới tải và gần như không tái hiện nổi.
 *
 * Chỉ nhân bản node NÀO bị đụng tới. 130 node mà chỉ 74 đơn vị chữ, và phần lớn
 * request tiếng Việt không có bản dịch nào — nhân bản cả cây cho mỗi request là
 * chi phí thật mà không đổi lấy gì.
 */
export function applyTranslations(doc: Doc, entries: TranslationEntry[]): Doc {
  if (!entries.length) return doc;

  const touched = new Map<string, Node>();

  const nodeFor = (id: string): Node | null => {
    const existing = touched.get(id);
    if (existing) return existing;
    const original = doc.nodes[id];
    if (!original) return null;
    // Nhân bản nông một tầng là đủ: mỗi trường bị ghi đè đều được GÁN LẠI bằng
    // giá trị mới chứ không sửa bên trong giá trị cũ.
    const copy = { ...original } as Node;
    touched.set(id, copy);
    return copy;
  };

  for (const entry of entries) {
    if (!isValidFor(entry.field, entry.value)) continue;

    /**
     * Bản dịch cho chữ NẰM TRONG một instance.
     *
     * Địa chỉ là `instanceId/localId` (xem `instanceAddress`). Nó không phủ lên
     * một node trong doc — nó phủ lên OVERRIDE của instance, tức là thành một
     * lớp thứ hai chồng lên override mà người dùng đã đặt.
     *
     * Thứ tự đó có chủ đích: bản dịch của một trang cụ thể phải thắng nội dung
     * riêng của instance ở trang đó, vì cả hai đều thuộc về đúng trang ấy — và
     * bản dịch là thứ được chọn sau.
     */
    const inst = parseInstanceAddress(entry.nodeId);
    if (inst) {
      const host = nodeFor(inst.instanceId);
      // Instance đã bị xoá, hoặc node đó không còn là instance.
      if (!host || host.type !== 'Instance') continue;

      // Chữ trong params của Composite nằm trong instance: thêm vào bản đồ `params`
      // của override (khoá = đường dẫn), `applyOverride` sẽ phủ nó lên params.
      if (isParamField(entry.field)) {
        const prev = host.overrides[inst.localId];
        host.overrides = {
          ...host.overrides,
          [inst.localId]: {
            ...prev,
            params: { ...prev?.params, [paramPathOf(entry.field)]: entry.value as string },
          },
        };
        continue;
      }

      const key = OVERRIDE_FIELD[entry.field];
      if (!key) continue;

      // Nhân bản cả bản đồ overrides VÀ override của node đó: cả hai đều đến từ
      // doc trong cache dùng chung, và ghi vào chúng sẽ rò rỉ bản dịch sang
      // request của ngôn ngữ khác.
      host.overrides = {
        ...host.overrides,
        [inst.localId]: { ...host.overrides[inst.localId], [key]: entry.value },
      };
      continue;
    }

    const node = nodeFor(entry.nodeId);
    // Bản dịch mồ côi: node đã bị xoá khỏi doc. Bỏ qua im lặng — builder có màn
    // riêng để dọn, và một hàng rác không đáng làm hỏng một lượt render.
    if (!node) continue;

    // Chữ trong params của Composite trên node thường của doc. Nhân bản params dọc
    // đường đi (`applyParamMap`) — node chỉ được nhân bản NÔNG, nên params vẫn là
    // object của doc trong cache dùng chung.
    if (isParamField(entry.field)) {
      if (node.type === 'Composite') {
        node.params = applyParamMap(node.params, {
          [paramPathOf(entry.field)]: entry.value as string,
        });
      }
      continue;
    }

    switch (entry.field) {
      case 'content':
        if (node.type === 'Text') node.content = entry.value as RichText;
        break;
      case 'label':
        if (node.type === 'Button') node.label = entry.value as RichText;
        break;
      case 'alt':
        if (node.type === 'Image') node.alt = entry.value as string;
        break;
      case 'assetId':
        // Ảnh VÀ video dùng chung một trường: cả hai node đều gọi nguồn chính của
        // mình là `assetId`, nên một trường thứ hai chỉ để phân biệt loại node là
        // một trường không ai nhớ đang nói về cái gì.
        if (node.type === 'Image' || node.type === 'Video') {
          node.assetId = entry.value as string | null;
        }
        break;
      case 'posterAssetId':
        if (node.type === 'Video') node.posterAssetId = entry.value as string | null;
        break;
      case 'href':
        // Chỉ action dạng `link`. Ghi đè lên `anchor`/`submit` tạo ra một action
        // lai không hợp lệ với schema — cùng hàng rào mà `applyOverride` đã dựng.
        if (node.type === 'Button' && node.action.kind === 'link') {
          node.action = { ...node.action, href: entry.value as string };
        }
        break;
      case 'a11yLabel':
        // `a11y` là object lồng, nên phải nhân bản nó nữa — sửa tại chỗ sẽ ghi
        // thẳng vào doc đang được cache dùng chung.
        node.a11y = { ...node.a11y, label: entry.value as string };
        break;
    }
  }

  if (!touched.size) return doc;
  return { ...doc, nodes: { ...doc.nodes, ...Object.fromEntries(touched) } };
}
