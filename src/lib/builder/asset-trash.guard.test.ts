import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Thùng rác ảnh chỉ là CỜ HIỂN THỊ. Nó chỉ được lọc ở 4 chỗ người dùng nhìn thấy
 * kho (list API, asset-usage, số đếm thư mục, MCP list_assets).
 *
 * Lọc nhầm ở publish snapshot hay render thì lần Publish sau vỡ ảnh: ảnh đã bỏ
 * vào rác nhưng trang/release vẫn trỏ tới nó sẽ biến mất khỏi snapshot, trang
 * công khai hiện ô trống dù file S3 còn nguyên. Test đọc SOURCE để chặn điều đó.
 */

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

const MUST_NOT_FILTER = [
  'src/app/api/publish/route.ts',
  'src/lib/render/page.ts',
  'src/lib/render/site-icons.ts',
  'src/lib/collections/public-read.ts',
  'src/lib/builder/queries.ts',
  'src/lib/builder/settings.ts',
  'src/lib/builder/site-settings.ts',
  'src/lib/render/share-meta.ts',
  'src/lib/render/collection-page.ts',
];

const MUST_FILTER = [
  'src/app/api/assets/route.ts',
  'src/lib/builder/asset-usage.ts',
  'src/lib/builder/asset-folders.ts',
  'src/lib/ai/asset-tools.ts',
];

describe('thùng rác ảnh: chỗ được và không được lọc', () => {
  it.each(MUST_NOT_FILTER)('%s KHÔNG chứa trashedAt', (p) => {
    expect(read(p)).not.toContain('trashedAt');
  });

  it.each(MUST_FILTER)('%s PHẢI chứa trashedAt', (p) => {
    expect(read(p)).toContain('trashedAt');
  });
});
