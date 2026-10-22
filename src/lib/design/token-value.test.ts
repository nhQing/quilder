import { describe, expect, it } from 'vitest';

import { isSafeTokenValue, MAX_TOKEN_VALUE } from './token-value';

describe('isSafeTokenValue', () => {
  it('nhận giá trị CSS thường của token dự án', () => {
    for (const v of [
      '#0b0b0f', '24px', '1.5rem', '62ch', 'clamp(1.15rem, 0.6rem + 2.6vw, 3.5rem)',
      '"SF Pro Display", -apple-system, sans-serif', 'rgb(244 241 234 / 0.12)',
      '0 8px 24px rgb(0 0 0 / 0.2)', 'cubic-bezier(0.34, 1.56, 0.64, 1)', 'var(--space-m)', '700',
    ]) expect(isSafeTokenValue(v), v).toBe(true);
  });

  it('chặn mọi đường thoát khỏi khai báo hoặc tải tài nguyên ngoài', () => {
    for (const v of [
      'red; } body { display: none', 'red}', '{', 'url(https://x.vn/a.png)', 'URL (x)',
      'expression(alert(1))', 'red /* nuốt */', '</style><script>', 'red !important', '@import x',
      'a\\b', 'red\nblue', 'image-set("a.png" 1x)',
    ]) expect(isSafeTokenValue(v), v).toBe(false);
  });

  it('ngoặc và nháy phải cân, không rỗng, không quá dài', () => {
    expect(isSafeTokenValue('clamp(1rem, 2vw')).toBe(false);
    expect(isSafeTokenValue('a)(')).toBe(false);
    expect(isSafeTokenValue('"Inter')).toBe(false);
    expect(isSafeTokenValue('  ')).toBe(false);
    expect(isSafeTokenValue('a'.repeat(MAX_TOKEN_VALUE + 1))).toBe(false);
  });
});
