import 'server-only';

/**
 * Favicon của site, đọc từ database chứ không từ `public/`.
 *
 * ## Vì sao file này tồn tại
 *
 * `public/favicon.ico` đi vào image lúc build — favicon thành CODE, và đổi logo
 * cho một dự án là build lại rồi deploy lại. Với mô hình "một builder, nhiều dự
 * án" thì đó là đúng thứ phải tránh. Cùng lý lẽ và cùng cách gỡ như
 * `custom-tokens.ts`: đọc lúc render.
 *
 * ## Vì sao chỉ nhận PNG và SVG
 *
 * JPEG không có nền trong suốt, và favicon gần như luôn nằm trên nền tab mà ta
 * không chọn được — một ô vuông trắng quanh logo trên tab tối. `.ico` thì kho ảnh
 * không nhận: `sniff()` dò kiểu từ magic bytes và `.ico` không nằm trong danh sách.
 * Không cần: mọi trình duyệt còn được hỗ trợ đều đọc PNG và SVG cho `rel="icon"`.
 *
 * ## Vì sao KHÔNG có kích thước trong `sizes`
 *
 * Khai `sizes="32x32"` cho một file 512px là nói dối trình duyệt, và nó sẽ chọn
 * file đó cho một khe 32px rồi thu nhỏ. Bỏ trống `sizes` để trình duyệt tự đo —
 * với đúng một file thì không có gì để nó chọn sai.
 */

import { unstable_cache } from 'next/cache';

import { FAVICON_MIMES } from '@/lib/assets/favicon-mimes';
import { prisma } from '@/lib/db';

/** Tag revalidate — đường đổi favicon phải gọi nó. */
export const SITE_ICONS_TAG = 'site-icons';

export interface SiteIcon {
  url: string;
  mime: string;
}

const loadSiteIcon = unstable_cache(
  async (): Promise<SiteIcon | null> => {
    const site = await prisma.site.findFirst({ select: { faviconAssetId: true } });
    if (!site?.faviconAssetId) return null;

    const asset = await prisma.asset.findUnique({
      where: { id: site.faviconAssetId },
      select: { url: true, mime: true },
    });

    /*
     * Id treo (asset đã mất) trả `null` thay vì ném: hệ quả thật chỉ là tab không
     * có icon, và làm sập cả layout của site vì một favicon là đổi một khuyết điểm
     * thẩm mỹ thành một sự cố.
     */
    if (!asset || !FAVICON_MIMES.has(asset.mime)) return null;
    return asset;
  },
  ['site-icon'],
  { tags: [SITE_ICONS_TAG] },
);

/**
 * Phần `icons` cho `Metadata` của Next, hoặc `undefined` khi chưa đặt.
 *
 * `undefined` chứ không phải một object rỗng: object rỗng khiến Next phát ra thẻ
 * `<link>` không có href, còn `undefined` thì nó không phát gì — và không có thẻ
 * nào là trạng thái đúng khi site chưa có favicon.
 */
export async function siteIcons(): Promise<
  { icon: { url: string; type: string }[]; apple: { url: string; type: string }[] } | undefined
> {
  const icon = await loadSiteIcon();
  if (!icon) return undefined;

  const entry = { url: icon.url, type: icon.mime };

  /*
   * `apple` dùng CÙNG file. Đúng chuẩn thì apple-touch-icon nên là PNG 180×180 nền
   * đục, nhưng đòi người dùng nạp hai file để có một icon là một cái giá không ai
   * trả — và một icon hơi lệch chuẩn vẫn tốt hơn ô chữ cái mặc định của iOS.
   */
  return { icon: [entry], apple: [entry] };
}
