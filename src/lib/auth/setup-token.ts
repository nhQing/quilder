/**
 * Mã cài đặt cho màn tạo tài khoản đầu tiên.
 *
 * ## Vấn đề nó giải
 *
 * Màn `/builder/setup` là một endpoint CÔNG KHAI, không cần đăng nhập, và nó cấp
 * quyền admin. Chặn duy nhất bằng "bảng User còn rỗng" là chưa đủ: container lên
 * trước khi người vận hành kịp mở trình duyệt, và bot quét cổng tính bằng giây.
 * WordPress dính chuyện này nhiều lần; Portainer phải thêm timeout vì đã có người
 * bị chiếm quyền đúng theo cách đó.
 *
 * ## Vì sao KHÔNG lưu token vào database
 *
 * Bản đầu định thêm bảng `SetupToken`. Không cần: token dẫn xuất từ `AUTH_SECRET`
 * bằng HMAC, nên hai bên tính ra cùng một chuỗi mà không ai phải lưu gì. Tính
 * "một lần" đến từ chỗ khác và chắc hơn — endpoint tự đóng vĩnh viễn ngay khi có
 * tài khoản đầu tiên. Không bảng mới, không migration, không state để dọn.
 *
 * Kẻ tấn công không biết `AUTH_SECRET`, nên không đoán được token. Người vận hành
 * thì đọc nó từ `docker logs`.
 *
 * ## Vì sao 16 ký tự hex
 *
 * 64 bit entropy. Cửa sổ tấn công là khoảng thời gian giữa lúc container lên và
 * lúc bạn tạo tài khoản — vài phút. Đoán 2^64 trong vài phút là không thể, và một
 * chuỗi ngắn thì người ta còn chép tay được từ log.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

/** Đổi khi định dạng token đổi, để token cũ không còn hợp lệ. */
const PURPOSE = 'quilder:setup:v1';

export function setupToken(authSecret: string): string {
  if (!authSecret) throw new Error('AUTH_SECRET rỗng — không sinh được mã cài đặt');
  return createHmac('sha256', authSecret).update(PURPOSE).digest('hex').slice(0, 16);
}

/**
 * So bằng `timingSafeEqual`.
 *
 * So bằng `===` làm rò rỉ số ký tự khớp qua thời gian trả lời. Với một endpoint
 * cấp quyền admin thì đó là kênh phụ đáng bịt, kể cả khi cửa sổ chỉ vài phút.
 */
export function setupTokenMatches(authSecret: string, given: unknown): boolean {
  if (typeof given !== 'string' || !given) return false;
  const expected = Buffer.from(setupToken(authSecret));
  const actual = Buffer.from(given);
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}
