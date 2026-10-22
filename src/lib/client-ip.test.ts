import { describe, expect, it } from 'vitest';

import { clientIp } from './client-ip';

const h = (init: Record<string, string>) => new Headers(init);

describe('clientIp', () => {
  it('lấy phần tử cuối của x-forwarded-for — phần do proxy của ta viết', () => {
    // Client tự gửi "1.1.1.1", nginx nối IP thật vào cuối.
    expect(clientIp(h({ 'x-forwarded-for': '1.1.1.1, 203.0.113.7' }))).toBe('203.0.113.7');
  });

  it('một phần tử thì lấy phần tử đó', () => {
    expect(clientIp(h({ 'x-forwarded-for': '203.0.113.7' }))).toBe('203.0.113.7');
  });

  it('bỏ khoảng trắng và phần tử rỗng', () => {
    expect(clientIp(h({ 'x-forwarded-for': ' 1.1.1.1 , 203.0.113.7 , ' }))).toBe('203.0.113.7');
  });

  it('không có x-forwarded-for thì dùng x-real-ip', () => {
    expect(clientIp(h({ 'x-real-ip': '198.51.100.2' }))).toBe('198.51.100.2');
  });

  it('không có header nào thì mọi lời gọi chung một gáo', () => {
    expect(clientIp(h({}))).toBe('unknown');
  });
});
