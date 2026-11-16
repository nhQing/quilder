/**
 * Phần thuần của effect `filter` — tách riêng để test không cần DOM.
 *
 * Giá trị lọc so khớp theo dạng CHUẨN HOÁ: bỏ dấu, `đ` → `d`, chữ thường, mọi cụm
 * ký tự không phải chữ/số thành một dấu `-`. Nhờ vậy `?place=Ha-Noi`, `ha-noi`,
 * `Hà Nội` và chữ "Hà Nội" in trên thẻ là cùng một giá trị — người gõ URL tay hay
 * dán link từ chỗ khác đều trúng.
 */

export function normalizeFilterValue(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Giá trị lọc mà một link chọn: tham số `param` trong query của `href`, đã chuẩn
 * hoá. Không có tham số (vd "Tất cả" trỏ `/events`) là chuỗi rỗng = bỏ lọc.
 */
export function filterValueFromHref(href: string | null | undefined, param: string, base: string): string {
  if (!href) return '';
  try {
    return normalizeFilterValue(new URL(href, base).searchParams.get(param));
  } catch {
    return '';
  }
}

/**
 * Giá trị đang áp dụng: giá trị trên URL nếu nó trùng một lựa chọn có thật, không
 * thì bỏ lọc. `?place=da-nang` khi không có nút Đà Nẵng mà lọc thật thì ra một lưới
 * rỗng không lối thoát — hiện tất cả và sáng nút "Tất cả" thì người xem còn chọn lại.
 */
export function resolveActive(urlValue: string, options: readonly string[]): string {
  return urlValue && options.includes(urlValue) ? urlValue : '';
}

/** Một mục hiện khi không lọc, khi mục không mang giá trị, hoặc khi giá trị trùng. */
export function itemVisible(active: string, itemValue: string): boolean {
  return !active || !itemValue || itemValue === active;
}

/** URL mới sau khi chọn `value`: đặt hoặc gỡ `param`, giữ nguyên phần còn lại. */
export function hrefWithFilter(current: string, param: string, value: string): string {
  const url = new URL(current);
  if (value) url.searchParams.set(param, value);
  else url.searchParams.delete(param);
  return url.pathname + url.search + url.hash;
}
