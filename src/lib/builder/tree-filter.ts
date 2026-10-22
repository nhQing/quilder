/**
 * Lọc cây node theo từ khoá.
 *
 * ## Vì sao lọc phải GIỮ CẢ TỔ TIÊN
 *
 * Trả về một danh sách phẳng các node khớp thì rẻ hơn, nhưng nó vứt mất thứ duy
 * nhất làm cây có ích: biết node đang tìm nằm ở đâu. Trang chủ có 149 node và 27
 * node trong đó không có tên nên hiện trùng nhau ("Text", "Text"…). Danh sách
 * phẳng bốn dòng "Text" không giúp gì; "hero → hero_inner → Text" thì có.
 *
 * Nên kết quả gồm: node khớp, MỌI tổ tiên của nó, và không gì khác.
 *
 * ## Bỏ dấu trước khi so
 *
 * Gõ "tieu de" phải tìm ra "Tiêu đề". Người ta gõ nhanh và không bỏ dấu — bắt họ
 * gõ đúng dấu là biến ô tìm thành thứ chỉ dùng được khi đã biết chính xác cần tìm gì.
 */

import type { Doc, NodeId } from '@/lib/doc/types';

/** Bỏ dấu, thường hoá. Cùng phép chuẩn hoá mà `find_nodes` của lớp AI dùng. */
export function fold(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase();
}

export interface FilterResult {
  /** Id được hiển thị: node khớp cộng mọi tổ tiên của chúng. */
  visible: ReadonlySet<NodeId>;
  /** Chỉ những node THẬT SỰ khớp — để tô sáng, phân biệt với tổ tiên. */
  matched: ReadonlySet<NodeId>;
}

/**
 * @param label Hàm lấy nhãn hiển thị của một node — dùng lại `labelOf` của cây
 *              để ô tìm khớp đúng thứ người dùng đang nhìn thấy, không phải một
 *              trường nội bộ nào khác.
 */
export function filterTree(
  doc: Doc,
  query: string,
  label: (id: NodeId) => string,
): FilterResult | null {
  const needle = fold(query.trim());
  // Query rỗng trả `null` chứ không phải "tất cả": bên gọi dùng nó để đi đúng
  // đường render cũ, nên không có ô tìm nào thì hành vi y hệt trước đây.
  if (!needle) return null;

  const matched = new Set<NodeId>();
  const visible = new Set<NodeId>();

  for (const id of Object.keys(doc.nodes)) {
    if (!fold(label(id)).includes(needle)) continue;
    matched.add(id);

    // Đi ngược lên gốc. `seen` chặn vòng lặp vô hạn nếu doc có cycle — validator
    // cấm cycle, nhưng một hàm duyệt cây không nên treo cả builder khi dữ liệu sai.
    let cursor: NodeId | null = id;
    const seen = new Set<NodeId>();
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      visible.add(cursor);
      cursor = doc.nodes[cursor]?.parentId ?? null;
    }
  }

  return { visible, matched };
}

/**
 * Thụt lề, có trần.
 *
 * Ở độ sâu 7, `depth × 12 + 8` chiếm 92px trong pane 240px cố định — gần 40% bề
 * rộng chỉ để thụt lề, và tên node bị ép vào phần còn lại. Sau cấp 6, mỗi cấp
 * chỉ thêm 4px: vẫn thấy được là sâu hơn, mà không ăn hết chỗ của chữ.
 */
export function indentFor(depth: number): number {
  const full = Math.min(depth, 6) * 12;
  const rest = Math.max(0, depth - 6) * 4;
  // Trần cứng ở 40% pane. Quá mức này thì thêm thụt lề không nói thêm được gì —
  // người ta không đếm được "cấp 14 hay cấp 15" bằng mắt — mà vẫn ăn hết chỗ của
  // tên node. Cây thật sâu 7 cấp, nên trần chỉ chạm tới khi dữ liệu bất thường.
  return Math.min(full + rest + 8, 96);
}
