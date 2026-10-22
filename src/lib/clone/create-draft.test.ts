import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Phần GHI của clone: những thứ KHÔNG ĐƯỢC xảy ra (publish, đè trang, tự đặt thư mục) và những
 * thứ phải xảy ra (noindex, asset hỏng không làm hỏng cả clone).
 *
 * Prisma và kho ảnh bị thay bằng mock như phần còn lại của repo (`src/lib/builder/*.test.ts`) —
 * vitest ở đây không có Postgres.
 */

const { tx, prisma, uploadAsset } = vi.hoisted(() => {
  const tx = {
    page: { create: vi.fn(), update: vi.fn() },
    pageVersion: { create: vi.fn() },
    auditLog: { create: vi.fn() },
  };
  const prisma = {
    site: { findFirst: vi.fn() },
    page: { findUnique: vi.fn(), findMany: vi.fn() },
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  return { tx, prisma, uploadAsset: vi.fn() };
});

vi.mock('@/lib/db', () => ({ prisma }));
vi.mock('@/lib/i18n/queries', () => ({ getLocales: async () => [{ code: 'vi' }, { code: 'en' }] }));
vi.mock('@/lib/builder/upload-asset', () => ({
  MAX_ASSET_BYTES: 10 * 1024 * 1024,
  uploadAsset: (...a: unknown[]) => uploadAsset(...a),
}));

import { createCloneDraft, isPublicHttpUrl } from './create-draft';
import type { CloneDraftInput, RawNode } from './types';

const n = (over: Record<string, unknown>) =>
  ({ children: [], effects: [], style: { base: {} }, parentId: 'root', ...over }) as unknown as RawNode;

function input(over: Partial<CloneDraftInput> = {}): CloneDraftInput {
  return {
    url: 'https://nguon.test/trang',
    title: 'Trang clone',
    slug: 'clone-thu',
    folder: 'clone/nguon',
    doc: {
      rootId: 'root',
      nodes: {
        root: n({ id: 'root', parentId: null, type: 'Stack', direction: { base: 'column' }, children: ['t', 'i'] }),
        t: n({ id: 't', type: 'Text', tag: 'p', content: [{ t: 'text', v: 'Chào' }] }),
        i: n({ id: 'i', type: 'Image', assetId: null, alt: 'ảnh', fit: { base: 'cover' }, _src: 'https://cdn.test/a.png' }),
      },
    },
    assets: { 'https://cdn.test/a.png': { assetId: 'A1' } },
    notes: {},
    page: { description: 'Mô tả của nguồn' },
    ...over,
  };
}

const ctx = { actorEmail: 'a@b.c', actorSub: 'u1', origin: 'https://builder.test' };

beforeEach(() => {
  vi.clearAllMocks();
  prisma.site.findFirst.mockResolvedValue({ id: 'site1' });
  prisma.page.findUnique.mockResolvedValue(null);
  tx.page.create.mockResolvedValue({ id: 'page1' });
  tx.pageVersion.create.mockResolvedValue({ id: 'ver1' });
});

describe('createCloneDraft — những điều không bao giờ xảy ra', () => {
  it('thiếu folder thì từ chối và bảo HỎI chủ site, không ghi gì', async () => {
    const r = await createCloneDraft(input({ folder: '' }), ctx);
    expect(r).toMatchObject({ ok: false, status: 400 });
    expect(JSON.stringify(r)).toMatch(/HỎI chủ site/);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('folder là khoảng trắng cũng không được tự đặt', async () => {
    const r = await createCloneDraft(input({ folder: '   ' }), ctx);
    expect(r.ok).toBe(false);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('slug đã tồn tại thì DỪNG — không ghi đè, không tải asset nào', async () => {
    prisma.page.findUnique.mockResolvedValue({ id: 'co-san' });
    const r = await createCloneDraft(input({ assets: {} }), ctx);
    expect(r).toMatchObject({ ok: false, status: 409 });
    expect(JSON.stringify(r)).toMatch(/không ghi đè/);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(uploadAsset).not.toHaveBeenCalled();
  });

  it('không clone vào trang chủ và không nhận đoạn động', async () => {
    expect(await createCloneDraft(input({ slug: '' }), ctx)).toMatchObject({ ok: false });
    expect(await createCloneDraft(input({ slug: 'blogs/[slug]' }), ctx)).toMatchObject({ ok: false });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('createCloneDraft — đường thành công', () => {
  it('tạo trang MỚI, noindex, chỉ có bản nháp (không release, không publish)', async () => {
    const r = await createCloneDraft(input(), ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect(tx.page.create).toHaveBeenCalledTimes(1);
    const data = tx.page.create.mock.calls[0]![0].data;
    expect(data).toMatchObject({ slug: 'clone-thu', noindex: true, description: 'Mô tả của nguồn', siteId: 'site1' });
    // Chỉ trỏ draftVersion; không có publishedVersion / release.
    expect(tx.page.update.mock.calls[0]![0].data).toEqual({ draftVersionId: 'ver1' });
    const ver = tx.pageVersion.create.mock.calls[0]![0].data;
    expect(ver.label).toContain('nguon.test');
    expect(ver.createdBy).toBe('a@b.c');
    // Doc trong DB đã sạch giàn giáo và đã nối asset.
    expect(JSON.stringify(ver.doc)).not.toContain('_src');
    expect(ver.doc.nodes.i.assetId).toBe('A1');

    expect(r).toMatchObject({ pageId: 'page1', slug: 'clone-thu', noindex: true, nodeCount: 3, folder: 'clone/nguon' });
    expect(r.editorUrl).toBe('https://builder.test/builder/page1');
    expect(tx.auditLog.create.mock.calls[0]![0].data.meta.clonedFrom).toBe('https://nguon.test/trang');
    expect(r.report.some((x) => x.code === 'limits')).toBe(true);
  });

  it('asset thiếu thì server tự tải rồi upload vào ĐÚNG thư mục chủ site chọn', async () => {
    const fetchMock = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    uploadAsset.mockResolvedValue({ ok: true, asset: { id: 'SRV1', reused: false } });

    const r = await createCloneDraft(input({ assets: {} }), ctx);
    vi.unstubAllGlobals();

    expect(r.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(uploadAsset.mock.calls[0]![0]).toMatchObject({ fileName: 'a.png', folder: 'clone/nguon', actorEmail: 'a@b.c' });
    expect(tx.pageVersion.create.mock.calls[0]![0].data.doc.nodes.i.assetId).toBe('SRV1');
  });

  it('asset lỗi KHÔNG làm hỏng cả clone: trang vẫn tạo, lỗi vào báo cáo', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x', { status: 404 })));
    const r = await createCloneDraft(input({ assets: {} }), ctx);
    vi.unstubAllGlobals();

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.stats.imagesWired).toBe(0);
    const failed = r.report.find((x) => x.code === 'assets-failed');
    expect(failed?.severity).toBe('error');
    expect(failed?.message).toContain('HTTP 404');
  });

  it('video lớn hơn trần báo lỗi nhưng không dừng clone', async () => {
    const d = input({
      assets: { 'https://cdn.test/v.mp4': { error: 'vượt 10 MB (48 MB)', code: 'too-large' } },
    });
    d.doc.nodes.v = n({ id: 'v', type: 'Video', assetId: null, posterAssetId: null, _src: 'https://cdn.test/v.mp4' });
    (d.doc.nodes.root as { children: string[] }).children.push('v');
    const r = await createCloneDraft(d, ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.report.find((x) => x.code === 'assets-failed')?.message).toContain('vượt 10 MB');
  });

  it('doc không qua schema thì 422 và KHÔNG tạo trang', async () => {
    const d = input();
    (d.doc.nodes.t as Record<string, unknown>).tag = 'marquee';
    const r = await createCloneDraft(d, ctx);
    expect(r).toMatchObject({ ok: false, status: 422 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('isPublicHttpUrl', () => {
  it('chỉ nhận http/https tới máy công khai', () => {
    expect(isPublicHttpUrl('https://cdn.example.com/a.png')).toBe(true);
    expect(isPublicHttpUrl('http://example.com/a.png')).toBe(true);
    for (const bad of [
      'file:///etc/passwd',
      'ftp://x.test/a',
      'http://localhost:3001/api',
      'http://127.0.0.1/a',
      'http://10.0.0.5/a',
      'http://192.168.1.1/a',
      'http://172.20.1.1/a',
      'http://169.254.169.254/latest/meta-data',
      'http://[::1]/a',
      'http://db.internal/a',
      'khong-phai-url',
    ]) {
      expect(isPublicHttpUrl(bad), bad).toBe(false);
    }
  });
});
