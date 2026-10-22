/**
 * Băm mật khẩu bằng scrypt của node:crypto.
 *
 * KHÔNG dùng `import 'server-only'` ở đây, dù nó đúng về mặt ý định: package đó
 * ném lỗi khi được import ngoài ngữ cảnh React, nên nó chặn luôn cả
 * `scripts/create-user.ts` — một script chính đáng và cần thiết. Việc chặn đã có
 * sẵn: `node:crypto` không tồn tại trong bundle client, nên import nhầm vào
 * client là lỗi build ngay.
 *
 * Plan ghi argon2. Chọn scrypt thay thế vì một lý do vận hành cụ thể: argon2
 * trên npm cần build native hoặc tải prebuilt, và đó là một nguồn hỏng thật trên
 * Windows lẫn trong Docker alpine. scrypt nằm sẵn trong Node, không phụ thuộc gì,
 * và là một KDF được NIST khuyến nghị — đủ cho một công cụ nội bộ có SSO ở phía
 * sau. Nếu sau này bắt buộc phải dùng argon2 thì đổi đúng file này.
 *
 * KHÔNG chạy được trên Edge runtime, nên middleware không gọi nó. Middleware chỉ
 * xác minh JWT; kiểm mật khẩu là việc của route handler chạy trên Node.
 */

import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

interface ScryptOptions { N: number; r: number; p: number; maxmem: number }

const scrypt = promisify(scryptCb) as (
  password: string, salt: Buffer, keylen: number, options: ScryptOptions,
) => Promise<Buffer>;

/**
 * N=2^15, r=8 → cần 128·N·r ≈ 33.5MB mỗi lần băm. Đủ chậm cho tấn công vét, đủ
 * nhanh cho một lần đăng nhập.
 *
 * `maxmem` PHẢI khai tường minh: mặc định của Node là 32MB, tức là thấp hơn nhu
 * cầu của chính tham số này, và scrypt ném ERR_CRYPTO_INVALID_SCRYPT_PARAMS —
 * một lỗi không nói gì về nguyên nhân thật.
 */
const PARAMS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEYLEN = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEYLEN, PARAMS);
  // Ghi kèm tham số để đổi chúng sau này không làm hash cũ hết đọc được.
  return `scrypt$${PARAMS.N}$${PARAMS.r}$${PARAMS.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const [, n, r, p, saltB64, keyB64] = parts;
  const salt = Buffer.from(saltB64!, 'base64');
  const expected = Buffer.from(keyB64!, 'base64');

  const actual = await scrypt(password, salt, expected.length, {
    N: Number(n), r: Number(r), p: Number(p),
    // Đọc tham số từ chuỗi đã lưu, nên maxmem phải đủ cho tham số ĐÓ, không
    // phải cho tham số hiện tại.
    maxmem: Math.max(64 * 1024 * 1024, 256 * Number(n) * Number(r)),
  });

  // So sánh hằng thời gian: so bằng `===` để lộ độ dài tiền tố trùng khớp.
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
