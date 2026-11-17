import { describe, expect, it } from 'vitest';

import { ASSET_PICKER_MAX_TAKE, parseAssetPageQuery } from './page-query';

const p = (s: string) => parseAssetPageQuery(new URLSearchParams(s));

describe('parseAssetPageQuery', () => {
  it('không có take → null (giữ hành vi trả cả danh sách)', () => {
    expect(p('')).toBeNull();
    expect(p('folder=x')).toBeNull();
  });

  it('đọc take/skip/q/mimes', () => {
    expect(p('take=60&skip=120&q=%20wealth%20&mimes=image/png,image/svg%2Bxml')).toEqual({
      take: 60,
      skip: 120,
      q: 'wealth',
      mimes: ['image/png', 'image/svg+xml'],
    });
  });

  it('kẹp giá trị lạ', () => {
    expect(p('take=99999&skip=-5')).toEqual({ take: ASSET_PICKER_MAX_TAKE, skip: 0, q: null, mimes: null });
    expect(p('take=abc')?.take).toBe(60);
    expect(p('take=10&mimes=;drop,image/png')?.mimes).toEqual(['image/png']);
  });
});
