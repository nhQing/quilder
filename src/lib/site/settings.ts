import 'server-only';

/**
 * Cấu hình SEO & thu thập của site — đọc cho route công khai (robots, sitemap,
 * metadata của layout). Cache theo `SITE_SETTINGS_TAG`: route công khai không được
 * hỏi DB ở mỗi request, và PATCH `/api/settings` xoá tag này khi lưu.
 */

import { unstable_cache } from 'next/cache';

import { prisma } from '@/lib/db';
import { SITE_SETTINGS_TAG } from './origin';
import { parseSitemapRules, type SitemapRules } from './sitemap-rules';
import { parseSiteTheme, type SiteTheme } from './theme';

export interface SiteCrawlSettings {
  robotsTxt: string | null;
  sitemapRules: SitemapRules;
  seoTitleTemplate: string | null;
  seoDescription: string | null;
  siteName: string | null;
  theme: SiteTheme;
}

const EMPTY: SiteCrawlSettings = {
  robotsTxt: null,
  sitemapRules: { include: [], exclude: [] },
  seoTitleTemplate: null,
  seoDescription: null,
  siteName: null,
  theme: 'light',
};

const load = unstable_cache(
  async (): Promise<SiteCrawlSettings> => {
    const site = await prisma.site.findFirst({
      select: { name: true, robotsTxt: true, sitemapRules: true, seoTitleTemplate: true, seoDescription: true, theme: true },
    });
    if (!site) return EMPTY;
    return {
      robotsTxt: site.robotsTxt,
      sitemapRules: parseSitemapRules(site.sitemapRules),
      seoTitleTemplate: site.seoTitleTemplate,
      seoDescription: site.seoDescription,
      siteName: site.name,
      theme: parseSiteTheme(site.theme),
    };
  },
  // v2: thêm `theme` (21/10/2026) — key mới để bản cache cũ trên đĩa (thiếu `theme`) không được đọc.
  ['site-crawl-settings', 'v2'],
  { tags: [SITE_SETTINGS_TAG], revalidate: 3600 },
);

/**
 * DB hỏng thì trả bộ RỖNG = hành vi tự sinh như trước: robots.txt và sitemap là tín
 * hiệu SEO, và một tín hiệu mặc định còn hơn một trang 500.
 */
export async function getSiteCrawlSettings(): Promise<SiteCrawlSettings> {
  try {
    return await load();
  } catch (err) {
    console.error('[site-settings] không đọc được cấu hình SEO:', err);
    return EMPTY;
  }
}
