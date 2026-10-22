import { describe, expect, it } from 'vitest';

import { sitemapEntryUrls, type SitemapEntryRow } from './sitemap-entries';

const NOW = new Date('2026-10-21T00:00:00.000Z');
const PAST = new Date('2026-10-01T00:00:00.000Z');
const FUTURE = new Date('2026-12-01T00:00:00.000Z');
const LOCALES = [
  { code: 'vi', label: 'Tiếng Việt', isDefault: true },
  { code: 'en', label: 'English', isDefault: false },
];

function row(over: Partial<SitemapEntryRow> = {}): SitemapEntryRow {
  return {
    slug: 'lai-suat',
    status: 'published',
    publishedAt: PAST,
    updatedAt: PAST,
    locales: [],
    seo: undefined,
    seoI18n: {},
    ...over,
  };
}

const EN_LIVE = { locale: 'en', slug: 'rates', status: 'published', publishedAt: PAST };

const paths = (r: SitemapEntryRow) => sitemapEntryUrls(r, LOCALES, 'blogs/post', NOW).map((u) => u.path);

describe('sitemapEntryUrls', () => {
  it('bài KHÔNG có seo (mọi bài cũ) vẫn có mặt', () => {
    expect(paths(row())).toEqual(['/blogs/post/lai-suat']);
  });

  it('bản tiếng Anh live ra thêm URL /en với slug riêng', () => {
    expect(paths(row({ locales: [EN_LIVE] }))).toEqual(['/blogs/post/lai-suat', '/en/blogs/post/rates']);
  });

  it('bản tiếng Anh nháp hoặc hẹn giờ chưa tới thì không có', () => {
    expect(paths(row({ locales: [{ ...EN_LIVE, status: 'draft' }] }))).toEqual(['/blogs/post/lai-suat']);
    expect(paths(row({ locales: [{ ...EN_LIVE, publishedAt: FUTURE }] }))).toEqual(['/blogs/post/lai-suat']);
  });

  it('noindex loại THEO TỪNG NGÔN NGỮ', () => {
    expect(paths(row({ locales: [EN_LIVE], seoI18n: { en: { noindex: true } } }))).toEqual(['/blogs/post/lai-suat']);
    expect(paths(row({ locales: [EN_LIVE], seo: { noindex: true } }))).toEqual(['/en/blogs/post/rates']);
  });

  it('canonical trỏ chỗ khác thì bỏ; trỏ về chính nó thì giữ', () => {
    expect(paths(row({ seo: { canonicalUrl: '/blogs/post/goc' } }))).toEqual([]);
    expect(paths(row({ seo: { canonicalUrl: '/blogs/post/lai-suat' } }))).toEqual(['/blogs/post/lai-suat']);
  });

  it('canonical của bản tiếng Việt KHÔNG loại bản tiếng Anh', () => {
    expect(paths(row({ locales: [EN_LIVE], seo: { canonicalUrl: '/khac' } }))).toEqual(['/en/blogs/post/rates']);
  });

  it('bản gốc chưa đăng nhưng bản tiếng Anh live: chỉ /en', () => {
    expect(paths(row({ status: 'draft', publishedAt: null, locales: [EN_LIVE] }))).toEqual(['/en/blogs/post/rates']);
  });

  it('lastModified là updatedAt của bài', () => {
    expect(sitemapEntryUrls(row(), LOCALES, 'blogs/post', NOW)[0]!.lastModified).toBe(PAST);
  });
});
