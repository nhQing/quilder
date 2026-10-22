import type { Doc, NodeId } from '@/lib/doc/types';

/**
 * Các `Instance` của một component trên trang, THEO THỨ TỰ trên trang (duyệt sâu từ gốc).
 *
 * Thứ tự là thứ người dùng thấy: bấm một mục ở pane Component lần lượt đi từ trên xuống
 * dưới qua từng chỗ dùng — không theo thứ tự khoá trong `doc.nodes`, vốn là thứ tự tạo.
 */
export function instancesOf(doc: Doc, componentId: string): NodeId[] {
  const out: NodeId[] = [];
  const stack: NodeId[] = [doc.rootId];
  const seen = new Set<NodeId>();
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const node = doc.nodes[id];
    if (!node) continue;
    if (node.type === 'Instance' && node.componentId === componentId) out.push(id);
    const kids = (node.children ?? []) as NodeId[];
    for (let i = kids.length - 1; i >= 0; i -= 1) stack.push(kids[i]!);
  }
  return out;
}
