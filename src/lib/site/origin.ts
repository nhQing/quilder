import 'server-only';

/**
 * Gốc URL công khai của site — MỘT chỗ duy nhất.
 *
 * Canonical, sitemap, robots, `og:url`, link "trên site" của nút Chia sẻ đều dựng
 * trên gốc này. Trước 20/10/2026 mỗi chỗ tự đọc `process.env.SITE_URL ?? localhost`,
 * và một bản lệch nghĩa là `Sitemap:` trong robots.txt trỏ một gốc khác với chính
 * các URL trong sitemap.xml. `metadata-routes.test.ts` chặn việc đọc env ngoài file
 * này.
 *
 * ## Thứ tự: env → DB → localhost
 *
 * Env thắng vì stg và prod đã chạy bằng `SITE_URL` từ trước: để DB thắng thì một
 * hàng `Site` cũ có thể lặng lẽ đổi canonical của site đang chạy. Site mới thì
 * không cần env — domain đặt ở màn cài đặt và sửa trong Cài đặt.
 */

import { unstable_cache } from 'next/cache';

import { prisma } from '@/lib/db';
import { resolveOrigin, type OriginSource } from './origin-resolve';

export { normalizeSiteUrl, resolveOrigin, type OriginSource } from './origin-resolve';

/** Tag revalidate — mọi đường ghi cột cấu hình site (`siteUrl`, SEO, robots, sitemap) gọi nó. */
export const SITE_SETTINGS_TAG = 'site-settings';

const loadDbSiteUrl = unstable_cache(
  async (): Promise<string | null> => {
    const site = await prisma.site.findFirst({ select: { siteUrl: true } });
    return site?.siteUrl ?? null;
  },
  ['site-origin'],
  { tags: [SITE_SETTINGS_TAG], revalidate: 3600 },
);

async function current(): Promise<{ origin: string; source: OriginSource }> {
  let dbValue: string | null = null;
  try {
    dbValue = await loadDbSiteUrl();
  } catch (err) {
    // DB hỏng thì vẫn có một gốc để dựng URL: robots.txt và trang lỗi không được
    // sập theo vì không đọc được một cột cấu hình.
    console.error('[site-origin] không đọc được Site.siteUrl:', err);
  }
  return resolveOrigin(process.env.SITE_URL, dbValue);
}

export async function siteOrigin(): Promise<string> {
  return (await current()).origin;
}

export async function siteOriginSource(): Promise<OriginSource> {
  return (await current()).source;
}

/**
 * Gốc ĐÃ CẤU HÌNH (env hoặc DB), hoặc `null` khi đang rơi về localhost.
 *
 * Cho những chỗ có đường lui tốt hơn localhost: nút Chia sẻ và thẻ xem trước SEO
 * lấy tên miền của chính builder khi chưa đặt gì.
 */
export async function configuredSiteOrigin(): Promise<string | null> {
  const r = await current();
  return r.source === 'fallback' ? null : r.origin;
}

/** Env `SITE_URL` đã chuẩn hoá, hoặc `null`. Màn cài đặt và Cài đặt khoá ô domain khi có. */
export function siteUrlFromEnv(): string | null {
  const r = resolveOrigin(process.env.SITE_URL, null);
  return r.source === 'env' ? r.origin : null;
}
