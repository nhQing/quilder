import { describe, expect, it } from 'vitest';

import { jsonForScript } from './json-for-script';

describe('jsonForScript', () => {
  const evil = {
    '@type': 'Article',
    headline: '</script><img src=x onerror=alert(1)><script>',
    description: 'A & B <!-- chú thích -->',
  };

  it('không chuỗi nào đóng được thẻ script', () => {
    const out = jsonForScript(evil);
    expect(out.toLowerCase()).not.toContain('</script');
    expect(out).not.toContain('<');
    expect(out).not.toContain('>');
    // `<!--` trong script làm trình duyệt chuyển sang trạng thái phân tích khác.
    expect(out).not.toContain('<!--');
  });

  it('JSON.parse đọc lại đúng dữ liệu ban đầu', () => {
    expect(JSON.parse(jsonForScript(evil))).toEqual(evil);
  });

  it('giữ nguyên tiếng Việt và ký tự thường', () => {
    const value = { headline: 'Vay tiêu dùng: lãi suất 1,5%/tháng' };
    expect(jsonForScript(value)).toBe(JSON.stringify(value));
  });

  it('escape U+2028 và U+2029', () => {
    const raw = `x${String.fromCharCode(0x2028)}y${String.fromCharCode(0x2029)}z`;
    const out = jsonForScript({ a: raw });
    expect(out).toContain('\\u2028');
    expect(out).toContain('\\u2029');
    expect(out).not.toContain(String.fromCharCode(0x2028));
    expect(JSON.parse(out)).toEqual({ a: raw });
  });
});
