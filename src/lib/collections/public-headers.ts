/**
 * Header cho namespace công khai — MỘT chỗ.
 *
 * Bốn route trả về cùng một loại dữ liệu, nên bốn bản CORS và bốn bản ETag là bốn
 * chỗ để lệch nhau. Và lệch ở đây không lộ ra ngay: một route thiếu
 * `Access-Control-Allow-Origin` chỉ vỡ ở trình duyệt của người khác.
 */

import { createHash } from 'node:crypto';

/**
 * Allowlist, KHÔNG phải `*` mặc định.
 *
 * Nội dung vốn công khai, nên `*` không rò rỉ gì. Nhưng allowlist là chỗ duy nhất
 * để về sau gắn quota theo origin — và thêm nó sau khi đã ship `*` là một thay đổi
 * phá vỡ với mọi client đang gọi.
 *
 * App mobile không gửi `Origin` và không có CORS, nên rỗng KHÔNG chặn chúng: nó chỉ
 * chặn trang web của bên thứ ba gọi từ trình duyệt.
 */
function allowed(): string[] {
  return (process.env.PUBLIC_API_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function corsHeaders(origin: string | null): Record<string, string> {
  const list = allowed();
  const ok = origin && (list.includes(origin) || list.includes('*'));
  return {
    ...(ok ? { 'access-control-allow-origin': origin } : {}),
    'access-control-allow-methods': 'GET, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400',
    // `vary: origin` là bắt buộc khi header trên phụ thuộc origin: thiếu nó thì CDN
    // phục vụ bản đã cache của origin A cho origin B, và lỗi chỉ hiện ở trình duyệt
    // của người thứ hai.
    vary: 'origin, accept-encoding',
  };
}

export function etagOf(payload: unknown): string {
  return `W/"${createHash('sha1').update(JSON.stringify(payload)).digest('base64url').slice(0, 27)}"`;
}

export function jsonPublic(
  payload: unknown,
  opts: { origin: string | null; ifNoneMatch: string | null; maxAge?: number },
): Response {
  const etag = etagOf(payload);
  const headers: Record<string, string> = {
    ...corsHeaders(opts.origin),
    etag,
    'content-type': 'application/json; charset=utf-8',
    // `s-maxage` cho CDN, `stale-while-revalidate` để một lượt hết hạn không làm
    // client đầu tiên phải chờ truy vấn.
    'cache-control': `public, s-maxage=${opts.maxAge ?? 60}, stale-while-revalidate=300`,
  };

  // 304 tiết kiệm cả băng thông lẫn thời gian dựng JSON ở client. Với một danh sách
  // 100 bài thì đó là vài trăm KB cho mỗi lần mở app.
  if (opts.ifNoneMatch === etag) return new Response(null, { status: 304, headers });

  return new Response(JSON.stringify(payload), { status: 200, headers });
}

/**
 * Mã lỗi MÁY ĐỌC — tập ĐÓNG.
 *
 * Câu tiếng Việt trong `error` là để người đọc; nó được phép đổi chữ bất cứ lúc nào.
 * Một client muốn phân biệt "tham số sai" với "không có loại nội dung" mà chỉ có câu
 * đó thì phải so khớp chuỗi tiếng Việt — và lần đầu ai đó sửa một dấu phẩy trong câu
 * là lần app ngoài kia rẽ nhánh sai, im lặng.
 *
 *  - `bad_param`    — 400, tham số không hợp lệ. Sửa URL.
 *  - `unknown_type` — 404, không có loại nội dung đó. Đọc lại `/types`.
 *  - `not_found`    — 404, không có nội dung đó (hoặc còn nháp, hoặc hẹn giờ chưa tới
 *                     — API cố ý không phân biệt ba ca này).
 */
export type PublicErrorCode = 'bad_param' | 'unknown_type' | 'not_found' | 'unknown_view' | 'view_invalid';

/**
 * Lỗi cũng phải mang CORS.
 *
 * Không mang thì một client trình duyệt nhận "TypeError: Failed to fetch" thay vì
 * câu tiếng Việt giải thích tham số nào sai — tức lớp thông báo lỗi mà cả
 * `public-params.ts` tồn tại để tạo ra sẽ không tới được người đọc.
 */
export function errorPublic(
  error: string,
  status: number,
  origin: string | null,
  code: PublicErrorCode,
): Response {
  return new Response(JSON.stringify({ error, code }), {
    status,
    headers: { ...corsHeaders(origin), 'content-type': 'application/json; charset=utf-8' },
  });
}

export function preflight(origin: string | null): Response {
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}
