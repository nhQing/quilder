import { describe, expect, it } from 'vitest';

import { FALLBACK_ORIGIN, normalizeSiteUrl, resolveOrigin } from './origin-resolve';

describe('resolveOrigin', () => {
  it('env thắng DB', () => {
    expect(resolveOrigin('https://env.vn', 'https://db.vn')).toEqual({
      origin: 'https://env.vn',
      source: 'env',
    });
  });

  it('env rỗng hoặc toàn khoảng trắng coi như không đặt', () => {
    expect(resolveOrigin('  ', 'https://db.vn').source).toBe('db');
    expect(resolveOrigin('', 'https://db.vn').source).toBe('db');
    expect(resolveOrigin(undefined, 'https://db.vn').source).toBe('db');
  });

  it('bỏ / cuối', () => {
    expect(resolveOrigin('https://env.vn/', null).origin).toBe('https://env.vn');
    expect(resolveOrigin(null, 'https://db.vn/').origin).toBe('https://db.vn');
  });

  it('không có cả hai thì về localhost', () => {
    expect(resolveOrigin(undefined, null)).toEqual({ origin: FALLBACK_ORIGIN, source: 'fallback' });
  });

  it('giá trị DB hỏng thì về localhost, không ném', () => {
    expect(resolveOrigin(undefined, 'không phải url').source).toBe('fallback');
  });
});

describe('normalizeSiteUrl', () => {
  it('nhận origin http/https', () => {
    expect(normalizeSiteUrl('https://example.vn')).toBe('https://example.vn');
    expect(normalizeSiteUrl(' http://localhost:3001/ ')).toBe('http://localhost:3001');
  });

  it('từ chối path, query, hash, scheme lạ, thông tin đăng nhập', () => {
    expect(normalizeSiteUrl('https://vd.com/vi')).toBeNull();
    expect(normalizeSiteUrl('https://vd.com/?a=1')).toBeNull();
    expect(normalizeSiteUrl('https://vd.com/#x')).toBeNull();
    expect(normalizeSiteUrl('ftp://vd.com')).toBeNull();
    expect(normalizeSiteUrl('https://u:p@vd.com')).toBeNull();
    expect(normalizeSiteUrl('vd.com')).toBeNull();
    expect(normalizeSiteUrl('')).toBeNull();
  });
});
