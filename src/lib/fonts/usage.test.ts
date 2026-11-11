import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Đếm chỗ dùng một token: trang (nháp + bản live của release đang active) và component
 * (`Preset.tree` nháp + `Release.components` của release đang active). Mock Prisma lọc
 * `archivedAt: null` như Postgres để thấy được trang lưu trữ bị bỏ.
 */

const doc = (token: string) => ({ root: { style: { base: { typography: { family: { $token: token } } } } } });

const m = vi.hoisted(() => ({
  pages: [] as { id: string; title: string; slug: string; draftVersionId: string | null; archivedAt: Date | null }[],
  versions: new Map<string, unknown>(),
  entries: [] as { pageId: string; versionId: string }[],
  presets: [] as { id: string; name: string; tree: unknown }[],
  releaseComponents: null as unknown,
}));

vi.mock('@/lib/db', () => ({
  prisma: {
    site: { findFirst: vi.fn(async () => ({ id: 's1', activeReleaseId: 'r1' })) },
    page: {
      findMany: vi.fn(async ({ where }: { where: { archivedAt?: null } }) =>
        m.pages.filter((p) => !('archivedAt' in where) || p.archivedAt === null),
      ),
    },
    releaseEntry: { findMany: vi.fn(async () => m.entries) },
    pageVersion: {
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in.filter((id) => m.versions.has(id)).map((id) => ({ id, doc: m.versions.get(id) })),
      ),
    },
    preset: { findMany: vi.fn(async () => m.presets) },
    release: { findUnique: vi.fn(async () => ({ components: m.releaseComponents })) },
  },
}));

const { tokenUsage } = await import('./usage');

beforeEach(() => {
  m.pages = [];
  m.versions = new Map();
  m.entries = [];
  m.presets = [];
  m.releaseComponents = null;
});

describe('tokenUsage', () => {
  it('đếm trang nháp, trang chỉ release live dùng, và component nháp', async () => {
    m.pages = [
      { id: 'p1', title: 'Trang chủ', slug: '', draftVersionId: 'v1', archivedAt: null },
      { id: 'p2', title: 'Giới thiệu', slug: 'gioi-thieu', draftVersionId: 'v2', archivedAt: null },
      { id: 'p3', title: 'Không dùng', slug: 'x', draftVersionId: 'v4', archivedAt: null },
    ];
    m.versions.set('v1', doc('font-gilroy'));
    m.versions.set('v2', doc('font-body')); // nháp đã gỡ…
    m.versions.set('v3', doc('font-gilroy')); // …nhưng bản live vẫn dùng
    m.versions.set('v4', doc('font-body'));
    m.entries = [{ pageId: 'p2', versionId: 'v3' }];
    m.presets = [
      { id: 'c1', name: 'Thẻ tin', tree: doc('font-gilroy') },
      { id: 'c2', name: 'Nút', tree: doc('font-body') },
    ];

    const u = await tokenUsage('font-gilroy');
    expect(u.pages).toEqual([
      { id: 'p1', title: 'Trang chủ', href: '/builder/p1' },
      { id: 'p2', title: 'Giới thiệu', href: '/builder/p2' },
    ]);
    expect(u.components).toEqual([{ id: 'c1', title: 'Thẻ tin', href: '/builder/components/c1' }]);
  });

  it('component chỉ còn dùng trong Release.components của release live vẫn được tính', async () => {
    m.presets = [{ id: 'c2', name: 'Nút', tree: doc('font-body') }];
    m.releaseComponents = { c2: doc('font-gilroy') };
    const u = await tokenUsage('font-gilroy');
    expect(u.components).toEqual([{ id: 'c2', title: 'Nút', href: '/builder/components/c2' }]);
  });

  it('trang lưu trữ (archivedAt) không tính', async () => {
    m.pages = [{ id: 'p9', title: 'Cũ', slug: 'cu', draftVersionId: 'v9', archivedAt: new Date() }];
    m.versions.set('v9', doc('font-gilroy'));
    const u = await tokenUsage('font-gilroy');
    expect(u.pages).toEqual([]);
  });

  it('không khớp tiền tố tên: font-gilroy-web không phải font-gilroy', async () => {
    m.pages = [{ id: 'p1', title: 'A', slug: 'a', draftVersionId: 'v1', archivedAt: null }];
    m.versions.set('v1', doc('font-gilroy-web'));
    expect((await tokenUsage('font-gilroy')).pages).toEqual([]);
  });
});
