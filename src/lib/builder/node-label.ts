/**
 * Tên hiển thị của một node, và đường dẫn tổ tiên của nó.
 *
 * ## Vì sao ở file riêng
 *
 * `labelOf` sống trong `LayerTree.tsx` từ đầu, và lát 2 của giao diện v2 cần đúng nó ở
 * đầu panel Inspector. Chép sang là hai bản của một luật, và thứ trôi mất khi chúng
 * lệch nhau rất cụ thể: cây bên trái gọi node là "Tiêu đề", đầu panel gọi nó là "Text",
 * và người dùng không biết mình đang sửa đúng thứ mình vừa chọn hay không.
 *
 * Hàm thuần ở file thuần — cùng luật với `toSlug`. Không import store, không import
 * component, nên test không phải dựng gì.
 */

import type { Doc, Node, NodeId } from '@/lib/doc/types';

/**
 * Nhãn hiển thị: tên tác giả đặt, hoặc đoạn text đầu, hoặc chính type.
 *
 * Cắt ở 28 ký tự: nhãn dài hơn thế không lọt một hàng cây ở pane 300px, và `truncate`
 * của CSS thì im lặng — cắt ở đây để cả cây, đầu panel và tooltip cắt giống nhau.
 */
export function labelOf(node: Node): string {
  if (node.name) return node.name;
  if (node.type === 'Text') {
    const first = node.content.find((c) => c.t === 'text');
    if (first && 'v' in first && first.v.trim()) return first.v.trim().slice(0, 28);
  }
  if (node.type === 'Composite') return node.composite;
  return node.type;
}

/**
 * Đường từ GỐC xuống tới `nodeId`, gồm cả chính nó. Rỗng nếu node không tồn tại.
 *
 * Trả node chứ không trả nhãn: chỗ gọi cần `id` để chọn được tổ tiên khi bấm, và cần
 * `type` để tô màu. Gọi `labelOf` ở tầng render.
 *
 * `seen` chặn treo nếu doc có cycle. Doc hợp lệ không có cycle, nhưng hàm này chạy
 * trên mỗi lần render của panel — một vòng lặp vô hạn ở đây làm treo cả tab, và
 * `applyOps` không phải là thứ duy nhất từng ghi vào `parentId`.
 */
export function ancestorPath(doc: Doc, nodeId: NodeId): Node[] {
  const out: Node[] = [];
  const seen = new Set<NodeId>();
  let cur: NodeId | null = nodeId;

  while (cur && !seen.has(cur)) {
    const node: Node | undefined = doc.nodes[cur];
    if (!node) break;
    seen.add(cur);
    out.push(node);
    cur = node.parentId;
  }

  return out.reverse();
}
