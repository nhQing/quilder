/**
 * URL của MỘT bài trong sitemap — một URL cho mỗi ngôn ngữ đang live, trừ bản nào tự
 * xin không vào (21/10/2026).
 *
 * Thuần, để test: `sitemap.ts` nạp dữ liệu, hàm này quyết định.
 *
 * ## Vì sao theo từng ngôn ngữ
 *
 * Trước đây sitemap chỉ có URL của ngôn ngữ mặc định, nên bản tiếng Anh chỉ được tìm
 * thấy qua hreflang. Luật "đang live" là CÙNG luật với hreflang (`isLocalePublished`,
 * `page.tsx`) và slug là `localeSlug` — hai chỗ lệch nhau thì sitemap phát URL 404.
 *
 * ## Vì sao bỏ bài có canonical trỏ chỗ khác
 *
 * Sitemap chỉ được chứa URL CHUẨN. Một trang tự khai "bản chuẩn của tôi ở chỗ khác" mà
 * vẫn nằm trong sitemap là hai tín hiệu ngược nhau gửi cho Google.
 */

import { asSeo, localizeSeo, normalizeCanonical } from '@/lib/collections/seo';
import { isLocalePublished, localeSlug, type EntryLocaleRow } from '@/lib/collections/entry-locale';
import { localePath, type LocaleInfo } from '@/lib/i18n/locale';

export interface SitemapEntryRow {
  slug: string;
  status: string;
  publishedAt: Date | null;
  updatedAt: Date;
  locales: EntryLocaleRow[];
  /** `data[<khoá seo>]` của bản gốc, hoặc `undefined` khi loại không có field SEO. */
  seo: unknown;
  /** Mã ngôn ngữ → `i18n[<mã>][<khoá seo>]`. */
  seoI18n: Record<string, unknown>;
}

export function sitemapEntryUrls(
  row: SitemapEntryRow,
  locales: readonly LocaleInfo[],
  base: string,
  now: Date,
): { path: string; lastModified: Date }[] {
  const state = { slug: row.slug, status: row.status, publishedAt: row.publishedAt };
  const out: { path: string; lastModified: Date }[] = [];

  for (const l of locales) {
    const code = l.isDefault ? undefined : l.code;
    if (!isLocalePublished(state, row.locales, code, now)) continue;

    const path = localePath(l, `${base}/${localeSlug(state, row.locales, code)}`);
    const seo = code ? localizeSeo(row.seo, row.seoI18n[code]) : asSeo(row.seo);
    if (seo.noindex) continue;
    if (seo.canonicalUrl) {
      const c = normalizeCanonical(seo.canonicalUrl, null);
      if (c.ok && c.path !== path) continue;
    }
    out.push({ path, lastModified: row.updatedAt });
  }
  return out;
}
