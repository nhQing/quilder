import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';

import { when as formatWhen } from '@/lib/when';

/**
 * Xem một RELEASE CŨ, trước khi quyết định lùi về nó.
 *
 * ## Vì sao route này phải tồn tại
 *
 * Lùi bản là thao tác an toàn nhất trong hệ thống — đổi một con trỏ, dưới một giây,
 * lùi lại được ngay. Nhưng nó vẫn **đổi thứ khách đang xem**, và trước lát này màn
 * Lịch sử publish chỉ cho biết nhãn, giờ, người bấm và số trang. Không ai trả lời
 * được câu duy nhất đáng hỏi trước khi bấm: *bản đó trông ra sao*.
 *
 * Cách duy nhất trước đây là lùi thật rồi nhìn — tức dùng site thật làm bản xem thử.
 *
 * ## Vì sao nó dùng lại đúng đường dựng trang của site thật
 *
 * `getReleasePage` là `loadPublishedPage` với `releaseId` tường minh, không phải một
 * đường dựng thứ hai. Một bản sao sẽ trôi khỏi bản gốc, và thứ trôi mất chính là điều
 * màn này tồn tại để trả lời.
 *
 * ## Vì sao KHÔNG dùng `<Canvas>` hay iframe
 *
 * Trang render thẳng vào document, y như `/preview/[pageId]`. Đó là điều làm nó trung
 * thực: cùng CSS, cùng token, cùng thứ tự style.
 */

import { PreviewPill } from '@/components/site/PreviewPill';
import { getSession } from '@/lib/auth/guard';
import { prisma } from '@/lib/db';
import { compileDoc } from '@/lib/render/css';
import { tokenCssFromSeal } from '@/lib/render/custom-tokens';
import { componentsFromSnapshot } from '@/lib/render/components';
import { NodeRenderer, type RenderContext } from '@/lib/render/NodeRenderer';
import { getReleasePage, listReleaseSlugs } from '@/lib/render/page';

export const dynamic = 'force-dynamic';

export const metadata = {
  // Bản cũ càng không được index: nó là nội dung đã bị thay thế.
  robots: { index: false, follow: false },
};

export default async function ReleasePreview({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ slug?: string }>;
}) {
  const { id } = await params;
  const { slug: wanted } = await searchParams;

  /*
   * Kiểm phiên Ở ĐÂY, không chỉ dựa vào middleware — cùng lý do `/preview/[pageId]`
   * làm vậy: middleware chạy trên Edge nên chỉ xác minh được chữ ký JWT, còn một
   * token đã thu hồi vẫn qua được nó.
   */
  const session = await getSession();
  if (!session) redirect(`/builder/login?next=/preview/release/${id}`);

  const release = await prisma.release.findUnique({
    where: { id },
    select: { id: true, label: true, createdAt: true, createdBy: true },
  });
  if (!release) notFound();

  const site = await prisma.site.findFirst({ select: { activeReleaseId: true } });
  const isActive = site?.activeReleaseId === id;

  const slugs = await listReleaseSlugs(id);
  if (!slugs.length) notFound();

  /*
   * `?slug=` chọn trang. Mặc định là TRANG CHỦ nếu release có nó, không phải trang
   * đầu bảng chữ cái: người mở màn này muốn biết "site trông ra sao", và câu trả lời
   * bắt đầu ở trang chủ.
   */
  const slug = wanted !== undefined && slugs.includes(wanted) ? wanted : (slugs.includes('') ? '' : slugs[0]!);

  const page = await getReleasePage(id, slug);
  if (!page) notFound();

  const components = componentsFromSnapshot(page.components);
  const { css } = compileDoc(page.doc, components);
  const tokenCss = tokenCssFromSeal(page.tokens);

  const ctx: RenderContext = {
    doc: page.doc,
    components,
    scope: { site: page.siteGlobals, page: { title: page.title, slug: page.slug } },
    /*
     * Ảnh lấy từ ẢNH CHỤP của release, không phải bảng live.
     *
     * Đó là toàn bộ điểm của màn này: nó phải hiện bản CŨ, kể cả khi một asset đã bị
     * thay từ hôm đó. Đọc bảng live sẽ cho một bản lai — nội dung cũ, ảnh mới — tức
     * đúng thứ không tồn tại ở bất kỳ thời điểm nào.
     */
    assets: page.assets,
  };

  /*
   * Server component, nên không có hydration mismatch để lo. Vẫn dùng chung
   * `when()`: nếu không, giờ ở đây là giờ CỦA CONTAINER (UTC trên server thật),
   * lệch bảy tiếng so với đúng mốc đó hiển thị ở màn Lịch sử publish — hai màn
   * nói về cùng một release mà ghi hai giờ khác nhau.
   */
  const when = formatWhen(release.createdAt, {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  return (
    <>
      {tokenCss && (
        <style
          data-mm-tokens=""
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: tokenCss }}
        />
      )}
      <style
        data-mm-doc=""
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: css }}
      />

      {/*
        Thanh nổi giữa đáy, cùng vỏ với thanh xem nháp (`PreviewPill`) và cùng lý do —
        xem "Vì sao nổi ở đáy" trong `PreviewChrome.tsx`: dính ở trên thì nó che header
        của site, đúng phần người ta mở màn này để soi; chiếm chỗ trong luồng thì trang
        dài hơn bản thật và hai bản không so được bằng mắt.

        Chip trạng thái khác màu thanh xem nháp: đây là nội dung ĐÃ TỪNG lên site, không
        phải bản nháp. Hai màn trông giống nhau là hai màn bị nhầm lẫn. Nháp = cảnh báo
        (vàng), release đang chạy = `ok` (xanh, cùng nghĩa "đang chạy" của Badge trong
        vỏ), release cũ = trung tính — nó không lỗi, không chạy, chỉ là lịch sử.
      */}
      <PreviewPill
        label="Công cụ xem release"
        tone={isActive ? 'ok' : 'neutral'}
        statusTitle={
          `${isActive ? 'Bản ĐANG CHẠY' : 'Bản CŨ — không phải bản đang chạy'}` +
          ` · ${release.label} · ${when} · ${release.createdBy}`
        }
        data={{ 'data-release-preview': release.id }}
        status={
          isActive ? (
            'Bản ĐANG CHẠY'
          ) : (
            <>
              <span data-pill-long="">Bản CŨ — không phải bản đang chạy</span>
              <span data-pill-short="">Bản CŨ</span>
            </>
          )
        }
      >
        {/* Co lại và cắt `…` trước tiên khi thiếu chỗ; câu đầy đủ nằm ở `title`. Màn
            hẹp thì ẩn hẳn — câu đó đi theo `title` của chip trạng thái. */}
        <span data-pill-meta="" title={`${release.label} · ${when} · ${release.createdBy}`}>
          {release.label} · {when} · {release.createdBy}
        </span>

        <span data-pill-sep="" aria-hidden="true" />
        {/* Bộ chuyển trang: một release là cả site, nên xem một trang không trả lời
            được "bản này trông ra sao". Nhiều trang thì dải tự cuộn ngang trong thanh. */}
        <span data-pill-group="" data-pill-scroll="" role="group" aria-label="Trang trong release">
          {slugs.map((s) => (
            <Link
              key={s}
              href={`/preview/release/${release.id}?slug=${encodeURIComponent(s)}`}
              data-pill-seg=""
              data-pill-mono=""
              aria-current={s === slug ? 'page' : undefined}
            >
              /{s}
            </Link>
          ))}
        </span>

        <span data-pill-sep="" aria-hidden="true" />
        <Link href="/builder/releases" data-pill-seg="" title="Về màn Lịch sử publish">
          <span data-pill-long="">← Lịch sử publish</span>
          <span data-pill-short="">← Lịch sử</span>
        </Link>
      </PreviewPill>

      {/*
        KHÔNG mount `EffectRuntime`.

        Màn này để đối chiếu nội dung và bố cục giữa hai bản, và motion làm việc đó
        khó hơn: phần tử bị ghim, mờ dần, trượt vào — nên hai bản cạnh nhau không so
        được bằng mắt. `/preview/[pageId]` thì ngược lại, nó tồn tại để xem đúng thứ
        khách sẽ thấy.
      */}
      <NodeRenderer nodeId={page.doc.rootId} ctx={ctx} />
    </>
  );
}
