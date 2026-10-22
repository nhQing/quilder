import Link from 'next/link';
import { redirect } from 'next/navigation';

/**
 * Cài đặt chung — ngôn ngữ, endpoint form, biến của site, favicon/logo.
 *
 * Mục "Nền tảng" (sửa 12 token), "Lịch sử đổi biến" và bảng tra "Toàn bộ biến" đã
 * gỡ ngày 13/10/2026 — lý do ở `lib/design/foundations.ts` và `lib/builder/settings.ts`.
 *
 * ## Trang này có HAI chế độ lưu, và phải nói rõ chỗ nào là chỗ nào
 *
 * Mọi thứ khác trong builder theo hợp đồng nháp → publish. Trang này thì không
 * đồng nhất:
 *
 *  - **Ăn ngay vào site thật:** favicon và ảnh chia sẻ — chrome của site, đọc
 *    bảng live, không qua ảnh chụp `Release`.
 *  - **Chờ Publish:** `Site.globals`. Nó ĐƯỢC seal (`publish/route.ts`), và
 *    `(site)/[[...slug]]` đọc `page.siteGlobals` từ release.
 *
 * Hai chế độ cạnh nhau trên một trang là thứ dễ gây hiểu nhầm nhất ở đây, nên
 * đầu trang nói cả hai, mỗi chế độ một thẻ nhỏ kèm chip trạng thái. Câu cũ ("trang
 * này chỉ để tra") viết trước 26/08/2026, khi màn hình còn chỉ đọc thật — nó đã sai
 * suốt từ lúc `globals` mở đường sửa, và người dùng đọc nó rồi tưởng khối bên dưới
 * không bấm được.
 */

import { getSession } from '@/lib/auth/guard';
import { cn } from '@/lib/builder/cn';
import { loadSettings } from '@/lib/builder/settings';
import { endpointUsage } from '@/lib/builder/site-settings';
import { ui } from '@/lib/builder/ui';
import { readEndpointTable } from '@/lib/doc/endpoint-table';
import { ENDPOINT_KEY } from '@/lib/doc/site-bindings';
import { prisma } from '@/lib/db';
import { siteOrigin, siteOriginSource, siteUrlFromEnv } from '@/lib/site/origin';
import { parseSitemapRules } from '@/lib/site/sitemap-rules';
import { parseSiteTheme } from '@/lib/site/theme';
import { SiteSeoForm } from '@/components/builder/SiteSeoForm';
import { SiteEndpointsForm } from '@/components/builder/SiteEndpointsForm';
import { SiteLocalesForm } from '@/components/builder/SiteLocalesForm';
import { SiteSettingsForm } from '@/components/builder/SiteSettingsForm';
import { Badge } from '@/components/builder/ui/Badge';
import { Consequence } from '@/components/builder/ui/Overlay';
import { PageHeader, PageShell, Section } from '@/components/builder/ui/Page';

export const dynamic = 'force-dynamic';

/** Thẻ nhỏ ở đầu trang: một chế độ lưu, chip trạng thái + phạm vi của nó. */
const MODE = cn(ui.card, 'inline-flex items-center gap-2 rounded-md px-3 py-2 text-small text-shell-ink');

export default async function SettingsPage() {
  const session = await getSession();
  if (!session) redirect('/builder/login?next=/builder/settings');

  const [{ site, locales, tokenCount }, usage, originSource, origin, seo] = await Promise.all([
    loadSettings(),
    endpointUsage(),
    siteOriginSource(),
    siteOrigin(),
    // Khối "Tên miền & SEO" đọc thẳng cột, không qua `getSiteCrawlSettings`: màn sửa
    // phải thấy giá trị vừa lưu, không phải bản cache của route công khai.
    prisma.site.findFirst({
      select: {
        name: true, siteUrl: true, seoTitleTemplate: true, seoDescription: true, robotsTxt: true, sitemapRules: true,
        theme: true,
      },
      orderBy: { createdAt: 'asc' },
    }),
  ]);
  // `endpoint` có ô riêng bên trái — bảng biến không bày, không đếm nó.
  const globals = Object.entries(site.globals).filter(([k]) => k !== ENDPOINT_KEY);
  const endpoints = readEndpointTable(site.globals);
  // Ô "Form" đếm theo FORM, không theo khoá — đó là thứ người dùng nhìn thấy trong ô.
  const formCount = usage.reduce((n, u) => n + u.forms.length, 0);
  const formsOff = usage.filter((u) => !endpoints[u.key]).reduce((n, u) => n + u.forms.length, 0);

  return (
    <PageShell>
      <PageHeader title="Cài đặt chung" />
      {/* Hàng chế độ lưu đứng sát tiêu đề, rộng bằng cả màn — mô tả của `PageHeader`
          giới hạn 78ch, hẹp hơn hai thẻ cạnh nhau. */}
      <p className="-mt-3 flex flex-wrap items-center gap-2.5 text-ui text-shell-muted">
        <span>Trang này có hai chế độ lưu:</span>
        <span className={MODE}>
          <Badge tone="ok" size="sm">
            lưu là có hiệu lực
          </Badge>
          Favicon và ảnh chia sẻ đổi ngay trên site thật
        </span>
        <span className={MODE}>
          <Badge tone="warn" size="sm">
            chờ Publish
          </Badge>
          Globals của site đổi khi bấm Publish
        </span>
      </p>

      {/*
        Bảng Token rỗng KHÔNG làm site hỏng — `tokens.css` đã nằm trong bundle CSS
        lúc build, nên trang chạy vẫn ra đúng màu. Nó chỉ làm mù mọi thứ đọc bảng
        đó: bộ chọn màu trong inspector và `search_tokens` của MCP.

        Màn này không còn hiện token nào (bảng tra "Toàn bộ biến" gỡ 13/10/2026),
        nhưng vẫn là chỗ hợp lý nhất để nói ra: triệu chứng ("bộ chọn màu trống")
        nằm cách nguyên nhân ("bước nạp token chưa chạy trên stack này") đủ xa để
        không ai tự nối được hai đầu.
      */}
      {tokenCount === 0 && (
        <div className="max-w-3xl">
          <Consequence>
            <strong>Bảng biến đang rỗng.</strong> Site vẫn hiện đúng màu vì{' '}
            <code className="font-shell-mono">tokens.css</code> nằm trong bundle CSS, nhưng bộ chọn
            màu và <code className="font-shell-mono">search_tokens</code> của MCP đều không thấy gì.
            Chạy service <code className="font-shell-mono">bootstrap</code> (hoặc{' '}
            <code className="font-shell-mono">pnpm tokens:import</code> ở máy dev) để nạp.
          </Consequence>
        </div>
      )}

      <div className="flex flex-wrap items-start gap-5">
        {/* Cột trái: hai ô ngắn xếp chồng, để cột phải (biến + nhận diện) không bị kéo dài một mình. */}
        <div className="flex min-w-0 flex-[1_1_20rem] flex-col gap-5">
          <Section
            id="settings-locales"
            title="Ngôn ngữ"
            count={locales.length}
            description={
              <>
                Ngôn ngữ mặc định không có tiền tố URL. Ngôn ngữ mới thêm vào ở trạng thái tắt — dịch
                xong ở{' '}
                <Link href="/builder/text" className="rounded-sm text-shell-accent hover:text-shell-ink">
                  Văn bản
                </Link>{' '}
                rồi hãy bật.
              </>
            }
            className={cn(ui.card, 'p-5')}
          >
            <SiteLocalesForm locales={locales} />
          </Section>

          {/*
            Form trên site — mỗi form một box: tên, URL nhận dữ liệu, các nút của nó.

            Trước 13/10/2026 bảng URL chỉ hiện dạng JSON khoá lại trong "Biến của site",
            nên builder tạo được form mà không có chỗ nào đặt URL nhận. Xem `SiteEndpointsForm`
            cho lý do lấy FORM làm gốc thay vì khoá. Giữ id `settings-endpoints`: Inspector
            (`EndpointPicker`) và thông báo của Form trỏ link tới đây.
          */}
          <Section
            id="settings-endpoints"
            title="Form"
            count={formCount}
            description={
              <>
                Mỗi form gửi dữ liệu khách nhập tới một URL — backend ở đó nhận, builder không lưu bản
                đăng ký nào. Đổi URL: xem nháp dùng ngay, site thật đổi khi bấm Publish.
              </>
            }
            actions={
              formsOff > 0 ? (
                <Badge tone="warn" size="sm">
                  {formsOff} form chưa có URL
                </Badge>
              ) : undefined
            }
            className={cn(ui.card, 'p-5')}
          >
            <SiteEndpointsForm initial={endpoints} usage={usage} />
          </Section>
        </div>

        <Section
          id="settings-site"
          title="Biến của site"
          count={globals.length}
          description={
            <>
              Những giá trị lặp lại khắp trang — tên công ty, hotline, số giấy phép. Node trỏ tới
              chúng bằng binding <code className="font-shell-mono">site</code>, nên sửa một chỗ là đổi
              mọi nơi đang hiện.
            </>
          }
          className={cn(ui.card, 'flex-[2_1_28rem] p-5')}
        >
          {/*
            Sửa được từ 26/08/2026. Trước đó màn này chỉ ĐỌC, nghĩa là đổi số hotline
            hay số giấy phép bắt buộc phải có một dev với quyền vào database — đúng
            thứ vi phạm metric thành công duy nhất của dự án.

            Form tự kiểm quyền `admin` ở phía route; ở đây không giấu nó theo role,
            vì `viewer` mở ra rồi bấm Lưu sẽ nhận 403 kèm lý do — rõ hơn là một
            khối biến mất không giải thích.
          */}
          {/*
            Chưa có gốc URL (cả env `SITE_URL` lẫn `Site.siteUrl` đều trống) là thứ
            vô hiệu hoá TOÀN BỘ metadata chia sẻ.

            `metadataBase` rơi về `http://localhost:3001`, nên `og:image` và
            `og:url` trỏ vào localhost — scraper của Zalo/Facebook đi tìm ảnh ở
            máy của CHÍNH NÓ, thẻ ra trắng, và không có lỗi nào ở phía mình để
            lần. Đây đúng loại lỗi mà một màn cấu hình phải nói ra: nó không
            thuộc về dữ liệu người dùng nhập, nên không ô nào trong form bên dưới
            có thể chỉ ra.

            Kiểm ở server component: biến môi trường không tới được client, và
            gửi nó xuống chỉ để hiện một dòng chữ là gửi cấu hình hạ tầng ra
            trình duyệt.
          */}
          {originSource === 'fallback' && (
            <Consequence>
              Site chưa có URL. Canonical, sitemap và mọi thẻ chia sẻ đang dựng từ{' '}
              <code className="font-shell-mono">http://localhost:3001</code> — nghĩa là dán link site vào
              Zalo hay Facebook sẽ ra thẻ trắng. Đặt URL site ở khối “Tên miền & SEO” bên dưới.
            </Consequence>
          )}

          <SiteSettingsForm
            initial={{
              name: site.name,
              primaryDomain: site.primaryDomain,
              globals: site.globals,
              faviconAssetId: site.faviconAssetId,
              faviconFile: site.faviconFile,
              ogImageId: site.ogImageId,
              ogImageFile: site.ogImageFile,
              ogImageSize: site.ogImageSize,
              builderLogoAssetId: site.builderLogoAssetId,
              builderLogoFile: site.builderLogoFile,
              builderFaviconAssetId: site.builderFaviconAssetId,
              builderFaviconFile: site.builderFaviconFile,
              builderFaviconUseSite: site.builderFaviconUseSite,
            }}
          />
        </Section>
      </div>

      {seo && (
        <Section
          id="seo-crawl"
          title="Giao diện, tên miền & SEO"
          description="Theme sáng/tối, URL site, tiêu đề và mô tả mặc định, robots.txt và sitemap.xml."
          className={cn(ui.card, 'p-5')}
        >
          <SiteSeoForm
            initial={{
              siteUrl: seo.siteUrl,
              theme: parseSiteTheme(seo.theme),
              siteUrlEnv: siteUrlFromEnv(),
              origin,
              seoTitleTemplate: seo.seoTitleTemplate,
              seoDescription: seo.seoDescription,
              siteName: seo.name,
              robotsTxt: seo.robotsTxt,
              sitemapRules: parseSitemapRules(seo.sitemapRules),
            }}
          />
        </Section>
      )}
    </PageShell>
  );
}
