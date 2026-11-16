import { describe, expect, it } from 'vitest';

import { crossOrigin } from './forms';

const req = (origin?: string) =>
  new Request('http://x/api/forms/a', { method: 'POST', headers: origin ? { origin } : {} });

describe('crossOrigin', () => {
  it('danh sách trống → không chặn', () => {
    expect(crossOrigin(req('https://evil.example'), '')).toBe(false);
  });
  it('origin trong danh sách → cho qua, không phân biệt hoa thường / dấu / cuối', () => {
    expect(crossOrigin(req('https://MaiMoney.com'), 'https://maimoney.com/, http://10.60.0.79:3002')).toBe(false);
    expect(crossOrigin(req('http://10.60.0.79:3002'), 'https://maimoney.com,http://10.60.0.79:3002')).toBe(false);
  });
  it('origin lạ → chặn', () => {
    expect(crossOrigin(req('https://evil.example'), 'https://maimoney.com')).toBe(true);
  });
  it('không có Origin → cho qua', () => {
    expect(crossOrigin(req(), 'https://maimoney.com')).toBe(false);
  });
});
