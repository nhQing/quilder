import { notFound } from 'next/navigation';
import '@/styles/site.css';
// CSS của gói dự án (QUILDER_PROJECT), nối SAU CSS lõi — cùng thứ tự với bó của site công khai.
import '@project/styles.css';

import { getDraftPage } from '@/lib/builder/queries';
import { compileDoc } from '@/lib/render/css';
import { customTokensCss } from '@/lib/render/custom-tokens';
import { loadComponents } from '@/lib/render/components';
import { draftSiteGlobals } from '@/lib/render/draft-globals';
import { NodeRenderer, type RenderContext } from '@/lib/render/NodeRenderer';
import { collectAssetIds, loadAssets } from '@/lib/render/page';
import { applyTranslations } from '@/lib/render/translations';
import { listDraftTranslations } from '@/lib/i18n/queries';
import type { TranslatableField } from '@/lib/builder/text-units';


export const dynamic = 'force-dynamic';

/**
 * Nội dung của iframe xem trước trong builder.
 *
 * Khác `(site)/[[...slug]]` ở ba điểm, cả ba đều có lý do:
 *
 * 1. Đọc **bản nháp**, không phải release đang active — đó là mục đích tồn tại.
 * 2. **Không mount EffectRuntime.** Motion khiến việc chọn và đo bị nhảy: một
 *    node đang được scroll-reveal kéo lên sẽ trả về rect sai, và khung chọn lệch
 *    khỏi element. Preview trong builder xem tĩnh; muốn xem motion thật thì bấm
 *    "Xem nháp" mở tab riêng.
 * 3. `data-reveal-ready` không bao giờ được bật, nên CSS không ẩn gì cả và mọi
 *    node đều nhìn thấy được để chọn.
 */
export default async function BuilderRender({
  params,
  searchParams,
}: {
  params: Promise<{ pageId: string }>;
  searchParams: Promise<{ locale?: string }>;
}) {
  const { pageId } = await params;
  const { locale } = await searchParams;
  const page = await getDraftPage(pageId);
  if (!page) notFound();

  /*
   * `?locale=en` — phủ bản dịch NHÁP lên doc trước khi render.
   *
   * Đọc bảng `Translation` chứ không đọc `Release.translations`: cả route này tồn
   * tại để xem bản nháp, và một bản dịch vừa gõ xong mà phải publish mới thấy là
   * dùng site thật làm bản nháp — đúng thứ kiến trúc draft/publish tránh.
   *
   * Ngôn ngữ mặc định KHÔNG có bản dịch nào để phủ (nó LÀ bản gốc), nên `locale`
   * vắng hoặc trỏ vào ngôn ngữ mặc định đều đi thẳng.
   */
  const doc = locale
    ? applyTranslations(
        page.doc,
        (await listDraftTranslations(pageId))[locale]?.map((t) => ({
          nodeId: t.nodeId,
          field: t.field as TranslatableField,
          value: t.value,
        })) ?? [],
      )
    : page.doc;

  // Cây component phải có TRƯỚC khi gom asset và trước khi compile CSS: cả hai
  // đều phải nhìn xuyên qua instance.
  const components = await loadComponents(doc);
  /*
   * Gom asset trên doc ĐÃ PHỦ DỊCH, không phải `page.doc`.
   *
   * Bản dịch đổi được `assetId` (ảnh và video khác nhau theo ngôn ngữ), nên gom
   * trên bản gốc sẽ thiếu đúng những asset chỉ bản dịch dùng — và `ImageNode` trả
   * `null` khi thiếu asset, im lặng. Site thật không dính lỗi này vì release chụp
   * MỌI asset (xem `assetSnapshot`), nên nó sẽ chỉ xuất hiện trong builder: đúng
   * chỗ khó nghi nhất.
   */
  const assets = await loadAssets(collectAssetIds(doc, components));
  const { css } = compileDoc(doc, components);
  // Token người dùng tự tạo không có trong tokens.css tĩnh. Không phát ở đây thì
  // var(--tên) resolve rỗng, thuộc tính bị bỏ qua, màu biến mất không báo lỗi.
  const tokenCss = await customTokensCss();

  const ctx: RenderContext = {
    doc,
    components,
    // Globals live, không phải của release: canvas là bản NHÁP — xem `draftSiteGlobals`.
    scope: { site: await draftSiteGlobals(), page: { title: page.title, slug: page.slug } },
    assets,
  };

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
      {/* Con trỏ trong builder phải là mũi tên chọn, không phải cursor tuỳ biến
          của website — nếu không sẽ không biết mình đang chỉ vào đâu. */}
      <style
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{
          __html: '*{cursor:default!important}a,button{cursor:pointer!important}',
        }}
      />
      <NodeRenderer nodeId={doc.rootId} ctx={ctx} />
    </>
  );
}
