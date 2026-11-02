import { describe, expect, it } from 'vitest';

import { builderTitle } from './builder-title';

describe('builderTitle', () => {
  it('đã đặt logo riêng: "<tên site> builder"', () => {
    expect(builderTitle({ siteName: 'MaiMoney', hasLogo: true })).toBe('MaiMoney builder');
    expect(builderTitle({ siteName: '  MaiMoney  ', hasLogo: true })).toBe('MaiMoney builder');
  });

  it('chưa đặt logo riêng, hoặc tên site trống: vẫn là Quilder', () => {
    expect(builderTitle({ siteName: 'MaiMoney', hasLogo: false })).toBe('Quilder');
    expect(builderTitle({ siteName: '   ', hasLogo: true })).toBe('Quilder');
    expect(builderTitle({ siteName: null, hasLogo: true })).toBe('Quilder');
  });
});
