import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `assetReferences` — nửa NẠP DB của phép kiểm trước khi xoá ảnh.
 *
 * Phép duyệt đã có test riêng ở `asset-references-scan.test.ts`. Ở đây đo đúng ba
 * thứ mà chỉ phần nạp mới làm sai được, với Prisma giả (vitest không có Postgres):
 *
 *  1. **Release nào là "đang chạy".** Phải là `Site.activeReleaseId`, không phải
 *     release mới nhất — sau một lần lùi bản, hai thứ đó khác nhau, và nhầm là chặn
 *     theo một release không ai đang xem trong khi thả ảnh của release đang chạy.
 *  2. **Số truy vấn không phụ thuộc số id.** "Dọn sạch" gửi cả nghìn id.
 *  3. **Không đọc `Release.assets`.** Ảnh chụp đó chứa mọi asset, nên đọc nó là chặn
 *     tất cả.
 */

type Args = Record<string, unknown>;

const IMG = 'cimg0000000000000000000001';
const KEY = 'public/builder/bia-1a2b3c4d.png';

const base = (id: string, extra: Record<string, unknown>) => ({
  id,
  parentId: null,
  children: [],
  effects: [],
  style: { base: {} },
  ...extra,
});
const docWith = (assetId: string | null) => ({
  schemaVersion: 2,
  rootId: 'a',
  nodes: { a: base('a', { type: 'Image', assetId }) },
});

const fn = <T>(value: T) => vi.fn(async (_a?: Args): Promise<T> => value);

const db = {
  asset: { findMany: fn([{ id: IMG, key: KEY }]) },
  page: {
    findMany: fn([
      {
        id: 'p1', slug: 'blog', title: 'Blog', archivedAt: null, ogImageId: null, jsonLd: null,
        // Ảnh đã RỜI bản nháp — chỉ còn ở release.
        draftVersion: { doc: docWith(null) },
      },
    ]),
  },
  translation: { findMany: fn([] as unknown[]) },
  preset: { findMany: fn([] as unknown[]) },
  effectPreset: { findMany: fn([] as unknown[]) },
  entry: {
    findMany: fn([
      {
        id: 'e1', typeKey: 'post', slug: 'bai-mot', archivedAt: null,
        data: { title: 'Bài một', content: `<img src="https://cdn.example.com/${KEY}">` },
        i18n: {},
        type: { name: 'Bài viết', titleField: 'title' },
      },
    ]),
  },
  site: {
    findMany: fn([{ faviconAssetId: null, ogImageId: null, globals: {}, activeReleaseId: 'r-mid' }]),
  },
  user: { findMany: fn([] as unknown[]) },
  token: { findMany: fn([] as unknown[]) },
  /*
   * Ba release, mới nhất trước — đúng thứ tự `orderBy` mà hàm hỏi. Site đã LÙI về
   * `r-mid`: `r-new` mới hơn nhưng không chạy. Cả ba trỏ chung version `v1`.
   */
  release: {
    findMany: fn([
      {
        id: 'r-new', label: 'Mới', createdAt: new Date('2026-10-03T00:00:00.000Z'),
        components: {}, translations: {}, tokens: {}, globals: {},
        entries: [{ slug: 'blog', versionId: 'v2' }],
      },
      {
        id: 'r-mid', label: 'Đang chạy', createdAt: new Date('2026-10-02T00:00:00.000Z'),
        components: {}, translations: {}, tokens: {}, globals: {},
        entries: [{ slug: 'blog', versionId: 'v1' }],
      },
      {
        id: 'r-old', label: 'Cũ', createdAt: new Date('2026-10-01T00:00:00.000Z'),
        components: {}, translations: {}, tokens: {}, globals: {},
        entries: [{ slug: 'blog', versionId: 'v1' }],
      },
    ]),
  },
  pageVersion: {
    findMany: vi.fn(async (a: { where: { id: { in: string[] } } }) =>
      a.where.id.in.map((id) => ({ id, doc: id === 'v1' ? docWith(IMG) : docWith(null) })),
    ),
  },
};

vi.mock('next/cache', () => ({
  unstable_cache: (f: (...a: unknown[]) => unknown) => f,
  revalidateTag: vi.fn(),
}));

// Getter chứ không `{ prisma: db }`: `vi.mock` được kéo lên trên khai báo `db`, nên
// đọc `db` ngay trong factory là chạm biến chưa khởi tạo.
vi.mock('@/lib/db', () => ({
  get prisma() {
    return db;
  },
}));

import { assetReferences } from './asset-references';

const allFindMany = () => Object.values(db).map((m) => m.findMany);

beforeEach(() => {
  for (const f of allFindMany()) f.mockClear();
});

describe('assetReferences', () => {
  it('release đang chạy theo activeReleaseId, không theo "mới nhất"', async () => {
    const out = await assetReferences([IMG]);
    const usage = out.get(IMG)!;

    expect(usage.blocking).toContainEqual({
      kind: 'live-release',
      label: 'Site đang chạy — /blog',
      href: '/builder/releases',
    });
    // `r-new` mới hơn nhưng không chạy, và không mang ảnh; `r-old` mang ảnh → cảnh báo.
    expect(usage.oldReleases).toEqual([
      { id: 'r-old', label: 'Cũ', createdAt: '2026-10-01T00:00:00.000Z' },
    ]);
  });

  it('entry (URL trong html) đi từ bảng tới kết quả', async () => {
    const out = await assetReferences([IMG]);
    expect(out.get(IMG)!.blocking).toContainEqual({
      kind: 'entry',
      label: 'Bài viết: Bài một',
      href: '/builder/content/post/e1',
    });
  });

  it('mỗi nguồn đúng một truy vấn, dù lô có hai nghìn id', async () => {
    const ids = [IMG, ...Array.from({ length: 1999 }, (_, i) => `cfake${String(i).padStart(21, '0')}`)];
    const out = await assetReferences(ids);

    expect(out.size).toBe(2000);
    for (const f of allFindMany()) expect(f).toHaveBeenCalledTimes(1);
    expect(out.get(ids[1]!)).toEqual({ blocking: [], oldReleases: [] });
  });

  it('version dùng chung giữa các release chỉ nạp một lần', async () => {
    await assetReferences([IMG]);
    const arg = db.pageVersion.findMany.mock.calls[0]![0];
    expect([...arg.where.id.in].sort()).toEqual(['v1', 'v2']);
  });

  it('không select Release.assets', async () => {
    await assetReferences([IMG]);
    const arg = db.release.findMany.mock.calls[0]![0] as { select: Record<string, unknown> };
    expect(arg.select).not.toHaveProperty('assets');
  });

  it('nạp mọi trang, kể cả đã lưu trữ', async () => {
    await assetReferences([IMG]);
    const arg = db.page.findMany.mock.calls[0]![0] as { where?: unknown };
    expect(arg.where).toBeUndefined();
  });

  it('lô rỗng không chạm DB', async () => {
    const out = await assetReferences([]);
    expect(out.size).toBe(0);
    for (const f of allFindMany()) expect(f).not.toHaveBeenCalled();
  });
});
