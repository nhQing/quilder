import { notFound, redirect } from 'next/navigation';

import { getSession } from '@/lib/auth/guard';
import { EffectRuntime } from '@/lib/motion/EffectRuntime';
import { getDraftPage } from '@/lib/builder/queries';
import { compileDoc } from '@/lib/render/css';
import { customTokensCss } from '@/lib/render/custom-tokens';
import { loadComponents } from '@/lib/render/components';
import { applyTranslations } from '@/lib/render/translations';
import { getLocales, listDraftTranslations } from '@/lib/i18n/queries';
import { collectEffects, NodeRenderer, type RenderContext } from '@/lib/render/NodeRenderer';
import { collectAssetIds, loadAssets } from '@/lib/render/page';
import {
  entryBodies,
  parsePageCollection,
  previewBinding,
  repeatAssetIds,
  resolveAllRepeats,
  typeShape,
} from '@/lib/render/collection-page';
import { allowedEmbedHostnames } from '@/lib/render/embed-origins';
import { draftSiteGlobals } from '@/lib/render/draft-globals';
import { PreviewChrome } from '@/components/site/PreviewChrome';
import { PREVIEW_PILL_SPACE } from '@/components/site/preview-pill';

export const dynamic = 'force-dynamic';

export const metadata = {
  // Bản nháp không bao giờ được index. Middleware sẽ đặt thêm X-Robots-Tag ở
  // bước auth; đây là lớp thứ nhất.
  robots: { index: false, follow: false },
};

/**
 * Xem nháp — trang thật, có motion, chưa publish.
 *
 * Khác iframe trong builder (`/render/[pageId]`): ở đây EffectRuntime CÓ mount,
 * vì mục đích là xem đúng thứ khách sẽ thấy sau khi publish. Trong builder thì
 * ngược lại — motion làm rect nhảy nên khung chọn lệch khỏi element.
 *
 * Chưa có token ký hạn 15 phút như plan mô tả; nó đến cùng auth. Cho tới lúc đó
 * đường dẫn này đoán được, nên đừng coi nó là bí mật.
 *
 * ## `?locale=en` — xem trước bản dịch NHÁP
 *
 * Đây là đường DUY NHẤT để thấy một bản dịch trước khi publish. Không có nó thì
 * quy trình dịch buộc phải publish rồi mới xem được, tức là dùng site thật làm
 * bản nháp — đúng thứ mà cả kiến trúc draft/publish này tồn tại để tránh.
 *
 * Khác site thật ở nguồn đọc: ở đây là bảng `Translation` (nháp), còn site thật
 * đọc ảnh chụp trong `Release.translations`.
 */
/**
 * `?w=<px>` — giả lập một bề rộng màn hình.
 *
 * Không thể thu hẹp khung nhìn từ bên trong chính trang, nên chế độ này trả về một
 * VỎ: iframe rộng đúng `w`, thanh công cụ nổi ở dải đáy bên dưới nó, và iframe đó nạp
 * lại chính `/preview/<id>` KHÔNG kèm `w`.
 *
 * Mặc định (không có `w`) vẫn render trang trực tiếp vào document. Điều đó là bắt
 * buộc, không phải mặc định cho tiện: `pnpm check:layout` đo `[data-n]` ở document
 * trên cùng, và bốn spec e2e chạy effect ở đó.
 *
 * Giá trị ngoài khoảng cho phép bị BỎ QUA (coi như không có `w`) chứ không kẹp về
 * biên: `?w=0` là gõ nhầm hoặc link hỏng, và một iframe rộng 240px không phải thứ
 * người ta muốn khi gõ 0.
 *
 * ## `?embed=1` — bản nằm TRONG iframe, không có dải công cụ
 *
 * Vỏ giả lập đã có dải công cụ của nó ở document ngoài. Không có cờ này thì bản bên
 * trong iframe cũng dựng dải của nó, và người dùng thấy **hai thanh breakpoint** xếp
 * lên nhau — thanh dưới lại còn không đổi được gì, vì nó đổi URL của iframe chứ
 * không của vỏ.
 *
 * Cờ này KHÔNG dùng để đổi cách render nội dung: nó chỉ bỏ dải công cụ. `/preview/<id>`
 * trần vẫn là bản mà `pnpm check:layout` và bốn spec e2e đo.
 */
const MIN_SIM_WIDTH = 240;
const MAX_SIM_WIDTH = 3840;

function simulatedWidth(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  const w = Math.round(n);
  return w >= MIN_SIM_WIDTH && w <= MAX_SIM_WIDTH ? w : null;
}

export default async function PreviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ pageId: string }>;
  searchParams: Promise<{ locale?: string; w?: string; embed?: string; param?: string }>;
}) {
  const { pageId } = await params;
  const { locale, w, embed, param: paramValue } = await searchParams;
  const simWidth = simulatedWidth(w);

  // Kiểm phiên Ở ĐÂY chứ không chỉ dựa vào middleware.
  //
  // Middleware chạy trên Edge nên chỉ xác minh được chữ ký JWT — một token
  // service đã bị thu hồi vẫn qua được nó. Thu hồi chỉ có hiệu lực ở tầng gọi
  // được database, và bản nháp là thứ đáng bảo vệ nhất trên hệ thống này: nó là
  // nội dung chưa duyệt của một site tài chính.
  const session = await getSession();
  if (!session) redirect(`/builder/login?next=/preview/${pageId}`);

  // Nạp cùng lúc: dải ngôn ngữ cần danh sách này ở CẢ hai nhánh bên dưới (vỏ giả
  // lập và bản nguyên bản), nên đọc nó sau nhánh đầu là đọc hai lần ở hai chỗ.
  const [page, locales] = await Promise.all([getDraftPage(pageId), getLocales()]);
  if (!page) notFound();

  /*
   * Chế độ giả lập: chỉ vỏ + iframe. Dừng TRƯỚC khi biên dịch CSS và nạp component —
   * bản trong iframe sẽ tự làm việc đó, và làm hai lần là hai lần truy vấn DB cho
   * cùng một trang.
   */
  if (simWidth !== null) {
    const inner =
      `/preview/${pageId}?embed=1` +
      (locale ? `&locale=${encodeURIComponent(locale)}` : '') +
      // Giá trị đoạn động phải đi theo vào iframe. Không truyền thì vỏ giả lập hiện
      // bản ghi mới nhất còn bản ngoài hiện bản người dùng chọn — hai màn khác nhau
      // cho cùng một địa chỉ.
      (paramValue ? `&param=${encodeURIComponent(paramValue)}` : '');
    return (
      <>
        <PreviewChrome pageId={pageId} locale={locale} locales={locales} width={simWidth} />
        <div
          style={{
            // Đúng một màn: khung iframe ở trên, dải đáy cho thanh công cụ nổi.
            //
            // Thanh là `fixed` nên nó không chiếm chỗ trong luồng. Ở bản trần điều đó
            // là cố ý (trang giữ đúng hình học của site thật); ở đây vỏ là của mình,
            // nên chừa hẳn dải đáy — thanh nổi trên nền tối, không che đáy của trang
            // trong iframe, thứ người soát sẽ không cuộn tới được nếu bị che.
            //
            // Nền tối để thấy rõ mép khung — cùng ý với khung trên canvas builder.
            background: '#1c1b22',
            boxSizing: 'border-box',
            height: '100svh',
            paddingBlockEnd: `calc(${PREVIEW_PILL_SPACE}px + env(safe-area-inset-bottom, 0px))`,
            // Bề rộng THẬT, không thu nhỏ: xem trước phải trung thực, và một bản đã
            // bị scale thì không đo được gì bằng mắt. Không đủ chỗ thì cuộn ngang.
            display: 'flex',
          }}
        >
          <iframe
            src={inner}
            title={`Xem nháp ở ${simWidth}px`}
            style={{
              width: simWidth,
              flex: '0 0 auto',
              height: '100%',
              // Căn giữa bằng `margin: auto`, KHÔNG bằng `justify-content: center`.
              // Khung rộng hơn màn (1920 trên màn 1440) thì `center` đẩy phần thừa ra
              // CẢ hai bên, và phần lòi sang trái nằm ở toạ độ âm — không cuộn tới được:
              // đo ngày 09/10/2026, 240px bên trái của khổ 1920 không bao giờ nhìn thấy.
              // `auto` co về 0 khi thiếu chỗ, nên phần thừa chỉ tràn sang phải.
              marginInline: 'auto',
              border: 0,
              background: '#fff',
            }}
          />
        </div>
      </>
    );
  }

  const drafts = locale ? await listDraftTranslations(pageId) : {};
  const doc = locale
    ? applyTranslations(
        page.doc,
        (drafts[locale] ?? []).map((t) => ({
          nodeId: t.nodeId,
          field: t.field as 'content' | 'label' | 'alt' | 'a11yLabel',
          value: t.value,
        })),
      )
    : page.doc;

  const components = await loadComponents(doc);

  /*
   * Xem trước phải GIẢI khối lặp, y như site thật.
   *
   * Trước 09/09/2026 nó không giải: `RenderContext` ở đây dựng `scope` trơn, không
   * entry, không repeat. Hậu quả đo được ngày 08/09 — một `Instance` có `repeat` hợp
   * lệ (`resolve_repeat` trả đúng 3 entry) render ra MỘT thẻ chưa bind. Người dựng
   * kết luận "repeat chưa có runtime" rồi đi đường vòng: 11 instance tĩnh, ~40 op,
   * một trang không tự cập nhật theo CMS. Toàn bộ chi phí đến từ việc preview nói dối.
   */
  const binding = await previewBinding({
    collection: parsePageCollection(page.collection),
    paramValue: paramValue ?? undefined,
    locale,
  });
  const resolved = await resolveAllRepeats(doc, {
    locale,
    entry: binding.entry,
    detailBase: binding.detailBase,
    taxonomyBase: binding.taxonomyBase,
    urlTaxonomyId: binding.urlTaxonomyId,
    // Vai `relation` cần ô này y như vai `taxonomy` cần ô trên. Thiếu nó,
    // `resolveAllRepeats` đọc `undefined` là "không lọc theo URL" và màn xem trước
    // của trang danh mục hiện DANH SÁCH ĐẦY ĐỦ — preview nói dối đúng ở nơi người
    // dùng mở ra để nghiệm thu.
    urlRelationId: binding.urlRelationId,
  });

  const shape = binding.entry ? await typeShape(binding.entry.typeKey) : null;
  const iframeHosts = binding.entry ? await allowedEmbedHostnames() : [];
  const body =
    binding.entry && shape
      ? entryBodies(shape.fields, binding.entry.data, iframeHosts)
      : null;

  const assets = await loadAssets([
    ...collectAssetIds(doc, components),
    ...repeatAssetIds(doc, resolved),
    ...(body?.assetIds ?? []),
  ]);
  const { css } = compileDoc(doc, components);
  const tokenCss = await customTokensCss();

  const ctx: RenderContext = {
    doc,
    components,
    scope: {
      // Globals live — xem nháp là thứ SẼ lên ở lần Publish tới (`draftSiteGlobals`).
      site: await draftSiteGlobals(),
      page: { title: page.title, slug: page.slug },
      ...(binding.entry ? { collection: binding.entry.data } : {}),
    },
    assets,
    repeatItems: resolved.items,
    repeatGroups: resolved.groups,
    repeatGroupEntries: resolved.groupEntries,
    detailBase: binding.detailBase,
    taxonomyBase: binding.taxonomyBase,
    entryBody: body?.bodies,
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
      {/* Trong iframe của vỏ giả lập thì KHÔNG dựng dải: vỏ ngoài đã có một cái. */}
      {!embed && (
        <PreviewChrome pageId={pageId} locale={locale} locales={locales} width={null} binding={binding.label} />
      )}
      <NodeRenderer nodeId={doc.rootId} ctx={ctx} />
      {/* `assets` là bắt buộc, không phải tuỳ chọn: `image-sequence` giữ frame dưới
          dạng assetId trong params, và chỉ `collectEffects` mới đổi được chúng thành
          URL. Thiếu tham số này thì màn xem trước gán `img.src = "<assetId>"` — 404
          trên MỌI khung, trong khi site thật vẫn đúng. Một sai lệch chỉ hiện ở bản
          nháp là loại khó truy nhất, vì chỗ người ta soi lại là chỗ duy nhất sai. */}
      <EffectRuntime manifest={collectEffects(doc, assets, components)} />
    </>
  );
}
