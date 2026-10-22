/**
 * Link "trỏ tới một element" — dựng ở editor, đọc ở tool MCP `open_builder_link`.
 *
 * ## Vì sao là URL https thật chứ không phải mã riêng
 *
 * Chủ site dán link vào chat với Claude kèm một yêu cầu. Một URL thật vừa bấm được ở trình
 * duyệt (mở editor đúng chỗ) vừa đọc được bằng máy (model gọi tool, tool tách tham số). Một
 * mã riêng thì chỉ có một trong hai.
 *
 * ## Ba hình dạng, vì ba nơi một element có thể đứng
 *
 *  - Node của trang:              `/builder/<pageId>?node=<nodeId>`
 *  - Phần tử BÊN TRONG một instance trên trang (canvas trang chỉ chọn được cả Instance, nên
 *    thêm `cn` = id local của phần tử bên trong):
 *                                 `/builder/<pageId>?node=<instanceId>&cn=<localId>`
 *  - Node trong chế độ sửa component:
 *                                 `/builder/<pageId>?component=<componentId>&node=<localId>`
 *
 * `&locale=<mã>` thêm vào khi editor đang ở bản dịch — để lệnh "sửa chữ" của model đi qua
 * `set_translation` thay vì ghi đè bản gốc.
 *
 * File THUẦN (không React, không prisma): UI dùng để dựng, tool dùng để tách, test dùng cả hai.
 */

import type { Doc, Node, NodeId } from '@/lib/doc/types';
import { ancestorPath, labelOf } from './node-label';

/** Cây component tối thiểu để tra nhãn phần tử bên trong instance. */
export type LinkComponentTrees = ReadonlyMap<string, { nodes: Record<string, Node> }>;

export type AiLinkKind = 'page-node' | 'instance-child' | 'component-node';

/** Thứ editor biết về chỗ người dùng đang trỏ vào. */
export interface AiLinkSource {
  /** `window.location.origin`. */
  origin: string;
  /** Trang đang mở editor. Ở chế độ component nó chỉ là "chỗ đứng", không phải đích. */
  pageId: string;
  nodeId: NodeId;
  /** Id local của phần tử bên trong instance, khi click rơi vào trong một instance. */
  innerLocalId?: string | null;
  /** Có mặt = đang sửa component này (nodeId là id local trong cây component). */
  componentId?: string | null;
  /** `null` = bản gốc. */
  locale?: string | null;
}

/** Link đã tách. Tool và EditorShell cùng đọc hình dạng này. */
export interface ParsedAiLink {
  kind: AiLinkKind;
  /** Gốc URL của link — rỗng nếu dán đường dẫn tương đối. */
  origin: string;
  pageId: string;
  node: string;
  cn: string | null;
  component: string | null;
  locale: string | null;
}

export type ParseAiLinkResult = { ok: true; link: ParsedAiLink } | { ok: false; error: string };

export function buildAiLink(src: AiLinkSource): string {
  const q = new URLSearchParams();
  // Thứ tự khoá cố định: link ổn định thì so sánh và đọc bằng mắt đều dễ.
  if (src.componentId) q.set('component', src.componentId);
  q.set('node', src.nodeId);
  if (!src.componentId && src.innerLocalId) q.set('cn', src.innerLocalId);
  if (src.locale) q.set('locale', src.locale);
  return `${src.origin.replace(/\/+$/, '')}/builder/${encodeURIComponent(src.pageId)}?${q.toString()}`;
}

/** Bỏ ký tự làm hỏng dòng một-dòng: xuống dòng, và hai dấu tách `›` `—` của chính dòng. */
function clean(label: string): string {
  return label.replace(/[\r\n]+/g, ' ').replace(/[›—]/g, '-').replace(/\s+/g, ' ').trim();
}

/** Số tổ tiên giữ lại trong dòng chép — đủ để model đối chiếu, không dài thành đoạn văn. */
const MAX_PATH = 2;

export interface TargetDescription {
  /** Nhãn tổ tiên từ trên xuống, KHÔNG gồm gốc doc và chính node; đã cắt còn vài bậc. */
  path: string[];
  /** Nhãn node đích (với instance-child: "<instance> › <phần tử bên trong>"). */
  label: string;
  /** Nhãn phần tử bên trong instance, nếu có. */
  innerLabel: string | null;
}

/**
 * Mô tả đích bằng nhãn — đúng cái chữ người dùng thấy trong cây Lớp, để model đối chiếu
 * được "đây có phải node mình tưởng không".
 */
export function describeTarget(
  doc: Doc,
  nodeId: NodeId,
  opts: { innerLocalId?: string | null; components?: LinkComponentTrees } = {},
): TargetDescription | null {
  const path = ancestorPath(doc, nodeId);
  const self = path.at(-1);
  if (!self) return null;

  // Bỏ gốc: tên trang/component đứng thay nó ở đầu dòng.
  const between = path.slice(1, -1).map((n) => clean(labelOf(n)));
  const trimmed = between.length > MAX_PATH ? ['…', ...between.slice(-MAX_PATH)] : between;

  let innerLabel: string | null = null;
  if (opts.innerLocalId && self.type === 'Instance') {
    const inner = opts.components?.get(self.componentId)?.nodes[opts.innerLocalId];
    innerLabel = inner ? clean(labelOf(inner)) : clean(opts.innerLocalId);
  }

  const own = clean(labelOf(self));
  return { path: trimmed, label: innerLabel ? `${own} › ${innerLabel}` : own, innerLabel };
}

/** Dòng một-dòng đưa vào clipboard. `rootName` = tên trang hoặc tên component. */
export function buildClipboardLine(args: {
  rootName: string;
  description: TargetDescription;
  url: string;
}): string {
  const parts = [clean(args.rootName) || 'Trang', ...args.description.path, args.description.label];
  return `[Quilder] ${parts.join(' › ')} — ${args.url}`;
}

/* ── Tách link ────────────────────────────────────────────────────────── */

/**
 * Tìm URL đầu tiên chứa `/builder/` trong một khối chữ bất kỳ.
 *
 * Nhận cả dòng chép ("[Quilder] Trang › … — https://…"), link markdown `[x](https://…)` và
 * link bọc `<…>`; đó đều là thứ một người dán vào chat. Dấu câu dính cuối (`.`, `,`, `)`)
 * bị bỏ: nó là của câu văn bao quanh, không phải của URL.
 */
export function findBuilderUrl(text: string): string | null {
  const m = /[^\s<>"'`()[\]]*\/builder\/[^\s<>"'`()[\]]*/.exec(text);
  if (!m) return null;
  let s = m[0];
  const scheme = s.search(/https?:\/\//i);
  s = scheme >= 0 ? s.slice(scheme) : s.slice(s.indexOf('/builder/'));
  return s.replace(/[.,;:!?]+$/, '');
}

const BAD_ID = /[\s/:]/;

export function parseAiLink(text: string): ParseAiLinkResult {
  const raw = findBuilderUrl(text);
  if (!raw) {
    return { ok: false, error: 'Không thấy link builder (dạng …/builder/<pageId>?node=…) trong nội dung đã dán.' };
  }

  let url: URL;
  try {
    // Gốc giả cho link tương đối; `origin` thật chỉ lấy khi link có scheme.
    url = new URL(raw, 'http://relative.invalid');
  } catch {
    return { ok: false, error: `Link builder bị hỏng, không đọc được: ${raw}` };
  }

  const m = /^\/builder\/([^/]+)\/?$/.exec(url.pathname);
  if (!m) return { ok: false, error: `Link không trỏ tới một trang trong builder: ${raw}` };

  let pageId: string;
  try {
    pageId = decodeURIComponent(m[1]!);
  } catch {
    return { ok: false, error: `Mã trang trong link bị hỏng: ${m[1]}` };
  }
  if (!pageId || BAD_ID.test(pageId)) return { ok: false, error: `Mã trang trong link không hợp lệ: ${pageId}` };

  const get = (k: string): string | null => {
    const v = url.searchParams.get(k)?.trim();
    return v ? v : null;
  };
  const node = get('node');
  const component = get('component');
  const cn = get('cn');
  const locale = get('locale');

  if (!node) {
    return { ok: false, error: 'Link không có `node=` — hãy copy lại link bằng nút "Copy link cho AI" sau khi chọn element.' };
  }
  for (const [name, v] of [['node', node], ['cn', cn], ['component', component]] as const) {
    if (v && BAD_ID.test(v)) return { ok: false, error: `Tham số \`${name}\` trong link không hợp lệ: ${v}` };
  }

  const kind: AiLinkKind = component ? 'component-node' : cn ? 'instance-child' : 'page-node';
  const origin = /^https?:\/\//i.test(raw) ? url.origin : '';

  return {
    ok: true,
    link: { kind, origin, pageId, node, cn: component ? null : cn, component, locale },
  };
}
