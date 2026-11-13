import { existsSync } from 'node:fs';
import { join } from 'node:path';

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
  tokens: [] as { name: string; value: string }[],
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
    token: { findMany: vi.fn(async () => m.tokens) },
  },
}));

const { familyVariableRefs, tokenUsage } = await import('./usage');

beforeEach(() => {
  m.pages = [];
  m.versions = new Map();
  m.entries = [];
  m.presets = [];
  m.releaseComponents = null;
  m.tokens = [];
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

describe('familyVariableRefs — họ được nhắc theo TÊN qua biến CSS', () => {
  const PACK_CSS = `
    :root{--lv-font-display:newYork,Georgia,"Times New Roman",serif}
    :root{--font-display:"SF Pro Display",-apple-system,system-ui,sans-serif;--font-body:"SF Pro Text","SF Pro Display",system-ui}
    @font-face{font-family:gilroy;src:url(/p/fonts/g.woff2)}
    .x{--space-l:2rem}`;

  it('Token khác (không phải token của họ) và khai báo --*font* trong CSS gói, không phân biệt hoa thường', async () => {
    m.tokens = [
      { name: 'lv-font-head', value: 'GILROY, "Helvetica Neue", Arial, sans-serif' },
      { name: 'lv-font-display', value: 'newYork, Georgia, serif' },
      { name: 'font-gilroy', value: '"gilroy", system-ui' }, // token của chính họ: không tính
      { name: 'font-gilroy-web', value: '"Gilroy Web", system-ui' }, // tên khác: không khớp
      { name: 'space-l', value: '2rem' },
    ];
    const refs = await familyVariableRefs(
      [
        { cssName: 'gilroy', token: 'font-gilroy' },
        { cssName: 'NewYork', token: 'font-newyork' },
        { cssName: 'SF Pro Display', token: 'font-sf-pro-display' },
        { cssName: 'Unused', token: 'font-unused' },
      ],
      async () => PACK_CSS,
    );
    expect(refs.get('font-gilroy')).toEqual(['--lv-font-head']); // @font-face không phải biến
    expect(refs.get('font-newyork')).toEqual(['--lv-font-display']); // Token và CSS gói cùng tên: một lần
    expect(refs.get('font-sf-pro-display')).toEqual(['--font-body', '--font-display']);
    expect(refs.get('font-unused')).toEqual([]);
  });

  // Gói maimoney là repo riêng, CI không clone nó: thiếu gói thì bỏ qua thay vì đỏ.
  it.skipIf(!existsSync(join(process.cwd(), 'projects', 'maimoney', 'styles', 'fonts.css')))(
    'CSS tĩnh thật của gói maimoney (QUILDER_PROJECT) đọc được lúc chạy: SF Pro Display dùng bởi --font-display',
    async () => {
      vi.stubEnv('QUILDER_PROJECT', 'maimoney');
      try {
        const refs = await familyVariableRefs([{ cssName: 'SF Pro Display', token: 'font-sf-pro-display' }]);
        expect(refs.get('font-sf-pro-display')).toContain('--font-display');
      } finally {
        vi.unstubAllEnvs();
      }
    },
  );
});
