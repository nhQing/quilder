/**
 * Giá trị một token TỰ TẠO (bảng `Token`, `custom: true`) có được ghép vào stylesheet không.
 *
 * ## Vì sao không chỉ nhận mã màu nữa (21/10/2026)
 *
 * Token tự tạo từng chỉ là "màu lưu thành biến" từ bộ chọn màu, nên phép kiểm là một regex
 * hex. Từ khi Quilder tách token riêng của một dự án (vài trăm token Figma của một site)
 * khỏi `tokens.css` vào DB, token tự tạo mang cả độ dài (`24px`), `clamp(...)`, font stack,
 * bóng đổ… — regex hex loại sạch chúng và mọi `var(--mm-…)` trên trang thành rỗng.
 *
 * ## Vì sao vẫn phải chặn
 *
 * Giá trị đi THẲNG vào `:root { --tên: <giá-trị>; }` trên site công khai. Một giá trị mang
 * `;}` là thoát khỏi khai báo và chèn CSS tuỳ ý — kể cả `url()` gọi ra ngoài. Nên chặn mọi
 * ký tự và cụm cho phép thoát hay tải tài nguyên; còn lại là giá trị CSS bình thường.
 */

export const MAX_TOKEN_VALUE = 200;

/** Ký tự thoát khỏi khai báo / khối, hoặc mở HTML trong `<style>`. */
const FORBIDDEN_CHARS = /[;{}<>\\!@\r\n]/;
/** Cụm gọi tài nguyên ngoài hoặc mở comment (comment nuốt phần còn lại của khối). */
const FORBIDDEN_PARTS = /url\s*\(|expression\s*\(|image-set\s*\(|\/\*|\*\//i;

export function isSafeTokenValue(value: string): boolean {
  const v = value.trim();
  if (!v || v.length > MAX_TOKEN_VALUE) return false;
  if (FORBIDDEN_CHARS.test(v) || FORBIDDEN_PARTS.test(v)) return false;
  // Ngoặc phải cân: `clamp(1rem` thiếu ngoặc đóng làm hỏng mọi khai báo phía sau.
  let depth = 0;
  for (const ch of v) {
    if (ch === '(') depth++;
    else if (ch === ')' && --depth < 0) return false;
  }
  if (depth !== 0) return false;
  // Nháy phải chẵn (font stack `"SF Pro Display", sans-serif`).
  if ((v.match(/"/g) ?? []).length % 2 || (v.match(/'/g) ?? []).length % 2) return false;
  return true;
}
