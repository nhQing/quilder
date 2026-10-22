/**
 * Bảng `Site.globals.endpoint`: khoá → URL mà `Form` gửi tới và `NavChart` đọc số.
 *
 * ## Vì sao có module riêng, tách khỏi bảng "Biến của site"
 *
 * `endpoint` là một OBJECT trong `globals`, nên bảng khoá–giá trị chung chỉ bày nó
 * dưới dạng JSON khoá lại (xem `SiteSettingsForm`). Kết quả: builder cho tạo form mà
 * không có chỗ nào đặt được nơi form gửi tới — thiếu URL thì form hiện vô hiệu kèm
 * lý do, và cách duy nhất để sửa là một dev ghi thẳng database.
 *
 * Phần kiểm khoá/URL nằm ở đây để ô nhập ở màn Cài đặt (client), route ghi và test
 * dùng chung MỘT luật. Phần "form nào dùng khoá nào" ở `endpoint-usage.ts` (cần registry).
 */

import { ENDPOINT_KEY } from './site-bindings';

/** Cùng luật với `endpointKey` trong params của `Form` / `NavChart` (registry). */
export const ENDPOINT_KEY_RE = /^[a-z][a-z0-9-]{0,39}$/;

/** URL dài hơn thế này không phải endpoint, là dữ liệu dán nhầm. */
const URL_MAX = 2000;

export type EndpointTable = Record<string, string>;

/**
 * Đọc bảng từ `globals`. Bỏ qua giá trị không phải chuỗi: bảng do người gõ tay vào
 * database có thể lẫn thứ khác, và màn hình không được vỡ vì nó.
 */
export function readEndpointTable(globals: Record<string, unknown> | undefined): EndpointTable {
  const raw = globals?.[ENDPOINT_KEY];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return Object.fromEntries(
    Object.entries(raw as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === 'string'),
  );
}

/**
 * Kiểm một bảng trước khi ghi. Trả lỗi đầu tiên — đủ để người dùng sửa từng chỗ.
 *
 * Chỉ http(s): `siteEndpoint` lúc render cũng chỉ nhận vậy (một `javascript:` ở đây là
 * XSS qua đường cấu hình), và nhận ở đây mà render từ chối thì form tắt im lặng.
 */
export function checkEndpointTable(table: EndpointTable): string | null {
  for (const [key, url] of Object.entries(table)) {
    if (!ENDPOINT_KEY_RE.test(key)) {
      return `Khoá "${key}" không hợp lệ: chữ thường, số và gạch ngang, bắt đầu bằng chữ, tối đa 40 ký tự.`;
    }
    if (typeof url !== 'string' || !url.trim()) return `Khoá "${key}" chưa có URL.`;
    if (url.length > URL_MAX) return `URL của "${key}" dài quá ${URL_MAX} ký tự.`;
    if (!/^https?:\/\//i.test(url)) return `URL của "${key}" phải bắt đầu bằng https:// (hoặc http://).`;
    try {
      new URL(url);
    } catch {
      return `URL của "${key}" không hợp lệ.`;
    }
  }
  return null;
}

/**
 * Cảnh báo không chặn lưu: trang chạy https gửi form tới `http://` bị trình duyệt chặn
 * (mixed content) — form "gửi" mà không tới đâu. Localhost được miễn vì đó là máy dev.
 */
export function insecureEndpoint(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  } catch {
    return false;
  }
}

/**
 * Khoá mới cho một form "tách URL riêng": slug từ tên form, không trùng khoá đã có.
 *
 * Người dùng không đặt khoá — ở màn Cài đặt họ nghĩ theo FORM, không theo khoá. Nên khoá
 * phải tự đọc được ("form-danh-sach-cho", không phải "k7f2") để ai mở Inspector hay bảng
 * dữ liệu sau này vẫn nhận ra nó thuộc form nào.
 */
export function suggestEndpointKey(label: string, taken: ReadonlySet<string>): string {
  const slug = label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^[^a-z]+/, '')
    .replace(/-+$/, '')
    .slice(0, 34)
    .replace(/-+$/, '');
  const base = slug || 'form';
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) {
    const key = `${base}-${i}`;
    if (!taken.has(key)) return key;
  }
}
