import 'server-only';

/**
 * Token xác nhận cho thao tác phá huỷ: "tôi đã xem ĐÚNG danh sách này".
 *
 * ## Vấn đề nó giải
 *
 * Thao tác phá huỷ có hai bước: xem trước (dry-run) rồi xác nhận. Giữa hai bước, thế
 * giới vẫn chạy: có người publish một release dùng chính tấm ảnh sắp xoá, có bài mới
 * trỏ tới nó. Người bấm "Xoá" đang xác nhận một danh sách có thể đã cũ — và lỗi chỉ lộ
 * ra khi rollback về release đó và ảnh không còn.
 *
 * Mẫu là Webstudio (`confirmation-token.ts`): dry-run trả về một token là chữ ký của
 * CHÍNH thứ được xem; bước thực hiện tính lại thứ đó và chỉ chạy khi chữ ký khớp. Danh
 * sách đổi → chữ ký đổi → bước thực hiện từ chối và bảo xem lại.
 *
 * ## Dùng
 *
 *   // dry-run: trả `plan` cho UI, kèm token
 *   const token = issueConfirm('assets.purge', { ids, oldReleases });
 *
 *   // thực hiện: tính lại plan TỪ DB, rồi mới kiểm
 *   const check = verifyConfirm(body.confirmToken, 'assets.purge', { ids, oldReleases });
 *   if (!check.ok) return 409 + check.reason
 *
 * Payload nên là thứ người dùng THẤY (id, tên release sẽ vỡ), không phải toàn bộ hàng
 * DB: đổi một cột không liên quan không nên bắt người ta xem lại.
 *
 * Không lưu gì: token tự mang hạn và chữ ký HMAC bằng `AUTH_SECRET`, cùng lý lẽ với
 * `setup-token.ts`. Không bảng mới, không state để dọn.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

/** Đủ để đọc danh sách và bấm; ngắn để token rơi ở đâu đó không dùng lại được lâu. */
export const CONFIRM_TTL_MS = 5 * 60_000;

/** JSON với khoá sắp xếp: cùng dữ liệu ra cùng chuỗi, bất kể thứ tự khai báo. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function secret(): string {
  const value = process.env.AUTH_SECRET;
  if (!value || value.length < 32) throw new Error('AUTH_SECRET thiếu hoặc ngắn hơn 32 ký tự');
  return value;
}

function sign(action: string, payload: unknown, exp: number): string {
  return createHmac('sha256', secret())
    .update(canonical({ action, payload, exp }))
    .digest('base64url');
}

export function issueConfirm(
  action: string,
  payload: unknown,
  now: number = Date.now(),
): string {
  const exp = now + CONFIRM_TTL_MS;
  return `${exp.toString(36)}.${sign(action, payload, exp)}`;
}

export type ConfirmCheck =
  | { ok: true }
  | { ok: false; reason: 'missing' | 'malformed' | 'expired' | 'changed' };

/**
 * Token có đúng là chữ ký của (action, payload) này, và còn hạn không.
 *
 * `changed` gộp cả "payload đã đổi" lẫn "token của hành động khác": cả hai đều có nghĩa
 * là thứ người dùng đã xem không phải thứ sắp được làm, và câu trả lời là xem lại.
 */
export function verifyConfirm(
  token: unknown,
  action: string,
  payload: unknown,
  now: number = Date.now(),
): ConfirmCheck {
  if (typeof token !== 'string' || !token) return { ok: false, reason: 'missing' };
  const [expPart, mac] = token.split('.');
  const exp = expPart ? parseInt(expPart, 36) : NaN;
  if (!mac || !Number.isFinite(exp)) return { ok: false, reason: 'malformed' };
  if (now > exp) return { ok: false, reason: 'expired' };

  const expected = Buffer.from(sign(action, payload, exp));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return { ok: false, reason: 'changed' };
  }
  return { ok: true };
}

/** Câu trả lời cho người dùng, theo lý do. */
export function confirmMessage(reason: Exclude<ConfirmCheck, { ok: true }>['reason']): string {
  switch (reason) {
    case 'missing':
    case 'malformed':
      return 'Thiếu xác nhận. Xem trước danh sách rồi bấm xác nhận lại.';
    case 'expired':
      return 'Xác nhận đã hết hạn (5 phút). Xem lại danh sách rồi xác nhận.';
    case 'changed':
      return 'Danh sách đã đổi từ lúc bạn xem (có thứ mới tham chiếu tới nó). Xem lại trước khi xoá.';
  }
}
