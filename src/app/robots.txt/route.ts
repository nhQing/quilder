import { siteOrigin } from '@/lib/site/origin';
import { defaultRobotsTxt, NOINDEX_ROBOTS_TXT } from '@/lib/site/robots';
import { getSiteCrawlSettings } from '@/lib/site/settings';
import { isNoindexSite } from '@/lib/site-mode';

/**
 * robots.txt — route handler trả TEXT (từ 20/10/2026, trước đó là `MetadataRoute.Robots`).
 *
 * Đổi sang text vì nội dung giờ sửa được trong builder (`Site.robotsTxt`), và một
 * object `Robots` không biểu diễn được text tự do người dùng gõ. Nội dung tự sinh vẫn
 * đúng từng byte như trước — xem `defaultRobotsTxt`.
 *
 * Thứ tự, và thứ tự là cả hợp đồng:
 *
 *   1. `SITE_NOINDEX=true` → chặn tất. LUÔN thắng nội dung tự soạn: staging chép DB từ
 *      production sang thì cũng chép luôn robots.txt "mời vào" của production.
 *   2. `Site.robotsTxt` có giá trị → nguyên văn.
 *   3. còn lại → tự sinh.
 */

/**
 * `force-dynamic` — cùng lý do `sitemap.ts` cần dòng này, và thiếu nó là một lỗi ĐÃ
 * XẢY RA (khi file còn là `robots.ts`).
 *
 * Không có nó, Next sinh `robots.txt` thành file tĩnh LÚC BUILD. Cả `isNoindexSite()`
 * lẫn gốc URL khi đó đọc env của máy build — không phải env của container đang chạy,
 * nên file nói về một môi trường khác với môi trường nó đang phục vụ.
 *
 * Đo trên stg ngày 11/09/2026, sau khi deploy v1.5.0:
 *
 *     robots.txt  →  Allow: /          (và `Sitemap: http://localhost:3001/...`)
 *     sitemap.xml →  <urlset></urlset> (rỗng)
 *
 * Hai file mâu thuẫn nhau vì chỉ một cái đọc env lúc chạy. `SITE_NOINDEX=true` đang
 * BẬT trên stg — sitemap rỗng chứng minh điều đó — nhưng robots.txt vẫn mời crawler
 * vào, và dòng `Sitemap:` trỏ localhost là dấu vết của chính lần build. Hệ quả: bản
 * staging bị crawl như một bản trùng của production. `X-Robots-Tag` chặn được index,
 * không chặn được đọc.
 *
 * Mất prerender không tốn gì: phần đọc DB đi qua `unstable_cache` (tag `site-settings`).
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  let body: string;
  /*
   * Bản staging: chặn tất, và KHÔNG khai sitemap.
   *
   * Khai sitemap ở đây là tự tay đưa cho crawler danh sách đầy đủ mọi URL — đúng
   * thứ ta đang muốn tránh, và nó ghi đè mọi thiện chí của `Disallow`.
   *
   * Lưu ý một mâu thuẫn có thật giữa hai tín hiệu: crawler bị `Disallow` chặn thì
   * KHÔNG tải trang, nên nó không bao giờ đọc được header `X-Robots-Tag: noindex`.
   * Hệ quả là một URL đã bị ai đó link tới vẫn có thể hiện trong kết quả tìm kiếm
   * dưới dạng URL trần, không có nội dung.
   *
   * Vẫn khai cả hai vì mỗi cái chặn một đường: `Disallow` ngăn nội dung bị đọc,
   * header ngăn URL bị index. Nếu có ngày thấy một URL stg thật sự nằm trong kết
   * quả, cách gỡ là TẠM BỎ `Disallow` để crawler tải được trang và đọc thấy
   * noindex — rồi mới đặt lại.
   */
  if (isNoindexSite()) {
    body = NOINDEX_ROBOTS_TXT;
  } else {
    const { robotsTxt } = await getSiteCrawlSettings();
    body = robotsTxt ?? defaultRobotsTxt(await siteOrigin());
  }
  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=0, must-revalidate',
    },
  });
}
