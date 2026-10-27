import { EffectRuntime } from '@/lib/motion/EffectRuntime';
import { compileDoc } from '@/lib/render/css';
import { foundationOverrideCss, tokenCssFromSeal } from '@/lib/render/custom-tokens';
import { componentsFromSnapshot } from '@/lib/render/components';
import { collectEffects, NodeRenderer, type RenderContext } from '@/lib/render/NodeRenderer';
import { ViewCounter } from '@/components/site/ViewCounter';
import { ARTICLE_CSS } from '@/lib/render/article-css';
import { jsonForScript } from '@/lib/render/json-for-script';
import { pickJsonLd } from '@/lib/render/entry-meta';
import {
  articleJsonLd,
  entryBindingData,
  entryBodies,
  entrySeo,
  relationStructuredData,
  repeatAssetIds,
  resolveAllRepeats,
  typeShape,
} from '@/lib/render/collection-page';
import { loadAssets, type PublishedPage } from '@/lib/render/page';
import { resolveAllNavCharts } from '@/lib/render/nav-data';
import { resolveProjectData } from '@/lib/render/project-data';
import { allowedEmbedHostnames } from '@/lib/render/embed-origins';
import { applyTranslations, entriesFromSnapshot } from '@/lib/render/translations';
import type { EntryRow } from '@/lib/collections/queries';

/**
 * Dựng MỘT trang đã publish thành HTML — tách khỏi `[[...slug]]/page.tsx` ngày
 * 20/10/2026 để trang 404 hệ thống (`not-found.tsx`) dựng bằng ĐÚNG đường của mọi
 * trang khác. Một đường dựng thứ hai sẽ trôi khỏi đường này, và trang 404 sửa trong
 * builder sẽ ra khác thứ canvas cho thấy.
 *
 * Phần CHỌN trang (khớp slug, mẫu chi tiết, redirect) vẫn ở catch-all; ở đây chỉ
 * nhận một `Target` đã phân giải.
 */

export interface Target {
  page: PublishedPage;
  /** Entry của trang chi tiết. `null` trên trang thường và trang danh sách. */
  entry: EntryRow | null;
  /** Gốc trang chi tiết, ví dụ '/blogs/post'. Có mặt trên CẢ trang danh sách. */
  detailBase?: string;
  /** Gốc trang danh mục, ví dụ '/blogs'. Có mặt trên CẢ trang danh sách. */
  taxonomyBase?: string;
  /** Danh mục lấy từ URL, trên trang `param:'taxonomy'`. */
  urlTaxonomyId?: string;
  /** Bản ghi đích lấy từ URL, trên trang `param:'relation'`. */
  urlRelationId?: string;
  /**
   * Chính bản ghi đích đó — trang danh mục đọc field `seo` của nó (chỉ giá trị ghi đè).
   * KHÔNG đặt vào `entry`: xem `resolveTarget` cho lý do bản ghi này là tham số của
   * trang chứ không phải nội dung của nó.
   */
  relationEntry?: EntryRow;
  typeKey?: string;
}

export async function PublishedPageView({
  target,
  locale,
}: {
  target: Target;
  locale: { isDefault: boolean; code: string };
}) {
  const localeCode = locale.isDefault ? undefined : locale.code;
  const { page, entry, detailBase, taxonomyBase, urlTaxonomyId, urlRelationId } = target;

  // Phủ bản dịch từ ẢNH CHỤP của release, không phải từ bảng Translation: bảng đó
  // là bản nháp, và đọc nó ở đây sẽ đưa mọi ký tự vừa gõ lên site thật.
  const doc = locale.isDefault
    ? page.doc
    : applyTranslations(page.doc, entriesFromSnapshot(page.translations, locale.code));

  // Ảnh chụp của release, KHÔNG phải bảng Preset hiện tại. Đọc bảng live ở đây
  // nghĩa là sửa một component đổi ngay site đang chạy, bỏ qua publish.
  const components = componentsFromSnapshot(page.components);

  // Ba việc phụ thuộc lẫn nhau, nên chúng nối tiếp: entry → thân bài → ảnh của thân
  // bài. Khối lặp thì độc lập với cả ba, nên nó chạy song song.
  const [resolved, shape, navSeries, projectData] = await Promise.all([
    resolveAllRepeats(doc, {
      locale: localeCode,
      entry: entry ?? undefined,
      detailBase,
      taxonomyBase,
      // Trước 09/09/2026 dòng này KHÔNG có mặt, nên `urlTaxonomyId` luôn `undefined`
      // lúc render trang — cả đường ống filter `taxonomy.from: 'url'` đã chạy thật ở
      // API công khai nhưng chết ở đây. Đó là chỗ trang danh mục thiếu.
      urlTaxonomyId,
      // Cùng một dây, cho mô hình danh mục kiểu mới (field `relation` thay cho field
      // `taxonomy`). Thiếu nó thì `/blogs/<danh-mục>` hiện đúng danh sách của `/blogs`.
      urlRelationId,
    }),
    target.typeKey ? typeShape(target.typeKey) : Promise.resolve(null),
    // Song song với hai việc trên: chuỗi NAV không phụ thuộc entry hay thân bài.
    resolveAllNavCharts(doc, page.siteGlobals),
    // Composite của gói dự án cần dữ liệu tầng trang — xem project-data.ts.
    resolveProjectData(doc, page.siteGlobals),
  ]);

  // Danh sách host cho `<iframe>` trong thân bài. Cùng bảng `EmbedOrigin` với CSP
  // của khối `CustomCode` — một danh sách, một chỗ quản.
  const iframeHosts = await allowedEmbedHostnames();
  const body = entry && shape ? entryBodies(shape.fields, entry.data, iframeHosts) : null;
  const seo = entry && shape ? entrySeo(shape, entry.data) : null;
  // JSON-LD tự khai của bản ghi đích, trên trang danh mục. Chỉ `structuredData` — mọi
  // thứ khác của trang danh mục là metadata, nằm ở `generateMetadata`.
  const relationJsonLd = target.relationEntry
    ? await relationStructuredData(target.relationEntry)
    : null;

  /*
   * Ảnh của NỘI DUNG đọc bảng live, ảnh của TRANG đọc ảnh chụp release.
   *
   * Không phải một ngoại lệ tuỳ tiện — hai thứ này có hai vòng đời khác nhau, và spec
   * đã quyết điều đó: trang đi qua nháp → publish, còn nội dung thì "bấm Đăng là lên
   * site ngay". Ảnh bìa của một bài đăng chiều nay không có trong ảnh chụp release
   * sáng nay, nên đọc ảnh chụp ở đây là bài lên site mà không có ảnh — im lặng, vì
   * `ImageNode` trả `null` khi thiếu asset.
   *
   * Chiều ngược lại vẫn được giữ: ảnh của cây node KHÔNG đọc live, nên thay một ảnh
   * trong builder vẫn không đổi được site đang chạy.
   */
  const contentAssetIds = [
    ...repeatAssetIds(doc, resolved),
    ...(body?.assetIds ?? []),
    // Ảnh OG cũng cần nạp: nó vào JSON-LD, và JSON-LD trỏ tới một ảnh không tồn tại là
    // một cảnh báo trong Search Console mà không ai đọc.
    ...(seo?.imageAssetId ? [seo.imageAssetId] : []),
  ];
  const contentAssets = contentAssetIds.length ? await loadAssets(contentAssetIds) : {};
  const assets = { ...page.assets, ...contentAssets };

  /*
   * JSON-LD: bài tự khai (`seo.structuredData`) → TEMPLATE khai → `Article` tự sinh.
   *
   * Template thắng mặc định tự sinh: nếu một ngày có người khai `jsonLd` riêng cho
   * template chi tiết thì đó là một quyết định có chủ đích, và một mặc định tự sinh đè
   * lên nó là thứ không có cách nào tắt. Bài tự khai lại thắng template (21/10/2026):
   * template dùng chung cho mọi bài, còn bài thì cụ thể hơn — xem `pickJsonLd`.
   */
  const jsonLd = pickJsonLd({
    entryJsonLd: seo?.jsonLd ?? relationJsonLd,
    pageJsonLd: page.jsonLd,
    auto: () =>
      entry && seo
        ? articleJsonLd({
            seo,
            publishedAt: entry.publishedAt,
            updatedAt: entry.updatedAt,
            imageUrl: seo.imageAssetId ? assets[seo.imageAssetId]?.url : undefined,
          })
        : null,
  });

  const { css } = compileDoc(doc, components);
  const tokenCss = tokenCssFromSeal(page.tokens);

  /*
   * Màu nền tảng đọc bảng LIVE, không đọc ảnh chụp — ngoại lệ có chủ đích.
   *
   * Mọi thứ khác trên trang này đến từ `Release`. Ba màu nhận diện thì không: quyết
   * định ngày 03/09/2026 là đổi màu phải thấy ngay trên site thật, không chờ một
   * lần Publish. `Site.globals` vẫn seal như cũ, nên hai chế độ nằm cạnh nhau và
   * màn Cài đặt phải nói rõ chỗ nào là chỗ nào.
   *
   * Cái giá, đã biết và đã chấp nhận: lùi một release KHÔNG lùi màu. Đường lùi màu
   * là lịch sử token trong màn Cài đặt.
   *
   * In SAU `tokenCss` — cùng specificity thì nguồn sau thắng. Xem `OVERRIDE_SELECTOR`
   * cho lý do selector của nó không phải chỉ `:root`.
   */
  const overrideCss = await foundationOverrideCss();

  const ctx: RenderContext = {
    doc,
    components,
    scope: {
      site: page.siteGlobals,
      page: { title: page.title, slug: page.slug },
      // Trang chi tiết: binding `collection` đọc entry đang mở, kể cả NGOÀI khối lặp
      // — tiêu đề h1 và ngày đăng nằm trong template, không nằm trong một thẻ lặp.
      ...(entry ? { collection: entryBindingData(entry) } : {}),
    },
    assets,
    repeatItems: resolved.items,
    repeatGroups: resolved.groups,
    repeatGroupEntries: resolved.groupEntries,
    navSeries,
    projectData,
    detailBase,
    taxonomyBase,
    entryBody: body?.bodies,
  };

  return (
    <>
      {/* Inline trong body chứ không phải <head>: Next cho phép, và nó tiết kiệm
          một round-trip. Kích thước bị chặn bởi số node, không phải bởi framework. */}
      {tokenCss && (
        <style
          data-mm-tokens=""
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: tokenCss }}
        />
      )}
      {overrideCss && (
        <style
          data-mm-foundation=""
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: overrideCss }}
        />
      )}
      <style
        data-mm-doc=""
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: css }}
      />
      {/* Chỉ phát trên trang có thân bài. `reset.css` làm phẳng mọi khối, nên không có
          khối này thì bài viết là một khối chữ cùng cỡ, không bullet — xem
          `article-css.ts`. Đây là CSS của ta, không phải chuỗi người dùng nhập. */}
      {body && body.bodies.size > 0 && (
        <style
          data-mm-article-css=""
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: ARTICLE_CSS }}
        />
      )}
      {jsonLd ? (
        <script
          type="application/ld+json"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: jsonForScript(jsonLd) }}
        />
      ) : null}
      <NodeRenderer nodeId={doc.rootId} ctx={ctx} />
      {/* Manifest phẳng, serialize từ server. EffectRuntime là ranh giới client
          DUY NHẤT cho motion — xem ghi chú trong file đó. */}
      {/* `assets` đi kèm vì `image-sequence` giữ lô khung dưới dạng assetId, còn
          effect chạy phía client thì chỉ có DOM — xem `collectEffects`. */}
      <EffectRuntime manifest={collectEffects(doc, assets, components)} />
      {/* Chỉ trên trang chi tiết: đếm lượt xem cho cột "Bài viết nổi bật".
          Từ trình duyệt chứ không lúc render — trang được cache, xem ViewCounter. */}
      {entry ? <ViewCounter entryId={entry.id} /> : null}
    </>
  );
}
