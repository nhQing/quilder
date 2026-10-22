/**
 * Template tiêu đề cho cả site, ví dụ `%s · Tiệm Bánh Mai`.
 *
 * Hàm thuần: server dùng khi lưu (kiểm) và khi phát metadata (Next tự áp
 * `title.template`), khung xem trước SEO trong builder dùng `applyTitleTemplate` để
 * hiện đúng tiêu đề khách sẽ thấy.
 */

export const MAX_TITLE_TEMPLATE = 120;
export const MAX_SEO_DESCRIPTION = 300;

/** `null` = hợp lệ. Template rỗng là hợp lệ: nghĩa là tắt. */
export function checkTitleTemplate(template: string): string | null {
  const t = template.trim();
  if (!t) return null;
  if (t.length > MAX_TITLE_TEMPLATE) return `Template tiêu đề tối đa ${MAX_TITLE_TEMPLATE} ký tự.`;
  const count = t.split('%s').length - 1;
  if (count !== 1) {
    return 'Template phải chứa đúng một "%s" — chỗ tiêu đề của từng trang, ví dụ "%s · Tên site".';
  }
  return null;
}

/** Tiêu đề trang sau khi bọc template — đúng thứ Next phát ra trong `<title>`. */
export function applyTitleTemplate(template: string | null | undefined, title: string): string {
  const t = template?.trim();
  if (!t || checkTitleTemplate(t)) return title;
  return t.replace('%s', title);
}
