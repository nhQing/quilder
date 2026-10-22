import { describe, expect, it } from 'vitest';

import { setupToken, setupTokenMatches } from './setup-token';

const SECRET = 'day-la-mot-auth-secret-du-dai-de-test';

describe('setupToken', () => {
  it('xác định: cùng secret ra cùng token', () => {
    expect(setupToken(SECRET)).toBe(setupToken(SECRET));
  });

  it('secret khác ra token khác', () => {
    expect(setupToken(SECRET)).not.toBe(setupToken(SECRET + 'x'));
  });

  it('16 ký tự hex', () => {
    expect(setupToken(SECRET)).toMatch(/^[0-9a-f]{16}$/);
  });

  it('secret rỗng thì ném, không trả chuỗi rỗng', () => {
    // Trả '' sẽ làm mọi token rỗng khớp nhau — tức tắt hẳn phép kiểm mà
    // không ai thấy.
    expect(() => setupToken('')).toThrow();
  });
});

describe('setupTokenMatches', () => {
  it('token đúng thì khớp', () => {
    expect(setupTokenMatches(SECRET, setupToken(SECRET))).toBe(true);
  });

  it('token sai thì không khớp', () => {
    expect(setupTokenMatches(SECRET, 'deadbeefdeadbeef')).toBe(false);
  });

  it('không khớp với thứ không phải chuỗi, và với chuỗi rỗng', () => {
    for (const bad of [undefined, null, '', 0, {}, []]) {
      expect(setupTokenMatches(SECRET, bad), String(bad)).toBe(false);
    }
  });

  it('tiền tố đúng nhưng thiếu ký tự thì KHÔNG khớp', () => {
    const t = setupToken(SECRET);
    expect(setupTokenMatches(SECRET, t.slice(0, 15))).toBe(false);
  });
});
