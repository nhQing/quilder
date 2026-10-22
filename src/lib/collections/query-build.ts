/**
 * `CollectionQuery` → đối số truy vấn. THUẦN, để test được không cần DB.
 *
 * ## Vì sao trả về một shape riêng chứ không gọi Prisma
 *
 * Phần dễ sai nhất của cả tính năng là "điều kiện nào luôn được áp": bỏ một trong
 * bốn điều kiện nền (typeKey, đã đăng, chưa lưu trữ, publishedAt đã tới) là làm bài
 * nháp hoặc bài hẹn giờ lên sóng. Tách thuần nghĩa là bốn điều kiện đó có test
 * riêng, chạy trong một giây, không cần Postgres.
 */

import {
  MAX_QUERY_LIMIT,
  SORTABLE_COLUMNS,
  type CollectionFilter,
  type CollectionQuery,
} from '@/lib/doc/types';

/**
 * Re-export, KHÔNG khai lại: cả hai sống cùng `CollectionQuery` ở `doc/types.ts`.
 * Hai hằng cho một luật sẽ lệch nhau ở lần đầu có ai sửa một bên.
 */
export { MAX_QUERY_LIMIT, SORTABLE_COLUMNS };

export interface QueryContext {
  now: Date;
  /** Bài đang mở, cho `excludeCurrent`. */
  currentEntryId?: string;
  /** Danh mục của bài đang mở, cho `taxonomy.from: 'current-entry'`. */
  currentTaxonomyIds?: string[];
  /**
   * Danh mục lấy từ URL, cho `taxonomy.from: 'url'`. BA trạng thái, không phải hai.
   *
   *  - `undefined` — **không có ngữ cảnh URL**. Đang render ở nơi không có đoạn động
   *    nào để đọc. Điều kiện bị BỎ; xem `filterToWhere`.
   *  - `null` — **có đoạn động, nhưng nó không trỏ vào danh mục nào**. URL sai. Điều
   *    kiện thành "không khớp gì".
   *  - một id — phân giải được.
   *
   * `null` là trạng thái MỚI (14/09/2026) và nó tồn tại vì hai ca trên từng gộp làm
   * một. Xem docblock `filterToWhere`.
   */
  urlTaxonomyId?: string | null;
  /**
   * Bản ghi đích lấy từ URL, cho `relation.from: 'url'`.
   *
   * Ba trạng thái giống hệt `urlTaxonomyId` ngay trên, và vì đúng lý do đó.
   *
   * MỘT giá trị cho cả truy vấn, không phải một giá trị cho mỗi field: một trang
   * chỉ có tối đa MỘT đoạn động (xem `COLLECTION_RULES`), nên "giá trị lấy từ URL"
   * chỉ có một. Khoá theo tên field sẽ là một map luôn có đúng một phần tử.
   */
  urlRelationId?: string | null;
  /**
   * Ngôn ngữ đang phục vụ. `undefined` = ngôn ngữ mặc định.
   *
   * Quy ước này có từ trước ở đường render (`resolveTarget`), và nó quyết định phép
   * lọc "đã đăng" đọc ở ĐÂU — xem `publishWhere`.
   */
  locale?: string;
}

export interface EntryFindArgs {
  where: Record<string, unknown>;
  orderBy: Record<string, unknown>[];
  take: number;
  skip: number;
}

/**
 * Mảnh `where` không hàng nào khớp được.
 *
 * `id: { in: [] }` chứ không phải một cờ riêng đi ngược lên `buildEntryFindArgs`:
 * nó là một `where` Prisma hợp lệ, nên nó nối vào `AND` như mọi điều kiện khác và
 * `count` dùng lại đúng nó. Một cờ riêng nghĩa là mọi chỗ gọi phải nhớ xử lý nó,
 * và chỗ quên sẽ là chỗ trả về danh sách đầy đủ — đúng cái lỗi đang sửa.
 *
 * HÀM chứ không phải hằng: một object dùng chung nằm trong cây `where` của mọi
 * truy vấn là một object bất cứ ai cũng mutate được.
 */
export const matchNothing = (): Record<string, unknown> => ({ id: { in: [] } });

/**
 * Một điều kiện → mảnh `where`, hoặc `null` để BỎ nó.
 *
 * ## `null` = BỎ, và đó vẫn là hành vi đúng cho "không có ngữ cảnh"
 *
 * Trang danh sách dùng lại đúng thẻ của trang chi tiết là chuyện thường, và biến
 * "không có ngữ cảnh" thành "không khớp gì" làm cả khu trống mà không có lỗi nào
 * để lần. Rào chắn đó giữ NGUYÊN.
 *
 * ## Nhưng "không có ngữ cảnh" KHÁC "có ngữ cảnh mà không phân giải được"
 *
 * Đây là chỗ bản trước sai, và nó sai theo kiểu trông-như-đúng. Cả hai ca cùng cho
 * `ctx.urlTaxonomyId === undefined`, nên cả hai cùng bị BỎ điều kiện. Hậu quả đo
 * được trên staging: trang `/blogs/[category-slug]` khai
 * `{ k: 'taxonomy', from: 'url' }`; khi đoạn động không phân giải ra danh mục nào,
 * builder bỏ luôn điều kiện và trả DANH SÁCH KHÔNG LỌC. Mọi trang danh mục hiện
 * cùng một danh sách, và người xem không có cách nào biết — không 404, không khu
 * trống, chỉ là dữ liệu sai.
 *
 * Phân biệt bằng `null` vs `undefined` trên chính ô ngữ cảnh (xem `QueryContext`):
 *
 *  - `undefined` → không có đoạn động nào để đọc → BỎ điều kiện (hành vi cũ).
 *  - `null` → có đoạn động, nó không trỏ vào đâu cả → `matchNothing()`.
 *
 * Người ĐẶT `null` là người biết có đoạn động hay không, tức đường render và đường
 * API — không phải hàm này. Hàm này chỉ không được gộp hai câu trả lời khác nhau
 * làm một nữa.
 */
function filterToWhere(f: CollectionFilter, ctx: QueryContext): Record<string, unknown> | null {
  switch (f.k) {
    case 'field': {
      const path = [f.field];
      switch (f.op) {
        case 'eq':       return { data: { path, equals: f.value } };
        case 'ne':       return { NOT: { data: { path, equals: f.value } } };
        case 'gt':       return { data: { path, gt: f.value } };
        case 'gte':      return { data: { path, gte: f.value } };
        case 'lt':       return { data: { path, lt: f.value } };
        case 'lte':      return { data: { path, lte: f.value } };
        case 'contains': return { data: { path, string_contains: String(f.value) } };
      }
    }
    case 'taxonomy': {
      if (f.from === 'url') {
        if (ctx.urlTaxonomyId === undefined) return null;
        if (ctx.urlTaxonomyId === null) return matchNothing();
        return { taxonomies: { some: { taxonomyId: { in: [ctx.urlTaxonomyId] } } } };
      }
      const ids = f.from === 'fixed' ? f.ids : ctx.currentTaxonomyIds;
      if (!ids || ids.length === 0) return null;
      return { taxonomies: { some: { taxonomyId: { in: ids } } } };
    }
    case 'relation': {
      const ids =
        f.from === 'fixed'
          ? f.ids
          : ctx.urlRelationId === undefined
            ? undefined
            : ctx.urlRelationId === null
              ? null
              : [ctx.urlRelationId];
      if (ids === null) return matchNothing();
      if (!ids || ids.length === 0) return null;
      /*
       * `equals` HOẶC `array_contains` cho mỗi id — hai hình dạng của cùng một
       * field, xem docblock của `CollectionFilter`. Hỏi cả hai chứ không đọc
       * `cardinality` từ schema vì hàm này THUẦN: kéo schema vào đây là kéo một
       * lượt đọc DB vào chỗ chỉ dựng shape, và hàng cũ sót lại hình dạng cũ vẫn
       * phải khớp kể cả khi schema đã đổi.
       */
      return {
        OR: ids.flatMap((id) => [
          { data: { path: [f.field], equals: id } },
          { data: { path: [f.field], array_contains: id } },
        ]),
      };
    }
    case 'excludeCurrent':
      return ctx.currentEntryId ? { id: { not: ctx.currentEntryId } } : null;
  }
}

/**
 * Field không phải cột thật thì BỎ, không phải sinh ra một `orderBy` sai.
 *
 * Trả `null` để `buildEntryFindArgs` bỏ nó và rơi về thứ tự mặc định. Sinh ra một
 * đối số Prisma không hợp lệ thì lỗi nổ ở tầng đọc DB, cách xa chỗ gây ra nó, và
 * test shape ở tầng này vẫn xanh — đúng cái bẫy đã bắt được ở lần sửa này.
 */
function sortToOrderBy(field: string, dir: 'asc' | 'desc'): Record<string, unknown> | null {
  if ((SORTABLE_COLUMNS as readonly string[]).includes(field)) return { [field]: dir };
  return null;
}

/**
 * Điều kiện "đã đăng và đã tới mốc" — của bản gốc hay của một bản dịch.
 *
 * Đây là chỗ dễ sai nhất của publish-theo-locale, nên nó là một hàm riêng có test
 * riêng: hai nhánh, và nhánh sai nào cũng công bố thứ chưa được duyệt.
 *
 * Ngôn ngữ mặc định đọc cột của `Entry`. Ngôn ngữ khác đọc hàng `EntryLocale` của
 * chính nó, và CỐ Ý không kèm điều kiện nào lên `Entry.status` — bản tiếng Anh đã
 * duyệt phải hiện được kể cả khi bản gốc đã bị tháo xuống. Xem docblock
 * `isLocalePublished`.
 *
 * `archivedAt` không ở đây: nó là của cả hàng `Entry`, áp cho mọi ngôn ngữ, nên nó
 * nằm ở phần nền của `where`.
 */
export function publishWhere(ctx: QueryContext): Record<string, unknown> {
  if (!ctx.locale) {
    return {
      status: 'published',
      // `not: null` đi kèm `lte`: bài đã đăng mà chưa đặt mốc thì không có ngày để
      // so, và Postgres coi `null <= now` là NULL, tức là "không khớp" — đúng ý,
      // nhưng viết ra để người sau không tưởng đây là dư.
      publishedAt: { not: null, lte: ctx.now },
    };
  }
  return {
    locales: {
      some: {
        locale: ctx.locale,
        status: 'published',
        publishedAt: { not: null, lte: ctx.now },
      },
    },
  };
}

/**
 * Hai `where` để thử THEO THỨ TỰ khi tra một slug ở ngôn ngữ không mặc định.
 *
 *  1. **Slug riêng của ngôn ngữ đó.** `/en/tin-tuc/august-interest-rates`.
 *  2. Không thấy mới thử **slug gốc**, và CHỈ khi ngôn ngữ đó chưa đặt slug riêng
 *     (`slug: null`).
 *
 * Điều kiện `slug: null` ở bước 2 là thứ ngăn một bài có HAI URL cùng phục vụ một
 * ngôn ngữ — nội dung trùng lặp do chính ta sinh ra.
 *
 * Cả hai bước KHÔNG kèm điều kiện nào lên `Entry.status`: bản tiếng Anh đã duyệt phải
 * hiện được kể cả khi bản gốc đã bị tháo xuống (xem `isLocalePublished`).
 *
 * Ở ĐÂY chứ không trong `queries.ts`: API công khai (`public-read.ts`) tra cùng một
 * URL với cùng hai bước đó, và bản thứ hai của phép tra này là chỗ để hai đường trôi
 * lệch — đường site tôn trọng trạng thái đăng của từng ngôn ngữ, đường API thì không.
 * Đó không phải giả thuyết: đo ngày 28/08/2026, API trả nội dung bản dịch CÒN NHÁP.
 */
export function localizedSlugWheres(
  typeKey: string,
  slug: string,
  locale: string,
  now: Date,
): Record<string, unknown>[] {
  const published = { status: 'published', publishedAt: { not: null, lte: now } } as const;
  return [
    { typeKey, archivedAt: null, locales: { some: { locale, slug, ...published } } },
    { typeKey, slug, archivedAt: null, locales: { some: { locale, slug: null, ...published } } },
  ];
}

/**
 * Nối khoá sắp PHỤ vào cuối `orderBy`, tại chỗ.
 *
 * ## Vì sao cần
 *
 * `ORDER BY` trên một khoá có giá trị TRÙNG không hứa gì về thứ tự của các hàng
 * trùng nhau — SQL không hứa, và Postgres thật sự trả khác nhau giữa hai lần chạy
 * (kế hoạch đổi, hàng bị update đổi chỗ vật lý). Chuyện đó im lặng cho tới khi
 * khoá chính trùng trên DIỆN RỘNG.
 *
 * Đã trả giá thật: "`sort` `asc` và `desc` cho kết quả mâu thuẫn". Không phải lỗi
 * validator — mọi hàng đều `viewCount = 0`, nên khoá chính bằng nhau ở MỌI cặp và
 * hai chiều chỉ là hai thứ tự tuỳ ý. Cùng một URL, hai lần tải, hai thứ tự khác
 * nhau, không ai hiểu vì sao.
 *
 * ## Vì sao `publishedAt` rồi `id`
 *
 *  - **`publishedAt` trước** vì nó là khoá phụ có NGHĨA với người đọc: hai bài cùng
 *    số lượt xem thì bài mới lên trước. Nó cũng đúng bằng thứ tự mặc định của cả
 *    tầng này, nên một danh sách vỡ đồng hạng rơi về đúng thứ tự quen thuộc chứ
 *    không rơi vào một thứ tự lạ.
 *  - **`id` sau cùng** vì `publishedAt` MỘT MÌNH không đủ: nó trùng được (đăng hàng
 *    loạt cùng một giây) và nó `null` được — trên ngôn ngữ không mặc định,
 *    `publishWhere` lọc `EntryLocale`, không ràng buộc `Entry.publishedAt`. `id` là
 *    khoá chính, duy nhất, không null, nên nó chốt mọi hoà còn lại. Và `id` là cuid
 *    có tiền tố thời gian, nên `desc` xấp xỉ "mới tạo trước" — cùng chiều với
 *    `publishedAt: 'desc'`, không phải một thứ tự ngược ngẫu nhiên.
 *
 * Bỏ qua khoá nào người dùng đã tự khai: sắp theo `publishedAt: 'asc'` rồi ta nối
 * thêm `publishedAt: 'desc'` là một `ORDER BY` tự mâu thuẫn (mảnh thứ hai vô tác
 * dụng, nhưng nó nằm trong SQL và người đọc log sẽ mất thì giờ vì nó).
 *
 * `id` không nằm trong `SORTABLE_COLUMNS` nên hôm nay nó không bao giờ trùng với
 * khoá người dùng khai — vẫn kiểm, vì danh sách ấy có thể dài ra.
 */
function appendTieBreakers(orderBy: Record<string, unknown>[]): void {
  const used = new Set(orderBy.flatMap((o) => Object.keys(o)));
  for (const key of ['publishedAt', 'id'] as const) {
    if (!used.has(key)) orderBy.push({ [key]: 'desc' });
  }
}

export function buildEntryFindArgs(query: CollectionQuery, ctx: QueryContext): EntryFindArgs {
  const AND = (query.filter ?? [])
    .map((f) => filterToWhere(f, ctx))
    .filter((w): w is Record<string, unknown> => w !== null);

  const requested = (query.sort ?? [])
    .map((s) => sortToOrderBy(s.field, s.dir))
    .filter((o): o is Record<string, unknown> => o !== null);
  // Rỗng thì mới về mặc định: người dùng khai `sort` bằng một field không sắp được
  // vẫn phải nhận MỘT thứ tự xác định, không phải thứ tự tuỳ Postgres.
  const orderBy: Record<string, unknown>[] = requested.length
    ? requested
    : [{ publishedAt: 'desc' as const }];
  appendTieBreakers(orderBy);

  return {
    where: {
      typeKey: query.typeKey,
      archivedAt: null,
      ...publishWhere(ctx),
      AND,
    },
    orderBy,
    take: Math.min(query.limit, MAX_QUERY_LIMIT),
    skip: query.skip ?? 0,
  };
}
