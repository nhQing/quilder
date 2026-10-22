/**
 * Phủ override nội dung lên một node của component.
 *
 * Hàm thuần, không DOM, không DB — cùng lý do như `translations.ts`: đây là chỗ
 * dễ sai nhất của mô hình instance, và nó phải test được mà không dựng gì.
 *
 * ## Vì sao KHÔNG sửa tại chỗ
 *
 * Cây component đến từ một cache dùng chung cho mọi instance trên trang. Ghi vào
 * nó nghĩa là override của instance thứ nhất rò rỉ sang instance thứ hai — hai
 * thẻ sản phẩm cùng component sẽ hiện cùng một chữ, và lỗi đó chỉ xuất hiện khi
 * có từ hai instance trở lên.
 *
 * ## Vì sao chỉ nội dung
 *
 * Xem `ContentOverride` trong `doc/types.ts`. Ngắn gọn: style và cấu trúc luôn
 * theo component, nếu không thì sau sáu tháng mỗi trang một kiểu.
 */

import type { ContentOverride, Node, RichText } from '@/lib/doc/types';
import { applyParamMap } from '@/lib/render/param-paths';

/** Giá trị có đúng hình dạng cho trường đó không. */
function valid(key: keyof ContentOverride, value: unknown): boolean {
  switch (key) {
    case 'content':
    case 'label':
      return Array.isArray(value);
    case 'assetId':
    case 'posterAssetId':
      // `null` là GIÁ TRỊ thật ở đây: "dùng asset của component".
      return value === null || (typeof value === 'string' && value.length > 0);
    default:
      return typeof value === 'string';
  }
}

/**
 * Node của component + override → node để render.
 *
 * Trả về ĐÚNG object cũ khi không có gì để ghi đè: giữ nguyên reference là điều
 * kiện để React bỏ qua được nhánh không đổi, và để cache còn ý nghĩa.
 *
 * Override sai hình dạng bị BỎ QUA, không ném: dữ liệu có thể vào doc qua một
 * bản schema cũ hơn, và một chuỗi hỏng không đáng làm cả trang trắng.
 */
export function applyOverride(node: Node, override: ContentOverride | undefined): Node {
  if (!override) return node;

  let out: Node | null = null;
  const copy = (): Node => (out ??= { ...node } as Node);

  if (node.type === 'Text' && valid('content', override.content)) {
    (copy() as { content: RichText }).content = override.content!;
  }

  if (node.type === 'Button') {
    if (valid('label', override.label)) {
      (copy() as { label: RichText }).label = override.label!;
    }
    // `href` chỉ có nghĩa với action dạng link. Ghi đè lên `anchor` hay `submit`
    // sẽ tạo ra một action lai không hợp lệ với schema.
    if (node.action.kind === 'link' && valid('href', override.href)) {
      (copy() as { action: { kind: 'link'; href: string } }).action = {
        ...node.action,
        href: override.href!,
      };
    }
  }

  // `Video` có HAI nguồn asset, và cho tới 11/09/2026 không nguồn nào phủ được:
  // hàm này chưa từng có nhánh Video, nên một video trong component là cùng một
  // file ở mọi instance và mọi ngôn ngữ.
  if (node.type === 'Video') {
    if ('assetId' in override && valid('assetId', override.assetId)) {
      (copy() as { assetId: string | null }).assetId = override.assetId!;
    }
    if ('posterAssetId' in override && valid('posterAssetId', override.posterAssetId)) {
      (copy() as { posterAssetId: string | null }).posterAssetId = override.posterAssetId!;
    }
  }

  if (node.type === 'Image') {
    if (valid('alt', override.alt)) (copy() as { alt: string }).alt = override.alt!;
    if ('assetId' in override && valid('assetId', override.assetId)) {
      (copy() as { assetId: string | null }).assetId = override.assetId!;
    }
  }

  // Chữ trong params của Composite (nhãn mục lục, nhãn ô nhập của Form…). Phải phủ
  // TRƯỚC khi composite parse params: renderer đọc `node.params`, nên chỗ này là
  // chỗ duy nhất để một instance (footer có Form) đổi được chữ mà không đổi component.
  // `applyParamMap` nhân bản dọc đường đi — params gốc nằm trong cây component dùng
  // chung, sửa tại chỗ là rò rỉ sang instance khác.
  if (node.type === 'Composite' && override.params && typeof override.params === 'object') {
    const next = applyParamMap(node.params, override.params);
    if (next !== node.params) (copy() as { params: unknown }).params = next;
  }

  if (valid('a11yLabel', override.a11yLabel)) {
    // `a11y` là object lồng, nên phải nhân bản nó nữa — sửa tại chỗ sẽ ghi thẳng
    // vào cây component đang dùng chung.
    copy().a11y = { ...node.a11y, label: override.a11yLabel! };
  }

  return out ?? node;
}

/**
 * Mọi assetId nằm trong STYLE của một node — ảnh nền, mọi lớp.
 *
 * Một hàm dùng chung cho ba chỗ (`collectAssetIds` ở `page.ts`, `instanceAssetIds`
 * ngay dưới, `assetVars` ở `NodeRenderer.tsx`) vì ba chỗ đó phải đồng ý với nhau về
 * "node này cần ảnh nào": nạp thiếu thì renderer không có URL để định nghĩa
 * `--asset-<id>`, và `background-image: var(…)` rơi về `none` — không lỗi, không
 * cảnh báo. Chép phép duyệt này ra ba bản là hẹn ngày chúng lệch nhau.
 *
 * `states` phải duyệt riêng: nó là lớp LỒNG một cấp (tên state → style), nên
 * `Object.values(style)` đọc trúng cái hộp chứa các state chứ không đọc từng state.
 * Vòng lặp cũ ở `page.ts` đứt đúng chỗ đó.
 */
export function styleAssetIds(node: Node): string[] {
  const ids: string[] = [];

  const take = (layer: unknown): void => {
    const id = (layer as { fill?: { image?: { assetId?: string } } })?.fill?.image?.assetId;
    if (id) ids.push(id);
  };

  for (const [key, layer] of Object.entries(node.style ?? {})) {
    if (key === 'states') for (const st of Object.values(layer ?? {})) take(st);
    else take(layer);
  }

  return ids;
}

/**
 * Tham số effect nào chứa assetId.
 *
 * Nơi ĐỊNH NGHĨA (trước nằm ở `builder/asset-refs.ts`, file đó giờ re-export): phải ở
 * đây vì `instanceAssetIds` bên dưới cũng cần nó mà `asset-refs` đã import file này —
 * để bảng ở bên kia sẽ thành import vòng. Vì sao khai theo TÊN THAM SỐ chứ không quét
 * mù, và nhớ thêm dòng khi có effect mới mang asset: xem docblock ở `asset-refs.ts`.
 */
export const EFFECT_ASSET_PARAMS: Record<string, readonly string[]> = {
  'image-sequence': ['frames', 'framesNarrow', 'framesSuper'],
};

/** Mọi assetId nằm trong tham số effect của một node (lô khung image-sequence). */
export function effectAssetIds(node: Node): string[] {
  const out: string[] = [];
  for (const a of node.effects ?? []) {
    const keys = EFFECT_ASSET_PARAMS[a.effect];
    if (!keys) continue;
    for (const key of keys) {
      const value = (a.params as Record<string, unknown> | undefined)?.[key];
      if (!Array.isArray(value)) continue;
      for (const id of value) if (typeof id === 'string' && id) out.push(id);
    }
  }
  return out;
}

/** Mọi assetId mà một instance THẬT SỰ render, kể cả ảnh đến từ override. */
export function instanceAssetIds(
  tree: { nodes: Record<string, Node> },
  overrides: Record<string, ContentOverride>,
): string[] {
  const ids = new Set<string>();

  for (const [localId, node] of Object.entries(tree.nodes)) {
    const resolved = applyOverride(node, overrides[localId]);
    if (resolved.type === 'Image' && resolved.assetId) ids.add(resolved.assetId);
    if (resolved.type === 'Video') {
      if (resolved.assetId) ids.add(resolved.assetId);
      if (resolved.posterAssetId) ids.add(resolved.posterAssetId);
    }
    // Ảnh NỀN của node trong component. Thiếu dòng này thì compiler vẫn phát
    // `background-image: var(--asset-…)` cho node ấy, renderer không có URL để
    // định nghĩa biến, và khối im lặng không có nền.
    for (const id of styleAssetIds(resolved)) ids.add(id);
    // Lô khung của effect gắn trên node trong component (header/footer có thể mang
    // image-sequence). Thiếu dòng này thì `collectEffects` không có URL để đổi.
    for (const id of effectAssetIds(resolved)) ids.add(id);
  }

  return [...ids];
}

/**
 * Wrapper của instance có nên "trong suốt" về bố cục (`display: contents`) không.
 *
 * ## Vì sao cần
 *
 * Instance render ra `<div data-n data-c>` bọc cây component. Một header
 * `position: sticky` nằm TRONG wrapper đó bị giới hạn bởi chính wrapper (cao đúng
 * bằng header) nên không bao giờ dính theo cuộn của trang. Wrapper `display: contents`
 * biến root của component thành con TRỰC TIẾP của cha trong doc, đúng như khi header
 * là node trang.
 *
 * ## Vì sao KHÔNG áp cho mọi instance
 *
 * - Instance có style riêng (padding, grid-column, ẩn theo breakpoint...) thì wrapper
 *   LÀ phần tử mang bố cục đó; `contents` sẽ xoá sạch nó. Nên chỉ khi instance không
 *   có style/customCss nào.
 * - Wrapper `contents` không có hộp, nên viền chọn của builder (đo `data-n` bằng
 *   getBoundingClientRect) ra 0x0. Chấp nhận được cho header sticky/fixed, nhưng áp cho
 *   cả thư viện thì viền chọn của mọi thẻ sản phẩm biến mất — nên chỉ khi root của
 *   component là sticky/fixed (thứ thực sự cần). Footer thường (normal flow) không cần:
 *   wrapper block bao nó không đổi bố cục.
 */
export function isLayoutTransparent(
  instance: Node,
  tree: { rootId: string; nodes: Record<string, Node> },
): boolean {
  if (instance.customCss) return false;
  for (const [key, layer] of Object.entries(instance.style ?? {})) {
    if (key === 'states') {
      if (Object.values(layer ?? {}).some((st) => st && Object.keys(st).length)) return false;
    } else if (layer && Object.keys(layer).length) return false;
  }

  const root = tree.nodes[tree.rootId];
  if (!root) return false;
  return Object.entries(root.style ?? {}).some(([key, layer]) => {
    if (key === 'states') return false;
    const kind = (layer as { position?: { kind?: string } } | undefined)?.position?.kind;
    return kind === 'sticky' || kind === 'fixed';
  });
}
