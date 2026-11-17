import { describe, expect, it } from 'vitest';

import { buildAssetClipboardLine } from './asset-ref';

describe('buildAssetClipboardLine', () => {
  it('thư mục › tên › assetId', () => {
    expect(buildAssetClipboardLine({ id: 'cmabc', folder: 'maicash/hero', name: 'f-0096.jpg' })).toBe(
      '[Quilder] Thư viện › maicash/hero › f-0096.jpg — assetId: cmabc',
    );
  });
  it('chưa phân loại', () => {
    expect(buildAssetClipboardLine({ id: 'cmabc', folder: null, name: 'google-play.svg' })).toBe(
      '[Quilder] Thư viện › Chưa phân loại › google-play.svg — assetId: cmabc',
    );
  });
});
