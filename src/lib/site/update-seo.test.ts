import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  update: vi.fn((args: { data: Record<string, unknown> }) => args),
  revalidateTag: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidateTag: m.revalidateTag, unstable_cache: (fn: unknown) => fn }));
vi.mock('@/lib/db', () => ({
  prisma: {
    site: {
      findFirst: async () => ({
        id: 's1', siteUrl: 'https://vd.vn', seoTitleTemplate: null, seoDescription: null, robotsTxt: null, sitemapRules: {},
      }),
      update: m.update,
    },
    auditLog: { create: (a: unknown) => a },
    $transaction: async (ops: unknown[]) => ops,
  },
}));

import { updateSiteSeo } from './update-seo';

const saved = () => m.update.mock.calls.at(-1)?.[0]?.data;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('SITE_URL', '');
});
afterEach(() => vi.unstubAllEnvs());

describe('updateSiteSeo', () => {
  it('URL site: chuẩn hoá và đồng bộ primaryDomain', async () => {
    expect(await updateSiteSeo('u', { siteUrl: 'https://moi.vn/' })).toEqual({ ok: true });
    expect(saved()).toMatchObject({ siteUrl: 'https://moi.vn', primaryDomain: 'moi.vn' });
    expect(m.revalidateTag).toHaveBeenCalledWith('release');
  });

  it('URL site khi env SITE_URL đang ghi đè → 409', async () => {
    vi.stubEnv('SITE_URL', 'https://env.vn');
    const r = await updateSiteSeo('u', { siteUrl: 'https://moi.vn' });
    expect(r).toMatchObject({ ok: false, status: 409, field: 'siteUrl' });
    expect(m.update).not.toHaveBeenCalled();
  });

  it('robots chặn cả site: lần đầu 409 kèm cảnh báo, xác nhận thì lưu', async () => {
    const text = 'User-agent: *\nDisallow: /\nSitemap: https://vd.vn/sitemap.xml';
    const first = await updateSiteSeo('u', { robotsTxt: text });
    expect(first).toMatchObject({ ok: false, status: 409 });
    expect(first.ok === false && first.warnings?.length).toBeTruthy();
    expect(m.update).not.toHaveBeenCalled();

    expect(await updateSiteSeo('u', { robotsTxt: text, confirmWarnings: true })).toEqual({ ok: true });
    expect(saved()).toMatchObject({ robotsTxt: `${text}\n` });
  });

  it('robots rỗng hoặc null = về tự sinh', async () => {
    await updateSiteSeo('u', { robotsTxt: '  ' });
    expect(saved()).toMatchObject({ robotsTxt: null });
  });

  it('template sai → 400', async () => {
    expect(await updateSiteSeo('u', { seoTitleTemplate: 'không có chỗ' })).toMatchObject({
      ok: false,
      status: 400,
      field: 'seoTitleTemplate',
    });
  });

  it('luật sitemap: bỏ dòng trống, báo dòng sai', async () => {
    expect(await updateSiteSeo('u', { sitemapRules: { include: ['/a', ' '], exclude: ['/b'] } })).toEqual({ ok: true });
    expect(saved()).toMatchObject({ sitemapRules: { include: ['/a'], exclude: ['/b'] } });
    expect(await updateSiteSeo('u', { sitemapRules: { include: [], exclude: ['sai'] } })).toMatchObject({ status: 400 });
  });
});

describe('updateSiteSeo — theme', () => {
  it('nhận light/dark/system, từ chối giá trị lạ', async () => {
    expect(await updateSiteSeo('u', { theme: 'system' })).toEqual({ ok: true });
    expect(saved()).toMatchObject({ theme: 'system' });
    expect(await updateSiteSeo('u', { theme: 'neon' })).toMatchObject({ ok: false, status: 400, field: 'theme' });
  });
});
