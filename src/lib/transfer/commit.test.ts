import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', () => ({ prisma: {} }));
vi.mock('next/cache', () => ({ revalidateTag: vi.fn(), unstable_cache: (f: unknown) => f }));

import { GILROY_ASSETS, sampleBundle, sampleFont } from './fixtures';
import { parseBundle } from './manifest';

function bundleOf(over: Record<string, unknown> = {}) {
  const r = parseBundle(sampleBundle(over));
  if (!r.ok) throw new Error(r.error);
  return r.bundle;
}

describe('translationRowsFor', () => {
  it('bỏ ngôn ngữ chưa có ở đích, đổi id ảnh trong field assetId', async () => {
    const { translationRowsFor } = await import('./commit');
    const bundle = bundleOf({
      translations: [
        { locale: 'en', nodeId: 'img', field: 'assetId', value: 'casset00000000000000000001', sourceHash: 'h1' },
        { locale: 'en', nodeId: 'img', field: 'alt', value: 'Hello', sourceHash: 'h2' },
        { locale: 'ja', nodeId: 'img', field: 'alt', value: 'こんにちは', sourceHash: 'h3' },
      ],
    });
    const rows = translationRowsFor(
      bundle,
      { assets: new Map([['casset00000000000000000001', 'cdst']]), components: new Map() },
      new Set(['vi', 'en']),
    );
    expect(rows).toEqual([
      { locale: 'en', nodeId: 'img', field: 'assetId', value: 'cdst', sourceHash: 'h1' },
      { locale: 'en', nodeId: 'img', field: 'alt', value: 'Hello', sourceHash: 'h2' },
    ]);
  });
});

describe('pageMetaUpdate', () => {
  const bundle = bundleOf({
    page: {
      slug: 'abc', title: 'Tiêu đề gói', description: 'Mô tả', canonical: 'https://x.vn/abc', noindex: true,
      jsonLd: { '@type': 'Thing' }, ogImageId: 'casset00000000000000000001', collection: null,
    },
  });

  it('trang có sẵn, không lấy meta: không đổi gì', async () => {
    const { pageMetaUpdate } = await import('./commit');
    expect(pageMetaUpdate(bundle, 'cdst', { createdPage: false, takeMeta: false })).toEqual({});
  });

  it('trang có sẵn, lấy meta: đổi cả tiêu đề', async () => {
    const { pageMetaUpdate } = await import('./commit');
    const m = pageMetaUpdate(bundle, 'cdst', { createdPage: false, takeMeta: true });
    expect(m).toMatchObject({ title: 'Tiêu đề gói', description: 'Mô tả', canonical: 'https://x.vn/abc', noindex: true, ogImageId: 'cdst' });
  });

  it('trang mới: lấy meta của gói nhưng GIỮ tiêu đề người dùng nhập', async () => {
    const { pageMetaUpdate } = await import('./commit');
    const m = pageMetaUpdate(bundle, null, { createdPage: true, takeMeta: false });
    expect(m.title).toBeUndefined();
    expect(m).toMatchObject({ description: 'Mô tả', noindex: true, ogImageId: null });
  });
});

describe('commitFailure', () => {
  it('P2002 → 409 target-changed, kể cả khi lớp lỗi không phải instance của Prisma', async () => {
    const { commitFailure } = await import('./commit');
    const r = commitFailure(Object.assign(new Error('Unique constraint'), { code: 'P2002' }));
    expect(r).toMatchObject({ ok: false, status: 409 });
    expect(r?.issues?.[0]?.code).toBe('target-changed');
  });

  it('lỗi lạ trả null để chỗ gọi ném lại', async () => {
    const { commitFailure } = await import('./commit');
    expect(commitFailure(new Error('boom'))).toBeNull();
    expect(commitFailure(Object.assign(new Error('x'), { code: 'P2003' }))).toBeNull();
    expect(commitFailure('str')).toBeNull();
  });
});

describe('commitImport - họ font (spec §13.2)', () => {
  const session = { sub: 'u1', email: 'a@b.c' } as never;
  const root = { id: 'root', type: 'Section', tag: 'main', parentId: null, children: ['h'], effects: [], style: { base: {} } };
  const h = {
    id: 'h', type: 'Text', tag: 'h1', parentId: 'root', children: [], effects: [], content: [{ t: 'text', v: 'Chào' }],
    style: { base: { typography: { family: { $token: 'font-gilroy' } } } },
  };
  const META = { title: 'ABC', description: null, canonical: null, noindex: false, jsonLd: null, ogImageId: null };
  const keyOf = (a: { key: string }) => a.key;

  async function setup(fontFamilies: unknown[]) {
    vi.resetModules();
    const revalidateTag = vi.fn();
    const tx = {
      asset: {
        findMany: vi.fn(async () => GILROY_ASSETS.map((a) => ({ id: `dst-${a.id}`, trashedAt: null }))),
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
      preset: { count: vi.fn(async () => 0), create: vi.fn() },
      token: { create: vi.fn() },
      fontFamily: { create: vi.fn(async () => ({ id: 'fnew' })) },
      fontFace: { createMany: vi.fn() },
      page: { findUniqueOrThrow: vi.fn(async () => META), updateMany: vi.fn(async () => ({ count: 1 })) },
      pageVersion: { create: vi.fn(async () => ({ id: 'vnew' })) },
      translation: { findMany: vi.fn(async () => []), deleteMany: vi.fn(), createMany: vi.fn() },
      auditLog: { create: vi.fn(async () => ({ id: 'log1' })) },
    };
    vi.doMock('server-only', () => ({}));
    vi.doMock('next/cache', () => ({ revalidateTag, unstable_cache: (f: unknown) => f }));
    vi.doMock('@/lib/db', () => ({ prisma: { $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx) } }));
    vi.doMock('./target', () => ({
      loadTargetSnapshot: async () => ({
        pages: [{ id: 'p1', slug: 'abc', title: 'ABC', draftVersionId: 'v1', fixture: false, collection: null, hasUnpublishedChanges: false }],
        // Hai file font đã lên kho (bước tải file chạy trước commit).
        assetsByKey: new Map(GILROY_ASSETS.map((a) => [keyOf(a), { id: `dst-${a.id}`, key: a.key, trashed: false, alt: null, bytes: a.bytes }])),
        presetsByKey: new Map(), tokens: new Map(), tokenNames: new Set(), locales: new Map([['vi', { enabled: true }]]),
        endpointUrls: {}, embedHosts: [], collectionTypes: new Map(), folders: [], fontFamilies,
      }),
    }));
    const { commitImport } = await import('./commit');
    const bundle = bundleOf({ doc: { schemaVersion: 2, rootId: 'root', nodes: { root, h } }, assets: GILROY_ASSETS, fonts: [sampleFont()] });
    const r = await commitImport({ bundle, target: { kind: 'existing', pageId: 'p1' }, expectDraftVersionId: 'v1', takeMeta: false, session });
    return { r, tx, revalidateTag };
  }

  it('đích trống: tạo họ, các face (trỏ id ảnh ở đích) và token font-gilroy cùng định dạng với màn Font', async () => {
    const { r, tx, revalidateTag } = await setup([]);
    expect(r).toMatchObject({ ok: true, pageId: 'p1', importId: 'log1' });
    expect(tx.fontFamily.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        slug: 'gilroy', cssName: 'Gilroy', fallback: 'system-ui, sans-serif', source: 'upload',
        googleFamily: null, licenseNote: 'Mua bản web 2025', createdBy: 'a@b.c',
      }),
    }));
    expect(tx.fontFace.createMany).toHaveBeenCalledWith({
      data: [
        { familyId: 'fnew', weight: '300', style: 'normal', unicodeRange: '', subset: '', warnings: [], assetId: 'dst-cfont000000000000000000300' },
        { familyId: 'fnew', weight: '400', style: 'normal', unicodeRange: '', subset: '', warnings: [], assetId: 'dst-cfont000000000000000000400' },
      ],
    });
    expect(tx.token.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ name: 'font-gilroy', value: '"Gilroy", system-ui, sans-serif', category: 'font', custom: true }),
    });
    const actions = tx.auditLog.create.mock.calls.map((c) => (c as unknown as [{ data: { action: string; meta: { created?: { fonts?: string[] } } } }])[0].data);
    expect(actions.map((a) => a.action)).toEqual(['font.family.import', 'page.import']);
    expect(actions[1]!.meta.created?.fonts).toEqual(['fnew']);
    expect(revalidateTag).toHaveBeenCalledWith('fonts');
  });

  it('đích có họ cùng slug: không ghi họ/face/token, lần nhập vẫn thành công kèm việc cần làm', async () => {
    const { r, tx } = await setup([{ id: 'fdst', slug: 'gilroy', cssName: 'Gilroy', faces: [] }]);
    expect(r).toMatchObject({ ok: true });
    expect(tx.fontFamily.create).not.toHaveBeenCalled();
    expect(tx.fontFace.createMany).not.toHaveBeenCalled();
    expect(tx.token.create).not.toHaveBeenCalled();
    expect((r as { issues: { code: string }[] }).issues.map((i) => i.code)).toContain('font-differs');
  });
});

describe('commitImport - kiểm trong transaction (spec §8.3)', () => {
  const session = { sub: 'u1', email: 'a@b.c' } as never;
  const KEY = 'public/builder/hero-aaaaaaaa.png';
  const root = { id: 'root', type: 'Section', tag: 'main', parentId: null, children: ['img'], effects: [], style: { base: {} } };
  const img = { id: 'img', type: 'Image', parentId: 'root', children: [], effects: [], style: { base: {} }, assetId: 'casset00000000000000000001', alt: 'x', fit: { base: 'cover' } };

  async function setup(opts: { asset?: { trashed: boolean } | null; live: { id: string; trashedAt: Date | null }[]; restored?: number }) {
    vi.resetModules();
    const writes: string[] = [];
    const tx = {
      asset: {
        findMany: vi.fn(async () => opts.live),
        updateMany: vi.fn(async (q: { data: Record<string, unknown> }) => { writes.push(`asset:${Object.keys(q.data).join(',')}`); return { count: 'trashedAt' in q.data ? (opts.restored ?? 0) : 1 }; }),
      },
      preset: { count: vi.fn(async () => 0), create: vi.fn() },
      token: { create: vi.fn() },
      page: { findUniqueOrThrow: vi.fn(), updateMany: vi.fn() },
      pageVersion: { create: vi.fn(async () => { writes.push('version'); return { id: 'vnew' }; }) },
      translation: { findMany: vi.fn(async () => []), deleteMany: vi.fn(), createMany: vi.fn() },
      auditLog: { create: vi.fn() },
    };
    vi.doMock('server-only', () => ({}));
    vi.doMock('next/cache', () => ({ revalidateTag: vi.fn(), unstable_cache: (f: unknown) => f }));
    vi.doMock('@/lib/db', () => ({ prisma: { $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx) } }));
    vi.doMock('./target', () => ({
      loadTargetSnapshot: async () => ({
        pages: [{ id: 'p1', slug: 'abc', title: 'ABC', draftVersionId: 'v1', fixture: false, collection: null, hasUnpublishedChanges: false }],
        assetsByKey: new Map(opts.asset ? [[KEY, { id: 'dst1', key: KEY, trashed: opts.asset.trashed, alt: 'có', bytes: 10 }]] : []),
        presetsByKey: new Map(), tokens: new Map(), tokenNames: new Set(), locales: new Map([['vi', { enabled: true }]]),
        endpointUrls: {}, embedHosts: [], collectionTypes: new Map(), folders: [], fontFamilies: [],
      }),
    }));
    const { commitImport } = await import('./commit');
    const bundle = bundleOf({ doc: { schemaVersion: 2, rootId: 'root', nodes: { root, img } } });
    const run = () => commitImport({ bundle, target: { kind: 'existing', pageId: 'p1' }, expectDraftVersionId: 'v1', takeMeta: false, session });
    return { run, writes };
  }

  it('ảnh đích vừa bị xoá hoàn toàn → 409 G5, chưa ghi gì', async () => {
    const { run, writes } = await setup({ asset: { trashed: false }, live: [] });
    const r = await run();
    expect(r).toMatchObject({ ok: false, status: 409 });
    expect((r as { issues: { code: string }[] }).issues[0]!.code).toBe('target-changed');
    expect(writes).toEqual([]);
  });

  it('ảnh "dùng lại" vừa bị đưa vào thùng rác → 409 G5', async () => {
    const { run } = await setup({ asset: { trashed: false }, live: [{ id: 'dst1', trashedAt: new Date() }] });
    expect(await run()).toMatchObject({ ok: false, status: 409 });
  });

  it('lấy ảnh ra khỏi thùng rác mà số hàng đổi không khớp → 409 G5, không tạo bản nháp', async () => {
    const { run, writes } = await setup({ asset: { trashed: true }, live: [{ id: 'dst1', trashedAt: new Date() }], restored: 0 });
    expect(await run()).toMatchObject({ ok: false, status: 409 });
    expect(writes).not.toContain('version');
  });

  it('còn file chưa tải lên → 409 kèm hướng dẫn G7 "bấm Tiếp tục"', async () => {
    const { run } = await setup({ asset: null, live: [] });
    const r = await run();
    expect(r).toMatchObject({ ok: false, status: 409 });
    const g7 = (r as { issues: { code: string; detail?: string }[] }).issues[0]!;
    expect(g7.code).toBe('network');
    expect(g7.detail).toContain('Còn 1 file chưa tải lên');
  });
});
