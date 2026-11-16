import { beforeEach, describe, expect, it } from 'vitest';

import { clearExportCache, putExport, takeExport } from './export-cache';

const bundle = { page: { slug: 'x' } } as never;

describe('export-cache', () => {
  beforeEach(() => clearExportCache());

  it('lấy được đúng một lần', () => {
    const t = putExport({ pageId: 'p', user: 'a@b', bundle, files: [] }, 0);
    expect(takeExport(t, 'p', 'a@b', 1000)?.bundle).toBe(bundle);
    expect(takeExport(t, 'p', 'a@b', 1000)).toBeNull();
  });

  it('khác trang / khác người / hết hạn → null', () => {
    const t1 = putExport({ pageId: 'p', user: 'a@b', bundle, files: [] }, 0);
    expect(takeExport(t1, 'q', 'a@b', 0)).toBeNull();
    const t2 = putExport({ pageId: 'p', user: 'a@b', bundle, files: [] }, 0);
    expect(takeExport(t2, 'p', 'x@y', 0)).toBeNull();
    const t3 = putExport({ pageId: 'p', user: 'a@b', bundle, files: [] }, 0);
    expect(takeExport(t3, 'p', 'a@b', 11 * 60 * 1000)).toBeNull();
  });

  it('không giữ quá 20 gói', () => {
    const first = putExport({ pageId: 'p', user: 'a', bundle, files: [] }, 0);
    for (let i = 0; i < 20; i++) putExport({ pageId: 'p', user: 'a', bundle, files: [] }, 0);
    expect(takeExport(first, 'p', 'a', 0)).toBeNull();
  });

  it('token rỗng → null', () => {
    expect(takeExport(null, 'p', 'a')).toBeNull();
  });
});
