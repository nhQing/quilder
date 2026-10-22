import { afterEach, describe, expect, it } from 'vitest';

import { isNoindexSite } from './site-mode';

const original = process.env.SITE_NOINDEX;
afterEach(() => {
  if (original === undefined) delete process.env.SITE_NOINDEX;
  else process.env.SITE_NOINDEX = original;
});

describe('isNoindexSite', () => {
  it('mặc định CHO PHÉP index — quên biến trên production không được làm mất thứ hạng', () => {
    delete process.env.SITE_NOINDEX;
    expect(isNoindexSite()).toBe(false);
  });

  it('bật bằng "true", không phân biệt hoa thường và khoảng trắng', () => {
    for (const v of ['true', 'TRUE', ' True ']) {
      process.env.SITE_NOINDEX = v;
      expect(isNoindexSite(), v).toBe(true);
    }
  });

  it('"false" thì TẮT — Boolean("false") là true, đó là cái bẫy này tránh', () => {
    for (const v of ['false', 'FALSE', '0', '', 'no']) {
      process.env.SITE_NOINDEX = v;
      expect(isNoindexSite(), v).toBe(false);
    }
  });
});
