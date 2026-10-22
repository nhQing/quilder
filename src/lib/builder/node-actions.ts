/**
 * Sinh op cho các thao tác cấu trúc: thêm, nhân bản, xoá, đổi thứ tự.
 *
 * Hàm thuần, không chạm React và không chạm mạng — nên test được, và nên là chỗ
 * duy nhất biết "thêm một Button nghĩa là node trông thế nào". Nhét mấy thứ này
 * vào component thì mỗi chỗ gọi sẽ tự dựng một node mặc định hơi khác nhau, rồi
 * validator từ chối một nửa trong số đó.
 *
 * Mọi hàm trả về `Op[]` đi qua đúng `/api/ops` như mọi thay đổi khác — nên chúng
 * undo được, ghi AuditLog, và không thể tạo ra trạng thái mà validator từ chối.
 */

import type { Doc, Node, NodeId, NodeType } from '@/lib/doc/types';
import { isLeafType } from '@/lib/doc/types';
import type { Op } from '@/lib/doc/ops';

/**
 * Đọc `children` như một mảng thường.
 *
 * Node lá khai `children: []` (tuple rỗng) trong schema. Trên kiểu hợp `Node`,
 * TypeScript rút `children` về `never[]`, nên `children.indexOf(id)` báo lỗi ở
 * mọi chỗ dùng. Đọc qua hàm này để chỗ gọi không phải ép kiểu lặp đi lặp lại.
 */
export function childrenOf(node: Node): NodeId[] {
  return node.children as NodeId[];
}

/** Loại node thêm được từ UI. Canvas/Video/CustomCode/Composite cần cấu hình riêng. */
export const INSERTABLE: { type: NodeType; label: string; hint: string }[] = [
  { type: 'Section', label: 'Section', hint: 'khối trang, thẻ <section>' },
  { type: 'Stack', label: 'Stack', hint: 'xếp dọc hoặc ngang' },
  { type: 'Grid', label: 'Grid', hint: 'lưới' },
  { type: 'Text', label: 'Văn bản', hint: 'tiêu đề hoặc đoạn' },
  { type: 'Button', label: 'Nút', hint: 'liên kết hoặc hành động' },
  { type: 'Image', label: 'Ảnh', hint: 'cần gán asset sau' },
];

/**
 * Id mới, không đụng id nào đang có.
 *
 * Dùng bảng chữ cái riêng thay vì `crypto.randomUUID()` vì id đi vào selector
 * CSS (`[data-n="..."]`) và vào DOM — giữ nó ngắn và chỉ gồm ký tự an toàn.
 */
export function freshId(doc: Doc, prefix = 'n'): NodeId {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  for (let attempt = 0; attempt < 50; attempt++) {
    let id = prefix;
    for (let i = 0; i < 8; i++) {
      id += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    if (!doc.nodes[id]) return id;
  }
  throw new Error('Không sinh được id mới');
}

/**
 * Node mặc định cho từng type.
 *
 * Phải hợp lệ NGAY với validator — `Image` bắt buộc có alt hoặc `decorative`,
 * `Button` bắt buộc có action và variant. Một node mặc định thiếu field sẽ bị từ
 * chối và người dùng chỉ thấy "op không hợp lệ" mà không hiểu vì sao.
 *
 * Cố ý KHÔNG kèm style: node mới trông trơ trụi, và như vậy là đúng — người
 * dùng thấy ngay mình phải làm gì tiếp, thay vì phải gỡ những giá trị mình không
 * chọn.
 */
export function blankNode(type: NodeType, id: NodeId, parentId: NodeId): Node {
  // `children: []` phải là tuple rỗng chứ không phải `NodeId[]`: node lá khai
  // `children: []` trong schema, và `NodeId[]` không gán được vào đó.
  const base = { id, parentId, children: [] as [], effects: [], style: { base: {} } };

  switch (type) {
    case 'Section':
      return { ...base, type: 'Section', tag: 'section', name: 'Section' } as Node;
    case 'Stack':
      return {
        ...base, type: 'Stack', name: 'Stack',
        direction: { base: 'column' },
        style: { base: { layout: { display: 'flex' } } },
      } as Node;
    case 'Grid':
      return { ...base, type: 'Grid', name: 'Grid', style: { base: { layout: { display: 'grid' } } } } as Node;
    case 'Text':
      return {
        ...base, type: 'Text', tag: 'p', name: 'Văn bản',
        content: [{ t: 'text', v: 'Nội dung mới' }],
      } as Node;
    case 'Button':
      return {
        ...base, type: 'Button', name: 'Nút', variant: 'primary',
        label: [{ t: 'text', v: 'Nút mới' }],
        action: { kind: 'none' },
      } as Node;
    case 'Image':
      return {
        ...base, type: 'Image', name: 'Ảnh',
        assetId: null, alt: '', decorative: true,
        fit: { base: 'cover' },
      } as Node;
    default:
      throw new Error(`Chưa hỗ trợ thêm node loại ${type} từ giao diện`);
  }
}

/**
 * Chèn node mới.
 *
 * Chèn vào TRONG node đang chọn nếu nó nhận con; nếu nó là lá thì chèn làm anh
 * em ngay sau nó. Đó là thứ người dùng mong đợi khi đang chọn một đoạn văn và
 * bấm "thêm văn bản" — họ muốn một đoạn nữa bên cạnh, không phải một lỗi.
 */
export function insertNear(
  doc: Doc,
  selectedId: NodeId | null,
  type: NodeType,
): { ops: Op[]; newId: NodeId } | { error: string } {
  const anchor = selectedId ? doc.nodes[selectedId] : doc.nodes[doc.rootId];
  if (!anchor) return { error: 'Không tìm thấy node đang chọn' };

  let parentId: NodeId;
  let index: number;

  if (!isLeafType(anchor.type)) {
    parentId = anchor.id;
    index = anchor.children.length;
  } else {
    if (!anchor.parentId) return { error: 'Node lá này không có cha để chèn cạnh' };
    parentId = anchor.parentId;
    index = childrenOf(doc.nodes[parentId]!).indexOf(anchor.id) + 1;
  }

  const parent = doc.nodes[parentId];
  if (!parent) return { error: 'Không tìm thấy node cha' };
  if (isLeafType(parent.type)) return { error: `${parent.type} không nhận node con` };

  const newId = freshId(doc);
  return {
    newId,
    ops: [{ op: 'insertNode', parentId, index, node: blankNode(type, newId, parentId) }],
  };
}

/** Đổi chỗ node với anh em liền kề. `delta` là -1 (lên) hoặc +1 (xuống). */
export function reorder(
  doc: Doc,
  nodeId: NodeId,
  delta: -1 | 1,
): { ops: Op[] } | { error: string } {
  const node = doc.nodes[nodeId];
  if (!node?.parentId) return { error: 'Node gốc không đổi thứ tự được' };

  const siblings = childrenOf(doc.nodes[node.parentId]!);
  const at = siblings.indexOf(nodeId);
  const to = at + delta;
  if (to < 0 || to >= siblings.length) return { error: 'Đã ở đầu hoặc cuối rồi' };

  return {
    ops: [{ op: 'moveNode', nodeId, newParentId: node.parentId, newIndex: to }],
  };
}

/**
 * Nhân bản.
 *
 * `duplicateNode` chỉ nhân CHÍNH node, không nhân cây con — id của từng hậu duệ
 * phải do bên gọi quyết thì op mới xác định. Nên ở đây ta tự duyệt cây và sinh
 * một op cho mỗi node, giữ đúng thứ tự cha-trước-con.
 */
export function duplicateDeep(
  doc: Doc,
  nodeId: NodeId,
): { ops: Op[]; newId: NodeId } | { error: string } {
  const node = doc.nodes[nodeId];
  if (!node) return { error: 'Không tìm thấy node' };
  if (!node.parentId) return { error: 'Không nhân bản được node gốc' };

  const parent = doc.nodes[node.parentId]!;
  const at = childrenOf(parent).indexOf(nodeId) + 1;

  // Ánh xạ id cũ → id mới, dựng trước để op con trỏ đúng cha mới.
  const mapping = new Map<NodeId, NodeId>();
  const order: NodeId[] = [];
  const walk = (id: NodeId) => {
    order.push(id);
    mapping.set(id, freshId(doc));
    for (const child of childrenOf(doc.nodes[id]!) ?? []) walk(child);
  };
  walk(nodeId);

  if (order.length > 80) {
    // Trần 80 op mỗi batch. Nói rõ thay vì để validator từ chối bằng một thông
    // điệp không liên quan gì tới thao tác người dùng vừa làm.
    return { error: `Cây này có ${order.length} node, vượt trần 80 thao tác mỗi lần.` };
  }

  const ops: Op[] = order.map((id, i) => {
    const source = doc.nodes[id]!;
    const newParent = i === 0 ? node.parentId! : mapping.get(source.parentId!)!;
    const index = i === 0 ? at : childrenOf(doc.nodes[source.parentId!]!).indexOf(id);
    return {
      op: 'insertNode',
      parentId: newParent,
      index,
      node: {
        ...structuredClone(source),
        id: mapping.get(id)!,
        parentId: newParent,
        // Để rỗng: mỗi op con tự splice mình vào children của cha. Giữ nguyên
        // mảng cũ sẽ thêm mỗi id con hai lần — cùng cái bẫy đã gặp ở `invert`.
        children: [],
        ...(i === 0 && source.name ? { name: `${source.name} (bản sao)` } : {}),
      } as Node,
    };
  });

  return { ops, newId: mapping.get(nodeId)! };
}

/** Node kế tiếp nên chọn sau khi xoá — anh em trước, hoặc cha. */
export function afterRemove(doc: Doc, nodeId: NodeId): NodeId | null {
  const node = doc.nodes[nodeId];
  if (!node?.parentId) return null;
  const siblings = childrenOf(doc.nodes[node.parentId]!);
  const at = siblings.indexOf(nodeId);
  return siblings[at - 1] ?? siblings[at + 1] ?? node.parentId;
}
