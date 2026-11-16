import { describe, expect, it } from 'vitest';

import { altOf, assetIdOf, pickAsset, withAlt } from './asset-value';

describe('asset-value', () => {
  it('đọc cả object (dạng lưu thật) lẫn chuỗi (dạng cũ của ô nhập)', () => {
    expect(assetIdOf({ assetId: 'a1', alt: 'Bìa' })).toBe('a1');
    expect(assetIdOf('a1')).toBe('a1');
    expect(assetIdOf(null)).toBeNull();
    expect(assetIdOf({})).toBeNull();
    expect(altOf({ assetId: 'a1', alt: 'Bìa' })).toBe('Bìa');
    expect(altOf('a1')).toBe('');
  });
  it('chọn ảnh mới ra object và giữ alt cũ; gỡ ảnh ra null', () => {
    expect(pickAsset({ assetId: 'a1', alt: 'Bìa' }, 'a2')).toEqual({ assetId: 'a2', alt: 'Bìa' });
    expect(pickAsset(null, 'a2')).toEqual({ assetId: 'a2' });
    expect(pickAsset({ assetId: 'a1' }, null)).toBeNull();
  });
  it('đổi alt', () => {
    expect(withAlt({ assetId: 'a1' }, 'Mới')).toEqual({ assetId: 'a1', alt: 'Mới' });
    expect(withAlt('a1', 'Mới')).toEqual({ assetId: 'a1', alt: 'Mới' });
    expect(withAlt(null, 'Mới')).toBeNull();
  });
});
