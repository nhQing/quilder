import { notFound } from 'next/navigation';

import { EditorShell } from '@/components/builder/EditorShell';
import { getDraftPage, listPages, listPresets, listTokens, publishedSeq, siteShareDefaults } from '@/lib/builder/queries';
import { loadComponents } from '@/lib/render/components';
import { draftSiteGlobals } from '@/lib/render/draft-globals';
import { readEndpointTable } from '@/lib/doc/endpoint-table';
import { getLocales, listDraftTranslations } from '@/lib/i18n/queries';
import { configuredSiteOrigin } from '@/lib/site/origin';

export const dynamic = 'force-dynamic';

export default async function EditorPage({
  params,
}: {
  params: Promise<{ pageId: string }>;
}) {
  const { pageId } = await params;
  const [page, pages, presets, tokens, baseSeq, locales, translations, share, globals, siteUrl] = await Promise.all([
    getDraftPage(pageId),
    listPages(),
    listPresets(),
    listTokens(),
    publishedSeq(pageId),
    // Chỉ ngôn ngữ ĐÃ BẬT: một ngôn ngữ chưa bật không có URL công khai, nên dựng
    // bản dịch cho nó trong builder là soạn cho một trang không ai tới được.
    getLocales(),
    // Panel Nội dung hiện ô bản dịch ở chế độ ngôn ngữ. Đọc ở đây chứ không gọi API
    // từ client: cùng dữ liệu mà bảng Văn bản đọc, một nguồn.
    listDraftTranslations(pageId),
    // Tên site + ảnh chia sẻ mặc định: thẻ xem trước trong khối "Trang" lùi về đây khi
    // trang không đặt ảnh riêng — đúng thứ tự mà site dùng.
    siteShareDefaults(),
    // Bảng endpoint cho ô "Gửi tới" của Form. Bảng LIVE, không phải ảnh chụp release:
    // canvas nháp cũng đọc bảng này (xem `draftSiteGlobals`), nên ô chọn và khung xem
    // trước nói cùng một điều về việc form có chạy hay không.
    draftSiteGlobals(),
    // `null` khi chưa đặt domain: thẻ xem trước và nút Chia sẻ lùi về địa chỉ builder.
    configuredSiteOrigin(),
  ]);
  if (!page) notFound();

  // Nạp SAU khi có doc: danh sách component cần nạp suy ra từ chính doc.
  const components = await loadComponents(page.doc);

  return (
    <EditorShell
      pageId={page.id}
      slug={page.slug}
      title={page.title}
      doc={page.doc}
      seq={page.seq}
      baseSeq={baseSeq}
      pages={pages}
      presets={presets}
      tokens={tokens}
      components={components}
      locales={locales}
      translations={translations}
      // Tiêu đề và slug đi cùng khối SEO: khối "Trang" bày chúng ở dạng CHỈ ĐỌC,
      // vì cả hai đã có ô sửa riêng trên dải đỉnh và đổi slug kéo theo luật redirect.
      seo={{
        ...page.seo,
        title: page.title,
        slug: page.slug,
        siteName: share.siteName,
        defaultOgImageUrl: share.defaultImageUrl,
        titleTemplate: share.titleTemplate,
        defaultDescription: share.defaultDescription,
        siteUrl,
      }}
      siteUrl={siteUrl}
      endpoints={readEndpointTable(globals)}
    />
  );
}
