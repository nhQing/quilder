/**
 * View của API công khai — một đường gọi NGẮN do admin đặt sẵn.
 *
 * ## Vấn đề
 *
 * Một màn của app mobile cần một lời gọi dài: `fields=…&populate[faq]=question,answer&
 * sort=…&pageSize=…`. Gõ chuỗi đó vào app nghĩa là mỗi lần đổi một field là một lần phát
 * hành app, và client có thể xin bất cứ thứ gì API cho phép.
 *
 * View lưu chuỗi ấy (gọi là A) dưới một khoá: app gọi `/api/public/v1/views/<khoá>` và
 * server tự bung ra A trong CÙNG lượt — không redirect. Redirect là hai lượt mạng, và
 * app vẫn nhận lại nguyên A, tức không gọn hơn gì.
 *
 * ## Client đổi được gì
 *
 * Chỉ những nhóm tham số admin đã cho phép (`VIEW_CLIENT_PARAMS`). `fields` và `populate`
 * KHÔNG BAO GIỜ nằm trong danh sách đó: chúng là hình dạng của payload, tức đúng phần
 * view tồn tại để cố định. Cho đổi chúng là quay về API tự do dưới một cái tên ngắn.
 *
 * File thuần, không DB — phần tra cấu trúc loại nằm ở `api-view-store.ts`.
 */

/**
 * Nhóm tham số client được gửi kèm, nếu view cho phép. Thứ tự này là thứ tự hiện trên
 * màn quản lý.
 */
export const VIEW_CLIENT_PARAMS = ['page', 'pageSize', 'locale', 'taxonomy', 'sort', 'filter', 'format'] as const;
export type ViewClientParam = (typeof VIEW_CLIENT_PARAMS)[number];

/** Mọi tham số mà `parsePublicParams` hiểu — query đã lưu chỉ được chứa những thứ này. */
const KNOWN_PARAMS = new Set(['page', 'pageSize', 'sort', 'taxonomy', 'locale', 'format', 'fields', 'populate', 'filter']);

/** Khoá nằm trên URL: chữ thường, số, gạch ngang, không mở hay đóng bằng gạch. */
export const VIEW_KEY_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

/** `filter[price][gt]` → `filter`, `populate[faq]` → `populate`, còn lại giữ nguyên. */
function paramGroup(key: string): string {
  const i = key.indexOf('[');
  return i > 0 ? key.slice(0, i) : key;
}

/**
 * Chuỗi admin dán vào → dạng chuẩn để lưu.
 *
 * Tham số lạ bị TỪ CHỐI: `parsePublicParams` bỏ qua khoá nó không biết, nên một chữ gõ
 * sai (`field=` thay vì `fields=`) sẽ làm view trả MỌI field, im lặng. Ở màn quản lý,
 * báo ngay lúc lưu rẻ hơn nhiều so với phát hiện qua dung lượng payload của app.
 */
export function normalizeViewQuery(raw: string): { ok: true; query: string } | { ok: false; error: string } {
  const sp = new URLSearchParams(raw.trim().replace(/^\?/, ''));
  for (const key of sp.keys()) {
    if (!KNOWN_PARAMS.has(paramGroup(key))) {
      return { ok: false, error: `Tham số "${key}" không phải tham số của API công khai` };
    }
  }
  return { ok: true, query: sp.toString() };
}

/**
 * Query đã lưu + tham số client → tham số đưa vào đường đọc công khai.
 *
 * - Tham số ngoài danh sách cho phép: 400, KHÔNG bỏ qua — cùng luật với
 *   `public-params.ts`. Bỏ qua thì app tưởng `locale=en` đã có tác dụng.
 * - `filter` của client CỘNG THÊM vào filter đã lưu (nối AND), không thay: view đặt
 *   `filter[featured][eq]=true` thì client không được nới nó ra thành mọi bài.
 * - Nhóm còn lại THAY giá trị đã lưu, cả nhóm một lượt — `sort` của client thay cả
 *   danh sách sort, không trộn hai thứ tự.
 */
export function mergeViewParams(
  stored: string,
  client: URLSearchParams,
  allow: readonly string[],
): { ok: true; params: URLSearchParams } | { ok: false; error: string } {
  const out = new URLSearchParams(stored);
  const replaced = new Set<string>();

  for (const [key, value] of client.entries()) {
    const group = paramGroup(key);
    if (!allow.includes(group)) {
      return {
        ok: false,
        error: allow.length
          ? `View này không cho đổi "${key}"; chỉ nhận: ${allow.join(', ')}`
          : `View này không nhận tham số nào (đã gửi "${key}")`,
      };
    }
    if (group !== 'filter' && !replaced.has(key)) {
      out.delete(key);
      replaced.add(key);
    }
    out.append(key, value);
  }
  return { ok: true, params: out };
}

export interface ViewInput {
  key: string;
  name: string;
  typeKey: string;
  query: string;
  allow: string[];
}

/** Kiểm phần không cần DB. Query theo cấu trúc loại thì `api-view-store.ts` kiểm. */
export function checkViewInput(v: ViewInput): { ok: true } | { ok: false; error: string } {
  if (!VIEW_KEY_RE.test(v.key)) {
    return { ok: false, error: 'Khoá chỉ gồm chữ thường, số và gạch ngang (tối đa 64 ký tự)' };
  }
  if (!v.name.trim()) return { ok: false, error: 'Thiếu tên view' };
  if (v.name.trim().length > 120) return { ok: false, error: 'Tên view tối đa 120 ký tự' };
  if (!v.typeKey) return { ok: false, error: 'Chưa chọn loại nội dung' };
  const bad = v.allow.find((a) => !(VIEW_CLIENT_PARAMS as readonly string[]).includes(a));
  if (bad) return { ok: false, error: `Không cho client đổi "${bad}" được` };
  return { ok: true };
}
