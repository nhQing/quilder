import 'server-only';

/**
 * Đường đọc collection.
 *
 * ## Cache: chỉ hai trong năm hàm được bọc
 *
 * Prisma không phải `fetch`, nên Next không tự cache. Luật "bọc `unstable_cache`
 * với tag", đúng như `getPublishedPage`, áp cho hàm có KHOÁ CACHE ỔN ĐỊNH —
 * `getEntryBySlug` (khoá: typeKey + slug + locale) và `getCollectionTypes` (không
 * tham số).
 *
 * `listEntries`, `relatedEntries`, `taxonomyGroups` CHƯA bọc, có chủ đích, vì hai
 * lý do cộng lại:
 *
 *  1. Tham số của chúng biến thiên theo từng lượt gọi (`CollectionQuery` tuỳ ý,
 *     `entryId`, `limit`) — không có một khoá cache hữu hạn để đặt tên.
 *  2. Cả ba đều lọc theo `publishedAt <= now`, và bọc chúng buộc phải quyết `now`
 *     nằm đâu — cả hai lựa chọn đều tệ: `now` trong khoá cache thì mỗi lượt gọi
 *     một khoá khác nhau, cache vô dụng; `now` trong thân hàm thì lặp lại đúng
 *     hạn chế hẹn giờ đã ghi ở `getEntryBySlug`, nhưng lan ra ba hàm nữa thay vì
 *     một.
 *
 * Giá đang trả, nói thẳng: route site là `force-dynamic`, nên mỗi lượt xem trang
 * là một lượt truy vấn thật cho mỗi khối lặp collection.
 *
 * **Quyết định của mốc 3 (24/08/2026):** ba hàm đó VẪN không bọc cache. Chuyện `now`
 * chỉ đáng giải cho hàm CÓ cache, và mốc 3 đã giải nó ở đúng chỗ có cache —
 * `getEntryBySlug`, xem `nextScheduledAt` bên dưới. Bọc thêm ba hàm kia là đổi một
 * truy vấn có trần lấy một khoá cache sinh ra từ tham số tuỳ ý (`CollectionQuery` là
 * một object lồng), tức một cache không bao giờ trúng nhưng vẫn tốn chỗ.
 */

import { unstable_cache } from 'next/cache';
import type { Prisma } from '@prisma/client';

import { prisma } from '@/lib/db';
import type { CollectionQuery } from '@/lib/doc/types';
import { collectionTag, entryTag, TYPES_TAG } from './cache';
import { nextRevalidateSeconds } from './schedule';
import type { FieldDef } from './field-def';
import { validateCollectionSchema } from './field-def';
import { applyEntryLocale } from './i18n';
import { seoKeyOf } from './seo';
import {
  buildEntryFindArgs, localizedSlugWheres, MAX_QUERY_LIMIT, publishWhere, type QueryContext,
} from './query-build';
import { localeSlug, type EntryLocaleRow } from './entry-locale';
import { taxonomyName } from './taxonomy-locale';
import type { TaxonomyFilter, TaxonomySort } from '@/lib/doc/types';
import { loadGroupTable } from './group-table';

export interface EntryRow {
  id: string;
  slug: string;
  typeKey: string;
  data: Record<string, unknown>;
  publishedAt: Date | null;
  updatedAt: Date;
  taxonomyIds: string[];
  /**
   * Danh mục KÈM TÊN, đã sắp theo `order` rồi tên.
   *
   * `taxonomyIds` ở trên vẫn còn vì nó phục vụ chuyện khác hẳn — lọc "tin liên
   * quan" — và ở đó chỉ cần id. Cái này phục vụ HIỂN THỊ: huy hiệu danh mục trên
   * thẻ tin, thứ mà `map: { taxonomy: … }` đọc tới. Đọc tên qua một lượt truy vấn
   * thứ hai từ id là N+1 với N là số bài trên trang.
   */
  taxonomies: { id: string; key: string; name: string }[];
  /**
   * TÁC GIẢ — `Entry.createdBy`, không phải `updatedBy`.
   *
   * Chốt 11/09/2026: lấy `updatedBy` thì một lần sửa chính tả của biên tập viên
   * đổi tên tác giả bài báo.
   *
   * `name` có thể rỗng (tài khoản chưa đặt tên) — chỗ đọc quyết định rơi về đâu.
   * `locked` đi kèm vì tài khoản đã khoá VẪN hiện trong byline: giữ lịch sử là
   * mục đích của việc khoá thay vì xoá.
   */
  author: { email: string; name: string | null; avatarAssetId: string | null; locked: boolean };
}

const SELECT = {
  id: true, slug: true, typeKey: true, data: true, i18n: true,
  status: true, publishedAt: true, updatedAt: true,
  /*
   * Lấy cả `key`/`name`/`order` chứ không chỉ `taxonomyId`.
   *
   * Đây là một join đã có sẵn — bảng nối vẫn phải đọc để có `taxonomyIds` — nên ba
   * cột nữa của một bảng vài chục hàng không thêm một lượt đọc nào. Không lấy thì
   * huy hiệu danh mục phải đọc lần hai, mỗi bài một lần.
   */
  taxonomies: { select: { taxonomyId: true, taxonomy: { select: { key: true, name: true, order: true, i18n: true } } } },
  /*
   * Tác giả, join qua khoá ngoại `createdBy → User.email`.
   *
   * Một join nữa trên cùng một truy vấn, không phải một lượt đọc nữa: không có
   * nó thì byline phải tra `User` một lần cho mỗi bài trên trang — N+1 với N là
   * số thẻ. Bốn cột của một bảng vài chục hàng.
   */
  author: { select: { email: true, name: true, avatarAssetId: true, lockedAt: true } },
  /*
   * Nạp CẢ ngôn ngữ, không lọc theo ngôn ngữ đang phục vụ.
   *
   * Số hàng tối đa bằng số ngôn ngữ đang bật — một con số nhỏ và có trần thật (bảng
   * `Locale`), không phải một quan hệ mở. Đổi lại, `toRow` tính được slug hiệu lực mà
   * không cần một lượt đọc thứ hai, và cùng một `SELECT` dùng được cho mọi hàm đọc.
   */
  locales: { select: { locale: true, slug: true, status: true, publishedAt: true } },
} as const;

type RawEntry = {
  id: string; slug: string; typeKey: string;
  data: unknown; i18n: unknown;
  status: string; publishedAt: Date | null; updatedAt: Date;
  /** `i18n` tuỳ chọn: màn quản trị (`admin-queries.ts`) không chọn nó và luôn hiện tên gốc. */
  taxonomies: { taxonomyId: string; taxonomy: { key: string; name: string; order: number; i18n?: unknown } }[];
  author: { email: string; name: string | null; avatarAssetId: string | null; lockedAt: Date | null };
  locales: EntryLocaleRow[];
};

/**
 * Danh mục của một entry, theo thứ tự XÁC ĐỊNH.
 *
 * Sắp ở JS chứ không ở `orderBy` lồng của Prisma: đây là một quan hệ vài hàng đã
 * nằm sẵn trong bộ nhớ, còn thứ tự thì PHẢI có — khoá ảo `taxonomy` lấy phần tử
 * đầu làm huy hiệu trên thẻ, nên thứ tự do Postgres quyết định nghĩa là huy hiệu
 * đổi chữ giữa hai lần tải trang mà không ai tái hiện được.
 *
 * `order` rồi `name`: cùng một luật với mọi chỗ khác đang liệt kê danh mục
 * (`previewBinding`, `taxonomyGroups`), nên thứ tự người dựng kéo trong trang
 * quản trị là thứ tự hiện ra trên site.
 *
 * `locale` đổi TÊN sang bản dịch (huy hiệu trên thẻ ở `/en`), không đổi `key`.
 */
export function sortedTaxonomies(rows: RawEntry['taxonomies'], locale?: string) {
  return rows
    .map((t) => ({
      id: t.taxonomyId, key: t.taxonomy.key, name: taxonomyName(t.taxonomy, locale), order: t.taxonomy.order,
    }))
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'vi'))
    .map(({ id, key, name }) => ({ id, key, name }));
}

/** Loại → khoá field `seo` của nó. Rỗng khi không phủ ngôn ngữ — xem `seoKeysFor`. */
type SeoKeys = ReadonlyMap<string, string>;
const NO_SEO_KEYS: SeoKeys = new Map();

/**
 * Khoá field `seo` của mọi loại, cho `applyEntryLocale`.
 *
 * Chỉ đọc khi có `locale`: ngôn ngữ mặc định không phủ gì, nên đường nóng nhất (site
 * tiếng Việt) không trả thêm lượt nào. `getCollectionTypes` đã cache dưới `TYPES_TAG`.
 */
async function seoKeysFor(locale: string | undefined): Promise<SeoKeys> {
  if (!locale) return NO_SEO_KEYS;
  const types = await getCollectionTypes();
  const out = new Map<string, string>();
  for (const t of types) {
    const k = seoKeyOf(t.schema);
    if (k) out.set(t.key, k);
  }
  return out;
}

function toRow(e: RawEntry, locale: string | undefined, seoKeys: SeoKeys): EntryRow {
  const data = (e.data ?? {}) as Record<string, unknown>;
  const taxonomies = sortedTaxonomies(e.taxonomies, locale);
  return {
    id: e.id,
    /*
     * Slug HIỆU LỰC của ngôn ngữ đang phục vụ, không phải slug gốc.
     *
     * Trường này là thứ trang danh sách dựng `href` từ đó. Trả slug gốc ở đây nghĩa
     * là thẻ tin trên `/en/tin-tuc` trỏ tới URL tiếng Việt, và người đọc bị đẩy ra
     * khỏi ngôn ngữ họ đang xem ngay lần bấm đầu tiên.
     */
    slug: localeSlug({ slug: e.slug, status: e.status, publishedAt: e.publishedAt }, e.locales, locale),
    typeKey: e.typeKey,
    data: locale ? applyEntryLocale(data, e.i18n, locale, seoKeys.get(e.typeKey) ?? null) : data,
    publishedAt: e.publishedAt,
    updatedAt: e.updatedAt,
    // Cùng MỘT thứ tự với `taxonomies` — hai danh sách của cùng một quan hệ mà
    // lệch thứ tự là thứ không ai nghĩ tới cho tới lúc phải đối chiếu chúng.
    taxonomyIds: taxonomies.map((t) => t.id),
    taxonomies,
    author: {
      email: e.author.email,
      name: e.author.name,
      avatarAssetId: e.author.avatarAssetId,
      locked: e.author.lockedAt !== null,
    },
  };
}

/* ── Hồi sinh Date qua biên `unstable_cache` ──────────────────────────────
 *
 * `unstable_cache` SERIALIZE giá trị trả về qua JSON. Nên một `Date` đi vào là
 * `Date`, nhưng đi ra là **chuỗi ISO** ở mọi lần cache HIT — trong khi kiểu khai
 * báo vẫn nói `Date`, và TypeScript vẫn xanh.
 *
 * Hệ quả thật, ngày 14/09/2026: `/blogs/post/<slug>` trả 500 trên stg với
 * `TypeError: a.publishedAt.toISOString is not a function`. `articleJsonLd` nhận
 * `publishedAt: Date | null` rồi gọi `.toISOString()`.
 *
 * Thứ làm nó khó truy nhất: **lỗi phụ thuộc TRẠNG THÁI CACHE, không phụ thuộc mã**.
 * Ngay sau deploy, cache trống → lần gọi đầu chạy hàm thật → `Date` thật → trang
 * 200. Từ lần thứ hai trở đi → cache hit → chuỗi → 500. Cùng một bản build, đo hai
 * lần cách nhau vài phút cho hai kết quả ngược nhau, và chúng tôi đã mất một vòng
 * điều tra vì tưởng là hồi quy của bản deploy.
 *
 * Không lớp kiểm nào của repo bắt được: `tsc` tin vào kiểu khai báo, còn test thì
 * gọi thẳng hàm bên trong chứ không đi qua `unstable_cache`.
 *
 * Vá ở ĐÂY, ngay tại biên, chứ không ở từng chỗ tiêu thụ: `EntryRow` có hai trường
 * ngày và có hàng chục chỗ đọc. Sửa từng chỗ gọi là để lại đúng cái bẫy này cho chỗ
 * thứ mười một. Sau khi hồi sinh, kiểu khai báo lại ĐÚNG với thực tế.
 */
function reviveDate(v: Date | string | null | undefined): Date | null {
  if (v == null) return null;
  return v instanceof Date ? v : new Date(v);
}

function reviveEntryRow<T extends EntryRow | null>(row: T): T {
  if (!row) return row;
  row.publishedAt = reviveDate(row.publishedAt);
  // `updatedAt` không nullable — giữ nguyên hợp đồng đó.
  row.updatedAt = reviveDate(row.updatedAt) ?? row.updatedAt;
  return row;
}

/** CHƯA bọc `unstable_cache` — xem "Cache" ở đầu file: khoá không ổn định, và `now`. */
export async function listEntries(
  query: CollectionQuery,
  ctx: QueryContext,
  locale?: string,
): Promise<EntryRow[]> {
  /*
   * `locale` đi vào `ctx` ở ĐÂY, không phải ở chỗ gọi.
   *
   * Hai tham số cùng nghĩa (`ctx.locale` và `locale`) mà chỗ gọi phải nhớ đặt cả hai
   * là một cái bẫy: quên `ctx.locale` thì danh sách lọc theo trạng thái đăng của BẢN
   * GỐC rồi phủ nội dung tiếng Anh lên — tức bài chưa duyệt bản dịch vẫn hiện.
   */
  const args = buildEntryFindArgs(query, { ...ctx, locale });
  const rows = await prisma.entry.findMany({
    where: args.where as Prisma.EntryWhereInput,
    orderBy: args.orderBy as Prisma.EntryOrderByWithRelationInput[],
    take: args.take,
    skip: args.skip,
    select: SELECT,
  });
  const seoKeys = await seoKeysFor(locale);
  return rows.map((r) => toRow(r as RawEntry, locale, seoKeys));
}

/**
 * Mốc hẹn giờ GẦN NHẤT trong tương lai của một loại nội dung, hoặc `null`.
 *
 * Một truy vấn nhỏ, có index (`[typeKey, status, publishedAt]`), và tự nó được cache
 * 60s — nên giá thật là một lượt đọc mỗi phút cho mỗi loại, không phải một lượt đọc
 * cho mỗi lượt xem trang. Đổi lại: bài hẹn giờ lên đúng giờ, sai số tối đa 60 giây.
 *
 * Vì sao không nhét truy vấn này vào trong `getEntryBySlug`: `revalidate` là THAM SỐ
 * của `unstable_cache`, nên nó phải biết TRƯỚC khi hàm được bọc. Tính bên trong thì
 * nó chỉ ảnh hưởng tới lần bọc sau — tức không ảnh hưởng gì.
 */
const nextScheduledAt = (typeKey: string) =>
  unstable_cache(
    async () => {
      const now = new Date();
      /*
       * HAI mốc, không phải một: bản gốc và bản dịch hẹn giờ độc lập với nhau.
       *
       * Chỉ xét `Entry` thì một bản tiếng Anh hẹn 9:00 mai không có mốc nào để
       * `revalidate` bám vào, nên nó chỉ xuất hiện khi có người tình cờ làm cache
       * miss — đúng cái bẫy mà docblock dưới đây mô tả, chỉ khác chỗ trú.
       */
      const [base, loc] = await Promise.all([
        prisma.entry.findFirst({
          where: { typeKey, status: 'published', archivedAt: null, publishedAt: { gt: now } },
          orderBy: { publishedAt: 'asc' },
          select: { publishedAt: true },
        }),
        prisma.entryLocale.findFirst({
          where: { typeKey, status: 'published', publishedAt: { gt: now }, entry: { archivedAt: null } },
          orderBy: { publishedAt: 'asc' },
          select: { publishedAt: true },
        }),
      ]);
      return [base?.publishedAt ?? null, loc?.publishedAt ?? null];
    },
    ['collection-next-scheduled', typeKey],
    { tags: [collectionTag(typeKey)], revalidate: 60 },
    // Cùng bẫy JSON của `unstable_cache` như `reviveEntryRow`, và ở đây nó KHÔNG
    // ném mà hỏng âm thầm: `nextRevalidateSeconds` gọi `at.getTime()`, nên một chuỗi
    // sẽ làm nó ném — hoặc, nếu chỗ gọi bắt lỗi, làm `revalidate` rơi về mặc định và
    // bài hẹn giờ lên trễ tới một giờ. Chưa nổ chỉ vì chưa có bài nào hẹn giờ.
  )().then((pair) => pair.map(reviveDate));

/**
 * Một entry theo slug, ở một ngôn ngữ KHÔNG phải ngôn ngữ mặc định.
 *
 * Hai bước, đúng thứ tự này, và thứ tự là phần chịu lực:
 *
 *  1. **Slug riêng của ngôn ngữ đó.** `/en/tin-tuc/august-interest-rates`.
 *  2. Không thấy mới thử **slug gốc**, và CHỈ khi ngôn ngữ đó chưa đặt slug riêng
 *     (`slug: null`).
 *
 * Điều kiện `slug: null` ở bước 2 là thứ ngăn một bài có HAI URL cùng phục vụ một
 * ngôn ngữ. Bỏ nó thì `/en/tin-tuc/lai-suat-thang-8` và
 * `/en/tin-tuc/august-interest-rates` cùng trả 200 với cùng nội dung — nội dung
 * trùng lặp do chính ta sinh ra, và Google chọn giúp ta cái nào là canonical.
 *
 * Hai truy vấn chỉ ở nhánh rơi về slug gốc, và cả hai đều đi đúng index
 * `[typeKey, locale, status, publishedAt]` hoặc `[typeKey, locale, slug]`.
 *
 * Cả hai bước KHÔNG kèm điều kiện nào lên `Entry.status` — xem `publishWhere`.
 */
async function findLocalized(typeKey: string, slug: string, locale: string, now: Date) {
  // Hai `where` ở `query-build.ts` — API công khai tra cùng URL với cùng hai bước,
  // xem docblock của `localizedSlugWheres`.
  for (const where of localizedSlugWheres(typeKey, slug, locale, now)) {
    const row = await prisma.entry.findFirst({
      where: where as Prisma.EntryWhereInput,
      select: SELECT,
    });
    if (row) return row;
  }
  return null;
}

/**
 * Một entry theo slug — CHỈ bài đã đăng và đã tới mốc.
 *
 * `notFound()` là việc của route; hàm này trả `null` cho cả ba trường hợp (không
 * có, còn nháp, hẹn giờ chưa tới) vì phân biệt chúng ở đây là mời route rò rỉ sự
 * tồn tại của một bài chưa đăng.
 *
 * ## Hẹn giờ: `revalidate` bám theo mốc gần nhất, không phải 3600s cố định
 *
 * `new Date()` nằm BÊN TRONG hàm được cache. Với `revalidate: 3600` cố định thì một
 * bài hẹn 9:00 mà có người mở URL lúc 8:59 nhận `null`, và `null` ĐÓ BỊ CACHE — bài
 * 404 tới 9:59 dù đã tới mốc. Nếu người mở lúc 8:59 là Googlebot thì thứ được ghi
 * nhớ là một 404.
 *
 * Nên `revalidate` = số giây tới mốc hẹn giờ gần nhất, kẹp trong [10, 3600] — xem
 * `nextRevalidateSeconds`. Sai số còn lại đến từ cache 60s của `nextScheduledAt`.
 */
export const getEntryBySlug = async (typeKey: string, slug: string, locale?: string) => {
  const revalidate = nextRevalidateSeconds(await nextScheduledAt(typeKey), new Date());

  return unstable_cache(
    async () => {
      const now = new Date();
      const row = locale
        ? await findLocalized(typeKey, slug, locale, now)
        : await prisma.entry.findFirst({
            where: { typeKey, slug, archivedAt: null, ...publishWhere({ now }) },
            select: SELECT,
          });
      return row ? toRow(row as RawEntry, locale, await seoKeysFor(locale)) : null;
    },
    ['collection-entry', typeKey, slug, locale ?? 'default'],
    { tags: [collectionTag(typeKey), entryTag(typeKey, slug)], revalidate },
  )().then(reviveEntryRow);
};

/**
 * Một bản ghi cho màn XEM TRƯỚC — kể cả còn nháp, kể cả hẹn giờ chưa tới.
 *
 * Cố ý KHÔNG dùng `publishWhere`, và cố ý KHÔNG cache.
 *
 * Người đang dựng mẫu chi tiết thường vừa tạo một bài thử và chưa đăng nó. Lọc nháp
 * ra ở đây thì màn xem trước trống đúng vào lúc nó cần hữu ích nhất — và một mẫu
 * render rỗng là cái bẫy đã tốn một buổi ngày 08/09/2026 (xem `previewBinding`).
 *
 * Hàm này KHÔNG được gọi từ đường site thật. `getEntryBySlug` mới là đường đó, và nó
 * giữ nguyên luật "nháp thì 404" — luật ấy thuộc về site công khai, không thuộc về
 * màn xem trước sau lớp auth.
 *
 * `slug` bỏ trống = bản ghi mới nhất của loại.
 */
export async function getEntryForPreview(
  typeKey: string,
  slug?: string,
  locale?: string,
): Promise<EntryRow | null> {
  const row = await prisma.entry.findFirst({
    where: { typeKey, archivedAt: null, ...(slug ? { slug } : {}) },
    orderBy: [{ publishedAt: 'desc' }, { updatedAt: 'desc' }],
    select: SELECT,
  });
  return row ? toRow(row as RawEntry, locale, await seoKeysFor(locale)) : null;
}

/**
 * Xếp hạng "liên quan nhất". THUẦN, để luật xếp hạng có test riêng.
 *
 * Số danh mục trùng giảm dần, rồi mới tới bài mới nhất. Đảo hai tiêu chí này là
 * biến khu "tin liên quan" thành khu "tin mới nhất" lần thứ hai trên cùng trang.
 */
export function rankRelated(
  candidates: { id: string; shared: number; publishedAt: Date | null }[],
  limit: number,
): string[] {
  return [...candidates]
    .sort((a, b) => {
      if (b.shared !== a.shared) return b.shared - a.shared;
      const at = a.publishedAt?.getTime() ?? 0;
      const bt = b.publishedAt?.getTime() ?? 0;
      return bt - at;
    })
    .slice(0, limit)
    .map((c) => c.id);
}

/** CHƯA bọc `unstable_cache` — xem "Cache" ở đầu file: khoá không ổn định, và `now`. */
export async function relatedEntries(args: {
  typeKey: string;
  entryId: string;
  limit: number;
  locale?: string;
}): Promise<EntryRow[]> {
  const limit = Math.min(args.limit, MAX_QUERY_LIMIT);
  const now = new Date();

  const mine = await prisma.entryTaxonomy.findMany({
    where: { entryId: args.entryId },
    select: { taxonomyId: true },
  });
  const myTax = mine.map((m) => m.taxonomyId);

  let picked: EntryRow[] = [];

  if (myTax.length) {
    const rows = await prisma.entry.findMany({
      where: {
        typeKey: args.typeKey, archivedAt: null,
        ...publishWhere({ now, locale: args.locale }),
        id: { not: args.entryId },
        taxonomies: { some: { taxonomyId: { in: myTax } } },
      },
      // Nạp rộng hơn limit rồi xếp trong bộ nhớ: "số danh mục trùng" là một phép
      // đếm trên bảng nối, và Postgres không sắp được nó trong cùng một findMany.
      // Trần 100 giữ cho nó không thành một lượt quét bảng.
      take: MAX_QUERY_LIMIT,
      orderBy: { publishedAt: 'desc' },
      select: SELECT,
    });

    const seoKeys = await seoKeysFor(args.locale);
    const scored = rows.map((r) => ({
      id: r.id,
      shared: (r as RawEntry).taxonomies.filter((t) => myTax.includes(t.taxonomyId)).length,
      publishedAt: r.publishedAt,
    }));
    const order = rankRelated(scored, limit);
    const byId = new Map(rows.map((r) => [r.id, toRow(r as RawEntry, args.locale, seoKeys)]));
    picked = order.map((id) => byId.get(id)!).filter(Boolean);
  }

  // Bù cho đủ số bằng bài mới nhất cùng loại.
  //
  // Thiếu bước này thì một bài chưa gắn danh mục có khu "tin liên quan" TRỐNG
  // TRƠN — không phải lỗi, nhưng trông y như lỗi, và không có gì để lần.
  if (picked.length < limit) {
    const have = new Set([args.entryId, ...picked.map((p) => p.id)]);
    const seoKeys = await seoKeysFor(args.locale);
    const fill = await prisma.entry.findMany({
      where: {
        typeKey: args.typeKey, archivedAt: null,
        ...publishWhere({ now, locale: args.locale }),
        id: { notIn: [...have] },
      },
      orderBy: { publishedAt: 'desc' },
      take: limit - picked.length,
      select: SELECT,
    });
    picked = [...picked, ...fill.map((r) => toRow(r as RawEntry, args.locale, seoKeys))];
  }

  return picked;
}

export interface TaxonomyGroup {
  taxonomy: { id: string; key: string; name: string };
  entries: EntryRow[];
  /**
   * Số bài ĐÃ ĐĂNG của danh mục — con số THẬT, không phải `entries.length`.
   *
   * `entries` đã bị cắt hai lần (theo `perGroup`, và theo trần hàng của truy vấn
   * thứ hai), nên `entries.length` là một con số nhỏ hơn hoặc bằng sự thật. Trước
   * đây chính nó đi vào `data.count` của item — tức tiêu đề nhóm nói "3 bài" cho
   * một danh mục có 40 bài, và không có gì báo.
   */
  entryCount: number;
}

/**
 * "FAQ theo danh mục": danh mục của một loại, mỗi danh mục kèm entry của nó.
 *
 * BA truy vấn tổng, không phải N+1: nạp danh mục, đếm bài của mọi danh mục bằng
 * một `groupBy`, rồi nạp entry của MỌI danh mục trong một lượt và gom trong bộ
 * nhớ. Với 7 danh mục thì N+1 là 8 lượt đọc cho một khối trên trang chủ.
 *
 * Truy vấn cuối có TRẦN SỐ HÀNG — xem `take` ở trong thân hàm. Ba truy vấn mà một
 * trong đó không có trần thì "không N+1" chỉ là đổi N lượt đọc nhỏ thành một lượt
 * đọc cả bảng.
 *
 * ## Vì sao `groupBy` là một truy vấn RIÊNG chứ không đếm từ `entries`
 *
 * Vì `entries` đã bị cắt, và hai thứ dựa vào con số thật: `filter.minEntries`
 * ("có bài thì mới hiện" — đếm sai là ẩn mất một danh mục có bài) và `sort` theo
 * `count`. Một truy vấn gộp cho cả bảng rẻ hơn hẳn một câu trả lời sai.
 *
 * CHƯA bọc `unstable_cache` — xem "Cache" ở đầu file: khoá không ổn định, và `now`.
 */
export async function taxonomyGroups(
  typeKey: string,
  limit: number,
  locale?: string,
  opts: { filter?: TaxonomyFilter; sort?: TaxonomySort } = {},
): Promise<TaxonomyGroup[]> {
  const perGroup = Math.min(limit, MAX_QUERY_LIMIT);
  const now = new Date();

  const taxonomies = await prisma.taxonomy.findMany({
    where: {
      typeKey,
      // Vắng `published` = không lọc, tức hành vi của mọi khối đang chạy. Chỉ khi
      // người dựng bật ô ấy thì danh mục nháp mới biến mất khỏi dải.
      ...(opts.filter?.published ? { status: 'published' } : {}),
    },
    orderBy: [{ order: 'asc' }, { name: 'asc' }],
    select: { id: true, key: true, name: true, i18n: true },
  });
  if (!taxonomies.length) return [];

  /*
   * Đếm bài đã đăng của từng danh mục — MỘT truy vấn cho cả bảng.
   *
   * Điều kiện phải khớp với `where` của truy vấn entry bên dưới, nếu không thì số
   * đếm và số bài hiện ra nói hai chuyện khác nhau về cùng một danh mục.
   */
  const counts = await prisma.entryTaxonomy.groupBy({
    by: ['taxonomyId'],
    where: {
      taxonomyId: { in: taxonomies.map((t) => t.id) },
      entry: { typeKey, archivedAt: null, ...publishWhere({ now, locale }) },
    },
    _count: { entryId: true },
  });
  const countById = new Map(counts.map((c) => [c.taxonomyId, c._count.entryId]));

  const rows = await prisma.entry.findMany({
    where: {
      typeKey, archivedAt: null,
      ...publishWhere({ now, locale }),
      taxonomies: { some: { taxonomyId: { in: taxonomies.map((t) => t.id) } } },
    },
    orderBy: { publishedAt: 'desc' },
    // Trần cứng, và nó CÓ LÀM SAI kết quả khi phân bố lệch — nói thẳng ra ở đây vì
    // một comment nói "không làm sai" là thứ khiến người sau đi tìm lỗi ở chỗ khác.
    //
    // Trần tồn tại để một loại có 4.000 bài không nạp cả 4.000 hàng kèm JSONB thân bài
    // vào bộ nhớ rồi mới cắt — đúng ca mà spec §5.2 bắt `limit` phải có trần.
    //
    // Hạn chế: `số nhóm × perGroup` chỉ đủ khi các bài mới nhất rải đều. 7 danh mục,
    // `perGroup = 3`, `take = 21` — nếu cả 21 bài mới nhất đều thuộc T1 thì T1 được 3
    // và SÁU danh mục còn lại hiện TRỐNG dù chúng có bài đã đăng. Trần `MAX_QUERY_LIMIT
    // * 4` làm ca đó dễ gặp hơn, không dễ gặp ít hơn.
    //
    // Cách đúng là một truy vấn có `LIMIT` theo TỪNG NHÓM: window function
    // (`row_number() OVER (PARTITION BY taxonomyId ORDER BY publishedAt DESC)`) hoặc N
    // truy vấn, mỗi truy vấn có trần riêng. Việc đó thuộc mốc 3, nơi ba công thức §5.3
    // được chứng minh — không phải sửa trần ở đây, vì bỏ trần là đổi một kết quả lệch
    // thành một lượt đọc cả bảng.
    take: Math.min(taxonomies.length * perGroup, MAX_QUERY_LIMIT * 4),
    select: SELECT,
  });

  const seoKeys = await seoKeysFor(locale);
  const byTax = new Map<string, EntryRow[]>();
  for (const r of rows) {
    const row = toRow(r as RawEntry, locale, seoKeys);
    for (const tid of row.taxonomyIds) {
      const list = byTax.get(tid) ?? [];
      if (list.length < perGroup) list.push(row);
      byTax.set(tid, list);
    }
  }

  const groups: TaxonomyGroup[] = taxonomies.map((t) => ({
    // Tên của ngôn ngữ đang phục vụ, KHÔNG kèm cột `i18n`: khối lặp map field `name`,
    // và một bảng dịch lọt vào `data` của item là thứ người dựng sẽ thử map tới.
    taxonomy: { id: t.id, key: t.key, name: taxonomyName(t, locale) },
    entries: byTax.get(t.id) ?? [],
    entryCount: countById.get(t.id) ?? 0,
  }));

  const min = opts.filter?.minEntries;
  const kept = min === undefined ? groups : groups.filter((g) => g.entryCount >= min);

  return opts.sort ? sortGroups(kept, opts.sort) : kept;
}

/**
 * Sắp ở JS, không ở `orderBy`.
 *
 * `count` không phải một cột — nó đến từ `groupBy` ở trên, nên Postgres không sắp
 * được nó cùng lượt với danh mục. Và một khi đã có một chiều phải sắp ở JS thì
 * sắp cả ba ở đây là chỗ duy nhất để đọc, thay vì hai nửa ở hai tầng.
 *
 * Bảng danh mục của một loại là vài chục hàng; sắp chúng trong bộ nhớ không phải
 * điều đáng cân nhắc.
 */
function sortGroups(groups: TaxonomyGroup[], sort: TaxonomySort): TaxonomyGroup[] {
  const sign = sort.dir === 'desc' ? -1 : 1;
  // Vị trí ban đầu = thứ tự `order` rồi tên mà truy vấn đã trả về. Chụp lại TRƯỚC
  // khi sắp, vì `dir: 'desc'` của `order` chỉ là đảo chính thứ tự ấy.
  const rank = new Map(groups.map((g, i) => [g.taxonomy.id, i]));

  return [...groups].sort((a, b) => {
    // `name` làm khoá PHỤ ở mọi chiều: nhiều danh mục cùng số bài là chuyện
    // thường (hai danh mục 0 bài), và không có khoá phụ thì thứ tự của chúng đổi
    // giữa hai lần tải trang.
    const byName = a.taxonomy.name.localeCompare(b.taxonomy.name, 'vi');
    switch (sort.field) {
      case 'count':
        return sign * (a.entryCount - b.entryCount) || byName;
      case 'name':
        return sign * byName;
      case 'order':
        return sign * (rank.get(a.taxonomy.id)! - rank.get(b.taxonomy.id)!);
    }
  });
}

/**
 * Entry theo danh sách ID, GIỮ NGUYÊN thứ tự của danh sách.
 *
 * Thứ tự là điểm chính: `IN (…)` của Postgres không hứa thứ tự nào, còn thứ tự
 * ID trong một field `relation` LÀ thứ tự người biên tập đã kéo. Trả về theo thứ
 * tự Postgres nghĩa là dải "bài cùng chuyên đề" đảo chỗ giữa hai lần tải trang.
 *
 * ID không tra được (đã xoá, còn nháp, hẹn giờ chưa tới) thì vắng mặt — không
 * phải một chỗ trống. Cùng bộ lọc "đã đăng" với mọi đường đọc site.
 */
export async function entriesByIds(ids: string[], locale?: string): Promise<EntryRow[]> {
  if (!ids.length) return [];

  const rows = await prisma.entry.findMany({
    where: {
      id: { in: ids },
      archivedAt: null,
      ...publishWhere({ now: new Date(), locale }),
    },
    select: SELECT,
  });

  const seoKeys = await seoKeysFor(locale);
  const byId = new Map(rows.map((r) => [r.id, toRow(r as RawEntry, locale, seoKeys)]));
  return ids.map((id) => byId.get(id)).filter((r): r is EntryRow => r !== undefined);
}

/**
 * Bản ghi đích của field `relation`, tra theo ID — MỘT truy vấn cho cả trang.
 *
 * Lọc "đã đăng" y như mọi đường đọc site: một bài trỏ tới bản ghi CÒN NHÁP thì
 * bản nháp ấy không được lộ ra qua đường vòng này. Bản ghi không lọt bộ lọc thì
 * vắng mặt trong kết quả, và `expandRelations` gỡ hẳn field đó.
 *
 * Không lọc theo `typeKey`: ID là duy nhất toàn bảng, và một trang có thể trỏ
 * tới hai loại đích khác nhau. Lọc theo loại nghĩa là một truy vấn cho mỗi loại.
 *
 * CHƯA bọc `unstable_cache` — cùng lý do với ba hàm kia ở đầu file: khoá là một
 * danh sách ID tuỳ ý, và bộ lọc có `now`.
 */
export async function relationTargets(
  ids: string[],
  locale?: string,
): Promise<{ id: string; slug: string; typeKey: string; data: Record<string, unknown> }[]> {
  if (!ids.length) return [];

  const rows = await prisma.entry.findMany({
    where: {
      id: { in: ids },
      archivedAt: null,
      ...publishWhere({ now: new Date(), locale }),
    },
    select: { id: true, slug: true, typeKey: true, data: true, i18n: true },
  });

  const seoKeys = await seoKeysFor(locale);
  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    typeKey: r.typeKey,
    // Phủ bản dịch y như `toRow`: không phủ thì huy hiệu chuyên đề trên trang
    // tiếng Anh hiện tên tiếng Việt, và chỉ chỗ ấy sai.
    data: locale
      ? applyEntryLocale((r.data ?? {}) as Record<string, unknown>, r.i18n, locale, seoKeys.get(r.typeKey) ?? null)
      : ((r.data ?? {}) as Record<string, unknown>),
  }));
}

export const getCollectionTypes = unstable_cache(
  async () => {
    const rows = await prisma.collectionType.findMany({
      // `createdAt` là khoá PHỤ, không thừa: loại vừa tạo mang `order = 0` và sẽ
      // đụng hàng đầu tiên — không có khoá phụ thì Postgres trả thứ tự tuỳ lượt.
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true, key: true, name: true, namePlural: true, icon: true,
        schema: true, titleField: true, slugField: true, singleton: true,
        _count: { select: { entries: true } },
      },
    });
    const groups = await loadGroupTable();
    return rows.map((r) => {
      const checked = validateCollectionSchema(r.schema, groups);
      return {
        id: r.id, key: r.key, name: r.name, namePlural: r.namePlural, icon: r.icon,
        // Cấu trúc không đọc được thì trả MẢNG RỖNG chứ không ném: một hàng hỏng
        // không được làm cả màn Nội dung không mở được.
        schema: (checked.ok ? checked.fields : []) as FieldDef[],
        titleField: r.titleField, slugField: r.slugField, singleton: r.singleton,
        entryCount: r._count.entries,
      };
    });
  },
  ['collection-types'],
  { tags: [TYPES_TAG], revalidate: 3600 },
);
