import 'server-only';

/**
 * Đường đọc công khai.
 *
 * ## Vì sao dùng lại `buildEntryFindArgs`
 *
 * Bốn điều kiện nền (typeKey, đã đăng, chưa lưu trữ, mốc đã tới) đã có test riêng
 * ở đó. Viết một truy vấn thứ hai cho API nghĩa là bốn điều kiện đó tồn tại ở hai
 * chỗ, và chỗ bị quên sẽ là chỗ để một bài nháp đi ra ngoài.
 *
 * ## `locale` phải đi vào `ctx`, không chỉ vào phép phủ dữ liệu
 *
 * Đây là lỗi đã CÓ THẬT ở file này, đo ngày 28/08/2026: `buildEntryFindArgs` được gọi
 * không kèm `locale`, nên `publishWhere` đi nhánh mặc định (`Entry.status`) rồi
 * `applyEntryLocale` phủ bản dịch lên. Hệ quả đo được bằng hai lượt curl:
 *
 *  - bản `en` còn NHÁP mà bản gốc đã đăng ⇒ API trả nội dung tiếng Anh chưa duyệt;
 *  - bản `en` đã đăng mà bản gốc còn nháp ⇒ API KHÔNG thấy bài đó.
 *
 * Cả hai đều là "trạng thái đăng của ngôn ngữ này bị đọc từ chỗ khác". `listEntries`
 * (đường site) đã có một docblock nói đúng cái bẫy này; đường API là bản thứ hai đã
 * quên. Nên `locale` đi vào `ctx` NGAY chỗ dựng truy vấn, và slug/`publishedAt` trả ra
 * cũng là của ngôn ngữ đang phục vụ — trả slug gốc nghĩa là client tiếng Anh dựng URL
 * chi tiết bằng slug tiếng Việt rồi nhận 404.
 *
 * ## Khoá hệ thống thắng khoá field
 *
 * `id`, `slug`, `publishedAt`, `updatedAt`, `taxonomies` được đặt SAU phần dữ liệu,
 * nên một field trùng tên bị che. Đó là lựa chọn có chủ đích: `id` là thứ client dùng
 * để lưu và để gọi lại, và một entry mà `id` là chuỗi do người biên tập gõ sẽ làm mọi
 * client vỡ ở lần lưu đầu tiên. `zKey` chỉ cho chữ thường nên chỉ ba khoá đầu va được
 * (`publishedAt`/`updatedAt` có chữ hoa, không phải khoá field hợp lệ), và với field
 * kiểu `slug` thì giá trị hai bên vốn bằng nhau.
 *
 * ## Cache: cấu trúc thì bọc, danh sách thì không
 *
 * `/types` và `/taxonomies` có khoá cache ỔN ĐỊNH (không tham số, hoặc chỉ `typeKey`)
 * và đổi hiếm hơn nội dung hàng chục lần — chúng đi qua `unstable_cache` với tag, nên
 * một lượt gọi lúc cache trúng là KHÔNG truy vấn nào.
 *
 * Danh sách entry thì KHÔNG bọc, cùng lý do đã ghi ở đầu `queries.ts`: khoá cache sẽ
 * là một query string tuỳ ý, tức một cache không bao giờ trúng nhưng vẫn tốn chỗ — và
 * ở một namespace mở, nó còn là một cửa để người ngoài phình cache bằng tham số rác.
 * Bù lại, `shapeOf` không còn tự đọc `CollectionType` nữa mà dùng `getCollectionTypes`
 * (đã cache, đã có tag): hai truy vấn cấu trúc mỗi lượt gọi biến thành không.
 */

import { unstable_cache } from 'next/cache';
import type { Prisma } from '@prisma/client';

import { prisma } from '@/lib/db';
import { allowedEmbedHostnames } from '@/lib/render/embed-origins';
import { collectionTag, TYPES_TAG } from './cache';
import { localeSlug, type EntryLocaleRow } from './entry-locale';
import { taxonomyName } from './taxonomy-locale';
import type { FieldDef, GroupTable } from './field-def';
import { loadGroupTable } from './group-table';
import { applyEntryLocale } from './i18n';
import { seoKeyOf } from './seo';
import type { PublicErrorCode } from './public-headers';
import { parsePublicParams, type PublicParams } from './public-params';
import { collectAssetIds, toPublicData, type AssetTable, type ShapeOpts } from './public-shape';
import { getCollectionTypes } from './queries';
import { buildEntryFindArgs, localizedSlugWheres, publishWhere } from './query-build';

export type ReadResult<T> =
  | { ok: true; payload: T }
  | { ok: false; status: number; error: string; code: PublicErrorCode };

interface Shape {
  key: string;
  name: string;
  titleField: string;
  slugField: string | null;
  fields: FieldDef[];
  groups: GroupTable;
  /** Cấu trúc của loại khác theo khoá — cho `populate[field]=…`, nơi field thuộc loại đích. */
  schemaOf: (typeKey: string) => FieldDef[] | undefined;
}

/**
 * Bảng nhóm field, đã cache theo `TYPES_TAG`.
 *
 * `loadGroupTable` là ba lượt validate trên mọi hàng `FieldGroupDef` (xem docblock của
 * nó) và nó chạy ở MỌI lượt gọi API — trong khi nhóm field đổi khi có người sửa cấu
 * trúc, tức vài lần một tháng. `upsertFieldGroup` gọi `revalidateTypes()`, nên tag này
 * đã được vô hiệu hoá đúng chỗ; không có cửa nào để bảng cũ sống sót qua một lần sửa.
 */
const publicGroupTable = unstable_cache(loadGroupTable, ['public-group-table'], {
  tags: [TYPES_TAG],
  revalidate: 3600,
});

/**
 * Cấu trúc của một loại — từ `getCollectionTypes`, KHÔNG từ một truy vấn riêng.
 *
 * Nó đã cache, đã có tag, và đã chạy `validateCollectionSchema` với đúng bảng nhóm.
 * Một `findUnique` thứ hai ở đây nghĩa là hai chỗ quyết định "field nào có hiệu lực",
 * và chỗ bị quên sẽ là chỗ trả ra một field đã xoá. Cấu trúc hỏng thì `schema` là MẢNG
 * RỖNG (luật của `getCollectionTypes`) — cùng lựa chọn với màn admin, và ở đây nó còn
 * là lớp chặn: phép chiếu theo schema chính là thứ ẩn field đã xoá.
 */
async function shapeOf(typeKey: string): Promise<Shape | null> {
  const [types, groups] = await Promise.all([getCollectionTypes(), publicGroupTable()]);
  const type = types.find((t) => t.key === typeKey);
  if (!type) return null;
  return {
    key: type.key,
    name: type.name,
    titleField: type.titleField,
    slugField: type.slugField,
    fields: type.schema,
    groups,
    schemaOf: (k) => types.find((t) => t.key === k)?.schema,
  };
}

/**
 * Bảng asset cho một tập entry.
 *
 * Gom mọi `assetId` xuất hiện trong tập rồi đọc MỘT lượt. Đọc theo từng entry là
 * N+1 ngay trên đường nóng nhất của API. Phép gom nằm ở `collectAssetIds`
 * (`public-shape.ts`) chứ không viết lại ở đây: nó phải tìm được cả `assetId` nằm
 * trong khối `figure` của một `richdoc`, và hai bản của phép duyệt đó sẽ trôi lệch.
 */
async function assetsFor(datas: Record<string, unknown>[]): Promise<AssetTable> {
  const ids = new Set<string>();
  for (const d of datas) collectAssetIds(d, ids);
  if (ids.size === 0) return {};

  const rows = await prisma.asset.findMany({
    where: { id: { in: [...ids] } },
    select: { id: true, url: true, width: true, height: true, blurhash: true, mime: true },
  });
  return Object.fromEntries(
    rows.map((a) => [a.id, { url: a.url, width: a.width, height: a.height, blurhash: a.blurhash, mime: a.mime }]),
  );
}

/* ── Hình dạng hàng đọc lên ────────────────────────────────────────────── */

/**
 * MỘT `select` cho cả danh sách và chi tiết.
 *
 * `status` và `locales` có mặt kể cả khi không ai hỏi `?locale=`: chúng là đầu vào của
 * `localeSlug`, và một `select` thứ hai "gọn hơn" cho nhánh không locale nghĩa là hai
 * hình dạng hàng, hai phép dựng envelope, và một chỗ để chúng lệch nhau. Số hàng
 * `locales` có trần thật (số ngôn ngữ đang bật), không phải một quan hệ mở — cùng lập
 * luận với `SELECT` của `queries.ts`.
 */
const SELECT = {
  id: true, slug: true, status: true, data: true, i18n: true,
  publishedAt: true, updatedAt: true,
  locales: { select: { locale: true, slug: true, status: true, publishedAt: true } },
  taxonomies: { select: { taxonomy: { select: { key: true, name: true, i18n: true } } } },
} as const;

type Row = {
  id: string; slug: string; status: string;
  data: unknown; i18n: unknown;
  publishedAt: Date | null; updatedAt: Date;
  locales: EntryLocaleRow[];
  taxonomies: { taxonomy: { key: string; name: string; i18n: unknown } }[];
};

/** Chỉ giữ những field client đã xin — xem `PublicParams.fields`. */
function pick(data: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) if (k in data) out[k] = data[k];
  return out;
}

/**
 * `data` sau khi phủ bản dịch và sau khi cắt theo `fields`.
 *
 * Cắt TRƯỚC khi gom `assetId` và id quan hệ, không phải sau khi chiếu: một client xin
 * `fields=title` thì lượt đọc bảng `Asset` cho ảnh trong thân bài là một truy vấn cho
 * dữ liệu không ai nhận. Đó chính là phần tiết kiệm mà `fields` tồn tại để lấy.
 */
function dataOf(row: Row, params: PublicParams, seoKey: string | null): Record<string, unknown> {
  const raw = (row.data ?? {}) as Record<string, unknown>;
  const withLocale = params.locale ? applyEntryLocale(raw, row.i18n, params.locale, seoKey) : raw;
  return params.fields === undefined ? withLocale : pick(withLocale, params.fields);
}

/** Field được chiếu ra ngoài: cả schema, hoặc đúng phần client đã xin. */
function fieldsOf(shape: Shape, params: PublicParams): FieldDef[] {
  if (params.fields === undefined) return shape.fields;
  const asked = new Set(params.fields);
  return shape.fields.filter((f) => asked.has(f.key));
}

/**
 * Năm khoá hệ thống của một entry, tính theo ngôn ngữ đang phục vụ.
 *
 * `slug` là slug HIỆU LỰC (`localeSlug`), không phải slug gốc — client tiếng Anh dựng
 * URL chi tiết từ đúng trường này. `publishedAt` là mốc của bản dịch khi có
 * `?locale=`: bản gốc có thể chưa đăng (mốc `null`) trong khi bài đang hiện ở tiếng
 * Anh, và một `publishedAt: null` trên một bài đang hiện là thứ làm mọi client sắp xếp
 * hoặc hiển thị ngày sai.
 */
function systemKeys(row: Row, locale: string | undefined) {
  const loc = locale ? row.locales.find((l) => l.locale === locale) : undefined;
  const at = loc?.publishedAt ?? row.publishedAt;
  return {
    id: row.id,
    slug: localeSlug({ slug: row.slug, status: row.status, publishedAt: row.publishedAt }, row.locales, locale),
    publishedAt: at?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
    // Tên theo `?locale=` như `data`; cột `i18n` không ra ngoài.
    taxonomies: row.taxonomies.map((t) => ({ key: t.taxonomy.key, name: taxonomyName(t.taxonomy, locale) })),
  };
}

/* ── populate ─────────────────────────────────────────────────────────── */

export interface RelationSummary {
  id: string;
  slug: string;
  title: string | null;
  publishedAt: string | null;
}

/**
 * Một bản ghi đích đã tra: tóm tắt, cùng `data` đã phủ bản dịch để `populate[field]=…`
 * chiếu field đã xin. `data` không bao giờ ra ngoài nguyên trạng — chỉ qua
 * `toPublicData` với đúng danh sách field client đã xin.
 */
interface RelationHit {
  summary: RelationSummary;
  data: Record<string, unknown>;
}

/**
 * `populate` mở đúng MỘT cấp, và mở ra một TÓM TẮT chứ không phải cả entry.
 *
 * Hai trần khác nhau, cả hai đều cần. "Một cấp" chặn `populate=a.b.c` biến một URL
 * thành một cây join; "tóm tắt" chặn một danh sách 100 bài kéo theo 100 thân bài
 * `richdoc` — mỗi cái vài chục KB — cho một ô hiển thị tên tác giả.
 *
 * Entry được trỏ tới cũng phải qua BỐN ĐIỀU KIỆN NỀN, và ở ĐÚNG NGÔN NGỮ đang phục vụ:
 * `publishWhere({ now, locale })`, không phải một điều kiện viết tay. Không lọc theo
 * ngôn ngữ thì một bài tiếng Anh đã đăng trỏ tới một hồ sơ mà bản tiếng Anh còn nháp
 * sẽ đưa bản nháp đó ra ngoài — đúng thứ mà cả namespace này tồn tại để không làm — và
 * tiêu đề trả ra sẽ là tiêu đề tiếng Việt.
 */
async function relationTable(
  datas: Record<string, unknown>[],
  fields: FieldDef[],
  populate: string[],
  now: Date,
  locale: string | undefined,
): Promise<Record<string, RelationHit>> {
  const relKeys = fields
    .filter((f): f is Extract<FieldDef, { t: 'relation' }> => f.t === 'relation')
    .filter((f) => populate.includes(f.key))
    .map((f) => f.key);
  if (relKeys.length === 0) return {};

  const ids = new Set<string>();
  for (const d of datas) {
    for (const k of relKeys) {
      const v = d[k];
      for (const one of Array.isArray(v) ? v : [v]) {
        if (typeof one === 'string' && one) ids.add(one);
      }
    }
  }
  if (ids.size === 0) return {};

  const [rows, types] = await Promise.all([
    prisma.entry.findMany({
      where: {
        id: { in: [...ids] },
        archivedAt: null,
        ...(publishWhere({ now, locale }) as Prisma.EntryWhereInput),
      },
      select: {
        id: true, slug: true, status: true, typeKey: true, data: true, i18n: true,
        publishedAt: true,
        locales: { select: { locale: true, slug: true, status: true, publishedAt: true } },
      },
    }),
    getCollectionTypes(),
  ]);

  const titleFieldOf = new Map(types.map((t) => [t.key, t.titleField]));
  const seoKeyOfType = new Map(types.map((t) => [t.key, seoKeyOf(t.schema)]));

  return Object.fromEntries(
    rows.map((r) => {
      const base = (r.data ?? {}) as Record<string, unknown>;
      const data = locale ? applyEntryLocale(base, r.i18n, locale, seoKeyOfType.get(r.typeKey) ?? null) : base;
      const raw = data[titleFieldOf.get(r.typeKey) ?? 'title'];
      const loc = locale ? r.locales.find((l) => l.locale === locale) : undefined;
      return [
        r.id,
        {
          summary: {
            id: r.id,
            slug: localeSlug({ slug: r.slug, status: r.status, publishedAt: r.publishedAt }, r.locales, locale),
            title: typeof raw === 'string' && raw.trim() ? raw : null,
            publishedAt: (loc?.publishedAt ?? r.publishedAt)?.toISOString() ?? null,
          },
          data,
        } satisfies RelationHit,
      ];
    }),
  );
}

/**
 * Field đã xin của bản ghi đích, theo THỨ TỰ client xin — mỗi quan hệ một danh sách.
 * Khoá không còn trong cấu trúc loại đích (field vừa bị xoá giữa hai lượt) thì bị bỏ.
 */
function populateDefs(shape: Shape, fields: FieldDef[], params: PublicParams): Map<string, FieldDef[]> {
  const out = new Map<string, FieldDef[]>();
  for (const f of fields) {
    const asked = params.populateFields[f.key];
    if (f.t !== 'relation' || !asked) continue;
    const target = shape.schemaOf(f.typeKey) ?? [];
    out.set(
      f.key,
      asked.map((k) => target.find((t) => t.key === k)).filter((t): t is FieldDef => t !== undefined),
    );
  }
  return out;
}

/**
 * Phần `data` của bản ghi đích mà `populate[field]=…` sẽ chiếu — đầu vào cho phép gom
 * `assetId`. Gom trên phần ĐÃ CẮT, không trên cả `data`: client xin `question` thì ảnh
 * trong thân bài đích là một lượt tra bảng `Asset` cho thứ không ai nhận.
 */
function populatedDatas(
  datas: Record<string, unknown>[],
  defs: Map<string, FieldDef[]>,
  table: Record<string, RelationHit>,
): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const d of datas) {
    for (const [key, picked] of defs) {
      const v = d[key];
      for (const id of Array.isArray(v) ? v : [v]) {
        const hit = typeof id === 'string' ? table[id] : undefined;
        if (hit) out.push(pick(hit.data, picked.map((p) => p.key)));
      }
    }
  }
  return out;
}

/**
 * Thay id bằng bản ghi đích, tại chỗ, trên object đã chiếu: tóm tắt, cộng field đã xin
 * nếu quan hệ được xin bằng `populate[field]=…`.
 *
 * Khoá tóm tắt đặt SAU field nên thắng khi trùng tên — cùng luật "khoá hệ thống thắng
 * khoá field" ở đầu file, vì cùng lý do: `id` và `slug` là thứ client dùng để gọi lại.
 */
function applyPopulate(
  out: Record<string, unknown>,
  data: Record<string, unknown>,
  fields: FieldDef[],
  populate: string[],
  table: Record<string, RelationHit>,
  defs: Map<string, FieldDef[]>,
  shaping: { groups: GroupTable; opts: ShapeOpts },
): void {
  for (const f of fields) {
    if (f.t !== 'relation' || !populate.includes(f.key)) continue;
    const picked = defs.get(f.key);
    const render = (id: unknown) => {
      const hit = typeof id === 'string' ? table[id] : undefined;
      if (!hit) return undefined;
      if (!picked) return hit.summary;
      return { ...toPublicData(hit.data, picked, shaping.groups, shaping.opts), ...hit.summary };
    };
    const v = data[f.key];
    if (f.cardinality === 'many') {
      // Id trỏ tới bài đã gỡ bị LOẠI khỏi mảng, không thành `null`: một mảng có lỗ
      // buộc mọi client phải lọc, và bản quên lọc sẽ vỡ ở dòng render đầu tiên.
      out[f.key] = Array.isArray(v) ? v.map(render).filter(Boolean) : [];
    } else {
      out[f.key] = render(v) ?? null;
    }
  }
}

/* ── Danh sách ────────────────────────────────────────────────────────── */

export interface PublicListPayload {
  data: Record<string, unknown>[];
  meta: { page: number; pageSize: number; total: number; pageCount: number };
}

const emptyPage = (params: PublicParams): PublicListPayload => ({
  data: [],
  meta: { page: params.page, pageSize: params.pageSize, total: 0, pageCount: 0 },
});

export async function readPublicList(
  typeKey: string,
  sp: URLSearchParams,
): Promise<ReadResult<PublicListPayload>> {
  const shape = await shapeOf(typeKey);
  if (!shape) {
    return { ok: false, status: 404, error: `Không có loại nội dung "${typeKey}"`, code: 'unknown_type' };
  }

  const parsed = parsePublicParams(sp, typeKey, shape.fields, shape.schemaOf);
  if (!parsed.ok) return { ok: false, status: 400, error: parsed.error, code: 'bad_param' };
  const { params } = parsed;

  const now = new Date();

  // Khoá danh mục → id: client gõ được khoá, không gõ được cuid.
  let urlTaxonomyId: string | undefined;
  if (params.taxonomyKey) {
    const tax = await prisma.taxonomy.findUnique({
      where: { typeKey_key: { typeKey, key: params.taxonomyKey } },
      select: { id: true },
    });
    // Danh mục không tồn tại → danh sách RỖNG, không phải bỏ qua điều kiện. Bỏ qua
    // thì `?taxonomy=go-sai` trả về mọi bài, và client tưởng danh mục đó có mọi thứ.
    if (!tax) return { ok: true, payload: emptyPage(params) };
    urlTaxonomyId = tax.id;
  }

  // `locale` vào `ctx` — xem "vì sao" ở đầu file. Bỏ nó là rò bản dịch chưa duyệt.
  const args = buildEntryFindArgs(params.query, { now, urlTaxonomyId, locale: params.locale });

  const [rows, total] = await Promise.all([
    prisma.entry.findMany({
      where: args.where as Prisma.EntryWhereInput,
      orderBy: args.orderBy as Prisma.EntryOrderByWithRelationInput[],
      take: args.take,
      skip: args.skip,
      select: SELECT,
    }),
    prisma.entry.count({ where: args.where as Prisma.EntryWhereInput }),
  ]);

  const outFields = fieldsOf(shape, params);
  const datas = (rows as Row[]).map((r) => dataOf(r, params, seoKeyOf(shape.fields)));

  // Bản ghi đích TRƯỚC bảng asset: ảnh của field đích đã xin phải vào CÙNG lượt tra
  // `Asset`. Không có `populate` thì `relationTable` trả ngay, không truy vấn nào.
  const relations = await relationTable(datas, outFields, params.populate, now, params.locale);
  const defs = populateDefs(shape, outFields, params);
  const [assets, iframeHosts] = await Promise.all([
    assetsFor([...datas, ...populatedDatas(datas, defs, relations)]),
    allowedEmbedHostnames(),
  ]);

  return {
    ok: true,
    payload: {
      data: (rows as Row[]).map((r, i) => {
        const opts: ShapeOpts = { assets, format: params.format, iframeHosts };
        const out = toPublicData(datas[i]!, outFields, shape.groups, opts);
        applyPopulate(out, datas[i]!, outFields, params.populate, relations, defs, {
          groups: shape.groups,
          opts,
        });
        // Field nằm PHẲNG ngay trong object, không có lớp `attributes` — chính
        // Strapi v5 đã bỏ lớp đó, và bắt chước nó là bắt chước một quyết định đã
        // bị chính tác giả huỷ.
        return { ...out, ...systemKeys(r, params.locale) };
      }),
      meta: {
        page: params.page,
        pageSize: params.pageSize,
        total,
        pageCount: Math.ceil(total / params.pageSize),
      },
    },
  };
}

/* ── Một entry ────────────────────────────────────────────────────────── */

export async function readPublicOne(
  typeKey: string,
  slug: string,
  sp: URLSearchParams,
): Promise<ReadResult<{ data: Record<string, unknown> }>> {
  const shape = await shapeOf(typeKey);
  if (!shape) {
    return { ok: false, status: 404, error: `Không có loại nội dung "${typeKey}"`, code: 'unknown_type' };
  }

  // Dùng lại đúng bộ đọc tham số của danh sách: `format`, `locale`, `populate` và
  // `fields` phải có nghĩa GIỐNG HỆT ở hai endpoint, và một bản đọc riêng ở đây là chỗ
  // để chúng lệch nhau. Phần phân trang của kết quả bị bỏ qua — vô hại.
  const parsed = parsePublicParams(sp, typeKey, shape.fields, shape.schemaOf);
  if (!parsed.ok) return { ok: false, status: 400, error: parsed.error, code: 'bad_param' };
  const { params } = parsed;

  const now = new Date();

  /*
   * Có `?locale=` thì tra theo LUẬT SLUG CỦA NGÔN ngữ ĐÓ — hai bước của
   * `localizedSlugWheres`, cùng hàm mà đường site dùng.
   *
   * Trước đây nhánh này là một `findFirst` duy nhất trên `Entry.slug` + `Entry.status`,
   * nên `/news/august-rates-en?locale=en` trả 404 dù bản tiếng Anh đã đăng dưới đúng
   * slug đó (đo ngày 28/08/2026) — và slug đó chính là thứ endpoint danh sách trả ra.
   */
  const wheres: Record<string, unknown>[] = params.locale
    ? localizedSlugWheres(typeKey, slug, params.locale, now)
    : [{ typeKey, slug, archivedAt: null, ...publishWhere({ now }) }];

  let row: Row | null = null;
  for (const where of wheres) {
    row = (await prisma.entry.findFirst({
      where: where as Prisma.EntryWhereInput,
      select: SELECT,
    })) as Row | null;
    if (row) break;
  }
  // Không phân biệt "không có" / "còn nháp" / "hẹn giờ chưa tới": phân biệt là rò
  // rỉ sự tồn tại của một bài chưa đăng cho bất kỳ ai đoán được slug.
  if (!row) return { ok: false, status: 404, error: 'Không có nội dung này', code: 'not_found' };

  const outFields = fieldsOf(shape, params);
  const data = dataOf(row, params, seoKeyOf(shape.fields));

  const relations = await relationTable([data], outFields, params.populate, now, params.locale);
  const defs = populateDefs(shape, outFields, params);
  const [assets, iframeHosts] = await Promise.all([
    assetsFor([data, ...populatedDatas([data], defs, relations)]),
    allowedEmbedHostnames(),
  ]);

  const opts: ShapeOpts = { assets, format: params.format, iframeHosts };
  const out = toPublicData(data, outFields, shape.groups, opts);
  applyPopulate(out, data, outFields, params.populate, relations, defs, { groups: shape.groups, opts });

  return { ok: true, payload: { data: { ...out, ...systemKeys(row, params.locale) } } };
}

/* ── Schema ───────────────────────────────────────────────────────────── */

/**
 * Schema mọi loại — để mobile sinh model từ đây thay vì gõ tay.
 *
 * Trả cả `FieldDef` nguyên trạng: nó đã là một union có thẻ, đọc được, và là mô tả
 * chính xác nhất về thứ API sẽ trả. Rút gọn nó thành "tên + kiểu" là bỏ đi `max`,
 * `options`, `allowed` — đúng những thứ client cần để validate trước khi gửi.
 *
 * Không truy vấn nào ở đây: cả hai nguồn (`getCollectionTypes`, `publicGroupTable`) đã
 * cache theo `TYPES_TAG`. Sắp theo `key` chứ không theo thứ tự tạo — thứ tự phải ổn
 * định giữa hai lượt gọi, nếu không `ETag` đổi mà nội dung thì không.
 */
export async function readPublicTypes() {
  const [types, groups] = await Promise.all([getCollectionTypes(), publicGroupTable()]);
  return {
    data: [...types]
      .sort((a, b) => a.key.localeCompare(b.key))
      .map((t) => ({
        key: t.key, name: t.name, namePlural: t.namePlural,
        singleton: t.singleton, titleField: t.titleField, slugField: t.slugField,
        fields: t.schema,
      })),
    // Nhóm field đi kèm: không có chúng thì client không giải nghĩa được `group`
    // và `blocks` trong `fields` ở trên.
    fieldGroups: Object.entries(groups).map(([key, fields]) => ({ key, fields })),
  };
}

/* ── Danh mục ─────────────────────────────────────────────────────────── */

/**
 * Cây danh mục của một loại, kèm số bài đã đăng.
 *
 * Bọc `unstable_cache` với `revalidate: 300` — ĐÚNG con số mà header
 * `s-maxage` của route đã hứa, nên nó không thêm một độ trễ mới nào. Hệ quả phải nói
 * thẳng: `entryCount` đếm theo `publishedAt <= now`, và `now` nằm TRONG hàm được cache,
 * nên một bài hẹn giờ lên sóng làm con số này đúng muộn nhất là 300 giây (một lần ghi
 * thật thì `collectionTag` vô hiệu hoá ngay). Đổi lại: một lượt đọc mỗi 5 phút cho mỗi
 * loại, thay vì hai truy vấn cho mỗi lần mở app.
 */
export const readPublicTaxonomies = (typeKey: string) =>
  unstable_cache(
    async () => {
      const now = new Date();
      const [rows, counts] = await Promise.all([
        prisma.taxonomy.findMany({
          where: { typeKey },
          orderBy: [{ order: 'asc' }, { name: 'asc' }],
          select: { id: true, key: true, name: true, parentId: true },
        }),
        /*
         * Đếm CHỈ bài đã đăng và đã tới mốc.
         *
         * `_count` trên quan hệ đếm cả nháp và bài hẹn giờ — tức con số này sẽ nói cho
         * người ngoài biết có bao nhiêu bài chưa công bố trong một danh mục. Đó là rò
         * dữ liệu qua một con số, loại rò khó thấy nhất vì không có nội dung nào đi kèm.
         */
        prisma.entryTaxonomy.groupBy({
          by: ['taxonomyId'],
          where: {
            entry: {
              typeKey, status: 'published', archivedAt: null,
              publishedAt: { not: null, lte: now },
            },
          },
          _count: { entryId: true },
        }),
      ]);

      const keyById = new Map(rows.map((r) => [r.id, r.key]));
      const countById = new Map(counts.map((c) => [c.taxonomyId, c._count.entryId]));

      return {
        data: rows.map((r) => ({
          key: r.key,
          name: r.name,
          // Trả KHOÁ của cha, không phải id: id là cuid nội bộ, và để nó ra ngoài là
          // mời client lưu nó rồi phụ thuộc vào nó.
          parent: r.parentId ? (keyById.get(r.parentId) ?? null) : null,
          entryCount: countById.get(r.id) ?? 0,
        })),
      };
    },
    ['public-taxonomies', typeKey],
    { tags: [collectionTag(typeKey)], revalidate: 300 },
  )();
