import { describe, expect, it } from 'vitest';

import { zDoc } from '@/lib/doc/schema';
import { defaultHomeDoc, defaultNotFoundDoc } from './default-docs';
import { ensureSiteDefaults } from './defaults';

/**
 * Prisma giả, giữ dữ liệu trong bộ nhớ — chỉ đủ các phương thức `ensureSiteDefaults`
 * gọi. Đủ để khẳng định điều quan trọng nhất: gọi trên DB ĐÃ CÓ dữ liệu thì không
 * tạo trùng, không thay release đang chạy.
 */
function fakeDb() {
  let n = 0;
  const id = (p: string) => `${p}${++n}`;
  const db = {
    locales: [] as { code: string }[],
    sites: [] as Record<string, unknown>[],
    pages: [] as Record<string, unknown>[],
    versions: [] as Record<string, unknown>[],
    releases: [] as Record<string, unknown>[],
  };
  const match = (row: Record<string, unknown>, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => row[k] === v);
  const tx = {
    locale: {
      findUnique: async ({ where }: { where: { code: string } }) =>
        db.locales.find((l) => l.code === where.code) ?? null,
      create: async ({ data }: { data: { code: string } }) => (db.locales.push(data), data),
    },
    site: {
      findFirst: async () => db.sites[0] ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: id('site'), activeReleaseId: null, ...data };
        db.sites.push(row);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = db.sites.find((s) => s.id === where.id)!;
        Object.assign(row, data);
        return row;
      },
    },
    page: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        db.pages.find((p) => match(p, where)) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: id('page'), draftVersionId: null, ...data };
        db.pages.push(row);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = db.pages.find((p) => p.id === where.id)!;
        Object.assign(row, data);
        return row;
      },
    },
    pageVersion: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: id('ver'), ...data };
        db.versions.push(row);
        return row;
      },
    },
    release: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: id('rel'), ...data };
        db.releases.push(row);
        return row;
      },
    },
  };
  return { db, tx: tx as never };
}

describe('ensureSiteDefaults', () => {
  it('DB trống: tạo site, trang chủ, trang 404 và release chứa cả hai', async () => {
    const { db, tx } = fakeDb();
    const r = await ensureSiteDefaults(tx, { name: 'Tiệm Bánh', siteUrl: 'https://banh.vn' });

    expect(r.created).toEqual(['locale:vi', 'site', 'page:home', 'page:not-found', 'release']);
    expect(db.sites[0]).toMatchObject({
      name: 'Tiệm Bánh',
      siteUrl: 'https://banh.vn',
      primaryDomain: 'banh.vn',
    });
    const nf = db.pages.find((p) => p.system === 'not-found')!;
    expect(nf).toMatchObject({ slug: '404', noindex: true });
    const entries = (db.releases[0]!.entries as { create: { pageId: string }[] }).create;
    expect(entries.map((e) => e.pageId).sort()).toEqual(db.pages.map((p) => p.id).sort());
    expect(db.sites[0]!.activeReleaseId).toBe(db.releases[0]!.id);
  });

  it('gọi lần hai: không tạo gì', async () => {
    const { db, tx } = fakeDb();
    await ensureSiteDefaults(tx);
    const r = await ensureSiteDefaults(tx);
    expect(r.created).toEqual([]);
    expect(db.pages).toHaveLength(2);
    expect(db.releases).toHaveLength(1);
  });

  it('site đang chạy (có trang chủ + release, chưa có 404): chỉ bổ sung trang 404 dạng nháp', async () => {
    const { db, tx } = fakeDb();
    db.locales.push({ code: 'vi' });
    db.sites.push({ id: 'live', name: 'Cũ', activeReleaseId: 'relLive' });
    db.pages.push({ id: 'home', siteId: 'live', slug: '', draftVersionId: 'v0', system: null });

    const r = await ensureSiteDefaults(tx);

    expect(r.created).toEqual(['page:not-found']);
    expect(db.releases).toHaveLength(0);
    expect(db.sites[0]!.activeReleaseId).toBe('relLive');
    expect(db.sites[0]!.name).toBe('Cũ');
  });

  it('slug 404 đã bị một trang thường chiếm: trang hệ thống lấy slug khác', async () => {
    const { db, tx } = fakeDb();
    db.sites.push({ id: 's', name: 'X', activeReleaseId: 'r' });
    db.pages.push({ id: 'home', siteId: 's', slug: '', draftVersionId: 'v0', system: null });
    db.pages.push({ id: 'mine', siteId: 's', slug: '404', draftVersionId: 'v1', system: null });

    await ensureSiteDefaults(tx);
    expect(db.pages.find((p) => p.system === 'not-found')?.slug).toBe('404-he-thong');
  });

  it('truyền name/siteUrl cho site đã có thì cập nhật, kèm primaryDomain', async () => {
    const { db, tx } = fakeDb();
    await ensureSiteDefaults(tx);
    await ensureSiteDefaults(tx, { name: 'Mới', siteUrl: 'https://moi.vn' });
    expect(db.sites[0]).toMatchObject({ name: 'Mới', siteUrl: 'https://moi.vn', primaryDomain: 'moi.vn' });
  });
});

describe('doc mặc định', () => {
  it('qua được validator doc', () => {
    expect(zDoc.safeParse(defaultHomeDoc('Site')).success).toBe(true);
    expect(zDoc.safeParse(defaultNotFoundDoc()).success).toBe(true);
  });

  it('không có mã hex hay px', () => {
    const json = JSON.stringify([defaultHomeDoc('Site'), defaultNotFoundDoc()]);
    expect(json).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(json).not.toMatch(/\d+px/);
  });
});
