/**
 * Token nào được bày cho ô nào — và cách bày giá trị của nó cho gọn.
 *
 * ## Vì sao ô không khai loại thì KHÔNG có token (21/10/2026)
 *
 * Trước đây `tokenCategory` vắng nghĩa là "mọi token": ô `inline-size` liệt kê đủ 469
 * token, gồm cả `dur-*`, `ease-*` và màu — danh sách vô nghĩa, và là nguồn chính của lời
 * phàn nàn "quá nhiều thông tin". Ô nào muốn token thì phải nói loại nào.
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
  const narrow = NAME_PREFIX[kind];
  if (narrow) return tokens.filter((t) => t.category === narrow.category && t.name.startsWith(narrow.prefix));
  return tokens.filter((t) => t.category === kind);
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
