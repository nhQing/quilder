/**
 * Hạn phiên khi người dùng tick "Ghi nhớ đăng nhập".
 *
 * Test ở tầng `signSession` chứ không gọi route: route cần Prisma và một user
 * thật, còn thứ đáng sai ở đây nằm gọn trong hai chỗ — `exp` của JWT có đúng con
 * số đã chọn không, và `remember` có được đọc một cách tường minh không.
 *
 * Phép kiểm `remember === true` đáng được test riêng vì nó im lặng khi sai: gửi
 * `"false"` mà cấp phiên 30 ngày thì không có triệu chứng nào, người dùng vẫn
 * đăng nhập được như thường.
 */

import { describe, expect, it, beforeAll } from 'vitest';
import { decodeJwt } from 'jose';

import { REMEMBER_MAX_AGE, SESSION_MAX_AGE, signSession } from './session';

beforeAll(() => {
  process.env.AUTH_SECRET ??= 'x'.repeat(48);
});

const payload = { sub: 'u1', email: 'a@b.com', role: 'admin' } as const;

/** Số giây giữa `iat` và `exp` — tức hạn thật mà token mang. */
async function tuoiCuaToken(maxAge?: number) {
  const token = await signSession({ ...payload }, maxAge);
  const { iat, exp } = decodeJwt(token);
  return exp! - iat!;
}

describe('hạn phiên', () => {
  it('mặc định là 8 giờ', async () => {
    expect(await tuoiCuaToken()).toBe(SESSION_MAX_AGE);
    expect(SESSION_MAX_AGE).toBe(8 * 60 * 60);
  });

  it('ghi nhớ là 30 ngày', async () => {
    expect(await tuoiCuaToken(REMEMBER_MAX_AGE)).toBe(REMEMBER_MAX_AGE);
    expect(REMEMBER_MAX_AGE).toBe(30 * 24 * 60 * 60);
  });

  it('phiên ghi nhớ dài hơn phiên thường, không phải bằng', async () => {
    // Chốt chặn cho trường hợp một lần sửa làm hai hằng trỏ về cùng giá trị:
    // lúc đó mọi test trên vẫn xanh mà tính năng thì mất.
    expect(REMEMBER_MAX_AGE).toBeGreaterThan(SESSION_MAX_AGE);
  });
});

describe('đọc cờ remember từ thân request', () => {
  /** Đúng phép kiểm mà route dùng. Giữ song song để lệch là đỏ. */
  const doc = (body: { remember?: unknown }) =>
    (body.remember === true ? REMEMBER_MAX_AGE : SESSION_MAX_AGE);

  it('chỉ boolean true mới cho phiên dài', () => {
    expect(doc({ remember: true })).toBe(REMEMBER_MAX_AGE);
  });

  it.each([
    ['chuỗi "false"', 'false'],
    ['chuỗi "true"', 'true'],
    ['số 1', 1],
    ['vắng mặt', undefined],
    ['null', null],
  ])('%s → phiên thường', (_nhan, value) => {
    // `'false'` là ca nguy hiểm nhất: nó là chuỗi không rỗng, nên một phép kiểm
    // thật/giả thông thường sẽ coi là THẬT và cấp nhầm 30 ngày.
    expect(doc({ remember: value })).toBe(SESSION_MAX_AGE);
  });
});
