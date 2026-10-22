/**
 * Token nào được bày cho ô nào — và cách bày giá trị của nó cho gọn.
 *
 * ## Vì sao ô không khai loại thì KHÔNG có token (21/10/2026)
 *
 * Trước đây `tokenCategory` vắng nghĩa là "mọi token": ô `inline-size` liệt kê đủ 469
 * token, gồm cả `dur-*`, `ease-*` và màu — danh sách vô nghĩa, và là nguồn chính của lời
 * phàn nàn "quá nhiều thông tin". Ô nào muốn token thì phải nói loại nào.
 *
 * ## Vì sao token MẶC ĐỊNH không bày (22/10/2026)
 *
 * Token khai trong `src/styles/tokens.css` lõi (`step-4`, `space-m`, `color-bg`…) đi kèm
 * mọi bản cài Quilder, không phải thứ người dùng tạo ra. Bày chúng trong bộ chọn là bắt
 * người ta chọn giữa những cái tên họ không hiểu ("chả hiểu gì" — user). Bộ chọn chỉ bày
 * token của DỰ ÁN; token mặc định vẫn nằm trong CSS nên node đang mang nó render như cũ,
 * và `TokenPicker` vẫn hiện dòng của token ĐANG chọn dù nó bị lọc ở đây.
 */

import type { TokenOption } from './queries';

/**
 * Loại token của một ô. Phần lớn trùng `Token.category` (`space`, `radius`, `typeScale`,
 * `color`…); vài loại hẹp hơn một category thì lọc thêm theo tiền tố tên:
 *
 *  - `tracking` → token `tracking-*` (category `typography` còn gồm cả font, weight, leading).
 */
export type TokenKind = string;

const NAME_PREFIX: Record<string, { category: string; prefix: string }> = {
  tracking: { category: 'typography', prefix: 'tracking-' },
};

export function tokensOfKind(tokens: readonly TokenOption[], kind: TokenKind | undefined): TokenOption[] {
  if (!kind) return [];
  const own = tokens.filter((t) => !t.core);
  const narrow = NAME_PREFIX[kind];
  if (narrow) return own.filter((t) => t.category === narrow.category && t.name.startsWith(narrow.prefix));
  return own.filter((t) => t.category === kind);
}

/**
 * Giá trị token rút gọn cho một dòng trong danh sách.
 *
 * `clamp(1.15rem, 0.6rem + 2.6vw, 3.5rem)` chiếm cả dòng mà thông tin người chọn cần chỉ
 * là "từ bao nhiêu tới bao nhiêu" — thành `1.15–3.5rem ↔`. Mũi tên nói giá trị co giãn
 * theo màn, đúng như dấu ≈ ở dòng chú thích dưới ô.
 */
export function shortTokenValue(value: string): string {
  const v = value.trim();
  const clamp = /^clamp\(\s*([^,]+?)\s*,[^,]+,\s*([^)]+?)\s*\)$/.exec(v);
  if (clamp) {
    const [lo, hi] = [clamp[1]!, clamp[2]!];
    const unit = (s: string) => /[a-z%]+$/i.exec(s)?.[0] ?? '';
    const a = unit(lo) === unit(hi) ? lo.slice(0, lo.length - unit(lo).length) : lo;
    return `${a}–${hi} ↔`;
  }
  return v.length > 28 ? `${v.slice(0, 27)}…` : v;
}

/** Lọc theo ô tìm: khớp tên hoặc giá trị, không phân biệt hoa thường. */
export function matchToken(t: TokenOption, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return t.name.toLowerCase().includes(q) || t.value.toLowerCase().includes(q);
}
