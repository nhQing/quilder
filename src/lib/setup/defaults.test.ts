import { describe, expect, it } from 'vitest';

import { zDoc } from '@/lib/doc/schema';
import { defaultHomeDoc, defaultNotFoundDoc } from './default-docs';
import { presetTreeToDoc } from '@/lib/doc/migrate';
import { parseFormParamsStrict } from '@/lib/composites/registry';
import { ensureSiteDefaults } from './defaults';
import { SYSTEM_PRESETS } from './system-presets';

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
    presets: [] as Record<string, unknown>[],
    presetVersions: [] as Record<string, unknown>[],
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
    preset: {
      findUnique: async ({ where }: { where: Record<string, unknown> }) =>
        db.presets.find((p) => match(p, where)) ?? null,
      createMany: async ({ data }: { data: Record<string, unknown>[] }) => {
        let count = 0;
        for (const d of data) {
          const dup = db.presets.some((p) => p.key === d.key || (d.system && p.system === d.system));
          if (dup) continue; // skipDuplicates
          db.presets.push({ id: id('preset'), ...d });
          count += 1;
        }
        return { count };
      },
    },
    presetVersion: {
      create: async ({ data }: { data: Record<string, unknown> }) => (db.presetVersions.push(data), data),
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

    expect(r.created).toEqual([
      'locale:vi', 'site', 'page:home', 'page:not-found', 'release', 'preset:form',
    ]);
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

    expect(r.created).toEqual(['page:not-found', 'preset:form']);
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

describe('mẫu hệ thống', () => {
  it('tạo mẫu hệ thống form một lần, không ghi đè bản đã có', async () => {
    const { db, tx } = fakeDb();
    const first = await ensureSiteDefaults(tx);
    expect(first.created).toContain('preset:form');
    const second = await ensureSiteDefaults(tx);
    expect(second.created).not.toContain('preset:form');
    expect(db.presets.filter((p) => p.system === 'form')).toHaveLength(1);

    db.presets[0]!.name = 'Tên đã sửa';
    const third = await ensureSiteDefaults(tx);
    expect(third.created).not.toContain('preset:form');
    expect(db.presets[0]!.name).toBe('Tên đã sửa');
    expect(db.presets).toHaveLength(1);
  });

  it('hai lần chạy đua: bên thua (createMany count 0) coi như đã có, không lỗi', async () => {
    const { db, tx } = fakeDb();
    const real = (tx as never as { preset: { findUnique: unknown } }).preset;
    const orig = real.findUnique as (a: { where: Record<string, unknown> }) => Promise<unknown>;
    // Kiểm đầu thấy trống, nhưng bên kia đã chèn xen vào trước createMany.
    let first = true;
    real.findUnique = async (a: { where: Record<string, unknown> }) => {
      if (first && a.where.system) {
        first = false;
        db.presets.push({ id: 'other', key: 'mau-form', system: 'form' });
        return null;
      }
      return orig(a);
    };
    const r = await ensureSiteDefaults(tx);
    expect(r.created).not.toContain('preset:form');
    expect(db.presets).toHaveLength(1);
    expect(db.presetVersions).toHaveLength(0);
  });

  it('key mau-form đã bị người dùng chiếm: mẫu lấy hậu tố -2', async () => {
    const { db, tx } = fakeDb();
    db.presets.push({ id: 'mine', key: 'mau-form', system: null });
    await ensureSiteDefaults(tx);
    expect(db.presets.find((p) => p.system === 'form')?.key).toBe('mau-form-2');
  });

  it('cây mẫu qua zDoc và parseFormParamsStrict, không có URL', () => {
    const [form] = SYSTEM_PRESETS;
    expect(zDoc.safeParse(presetTreeToDoc(form!.tree)).success).toBe(true);
    const root = form!.tree.nodes[form!.tree.rootId] as unknown as { params: unknown };
    expect(parseFormParamsStrict(root.params).ok).toBe(true);
    expect(JSON.stringify(form)).not.toMatch(/https?:/);
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
