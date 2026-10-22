import type { MetadataRoute } from 'next';
import type { Prisma } from '@prisma/client';
import { unstable_cache } from 'next/cache';

import { prisma } from '@/lib/db';
import { collectionTag } from '@/lib/collections/cache';
import { buildEntryFindArgs } from '@/lib/collections/query-build';
import type { PageCollection } from '@/lib/builder/page-collection';
import {
  parsePageCollection,
  relationTargetType,
  templateBase,
} from '@/lib/render/collection-page';
import { isTemplateSlug } from '@/lib/builder/slug';
import { getPublishedSlugs } from '@/lib/render/page';
import { isNoindexSite } from '@/lib/site-mode';

import { siteOrigin } from '@/lib/site/origin';
import { getSiteCrawlSettings } from '@/lib/site/settings';
import { applySitemapRules } from '@/lib/site/sitemap-rules';
import { getCollectionTypes } from '@/lib/collections/queries';
import { asSeo, seoKeyOf } from '@/lib/collections/seo';
import { getLocales } from '@/lib/i18n/queries';
import { sitemapEntryUrls } from '@/lib/render/sitemap-entries';

/**
 * Nội dung sitemap nằm trong DB, nên nó KHÔNG được prerender lúc build.
 *
 * Không có dòng này thì `docker build` thất bại thật: Next cố export
 * /sitemap.xml thành file tĩnh và Prisma không kết nối được — trong container
 * build làm gì có Postgres. Đây là ràng buộc chung của cả dự án: **build không
 * bao giờ được phụ thuộc vào một DB đang sống**, vì image phải build được trên
 * CI và trên máy bất kỳ.
 *
 * Mất prerender không tốn gì: `getPublishedSlugs` đã bọc `unstable_cache` với
 * tag 'release', nên sau request đầu tiên nó phục vụ từ cache tới lần publish kế.
 */
export const dynamic = 'force-dynamic';

/**
 * Slug của mọi entry đã ĐĂNG và đã tới mốc, cho một loại nội dung.
 *
 * Tag `collection:<typeKey>` chứ không phải chỉ `revalidate`: không có tag thì
 * sitemap phục vụ danh sách cũ tới một giờ sau khi đăng bài — tức bài mới không có
 * trong sitemap đúng lúc nó đáng được crawl nhất.
 *
 * `new Date()` nằm trong thân hàm được cache, nên một bài hẹn giờ có thể vào sitemap
 * muộn tối đa bằng `revalidate`. Chấp nhận: sitemap là một gợi ý cho crawler, không
 * phải đường vào trang — bài vẫn mở được bằng URL ngay khi tới mốc.
 */
const entriesOfType = (typeKey: string, seoKey: string | null) =>
  unstable_cache(
    async () => {
      const now = new Date();
      const live = { status: 'published', publishedAt: { not: null, lte: now } };
      const rows = await prisma.entry.findMany({
        where: {
          typeKey,
          archivedAt: null,
          // Bản gốc live HOẶC một bản dịch live: bản tiếng Anh live được khi bản gốc còn
          // nháp (`EntryLocale` độc lập với `status` của bản gốc). Từng ngôn ngữ được
          // lọc lại bằng `isLocalePublished` trong `sitemapEntryUrls`.
          OR: [live, { locales: { some: live } }],
        },
        select: {
          id: true, slug: true, status: true, publishedAt: true, updatedAt: true,
          locales: { select: { locale: true, slug: true, status: true, publishedAt: true } },
        },
        // Trần cứng: sitemap.xml có giới hạn 50.000 URL, và một file 4.000 dòng đã là
        // thứ không ai mở ra đọc. Vượt trần thì việc đúng là chia file theo index —
        // không phải bỏ trần ở đây.
        take: 5000,
        orderBy: { publishedAt: 'desc' },
      });
      const seo = await seoOfEntries(rows.map((r) => r.id), seoKey);
      return rows.map((r) => ({ ...r, seo: seo.get(r.id)?.seo, seoI18n: seo.get(r.id)?.seoI18n ?? {} }));
    },
    ['sitemap-entries', typeKey, seoKey ?? ''],
    { tags: [collectionTag(typeKey)], revalidate: 3600 },
  )();

/**
 * Field `seo` của từng bài — CHỈ phần đó, không kéo nguyên `data`/`i18n` của 5.000 bài.
 *
 * Đọc bằng biểu thức JSONB chứ không bằng một điều kiện `where` của Prisma: `NOT
 * { data: { path: [k,'noindex'], equals: true } }` cho ra `NULL` ở mọi bài KHÔNG có khoá
 * đó, và `NOT NULL` loại luôn bài — mọi bài cũ biến khỏi sitemap, không lỗi nào. Đọc ra
 * rồi quyết định bằng `sitemapEntryUrls` thì bài thiếu khoá đơn giản là "không noindex".
 */
async function seoOfEntries(
  ids: string[],
  seoKey: string | null,
): Promise<Map<string, { seo: unknown; seoI18n: Record<string, unknown> }>> {
  if (!seoKey || !ids.length) return new Map();
  const rows = await prisma.$queryRaw<{ id: string; seo: unknown; seo_i18n: unknown }[]>`
    SELECT id,
      data -> ${seoKey} AS seo,
      CASE WHEN jsonb_typeof(i18n) = 'object' THEN (
        SELECT jsonb_object_agg(e.key, e.value -> ${seoKey})
        FROM jsonb_each(i18n) AS e
        WHERE jsonb_typeof(e.value) = 'object' AND e.value ? ${seoKey}
      ) END AS seo_i18n
    FROM "Entry"
    WHERE id = ANY(${ids})`;
  return new Map(
    rows.map((r) => [
      r.id,
      {
        seo: r.seo ?? undefined,
        seoI18n: (typeof r.seo_i18n === 'object' && r.seo_i18n !== null ? r.seo_i18n : {}) as Record<string, unknown>,
      },
    ]),
  );
}

/**
 * `unstable_cache` trả `Date` thành CHUỖI ở mọi lần cache HIT (xem `queries.ts`,
 * "Hồi sinh Date"). `isLocalePublished` gọi `.getTime()`, nên phải hồi sinh trước khi
 * quyết định — không thì sitemap ném ở lượt thứ hai và rơi về `[]`.
 */
function reviveDate(v: Date | string | null): Date | null {
  return v === null ? null : new Date(v);
}

/**
 * Danh mục CÓ ÍT NHẤT MỘT bài đã đăng, cho một loại nội dung.
 *
 * Điều kiện "có bài" không phải chi tiết vặt: một danh mục rỗng render ra một trang
 * danh sách không có dòng nào, và phát nó vào sitemap là mời Google index một trang
 * trống — thứ nó tính vào chất lượng của cả tên miền.
 */
const taxonomiesOfType = (typeKey: string) =>
  unstable_cache(
    async () =>
      prisma.taxonomy.findMany({
        where: {
          typeKey,
          entries: {
            some: {
              entry: {
                status: 'published',
                archivedAt: null,
                publishedAt: { not: null, lte: new Date() },
              },
            },
          },
        },
        select: { key: true },
        orderBy: [{ order: 'asc' }, { name: 'asc' }],
        take: 1000,
      }),
    ['sitemap-taxonomies', typeKey],
    { tags: [collectionTag(typeKey)], revalidate: 3600 },
  )();

/**
 * Bản ghi ĐÃ ĐĂNG của loại đích, cho mẫu `param:'relation'` — kèm `id`.
 *
 * Tách khỏi `entriesOfType` ngay trên chứ không nới `select` của nó: `id` chỉ cần cho
 * phép kiểm "danh mục này có bài nào không" dưới đây, và kéo nó vào truy vấn dùng cho
 * 5.000 bài viết là trả giá đó ở mọi lần sinh sitemap.
 *
 * Trần 200 chứ không 5.000: mỗi hàng ở đây tốn thêm MỘT lượt kiểm rỗng (xem
 * `hasPublishedEntry`), nên trần là thứ giữ chi phí sitemap tuyến tính và biết trước.
 * Một site có hơn 200 danh mục thì việc đúng là chia sitemap theo index, không phải
 * bỏ trần ở đây.
 */
const relationTargetsOfType = (typeKey: string) =>
  unstable_cache(
    async () =>
      prisma.entry.findMany({
        where: {
          typeKey,
          status: 'published',
          archivedAt: null,
          publishedAt: { not: null, lte: new Date() },
        },
        select: { id: true, slug: true, updatedAt: true },
        take: 200,
        orderBy: { publishedAt: 'desc' },
      }),
    ['sitemap-relation-targets', typeKey],
    { tags: [collectionTag(typeKey)], revalidate: 3600 },
  )();

/**
 * Loại `listingTypeKey` có bài nào ĐÃ ĐĂNG trỏ tới bản ghi này qua `field` không.
 *
 * Cùng luật với điều kiện "có bài" của `taxonomiesOfType`, và cùng lý do — chỉ khác
 * chỗ trú của mối quan hệ (một field JSONB thay vì bảng nối.)
 *
 * `where` dựng bằng `buildEntryFindArgs` chứ không viết tay: hình dạng của một điều
 * kiện `relation` là `OR` của `equals` và `array_contains` (field `one` lưu chuỗi,
 * `many` lưu mảng — xem `filterToWhere`), và một bản chép tay ở đây sẽ lệch với thứ
 * trang thật lọc. Lệch theo hướng nguy hiểm nhất: sitemap phát ra đúng những URL mà
 * trang trả về rỗng.
 */
async function hasPublishedEntry(
  listingTypeKey: string,
  field: string,
  targetId: string,
): Promise<boolean> {
  const { where } = buildEntryFindArgs(
    { typeKey: listingTypeKey, filter: [{ k: 'relation', field, from: 'url' }], limit: 1 },
    { now: new Date(), urlRelationId: targetId },
  );
  const hit = await prisma.entry.findFirst({
    where: where as Prisma.EntryWhereInput,
    select: { id: true },
  });
  return hit !== null;
}

/**
 * Chỉ liệt kê trang đã publish trong release đang active, và loại trang noindex.
 * Draft không bao giờ xuất hiện ở đây — nó chỉ tồn tại sau token preview.
 *
 * Trang có `collection.mode === 'detail'` là một TEMPLATE, không phải một URL: bản
 * thân `/tin-tuc/:slug` không mở được. Nó bị thay bằng một URL cho mỗi bài đã đăng.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  /*
   * Bản staging không phát sitemap.
   *
   * `robots.ts` đã không khai đường dẫn này khi `SITE_NOINDEX=true`, nhưng
   * `/sitemap.xml` vẫn mở cho bất kỳ ai gõ thẳng — và một sitemap đầy đủ là bản
   * đồ mọi URL của bản nháp, kể cả trang chi tiết của từng bài viết. Rỗng ở đây
   * là lớp chặn thứ hai, và nó tốn đúng một dòng.
   */
  if (isNoindexSite()) return [];

  const BASE = await siteOrigin();

  try {
    const slugs = await getPublishedSlugs();
    if (!slugs.length) return [];

    const pages = await prisma.page.findMany({
      where: { slug: { in: slugs }, noindex: false, archivedAt: null },
      select: { slug: true, updatedAt: true, collection: true },
    });

    const plain: MetadataRoute.Sitemap = [];
    const entryTemplates: { base: string; typeKey: string }[] = [];
    const taxTemplates: { base: string; typeKey: string }[] = [];
    // Vai `relation` giữ cả lời khai: loại đích suy ra từ `field`, và `field` còn cần
    // lần nữa cho phép kiểm rỗng.
    const relTemplates: { base: string; collection: PageCollection }[] = [];

    for (const p of pages) {
      const col = parsePageCollection(p.collection);
      /*
       * Một trang MẪU không bao giờ vào sitemap dưới dạng chính nó: chuỗi
       * `/blogs/[category]` không mở được, và phát nó ra là mời Google index một
       * trang chưa bind dữ liệu.
       *
       * Kiểm bằng `isTemplateSlug` chứ không bằng `col.param`: một trang có `[` mà
       * QUÊN khai `collection` cũng phải bị loại — đó chính là ca dữ liệu sai mà
       * sitemap không được khuếch đại.
       */
      if (isTemplateSlug(p.slug)) {
        const base = templateBase(p.slug).replace(/^\//, '');
        if (col?.param === 'entry') entryTemplates.push({ base, typeKey: col.typeKey });
        else if (col?.param === 'taxonomy') taxTemplates.push({ base, typeKey: col.typeKey });
        else if (col?.param === 'relation') relTemplates.push({ base, collection: col });
        continue;
      }
      plain.push({
        url: p.slug ? `${BASE}/${p.slug}` : BASE,
        lastModified: p.updatedAt,
        changeFrequency: 'weekly' as const,
        priority: p.slug === '' ? 1 : 0.7,
      });
    }

    // Song song: mỗi loại là một lượt đọc độc lập, và số lượt đọc không đổi vì chồng
    // chúng lên nhau.
    const [types, locales] = await Promise.all([getCollectionTypes(), getLocales()]);
    const seoKeyOfType = (typeKey: string) => {
      const t = types.find((x) => x.key === typeKey);
      return t ? seoKeyOf(t.schema) : null;
    };
    const now = new Date();

    // Mỗi bài một URL cho MỖI ngôn ngữ đang live, trừ bản noindex hay có canonical trỏ
    // chỗ khác — xem `sitemapEntryUrls`.
    const perType = await Promise.all(
      entryTemplates.map(async (t) => {
        const rows = await entriesOfType(t.typeKey, seoKeyOfType(t.typeKey));
        return rows.flatMap((e) =>
          sitemapEntryUrls(
            {
              ...e,
              publishedAt: reviveDate(e.publishedAt),
              updatedAt: reviveDate(e.updatedAt) ?? now,
              locales: e.locales.map((l) => ({ ...l, publishedAt: reviveDate(l.publishedAt) })),
            },
            locales,
            t.base,
            now,
          ).map((u) => ({
            url: `${BASE}${u.path}`,
            lastModified: u.lastModified,
            changeFrequency: 'weekly' as const,
            priority: 0.6,
          })),
        );
      }),
    );

    const perTaxonomy = await Promise.all(
      taxTemplates.map(async (t) => {
        const rows = await taxonomiesOfType(t.typeKey);
        return rows.map((tx) => ({
          url: `${BASE}/${t.base}/${tx.key}`,
          lastModified: new Date(),
          changeFrequency: 'weekly' as const,
          priority: 0.5,
        }));
      }),
    );

    /*
     * Trang danh mục kiểu MỚI: một URL cho mỗi bản ghi đích có ít nhất một bài.
     *
     * `priority` bằng vai `taxonomy` — với người đọc thì hai vai này là cùng một loại
     * trang, chỉ khác chỗ lưu danh mục.
     */
    const perRelation = await Promise.all(
      relTemplates.map(async (t) => {
        const targetType = await relationTargetType(t.collection);
        const field = t.collection.field;
        // Lời khai không phân giải được (field đã đổi kiểu, loại đã xoá) thì mẫu này
        // không có URL nào — y như `findTemplateForSlug` sẽ không phân giải được nó.
        if (!targetType || !field) return [];

        const rows = await relationTargetsOfType(targetType);
        // Danh mục tự xin ẩn (field `seo` của bản ghi đích) thì không vào sitemap —
        // trang danh mục đọc cùng cờ đó cho thẻ robots (`generateMetadata`).
        const targetSeo = await seoOfEntries(rows.map((r) => r.id), seoKeyOfType(targetType));
        const keep = await Promise.all(
          rows.map((r) =>
            asSeo(targetSeo.get(r.id)?.seo).noindex
              ? false
              : hasPublishedEntry(t.collection.typeKey, field, r.id),
          ),
        );
        return rows
          .filter((_, i) => keep[i])
          .map((r) => ({
            url: `${BASE}/${t.base}/${r.slug}`,
            lastModified: r.updatedAt,
            changeFrequency: 'weekly' as const,
            priority: 0.5,
          }));
      }),
    );

    /*
     * Luật người dùng đặt ở Cài đặt › SEO & thu thập (`Site.sitemapRules`): loại theo
     * tiền tố, thêm URL ngoài builder. Áp CUỐI CÙNG, lên danh sách đã đầy đủ — loại
     * `/tin-tuc` phải loại cả bài viết bên dưới nó, không chỉ trang danh sách.
     */
    const { sitemapRules } = await getSiteCrawlSettings();
    return applySitemapRules(
      [...plain, ...perType.flat(), ...perTaxonomy.flat(), ...perRelation.flat()],
      sitemapRules,
      BASE,
      locales.filter((l) => !l.isDefault).map((l) => l.code),
    );
  } catch (err) {
    // Sitemap rỗng còn hơn 500: đây là tín hiệu SEO, không phải nội dung.
    console.error('[sitemap] không đọc được danh sách trang:', err);
    return [];
  }
}
