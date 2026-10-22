/**
 * `src/styles/tokens.css` → tập token thật, dạng hàm thuần.
 *
 * ## Vì sao file này phải tồn tại
 *
 * Bug tìm ra 25/08/2026: `pnpm tokens:import` nạp SAI giá trị cho 7 token màu.
 * `import-tokens.ts` dùng `root.walkDecls()` — duyệt MỌI khai báo `--*` bất kể
 * selector — kèm ghi chú "khai báo sau ghi đè khai báo trước, giống hệt cách
 * cascade hoạt động".
 *
 * Lập luận đó đúng cho hai `:root` liên tiếp, và SAI ở đây: khối cuối
 * `tokens.css` là `[data-theme="light"]`, một selector **có điều kiện**. Cascade
 * chỉ áp nó khi thuộc tính có mặt — mà `(site)/layout.tsx` render
 * `<html data-theme="dark">`. Kết quả: bảng `Token` giữ giá trị theme SÁNG trong
 * khi site render theme TỐI, cho `color-bg`, `color-fg`, `color-muted`,
 * `color-line`, `color-line-strong`, `color-veil`, `color-glass`.
 *
 * Nó hỏng im lặng theo cách tệ nhất: TÊN token vẫn hợp lệ nên validator vẫn nhận,
 * chỉ có GIÁ TRỊ mà người và AI đọc để chọn màu là ngược. Ai tính tương phản với
 * `color-bg` tưởng nền sáng sẽ viết chữ không đọc được trên một trang gần đen.
 *
 * ## Vì sao là hàm thuần nhận chuỗi
 *
 * Hai script cần nó (`import-tokens.ts` ghi DB, `check-tokens.ts` đối chiếu), và
 * một luật nằm ở hai bản sẽ trôi. Nhận `css: string` chứ không tự đọc đĩa để test
 * được bằng fixture ngay trong file test — cùng lý do `static-css.ts` nhận
 * `readFile` thay vì tự đọc.
 */

import postcss, { type Declaration, type Rule } from 'postcss';

export interface TokenDecl {
  value: string;
  /** Comment kèm theo — provenance kiểu "FIGMA VAR Neutral/900". */
  comment: string | null;
}

/** Điểm vào, tương đối gốc repo. */
export const TOKENS_CSS = 'src/styles/tokens.css';

function commentFor(decl: Declaration): string | null {
  const inline = decl.raws.value?.raw?.match(/\/\*([\s\S]*?)\*\//)?.[1];
  if (inline?.trim()) return inline.trim();
  const prev = decl.prev();
  if (prev?.type === 'comment') return prev.text.trim().split('\n')[0]?.trim() ?? null;
  return null;
}

/**
 * Token mà site THẬT SỰ dùng: chỉ khai báo trong `:root`.
 *
 * Khai báo sau trong cùng `:root` (hoặc trong một `:root` thứ hai) vẫn ghi đè cái
 * trước — đó là cascade thật. Cái bị loại là khai báo dưới selector khác.
 */
export function rootTokens(css: string): Map<string, TokenDecl> {
  const root = postcss.parse(css);
  const out = new Map<string, TokenDecl>();

  root.walkDecls((decl) => {
    if (!decl.prop.startsWith('--')) return;
    const parent = decl.parent as Rule | undefined;
    if (parent?.type !== 'rule') return;
    // `:root` nằm trong `@media` là giá trị THEO KHỔ MÀN (bộ `--lv-*` đổi gutter
    // và nhịp dọc theo breakpoint), không phải giá trị của token. Cho nó qua thì
    // khối đứng sau cùng thắng, và bảng Token ghi `--lv-gutter: 24px` — số của
    // mobile — làm giá trị gốc.
    if (parent.parent?.type === 'atrule') return;
    // `:root, html` cũng tính — tách theo dấu phẩy rồi so từng phần.
    const selectors = parent.selector.split(',').map((s) => s.trim());
    if (!selectors.includes(':root')) return;

    out.set(decl.prop.slice(2), { value: decl.value.trim(), comment: commentFor(decl) });
  });

  return out;
}

/**
 * MỌI tên token được khai báo ở bất cứ đâu trong file, kể cả trong khối theme.
 *
 * Khác `rootTokens` một cách có chủ đích: câu hỏi "tên này có tồn tại không" khác
 * câu hỏi "giá trị đang dùng là gì". Một token chỉ khai trong
 * `[data-theme="light"]` vẫn là một tên hợp lệ để tham chiếu — nó chỉ rỗng ở theme
 * tối. `check-tokens.ts` cần bản này cho phép kiểm "tham chiếu mà chưa khai báo".
 */
export function allDeclaredNames(css: string): Set<string> {
  const root = postcss.parse(css);
  const names = new Set<string>();
  root.walkDecls((decl) => {
    if (decl.prop.startsWith('--')) names.add(decl.prop.slice(2));
  });
  return names;
}

/** Tên token chỉ tồn tại dưới một selector theme, không có ở `:root`. */
export function themeOnlyNames(css: string): string[] {
  const atRoot = rootTokens(css);
  return [...allDeclaredNames(css)].filter((n) => !atRoot.has(n)).sort();
}
