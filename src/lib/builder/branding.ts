import 'server-only';

/**
 * Nhận diện của CHÍNH BUILDER: logo ở thanh menu + màn đăng nhập, favicon của tab.
 *
 * ## Vì sao đọc từ database, không từ `public/`
 *
 * Cùng lý lẽ với `render/site-icons.ts`: một builder chạy cho nhiều dự án, nên logo
 * là CẤU HÌNH chứ không phải code. Xem docblock của `Site.builderLogoAssetId`.
 *
 * ## Thứ tự của favicon
 *
 *   `builderFaviconUseSite` bật (mặc định) → favicon của web (`Site.faviconAssetId`)
 *   tắt + có `builderFaviconAssetId`       → file riêng đó
 *   còn lại                                → không khai icon (Next dùng mặc định)
 *
 * ## Vì sao lỗi đọc thì TRẢ MẶC ĐỊNH, không ném
 *
 * Hàm này chạy ở layout của MỌI màn builder, kể cả màn đăng nhập và màn Cài đặt —
 * chỗ duy nhất sửa được chính nó. Một id treo, một asset đã xoá, hay một DB chưa chạy
 * migration (code mới tới trước migration) mà làm sập layout thì cả builder khoá
 * cửa vì một tấm logo. Hậu quả thật của việc không đọc được chỉ là thấy logo mặc định.
 */

import { unstable_cache } from 'next/cache';

import { FAVICON_MIMES } from '@/lib/assets/favicon-mimes';
import { prisma } from '@/lib/db';

/** Tag revalidate — đường ghi nhận diện builder (`updateSiteSettings`) phải gọi nó. */
export const BUILDER_BRANDING_TAG = 'builder-branding';

export interface BuilderBranding {
  /** URL logo riêng, `null` = logo Quilder mặc định. */
  logoUrl: string | null;
  /** Favicon của tab builder, `null` = không khai. */
  favicon: { url: string; mime: string } | null;
}

const DEFAULT: BuilderBranding = { logoUrl: null, favicon: null };

const load = unstable_cache(
  async (): Promise<BuilderBranding> => {
    const site = await prisma.site.findFirst({
      select: {
        faviconAssetId: true,
        builderLogoAssetId: true,
        builderFaviconAssetId: true,
        builderFaviconUseSite: true,
      },
    });
    if (!site) return DEFAULT;

    const faviconId = site.builderFaviconUseSite ? site.faviconAssetId : site.builderFaviconAssetId;
    const ids = [site.builderLogoAssetId, faviconId].filter((x): x is string => Boolean(x));
    if (!ids.length) return DEFAULT;

    // Một lượt cho cả hai: hai cột không có khoá ngoại (giống `faviconAssetId`).
    const assets = await prisma.asset.findMany({
      where: { id: { in: ids } },
      select: { id: true, url: true, mime: true },
    });
    const byId = new Map(assets.map((a) => [a.id, a]));

    const logo = site.builderLogoAssetId ? byId.get(site.builderLogoAssetId) : undefined;
    const icon = faviconId ? byId.get(faviconId) : undefined;

    return {
      logoUrl: logo?.mime.startsWith('image/') ? logo.url : null,
      favicon: icon && FAVICON_MIMES.has(icon.mime) ? { url: icon.url, mime: icon.mime } : null,
    };
  },
  ['builder-branding'],
  { tags: [BUILDER_BRANDING_TAG] },
);

export async function getBuilderBranding(): Promise<BuilderBranding> {
  try {
    return await load();
  } catch (e) {
    console.warn('[builder-branding] không đọc được, dùng mặc định:', e instanceof Error ? e.message : e);
    return DEFAULT;
  }
}
