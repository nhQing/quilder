/**
 * Doc → danh sách đơn vị chữ phẳng.
 *
 * Đây là nền của trang Nội dung và của lớp đa ngôn ngữ. Hàm thuần, không DB,
 * không React — mọi tính chất khó đều test được mà không dựng gì.
 *
 * ## Vì sao có `field` chứ không chỉ `nodeId`
 *
 * Một node mang nhiều đoạn chữ độc lập: `ImageNode` có `alt`, và mọi node đều có
 * thể có `a11y.label`. Khoá chỉ theo node sẽ gộp chúng thành một, và bản dịch của
 * cái này sẽ ghi đè cái kia.
 *
 * ## Vì sao phân loại `flat` / `structured`
 *
 * `RichText` là CÂY inline node, không phải chuỗi. Đọc ra chuỗi rồi ghi ngược sẽ
 * san phẳng cây: link mất `href`, đoạn `split` mất mục tiêu và hiệu ứng tách chữ
 * chết im lặng. Nên chỉ đơn vị nào là MỘT đoạn phẳng duy nhất mới cho sửa như
 * chuỗi; số còn lại hiện chữ đã ghép nhưng chỉ đọc.
 *
 * Trên bản nháp hôm nay: 45 phẳng, 15 có cấu trúc.
 */

import type { ContentOverride, Doc, Node, NodeId, RichText } from '@/lib/doc/types';
import { plainText } from '@/lib/render/richtext';
import { applyOverride } from '@/lib/render/instance';
import {
  isParamField, listParamPaths, paramField, paramKindLabel, paramPathOf, type ParamField,
} from '@/lib/render/param-paths';

/** Cây component để đi xuyên instance. Vắng mặt thì instance bị bỏ qua. */
export type ComponentTrees = ReadonlyMap<string, { rootId: string; nodes: Record<string, Node> }>;

/**
 * Dấu tách địa chỉ của một đơn vị chữ NẰM TRONG instance: `instanceId/localId`.
 *
 * `/` chứ không phải `:` vì khoá ảnh chụp bản dịch đã là `locale:nodeId:field`
 * và tách bằng `:`. Và cả hai an toàn theo CẤU TRÚC, không phải theo quy ước:
 * `zNodeId` cấm cả hai ký tự trong id node.
 */
export const INSTANCE_SEP = '/';

export function instanceAddress(instanceId: NodeId, localId: NodeId): string {
  return `${instanceId}${INSTANCE_SEP}${localId}`;
}

/** `instanceId/localId` → hai mảnh. Trả `null` với địa chỉ node thường. */
export function parseInstanceAddress(
  address: string,
): { instanceId: string; localId: string } | null {
  const at = address.indexOf(INSTANCE_SEP);
  if (at <= 0 || at === address.length - 1) return null;
  return { instanceId: address.slice(0, at), localId: address.slice(at + 1) };
}

/**
 * Trường dịch được. Khớp với `field` trong bảng `Translation`.
 *
 * ## Vì sao không chỉ có chữ
 *
 * Tới 11/09/2026 danh sách này có bốn giá trị, tất cả là chữ, và kiểu tên là
 * `TextField`. Hệ quả: một trang hai ngôn ngữ dùng CÙNG một tấm ảnh, cùng một
 * video, và cùng một đường dẫn cho nút — kể cả khi ảnh đó có chữ tiếng Việt in
 * lên nó, thứ rất hay gặp ở ảnh hero và ảnh quảng cáo.
 *
 * Ba khoá thêm vào đều đã có sẵn chỗ nhận ở `ContentOverride`, nên tầng render
 * không phải đổi gì cho đơn vị nằm trong instance — xem `OVERRIDE_FIELD` ở
 * `render/translations.ts`.
 *
 * `href` giải một chuyện thứ hai, quan trọng không kém: **nút đổi ngôn ngữ trên
 * site**. Bản dịch phủ lên CÙNG một doc, nên trước đây một nút
 * `href: "/en/trang-chu"` trỏ tới đúng chỗ đó ở cả hai bản — tức trên trang tiếng
 * Anh nó link về chính nó. Giờ bản EN phủ `label: "VI"` + `href: "/trang-chu"`.
 */
export type BaseTranslatableField =
  | 'content'
  | 'label'
  | 'alt'
  | 'a11yLabel'
  | 'assetId'
  | 'posterAssetId'
  | 'href';

/**
 * Họ `param:<đường dẫn>` — chữ nằm trong `params` của Composite (nhãn/placeholder/gợi
 * ý của Form, trường chữ của composite gói dự án…). Đường dẫn là khoá trong params,
 * chỉ số mảng là số: `param:fields.2.label`, `param:fields.0.placeholder`.
 *
 * Tách khỏi `BaseTranslatableField` vì nó là một HỌ mở (số ô của Form không cố định),
 * nên các bảng `Record<…>` phải khai đủ trên phần gốc, còn họ này đi qua nhánh riêng.
 */
export type TranslatableField = BaseTranslatableField | ParamField;

/**
 * Ô nhập nào cho trường nào, ở bảng Văn bản.
 *
 * Hàm chứ không phải một field trên `TextUnit`: nó suy ra hoàn toàn từ `field`,
 * và một bản sao trong dữ liệu là một bản sao sẽ lệch.
 */
export function fieldValueKind(field: TranslatableField): 'text' | 'asset' | 'href' {
  if (field === 'assetId' || field === 'posterAssetId') return 'asset';
  if (field === 'href') return 'href';
  // `param:*` luôn là chuỗi trần: ô nhập một dòng, không RichText, không asset.
  return 'text';
}

export interface TextUnit {
  nodeId: NodeId;
  field: TranslatableField;
  /** `Text`, `Button`, `Image`… — để bày nhãn loại. */
  nodeType: Node['type'];
  /** `h1`, `p`, `nút`, `alt`, `a11y` — nhãn ngắn hiện trong bảng. */
  kind: string;
  /** Đường dẫn tổ tiên, để định vị mà không cần mở cây node. */
  path: string;
  /** Chữ đã ghép phẳng, dùng để hiện và để tìm. */
  text: string;
  /**
   * Sửa được bằng ô nhập một dòng mà không mất thông tin.
   *
   * `false` với `RichText` có nhiều hơn một inline node, hoặc node duy nhất
   * không phải `text`.
   */
  flat: boolean;
  /** Node đang bị khoá — AI và cả bảng Văn bản đều không được sửa. */
  locked: boolean;
  /**
   * Đơn vị này nằm BÊN TRONG một instance.
   *
   * Quan trọng vì đường ghi khác hẳn: node thường ghi bằng `setText`/`setProps`,
   * còn đây ghi bằng `setOverride` — và ghi nhầm đường sẽ sửa vào cây component,
   * tức là đổi mọi trang đang dùng nó thay vì đổi một chỗ.
   */
  inInstance?: { instanceId: NodeId; localId: NodeId; componentId: string };
  /**
   * Đơn vị đang dùng nội dung của component (chưa có override riêng).
   *
   * Giao diện cần phân biệt: "giống component" khác hẳn "đã sửa riêng thành ra
   * trùng nhau" — cái thứ nhất sẽ đổi theo khi component đổi, cái thứ hai thì không.
   */
  fromComponent?: boolean;
}

/** `RichText` chỉ gồm đúng một đoạn chữ trần. */
export function isFlatRichText(rt: RichText | undefined): boolean {
  if (!rt) return false;
  return rt.length === 1 && rt[0]!.t === 'text';
}

/**
 * Chuỗi → `RichText` phẳng.
 *
 * Chỉ được gọi cho đơn vị `flat`. Gọi cho đơn vị có cấu trúc là chỗ mất dữ liệu.
 */
export function flatRichText(text: string): RichText {
  return [{ t: 'text', v: text }];
}

/**
 * Đường dẫn tổ tiên, bỏ node gốc.
 *
 * Bỏ gốc vì mọi hàng đều có nó — một cột mà mọi dòng bắt đầu giống nhau thì
 * không phân biệt được gì, chỉ chiếm chỗ.
 */
function ancestorPath(doc: Doc, id: NodeId): string {
  const parts: string[] = [];
  let cur = doc.nodes[id];
  // Trần 32 tầng: doc hỏng có thể có vòng parentId, và vòng đó sẽ treo request.
  for (let hop = 0; cur?.parentId && hop < 32; hop++) {
    const parent = doc.nodes[cur.parentId];
    if (!parent) break;
    parts.unshift(parent.name ?? parent.type);
    cur = parent;
  }
  return parts.slice(1).join(' › ');
}

function unitsForNode(doc: Doc, node: Node): TextUnit[] {
  const out: TextUnit[] = [];
  const base = {
    nodeId: node.id,
    nodeType: node.type,
    path: ancestorPath(doc, node.id) || '(gốc)',
    locked: Boolean(node.locked),
  };

  if (node.type === 'Text') {
    out.push({
      ...base,
      field: 'content',
      kind: node.tag,
      text: plainText(node.content),
      flat: isFlatRichText(node.content),
    });
  }

  if (node.type === 'Button') {
    out.push({
      ...base,
      field: 'label',
      kind: 'nút',
      text: plainText(node.label),
      flat: isFlatRichText(node.label),
    });
    // Chỉ action dạng `link` mới có `href` để dịch. Bày ô cho `anchor`/`submit`
    // là mời người ta gõ vào một chỗ mà `applyOverride` cố ý bỏ qua.
    if (node.action.kind === 'link') {
      out.push({ ...base, field: 'href', kind: 'đường dẫn', text: node.action.href, flat: true });
    }
  }

  // `alt` của ảnh trang trí là chuỗi rỗng HỢP LỆ theo schema, và nó vẫn phải hiện
  // trong bảng: nếu ẩn đi thì không có cách nào phát hiện một ảnh có nội dung mà
  // bị đánh dấu trang trí nhầm.
  if (node.type === 'Image') {
    out.push({ ...base, field: 'alt', kind: 'alt', text: node.alt, flat: true });
    out.push({ ...base, field: 'assetId', kind: 'ảnh', text: node.assetId ?? '', flat: true });
  }

  /*
   * Video có HAI đơn vị: file và ảnh chờ.
   *
   * Ảnh chờ thường là thứ mang chữ (một khung hình có tiêu đề in lên), nên nó là
   * cái hay cần dịch hơn cả file video. Gộp hai thứ vào một đơn vị thì đổi ảnh
   * chờ sẽ đổi luôn video.
   */
  if (node.type === 'Video') {
    out.push({ ...base, field: 'assetId', kind: 'video', text: node.assetId ?? '', flat: true });
    out.push({
      ...base,
      field: 'posterAssetId',
      kind: 'ảnh chờ',
      text: node.posterAssetId ?? '',
      flat: true,
    });
  }

  /*
   * Composite: chữ nằm trong params. Đọc params THÔ (không qua schema) để giá trị mặc
   * định của `.catch()`/`.default()` không thành đơn vị ma — xem `param-paths.ts`.
   */
  if (node.type === 'Composite') {
    for (const { path, text } of listParamPaths(node.composite, node.params)) {
      out.push({
        ...base,
        field: paramField(path),
        kind: paramKindLabel(path),
        text,
        flat: true,
      });
    }
  }

  if (node.a11y?.label) {
    out.push({
      ...base,
      field: 'a11yLabel',
      kind: 'a11y',
      text: node.a11y.label,
      flat: true,
    });
  }

  return out;
}

/**
 * Mọi đơn vị chữ của một doc, theo thứ tự cây.
 *
 * Theo thứ tự CÂY, không theo thứ tự khoá của `doc.nodes`: soát chữ là đọc trang
 * từ trên xuống, và một bảng sắp theo id ngẫu nhiên thì không đọc tuần tự được.
 */
export function extractUnits(doc: Doc, components?: ComponentTrees): TextUnit[] {
  const out: TextUnit[] = [];
  const seen = new Set<NodeId>();

  const walk = (id: NodeId) => {
    // Doc hỏng có thể có vòng children. Không chặn thì đệ quy vô hạn.
    if (seen.has(id)) return;
    seen.add(id);

    const node = doc.nodes[id];
    if (!node) return;

    if (node.type === 'Instance') {
      out.push(...unitsForInstance(doc, node, components));
      return;
    }

    out.push(...unitsForNode(doc, node));
    for (const child of node.children) walk(child);
  };

  walk(doc.rootId);
  return out;
}

/**
 * Đơn vị chữ bên trong một instance.
 *
 * Đi trên cây COMPONENT nhưng lấy chữ theo bản ĐÃ PHỦ override — đó là thứ trang
 * thật hiện, và là thứ người dùng đang nhìn khi họ mở bảng Văn bản.
 *
 * `path` ghép từ tên instance rồi tới đường dẫn trong component, để cột Vị trí
 * vẫn định vị được: "Thẻ sản phẩm › card › tiêu đề" đọc ra ngay, còn "tiêu đề"
 * trần thì không.
 */
function unitsForInstance(
  doc: Doc,
  instance: Extract<Node, { type: 'Instance' }>,
  components?: ComponentTrees,
): TextUnit[] {
  const tree = components?.get(instance.componentId);
  // Không có cây component thì không có gì để bày. Im lặng: instance mồ côi đã
  // được renderer xử lý, và bảng Văn bản không phải chỗ báo lỗi đó.
  if (!tree) return [];

  const out: TextUnit[] = [];
  const seen = new Set<string>();
  const instanceName = instance.name ?? 'Component';
  const basePath = ancestorPath(doc, instance.id);

  const walk = (localId: string, localPath: string) => {
    if (seen.has(localId)) return;
    seen.add(localId);

    const source = tree.nodes[localId];
    if (!source) return;

    const override = instance.overrides[localId];
    const resolved = applyOverride(source, override);

    for (const unit of unitsForNode(doc, resolved)) {
      out.push({
        ...unit,
        nodeId: instanceAddress(instance.id, localId),
        path: [basePath, instanceName, localPath].filter(Boolean).join(' › '),
        // Node của component bị khoá thì instance cũng không sửa được: khoá nằm
        // ở nội dung, không ở chỗ nội dung được dùng.
        locked: Boolean(source.locked) || Boolean(instance.locked),
        inInstance: {
          instanceId: instance.id,
          localId,
          componentId: instance.componentId,
        },
        fromComponent: !hasOverrideFor(override, unit.field),
      });
    }

    const childPath = [localPath, source.name ?? source.type].filter(Boolean).join(' › ');
    for (const child of source.children) walk(child, childPath);
  };

  walk(tree.rootId, '');
  return out;
}

/**
 * Trường này đã có override riêng chưa.
 *
 * Mọi `TranslatableField` đều là một khoá của `ContentOverride` — đó là bất biến
 * mà `OVERRIDE_FIELD` ở `render/translations.ts` dựa vào, và nó giữ hàm này chỉ
 * còn một dòng.
 */
function hasOverrideFor(override: ContentOverride | undefined, field: TranslatableField): boolean {
  if (!override) return false;
  if (isParamField(field)) return override.params?.[paramPathOf(field)] !== undefined;
  return override[field] !== undefined;
}

/** Khoá ổn định của một đơn vị. Cùng dạng với `@@unique` của `Translation`. */
export function unitKey(nodeId: NodeId, field: TranslatableField): string {
  return `${nodeId}:${field}`;
}

/**
 * Vân tay của bản gốc lúc dịch.
 *
 * Dùng để phát hiện "bản gốc đã đổi sau khi dịch" — trạng thái mà bản tiếng Anh
 * nói một đằng, tiếng Việt nói một nẻo, và không ai biết cái nào mới.
 *
 * Không dùng crypto: hàm này chạy cả ở client (để bảng tự đánh dấu ngay sau khi
 * sửa) và `node:crypto` không có ở đó. Đây không phải mục đích bảo mật — chỉ cần
 * "chuỗi đổi thì vân tay đổi", và va chạm chỉ dẫn tới một nhãn cảnh báo bị bỏ
 * sót, không dẫn tới mất dữ liệu.
 */
export function sourceHash(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}
