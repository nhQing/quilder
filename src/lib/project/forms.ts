/**
 * Bộ nhận form PHÍA SERVER của gói dự án (`projects/<tên>/forms.ts`, nạp qua `@project/forms`).
 *
 * ## Vì sao có chỗ này
 *
 * Form của builder gửi tới một URL trong `Site.globals.endpoint`. Thường đó là một BE
 * khác. Nhưng có những nơi nhận cần secret riêng của một website (ghi Excel qua
 * Microsoft Graph, gửi mail qua SendGrid) mà không đáng dựng một service riêng: gói
 * dự án khai handler ở đây, lõi mở nó ở `POST /api/forms/<key>`, và endpoint của form
 * chỉ là URL của chính site — cùng origin, không CORS.
 *
 * Secret đọc từ biến môi trường của container lúc chạy, KHÔNG từ globals hay doc: hai
 * chỗ đó đi vào release, vào API công khai và vào tay AI.
 *
 * File này và `@project/forms` CHỈ được nạp từ route server. Đừng import chúng từ
 * component hay effect — handler mang secret.
 */

export interface FormHandlerContext {
  /** Đoạn `<key>` của `/api/forms/<key>`. */
  key: string;
}

/**
 * Nhận request gốc, trả response. Hợp đồng với composite `Form` của lõi:
 * - 2xx: form hiện `successMessage` (hoặc `userMessage` trong JSON nếu có).
 * - Mã khác: form hiện `userMessage` trong JSON nếu có, không thì `errorMessage` của
 *   form. `field` (tên ô) trong JSON đánh dấu ô sai (`aria-invalid`).
 */
export type FormHandler = (request: Request, ctx: FormHandlerContext) => Promise<Response>;

/**
 * Request đến từ origin không nằm trong `FORMS_ALLOWED_ORIGINS` → chặn.
 *
 * Danh sách lấy từ biến môi trường (vd `https://maimoney.com,https://www.maimoney.com`),
 * KHÔNG so với header `Host`: sau reverse proxy, `Host` thường là tên container nội bộ,
 * và so với nó sẽ chặn mọi khách thật. Biến trống → không chặn theo origin (captcha và
 * giới hạn tần suất của handler vẫn chạy). Không có header `Origin` (curl, server gọi
 * server) → cho qua để handler tự quyết.
 */
export function crossOrigin(request: Request, allowed = process.env.FORMS_ALLOWED_ORIGINS ?? ''): boolean {
  const list = allowed
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, '').toLowerCase())
    .filter(Boolean);
  if (!list.length) return false;
  const origin = request.headers.get('origin');
  if (!origin) return false;
  return !list.includes(origin.replace(/\/+$/, '').toLowerCase());
}
