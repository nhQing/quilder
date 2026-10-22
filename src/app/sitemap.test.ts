import { describe, expect, it, vi } from 'vitest';

/**
 * Trang MẪU không bao giờ vào sitemap dưới dạng chính nó — nó nở ra một URL cho mỗi
 * giá trị của đoạn động. Vai `relation` là vai thứ ba cần phép nở ấy, và thiếu nó thì
 * mọi trang danh mục kiểu mới KHÔNG có mặt trong sitemap: không lỗi, không cảnh báo,
 * chỉ là Google không bao giờ biết chúng tồn tại.
 *
 * Điều kiện "danh mục phải có ít nhất một bài đã đăng" đi kèm, cùng lý do với
 * `taxonomiesOfType`: phát một danh mục rỗng ra sitemap là mời Google index một trang
 * không có dòng nào, và nó tính vào chất lượng của cả tên miền.
 */
vi.mock('next/cache', () => ({
  unstable_cache: (fn: (...a: unknown[]) => unknown) => fn,
  revalidateTag: vi.fn(),
}));

vi.mock('@/lib/site-mode', () => ({ isNoindexSite: () => false }));

vi.mock('@/lib/site/origin', () => ({ siteOrigin: async () => 'https://vd.test' }));
vi.mock('@/lib/site/settings', () => ({
  getSiteCrawlSettings: async () => ({ sitemapRules: { include: [], exclude: [] } }),
}));

vi.mock('@/lib/render/page', () => ({
  getPublishedSlugs: async () => ['blogs', 'blogs/post/[slug]', 'blogs/[category-slug]'],
}));

const TIN_TUC_TYPE = {
  id: 'ct1',
  key: 'tin-tuc',
  name: 'Tin tức',
  namePlural: 'Tin tức',
  icon: null,
  schema: [
    { t: 'text', key: 'title', label: 'Tiêu đề' },
    { t: 'relation', key: 'category', label: 'Danh mục', typeKey: 'danh-muc', cardinality: 'one' },
    { t: 'seo', key: 'seo', label: 'SEO' },
  ],
  titleField: 'title',
  slugField: 'slug',
  singleton: false,
  _count: { entries: 2 },
};

const AT = new Date('2026-09-01T00:00:00.000Z');

vi.mock('@/lib/db', () => ({
  prisma: {
    page: {
      findMany: vi.fn(async () => [
        { slug: 'blogs', updatedAt: AT, collection: { typeKey: 'tin-tuc', param: 'list' } },
        {
          slug: 'blogs/post/[slug]',
          updatedAt: AT,
          collection: { typeKey: 'tin-tuc', param: 'entry' },
        },
        {
          slug: 'blogs/[category-slug]',
          updatedAt: AT,
          collection: { typeKey: 'tin-tuc', param: 'relation', field: 'category' },
        },
      ]),
    },
    entry: {
      findMany: vi.fn(async (args: { where: { typeKey: string } }) =>
        args.where.typeKey === 'danh-muc'
          ? [
              { id: 'dm1', slug: 'lai-suat', updatedAt: AT },
              { id: 'dm2', slug: 'danh-muc-rong', updatedAt: AT },
            ]
          : [
              {
                id: 'e-a', slug: 'lai-suat-thang-8', status: 'published', publishedAt: AT, updatedAt: AT,
                locales: [{ locale: 'en', slug: 'august-rates', status: 'published', publishedAt: AT }],
              },
              { id: 'e-b', slug: 'bai-an', status: 'published', publishedAt: AT, updatedAt: AT, locales: [] },
            ],
      ),
      // Phép kiểm "danh mục này có bài nào không" — `dm2` không có.
      findFirst: vi.fn(async (args: { where: { AND?: unknown[] } }) =>
        JSON.stringify(args.where).includes('dm1') ? { id: 'e1' } : null,
      ),
    },
    taxonomy: { findMany: vi.fn(async () => []) },
    locale: {
      findMany: vi.fn(async () => [
        { code: 'vi', label: 'Tiếng Việt', isDefault: true },
        { code: 'en', label: 'English', isDefault: false },
      ]),
    },
    // Phần `seo` đọc bằng biểu thức JSONB. Bài `e-a` KHÔNG có khoá seo — mọi bài cũ.
    $queryRaw: vi.fn(async () => [{ id: 'e-b', seo: { noindex: true }, seo_i18n: null }]),
    collectionType: { findMany: vi.fn(async () => [TIN_TUC_TYPE]) },
    fieldGroupDef: { findMany: vi.fn(async () => []) },
  },
}));

import sitemap from './sitemap';

const BASE = 'https://vd.test';

describe('sitemap — vai relation', () => {
  it('nở mẫu thành một URL cho mỗi bản ghi đích CÓ bài', async () => {
    const urls = (await sitemap()).map((e) => e.url);

    expect(urls).toContain(`${BASE}/blogs/lai-suat`);
    // Danh mục không có bài nào đã đăng: một trang trống, không phát ra.
    expect(urls).not.toContain(`${BASE}/blogs/danh-muc-rong`);
    // Bản thân chuỗi mẫu không mở được, nên nó không bao giờ là một URL.
    expect(urls.join('\n')).not.toContain('[');
  });

  it('không đụng hai vai cũ', async () => {
    const urls = (await sitemap()).map((e) => e.url);
    expect(urls).toContain(`${BASE}/blogs`);
    expect(urls).toContain(`${BASE}/blogs/post/lai-suat-thang-8`);
  });
});

describe('sitemap — field seo và ngôn ngữ', () => {
  it('bài không có khoá seo vẫn có mặt; bài noindex thì không', async () => {
    const urls = (await sitemap()).map((e) => e.url);
    expect(urls).toContain(`${BASE}/blogs/post/lai-suat-thang-8`);
    expect(urls).not.toContain(`${BASE}/blogs/post/bai-an`);
  });

  it('bản tiếng Anh live có URL /en riêng', async () => {
    const urls = (await sitemap()).map((e) => e.url);
    expect(urls).toContain(`${BASE}/en/blogs/post/august-rates`);
  });
});
