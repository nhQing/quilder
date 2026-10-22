import { notFound, permanentRedirect } from 'next/navigation';

import {
  detailBaseForType,
  entrySeo,
  findTemplateForSlug,
  loadDetailEntry,
  parsePageCollection,
  relationEntryBySlug,
  taxonomyBaseForType,
  taxonomyByKey,
  typeShape,
} from '@/lib/render/collection-page';
import { isTemplateSlug } from '@/lib/builder/slug';
// `collectAssetIds` CỐ Ý không import ở đây: nó lọc theo doc, còn ảnh chụp của release
// đã gom sẵn mọi asset lúc publish. `loadAssets` thì CÓ, và chỉ cho ảnh của ENTRY —
// xem chỗ gọi, và xem docblock đã cập nhật của chính nó.
import { getPublishedPage, getSiteShare, loadAssets } from '@/lib/render/page';
import { shareMeta } from '@/lib/render/share-meta';
import { applySeoToMeta, ogImageAlt } from '@/lib/render/entry-meta';
import { resolveEntrySeo, type EntrySeo } from '@/lib/collections/seo';
import { resolveRedirect } from '@/lib/render/redirects';
import { entriesFromSnapshot } from '@/lib/render/translations';
import { pageMetaFrom } from '@/lib/builder/page-meta';
import { entryLocaleState } from '@/lib/collections/entry-locale-read';
import { isLocalePublished, localeSlug } from '@/lib/collections/entry-locale';
import { localePath, splitLocale } from '@/lib/i18n/locale';
import { getLocales } from '@/lib/i18n/queries';
import { PublishedPageView, type Target } from '../PublishedPageView';

/**
 * Cùng lý do với sitemap: nội dung nằm trong DB, và `docker build` chạy ở nơi
 * không có Postgres. Prerender lúc build sẽ nướng cứng một bản chụp nội dung vào
 * image — vốn cũng đi ngược lại toàn bộ thiết kế, vì publish phải là đổi con trỏ
 * chứ không phải build lại image.
 *
 * Caching vẫn còn nguyên: `getPublishedPage` bọc `unstable_cache` với tag
 * 'release' và 'page:<slug>', nên trang được phục vụ từ cache giữa hai lần publish.
 * Nội dung collection có tag riêng (`collection:<typeKey>`), hết hiệu lực khi có
 * người đăng bài chứ không chờ publish release.
 */
export const dynamic = 'force-dynamic';

type Params = { slug?: string[] };

/**
 * `[[...slug]]` bắt cả '' (trang chủ), cả đường dẫn nhiều đoạn, và cả tiền tố
 * ngôn ngữ.
 *
 * Không dùng route group `[locale]` riêng: ngôn ngữ mặc định KHÔNG có tiền tố,
 * nên một segment động sẽ không khớp `/gioi-thieu` và mọi URL đang chạy đổi hết.
 */
async function resolve(params: Params) {
  const locales = await getLocales();
  return splitLocale(params.slug ?? [], locales);
}


/**
 * Hai gốc href của một loại, nạp song song.
 *
 * Cả trang danh sách lẫn trang danh mục đều cần CẢ HAI: một trang danh mục vẫn có
 * thể mang dải danh mục ở đầu và danh sách bài ở dưới.
 */
async function basesForType(typeKey: string) {
  const [detailBase, taxonomyBase] = await Promise.all([
    detailBaseForType(typeKey),
    taxonomyBaseForType(typeKey),
  ]);
  return { detailBase: detailBase ?? undefined, taxonomyBase: taxonomyBase ?? undefined };
}

/**
 * Slug → trang để render, theo ĐÚNG hai bước và đúng thứ tự này.
 *
 *  1. **Khớp chính xác trước.** Giữ nguyên hành vi hiện tại, không đổi một URL nào.
 *  2. Không thấy mới thử template chi tiết.
 *
 * Thứ tự đó là điều kiện để thêm collection không đụng vào site đang chạy:
 * `/tin-tuc/gioi-thieu-chuyen-muc` là một trang thật thì nó vẫn thắng một entry
 * cùng slug — kể cả khi entry đó tồn tại.
 *
 * `generateMetadata` và component trang gọi CÙNG hàm này, chứ không mỗi bên một
 * bản: hai bản sẽ trôi khỏi nhau, và thứ trôi mất là `<title>` của trang chi tiết
 * — thứ chỉ nhìn thấy trong tab trình duyệt và trong kết quả tìm kiếm.
 */
async function resolveTarget(slug: string, locale: string | undefined): Promise<Target | null> {
  const page = await getPublishedPage(slug);

  // Khớp CHÍNH XÁC chỉ áp dụng cho trang KHÔNG phải mẫu. Chuỗi `/blogs/[category]`
  // không được tự nó phục vụ như một URL: bỏ qua thì một con bot gõ đúng chuỗi ấy
  // nhận trang mẫu chưa bind dữ liệu, và Google index nó.
  if (page && !isTemplateSlug(slug)) {
    // Trang DANH SÁCH: thẻ tin phải bấm ra được trang chi tiết, nên nó cần gốc của
    // mẫu chi tiết cùng loại. Thiếu nó thì href là slug trần, tức đường dẫn tương
    // đối — bấm từ `/blogs` ra `/lai-suat`, và đó là 404.
    const col = parsePageCollection(page.collection);
    if (col?.param === 'list') {
      return { page, entry: null, ...(await basesForType(col.typeKey)), typeKey: col.typeKey };
    }
    return { page, entry: null };
  }

  const tpl = await findTemplateForSlug(slug);
  if (!tpl) return null;

  const { typeKey } = tpl.collection;
  const bases = await basesForType(typeKey);

  if (tpl.collection.param === 'taxonomy') {
    const tax = await taxonomyByKey(typeKey, tpl.paramValue);
    // Danh mục không có thật → 404, KHÔNG render một danh sách rỗng. Cùng lý do với
    // entry ngay dưới: một trang trống trông như hỏng, và Google index nó trước khi
    // có ai kịp nhìn thấy.
    if (!tax) return null;
    return { page: tpl.page, entry: null, ...bases, urlTaxonomyId: tax.id, typeKey };
  }

  /*
   * Vai `relation`: đoạn động là SLUG của một bản ghi thuộc loại đích (`danh-muc`).
   *
   * Cùng một quyết định với nhánh `taxonomy` ngay trên, và cố ý cùng: không phân giải
   * được thì 404. Đường còn lại — render trang với `urlRelationId: null`, tức "không
   * khớp gì" — cho ra một trang danh mục 200 mà trống trơn, và Google index nó trước
   * khi có ai kịp nhìn. Hai vai làm cùng một việc thì phải trả lời giống nhau.
   *
   * Điều KHÔNG được làm ở đây: trả `undefined`. `undefined` nghĩa là "không có đoạn
   * động nào để đọc" nên `filterToWhere` BỎ điều kiện, và trang danh mục sai lại hiện
   * danh sách đầy đủ như thể nó đúng — đúng lỗi cả đợt sửa này tồn tại để đóng.
   *
   * `entry` vẫn là `null`: bản ghi này là THAM SỐ của trang, không phải nội dung của
   * nó. Đặt nó vào `entry` là biến trang danh mục thành trang chi tiết — kéo theo
   * `<title>` lấy từ bài, JSON-LD `Article`, và một bộ đếm lượt xem.
   */
  if (tpl.collection.param === 'relation') {
    const target = await relationEntryBySlug(tpl.collection, tpl.paramValue, locale);
    if (!target) return null;
    return { page: tpl.page, entry: null, ...bases, urlRelationId: target.id, relationEntry: target, typeKey };
  }

  const entry = await loadDetailEntry(typeKey, tpl.paramValue, locale);
  // Entry không có / còn nháp / hẹn giờ chưa tới → 404. KHÔNG render mẫu rỗng.
  if (!entry) return null;

  return { page: tpl.page, entry, ...bases, typeKey };
}

export async function generateMetadata({ params }: { params: Promise<Params> }) {
  const { locale, slug } = await resolve(await params);
  const target = await resolveTarget(slug, locale.isDefault ? undefined : locale.code);
  // Trang hệ thống mở thẳng bằng URL thì trang này trả 404 (xem `SitePage`): không phát
  // canonical hay og:url trỏ vào một địa chỉ không tồn tại.
  if (!target || target.page.system) return {};

  const { page, entry } = target;

  // hreflang cho MỌI ngôn ngữ đang bật, kể cả chính nó. Bỏ bản thân ra là lỗi
  // thường gặp nhất khi làm hreflang, và Google coi cả nhóm là không hợp lệ.
  const locales = await getLocales();

  /*
   * Trang CHI TIẾT phải dựng lại hreflang theo từng ngôn ngữ, không dùng `slug` đang
   * xem cho tất cả. Hai lý do, và cả hai đều là lỗi SEO thật:
   *
   *  1. **URL khác nhau.** Từ khi có `EntryLocale.slug`, bản tiếng Anh có thể nằm ở
   *     `/en/tin-tuc/august-interest-rates`. Khai `hreflang="en"` trỏ tới
   *     `/en/tin-tuc/lai-suat-thang-8` là trỏ tới một URL 404 — và một cụm hreflang
   *     có mắt chết thì Google bỏ cả cụm.
   *  2. **Ngôn ngữ chưa đăng thì KHÔNG có trang.** Publish theo từng ngôn ngữ nghĩa
   *     là `/en/...` của một bài chưa duyệt bản tiếng Anh trả 404. Liệt nó vào
   *     hreflang là tự khai một bản dịch không tồn tại.
   *
   * Trang danh sách và trang thường giữ nguyên đường cũ: slug của chúng thuộc bảng
   * `Page`, không thuộc `EntryLocale`, nên không có gì để dựng lại.
   */
  let languages: Record<string, string>;
  if (entry && target.detailBase) {
    const state = await entryLocaleState(entry.id);
    const base = target.detailBase.replace(/^\//, '');
    const now = new Date();
    languages = Object.fromEntries(
      locales
        .filter((l) =>
          state ? isLocalePublished(state.base, state.rows, l.isDefault ? undefined : l.code, now) : l.isDefault,
        )
        .map((l) => {
          const own = state
            ? localeSlug(state.base, state.rows, l.isDefault ? undefined : l.code)
            : entry.slug;
          return [l.code, localePath(l, `${base}/${own}`)];
        }),
    );
  } else {
    languages = Object.fromEntries(locales.map((l) => [l.code, localePath(l, slug)]));
  }

  // Trang thường: đọc thẳng từ cột Page, KHÔNG duyệt cây node — metadata không được
  // phụ thuộc vào việc doc lớn cỡ nào.
  let title = page.title;
  let description = page.description ?? undefined;

  /*
   * Metadata theo NGÔN NGỮ, phủ lên hai giá trị vừa đọc.
   *
   * Trước 11/09/2026 hai dòng trên là tất cả, nên `/en/trang-chu` có `<title>`
   * tiếng Việt. Đó tệ hơn một tấm ảnh sai ngôn ngữ: ảnh thì người đọc bỏ qua, còn
   * `<title>` là dòng đầu trong kết quả Google.
   *
   * Đọc từ ẢNH CHỤP của release (`page.translations`), cùng nguồn với bản dịch nội
   * dung — nên metadata lùi được cùng release. Xem `page-meta.ts` cho lý do nó nằm
   * trong bảng `Translation` với địa chỉ `$meta` thay vì một cột mới.
   *
   * Chưa dịch thì GIỮ bản gốc, không để trống: một `<title>` rỗng là thứ Google
   * hiển thị, và nó tệ hơn một tiêu đề sai ngôn ngữ.
   */
  if (!locale.isDefault) {
    const meta = pageMetaFrom(entriesFromSnapshot(page.translations, locale.code));
    if (meta.title) title = meta.title;
    if (meta.description) description = meta.description;
  }

  /*
   * SEO của BÀI (trang chi tiết) hoặc của BẢN GHI ĐÍCH (trang danh mục `param:'relation'`).
   *
   * Trang chi tiết dùng MỘT template cho mọi bài, nên `Page.title` là tiêu đề của
   * template ("Chi tiết tin tức") — dùng nó là mọi bài có cùng một `<title>`. Nên bài
   * đi qua `entrySeo`: field `seo` trước, luật suy ra sau.
   *
   * Trang danh mục chỉ lấy GIÁ TRỊ GHI ĐÈ (`derive: false`): suy ra từ tên danh mục là
   * đổi `<title>` của mọi trang danh mục đang chạy, kể cả loại chưa ai điền SEO.
   *
   * `entry.data` ở `/en` đã phủ bản dịch (`getEntryBySlug(…, locale)` → `toRow`), và
   * field `seo` trong đó đã qua `localizeSeo` — canonical của bản tiếng Việt không
   * sang được trang tiếng Anh.
   */
  let seo: EntrySeo | null = null;
  if (entry && target.typeKey) {
    const shape = await typeShape(target.typeKey);
    seo = shape ? entrySeo(shape, entry.data) : null;
  } else if (target.relationEntry) {
    const shape = await typeShape(target.relationEntry.typeKey);
    seo = shape ? resolveEntrySeo(shape, target.relationEntry.data, { derive: false }) : null;
  }

  const meta = applySeoToMeta(
    {
      title,
      description,
      canonical: entry
        ? // `canonical` của cột Page thuộc về TEMPLATE, không thuộc về bài — dùng nó là
          // trỏ mọi bài về cùng một URL, tức bảo Google bỏ hết trừ một bài.
          localePath(locale, slug)
        : (page.canonical ?? localePath(locale, slug)),
      robots: page.noindex ? { index: false, follow: false } : undefined,
    },
    seo,
  );

  /** `assetId` của ảnh chia sẻ, theo thứ tự ưu tiên. Lấy cái ĐẦU tra được. */
  const imageCandidates: string[] = [];
  if (meta.imageAssetId) imageCandidates.push(meta.imageAssetId);

  /*
   * Ảnh của TRANG, rồi ảnh mặc định của SITE.
   *
   * `page.ogImageId` là chỗ sửa được cột đã có từ đầu mà chưa bao giờ được ĐỌC —
   * nên mọi trang không phải bài viết đều chia sẻ ra một thẻ không ảnh. Ảnh mặc
   * định của site là hàng rào cuối: trang nào chưa ai đặt ảnh riêng vẫn ra một thẻ
   * có ảnh, thay vì một thẻ trắng không ai bấm.
   */
  const share = await getSiteShare();
  if (page.ogImageId) imageCandidates.push(page.ogImageId);
  if (share.ogImageId) imageCandidates.push(share.ogImageId);

  /*
   * MỘT lượt đọc cho cả ba ứng viên, rồi mới chọn.
   *
   * Đọc lần lượt tới khi có kết quả là tối đa ba lượt cho một trang; đọc một lượt
   * rồi chọn trong bộ nhớ là một lượt, luôn luôn. Ảnh của BÀI không nằm trong ảnh
   * chụp release (nội dung không đi qua publish — xem docblock của `loadAssets`),
   * nên cả ba phải đi qua bảng live.
   */
  const assets = imageCandidates.length ? await loadAssets(imageCandidates) : {};
  const pickedId = imageCandidates.find((id) => assets[id]?.url);
  const picked = pickedId ? assets[pickedId] : undefined;

  const canonical = meta.canonical ?? localePath(locale, slug);

  const { openGraph, twitter } = shareMeta({
    title: meta.title,
    description: meta.description,
    /*
     * `og:url` dùng CANONICAL, không dùng URL đang mở.
     *
     * Facebook gộp lượt thích và lượt chia sẻ theo thẻ này. Khai URL đang mở nghĩa
     * là một link mang `?fbclid=…` hay `?utm_source=…` thành một bản ghi riêng —
     * số chia sẻ bị chia nhỏ theo từng chiến dịch quảng cáo, và không có gì báo.
     */
    path: canonical,
    siteName: share.name ?? undefined,
    locale: { code: locale.code, isDefault: locale.isDefault },
    otherLocaleCodes: locales.filter((l) => l.code !== locale.code).map((l) => l.code),
    image: picked
      ? {
          url: picked.url,
          width: picked.width,
          height: picked.height,
          mime: picked.mime,
          /*
           * `og:image:alt` lấy alt của ảnh OG đã khai ở field `seo`, nếu ảnh được chọn
           * đúng là ảnh đó; còn lại lấy TIÊU ĐỀ trang.
           *
           * Ảnh chụp release không giữ `Asset.alt` (xem `AssetSeal`), và đọc bảng
           * live chỉ để lấy một chuỗi alt là một lượt đọc nữa cho mỗi lượt xem
           * trang. Tiêu đề trang là xấp xỉ đủ tốt — và nó luôn có.
           */
          alt: ogImageAlt(pickedId!, seo, meta.title),
        }
      : undefined,
    kind: entry ? 'article' : 'website',
    publishedAt: entry?.publishedAt,
    updatedAt: entry?.updatedAt,
  });

  return {
    title: meta.titleMeta,
    description: meta.description,
    ...(meta.keywords ? { keywords: meta.keywords } : {}),
    alternates: { canonical, languages },
    robots: meta.robots,
    openGraph,
    twitter,
  };
}

export default async function SitePage({ params }: { params: Promise<Params> }) {
  const { locale, slug } = await resolve(await params);
  const localeCode = locale.isDefault ? undefined : locale.code;

  const target = await resolveTarget(slug, localeCode);
  if (!target) {
    /*
     * Chỉ tra redirect SAU KHI không tìm thấy trang đã publish. Thứ tự đó là cả
     * hợp đồng: chừng nào `ReleaseEntry` còn mang slug cũ thì slug cũ vẫn render
     * trang thật và redirect nằm im — đổi slug ở bản nháp không chạm site. Lùi
     * release cũng tự đúng: slug cũ sống lại, redirect lại nằm im.
     *
     * 301 chứ không 302: đây là một địa chỉ đã dời hẳn, và chỉ 301 mới chuyển được
     * giá trị link sang địa chỉ mới.
     */
    const moved = await resolveRedirect(slug);
    if (moved !== null) permanentRedirect(localePath(locale, moved));
    notFound();
  }

  /*
   * Trang HỆ THỐNG (404) không mở thẳng bằng URL của nó. Mở `/404` mà ra trang 404
   * với status 200 là một trang lỗi Google sẽ index như một trang thật. `notFound()`
   * dựng chính trang đó — qua `not-found.tsx` — với status 404.
   */
  if (target.page.system) notFound();

  return <PublishedPageView target={target} locale={locale} />;
}
