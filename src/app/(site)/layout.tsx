import type { Metadata } from 'next';
import { headers } from 'next/headers';

import { splitLocale } from '@/lib/i18n/locale';
import { getLocales } from '@/lib/i18n/queries';
import { siteIcons } from '@/lib/render/site-icons';
import { currentStaticCss, getReleaseCssHash } from '@/lib/render/style-bundle';
import { siteOrigin } from '@/lib/site/origin';
import { checkTitleTemplate } from '@/lib/site/seo-template';
import { getSiteCrawlSettings } from '@/lib/site/settings';

/**
 * Layout của site công khai.
 *
 * CSS tĩnh gom hết vào `@/styles/site.css`, nơi mọi file được import vào
 * `@layer base`. Đó KHÔNG phải để cho gọn: CSS không nằm trong layer nào luôn
 * thắng CSS nằm trong layer, nên rule cấp element của reset/typography mà lọt ra
 * ngoài layer sẽ đè lên toàn bộ `@layer doc`. Xem ghi chú trong site.css.
 *
 * Độ ưu tiên đúng: base < doc < doc-custom.
 *
 * ## Vì sao KHÔNG `import '@/styles/site.css'` nữa
 *
 * Import tĩnh nghĩa là CSS đi qua bundler lúc build, tức nó nằm trong CODE. Với
 * mô hình "mỗi domain một bản builder, và các bản đó nâng cấp được", mỗi lần nâng
 * cấp là một lần đổi CSS dưới chân release đang chạy — người dùng không bấm gì mà
 * site đổi. Đây đúng ca đã cắn Plasmic; xem docs/BENCHMARK.md §1.5.
 *
 * Thay bằng bó đã niêm phong trong `Release.cssHash`. Ba màn bản nháp
 * (`preview`, `render/*`) VẪN import tĩnh, và đó là đúng: chúng phải hiện CSS của
 * code hiện tại, không phải của release cũ.
 *
 * `<EffectRuntime />` sẽ mount ở đây, và CHỈ ở đây, khi Phase 2 tới. Một chỗ duy
 * nhất là điều kiện để bất biến "một vòng lặp animation" còn đúng dưới React.
 */


/**
 * `generateMetadata` chứ không phải `export const metadata`.
 *
 * Favicon đọc từ database (xem `site-icons.ts`), và một hằng số không đọc được DB.
 * Đổi từ hằng sang hàm KHÔNG đổi gì với metadata của từng trang: Next gộp metadata
 * của layout với của page, và page vẫn thắng ở mọi field nó khai.
 *
 * `title.template` và mô tả mặc định chỉ phát khi người dùng ĐẶT chúng ở Cài đặt ›
 * SEO & thu thập (từ 20/10/2026). Template nối tên site vào mọi tiêu đề đang chạy —
 * một thay đổi SEO trên toàn site — nên nó không bao giờ tự bật: cột null thì
 * metadata y hệt trước đây. Page vẫn thắng mọi field nó khai, nên `description` ở
 * đây chỉ lấp trang chưa có mô tả riêng.
 */
export async function generateMetadata(): Promise<Metadata> {
  const [origin, icons, seo] = await Promise.all([siteOrigin(), siteIcons(), getSiteCrawlSettings()]);
  const template = seo.seoTitleTemplate?.trim();
  return {
    metadataBase: new URL(origin),
    icons,
    ...(template && !checkTitleTemplate(template)
      ? { title: { template, default: seo.siteName ?? template.replace('%s', '').trim() } }
      : {}),
    ...(seo.seoDescription?.trim() ? { description: seo.seoDescription.trim() } : {}),
  };
}

/**
 * `lang` phải đúng ngôn ngữ đang phục vụ.
 *
 * Không phải hình thức: screen reader chọn giọng đọc theo thuộc tính này, nên
 * `lang="vi"` trên một trang tiếng Anh khiến nó đọc tiếng Anh bằng âm vị tiếng
 * Việt — gần như không hiểu được. Trình duyệt cũng dùng nó cho gợi ý dịch và cho
 * quy tắc ngắt dòng.
 *
 * Đường dẫn đến từ header do middleware chuyển tiếp: layout không nhận được
 * params của segment `[[...slug]]` nằm dưới nó.
 */
export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const path = (await headers()).get('x-mm-path') ?? '/';
  const [locales, { theme }] = await Promise.all([getLocales(), getSiteCrawlSettings()]);
  const { locale } = splitLocale(path.split('/').filter(Boolean), locales);

  /*
   * Hash bó CSS của RELEASE, không phải của code đang chạy.
   *
   * Rơi về hash hiện tại khi release chưa có bó — 56 release tồn tại trước khi cột
   * `cssHash` ra đời, và site chưa publish lần nào cũng rơi vào nhánh này. Thà
   * hiển thị bằng bản mới còn hơn không có CSS nào: một trang không CSS trông
   * giống hệt một trang hỏng.
   */
  /*
   * Trừ màn BẢN NHÁP (`/preview/…`): nó phải hiện CSS của code hiện tại, đúng như ghi
   * chú đầu file. Trước 13/10/2026 nó cũng lấy bó của release, nên CSS của effect mới
   * (modal, bảng sản phẩm…) vắng mặt ở bản nháp cho tới lần Publish sau — modal đang
   * đóng vẫn phủ kín trang và nuốt mọi cú click. `/mm-css` phục vụ hash hiện tại thẳng
   * từ code (`styleBundleByHash`), không cần hàng trong DB.
   */
  const draftView = path === '/preview' || path.startsWith('/preview/');
  const hash = draftView
    ? currentStaticCss().hash
    : (await getReleaseCssHash()) || currentStaticCss().hash;

  return (
    // Theme theo `Site.theme` (Cài đặt), không gõ cứng — xem `src/lib/site/theme.ts`.
    <html lang={locale.code} data-theme={theme}>
      <body>
        {/*
          `<link>` chứ không phải `<style>` inline — xem `getReleaseCssHash`: prop
          của `<style>` bị RSC payload serialize lại, nên 129 KB CSS đi xuống hai
          lần.

          React 19 tự nâng `<link rel="stylesheet">` lên `<head>` và bỏ trùng, nên
          nó nằm TRƯỚC mọi `<style>` inline mà trang phát ra trong body. Đó chính
          là thứ giữ đúng thứ tự cascade: bó này mở đầu bằng
          `@layer base, doc, doc-custom;`, và nếu nó xuống sau `@layer doc` của
          trang thì thứ tự đảo, reset đè lên mọi style người dùng đặt — trang vẫn
          render, HTML vẫn hợp lệ, chỉ là sai. `e2e/release-sealed.spec.ts` khoá
          lại thứ tự này.

          `precedence` là cách React quyết định vị trí trong head; đặt tên "base"
          cho khớp với vai trò của nó trong thang layer.
        */}
        <link rel="stylesheet" href={`/mm-css/${hash}.css`} precedence="base" />
        {children}
      </body>
    </html>
  );
}
