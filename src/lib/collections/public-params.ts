/**
 * Query string → `CollectionQuery`.
 *
 * ## Vì sao mọi thứ đi qua danh sách trắng
 *
 * Đây là bề mặt DUY NHẤT của hệ thống nhận đầu vào từ một client mà ta không kiểm
 * soát. `sort=data->>"x"` và `filter[a][regex]=.*` là hai dòng đủ để biến một API
 * đọc thành một công cụ quét bảng. Danh sách trắng theo SCHEMA của loại nghĩa là
 * client chỉ hỏi được về thứ đang có.
 *
 * ## Vì sao `op` lạ bị TỪ CHỐI chứ không bị bỏ qua
 *
 * `filterToWhere` trong `query-build.ts` trả `null` cho một điều kiện không dựng
 * được, và `buildEntryFindArgs` LỌC BỎ mọi `null`. Nên một `op` lạ đi lọt tới đó
 * không làm truy vấn hỏng — nó làm điều kiện BIẾN MẤT, và API trả về NHIỀU HƠN thứ
 * client hỏi. Ở một API công khai, "nhiều hơn yêu cầu" là rò dữ liệu, không phải một
 * lỗi hiển thị. 400 ở đây là lớp duy nhất chặn được nó.
 *
 * ## Vì sao `skip` không nhận trực tiếp
 *
 * `page` × `pageSize` là hai con số client hiểu; `skip` là chi tiết cài đặt. Nhận
 * cả hai là hai cách nói một điều, và chúng sẽ mâu thuẫn nhau ở đúng request đầu
 * tiên có cả hai.
 */

import type { CollectionFilter, CollectionQuery, FilterOp } from '@/lib/doc/types';
import type { FieldDef } from './field-def';
import { SORTABLE_COLUMNS } from './query-build';

export const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 20;
/** Trần `populate`: sâu MỘT cấp, và không quá ngần này field. */
export const MAX_POPULATE = 5;
/** Trần số field xin cho MỘT quan hệ ở dạng `populate[field]=a,b`. */
export const MAX_POPULATE_FIELDS = 10;

/**
 * Kiểu field của bản ghi ĐÍCH xin được qua `populate[field]=…`.
 *
 * Danh sách trắng, không phải danh sách đen: kiểu field mới thêm vào `FieldDef` mặc
 * định KHÔNG đi qua đây cho tới khi có người cân nó. Bị loại có lý do:
 *
 *  - `richdoc`, `html`: thân bài, vài chục KB mỗi cái — đúng thứ mà "tóm tắt" của
 *    `populate` tồn tại để không kéo theo một danh sách 100 bài.
 *  - `group`, `blocks`, `json`: không có trần kích thước.
 *  - `relation`: cấp thứ hai, tức một cây join từ một URL.
 *  - `taxonomy`: không sống trong `data` (xem `toPublicData`).
 *  - `seo`: dữ liệu cho thẻ meta của trang đích, không phải nội dung để hiện kèm.
 *
 * `richtext` ĐƯỢC nhận: nó là một dòng chữ có định dạng (câu trả lời FAQ, mô tả ngắn),
 * không có tầng khối.
 */
export const POPULATE_FIELD_TYPES: ReadonlySet<FieldDef['t']> = new Set([
  'text', 'richtext', 'number', 'boolean', 'date', 'enum', 'image', 'file', 'link', 'slug',
]);

const POPULATE_RE = /^populate\[([a-z][a-z0-9_]*)\]$/;

const OPS: readonly FilterOp[] = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'contains'];

/**
 * Cột sắp xếp được — IMPORT, không khai lại.
 *
 * `query-build.ts` đã có `SORTABLE_COLUMNS` và `doc/schema.ts` dùng cùng khái niệm.
 * Một bản thứ ba ở đây nghĩa là nới một bên thì hai bên kia từ chối im lặng, và bên
 * từ chối sẽ là bên người dùng gặp. `query-build.ts` thuần (không `server-only`), nên
 * import được từ cả test lẫn route.
 */
const REAL_COLUMNS = SORTABLE_COLUMNS;

/**
 * Khoá hệ thống, luôn có mặt trong mỗi entry — `fields` không cần xin chúng.
 *
 * Nhận rồi bỏ qua chứ không từ chối: chúng CÓ ra ngoài thật, nên `fields=id,title` đã
 * nhận đúng thứ nó hỏi. Từ chối ở đây chỉ dạy client một luật không có ích.
 */
export const RESERVED_KEYS = ['id', 'slug', 'publishedAt', 'updatedAt', 'taxonomies'] as const;

export interface PublicParams {
  query: CollectionQuery;
  page: number;
  pageSize: number;
  locale?: string;
  format: 'json' | 'html';
  populate: string[];
  /**
   * Field của bản ghi ĐÍCH mà client xin, theo khoá quan hệ — chỉ có cho quan hệ xin
   * bằng dạng `populate[field]=a,b`. Quan hệ xin bằng dạng phẳng `populate=field`
   * vắng mặt ở đây và ra tóm tắt như cũ.
   */
  populateFields: Record<string, string[]>;
  /**
   * `undefined` = mọi field của schema (không có `?fields=`).
   *
   * `[]` KHÁC `undefined`: nó là "chỉ xin khoá hệ thống" — `?fields=id,slug`, đúng thứ
   * một client cần để đồng bộ danh sách id mà không tải nội dung.
   */
  fields?: string[];
  taxonomyKey?: string;
}

export type ParamsResult =
  | { ok: true; params: PublicParams }
  | { ok: false; error: string };

const FILTER_RE = /^filter\[([a-z][a-z0-9_]*)\]\[([a-z]+)\]$/;
/** `vi`, `en-US`, `zh-Hant-TW`. Đủ rộng cho BCP-47 thật, đủ hẹp để không là chuỗi tuỳ ý. */
const LOCALE_RE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

function intOr(raw: string | null, fallback: number, min: number, max: number): number {
  if (raw === null || raw.trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) return fallback;
  return n;
}

/** Ép theo KIỂU FIELD, không theo hình dạng chuỗi: 'true' cho field text là chữ. */
function coerce(f: FieldDef, raw: string): string | number | boolean {
  if (f.t === 'boolean') return raw === 'true';
  if (f.t === 'number') {
    const n = Number(raw);
    return Number.isFinite(n) && raw.trim() !== '' ? n : raw;
  }
  return raw;
}

/**
 * `targetFields` tra cấu trúc của loại ĐÍCH theo khoá — cần cho dạng
 * `populate[field]=a,b`, nơi tên field thuộc về loại khác loại đang đọc. Vắng nó thì
 * dạng ấy bị 400 thay vì đi qua không kiểm.
 */
export function parsePublicParams(
  sp: URLSearchParams,
  typeKey: string,
  fields: FieldDef[],
  targetFields?: (typeKey: string) => FieldDef[] | undefined,
): ParamsResult {
  const byKey = new Map(fields.map((f) => [f.key, f]));

  const page = intOr(sp.get('page'), 1, 1, 100000);
  const pageSize = Math.min(intOr(sp.get('pageSize'), DEFAULT_PAGE_SIZE, 1, 1e9), MAX_PAGE_SIZE);

  // ── sort
  const sort: { field: string; dir: 'asc' | 'desc' }[] = [];
  for (const raw of sp.getAll('sort')) {
    const [field, dir = 'desc'] = raw.split(':');
    if (!field) return { ok: false, error: 'sort không hợp lệ' };
    if (dir !== 'asc' && dir !== 'desc') {
      return { ok: false, error: `Chiều sắp xếp "${dir}" không hợp lệ; dùng asc hoặc desc` };
    }
    // CHỈ cột thật — KHÔNG chấp nhận field trong schema, dù `byKey.has(field)` đúng.
    // Prisma không `orderBy` được theo đường dẫn trong JSONB (xem `SORTABLE_COLUMNS`
    // ở `query-build.ts`); cho field schema đi qua ở đây rồi rơi mất ở tầng dưới là
    // một request 200 nhưng thứ tự sai mà không ai biết.
    if (!(REAL_COLUMNS as readonly string[]).includes(field)) {
      return {
        ok: false,
        error: `Không sắp xếp được theo "${field}" — chỉ nhận ${REAL_COLUMNS.join(', ')}`,
      };
    }
    sort.push({ field, dir });
  }

  // ── filter
  const filter: CollectionFilter[] = [];
  for (const [key, value] of sp.entries()) {
    const m = FILTER_RE.exec(key);
    if (!m) continue;
    const field = m[1]!;
    const op = m[2]!;
    const def = byKey.get(field);
    if (!def) return { ok: false, error: `Không có field "${field}"` };
    if (!(OPS as readonly string[]).includes(op)) {
      return { ok: false, error: `Toán tử "${op}" không hợp lệ; chỉ nhận ${OPS.join(', ')}` };
    }
    /*
     * Field kiểu `slug` KHÔNG lọc được, và đây là ca tệ hơn "không chạy": nó chạy MỘT
     * PHẦN.
     *
     * Giá trị slug hiệu lực sống ở CỘT `Entry.slug`; `data.slug` chỉ có khi biên tập
     * viên gõ tay ô đó (xem `deriveSlug` ở `entry-write.ts`). Filter ở đây đi vào đường
     * dẫn JSONB, nên `filter[slug][eq]=...` khớp những bài có người gõ slug và BỎ SÓT
     * những bài để hệ thống tự sinh — đo ngày 28/08/2026: entry seed trả `total: 0`
     * trong khi response hiển thị đúng slug đó. Một filter đúng một phần là thứ không
     * ai phát hiện, vì nó luôn trả về "một ít" kết quả.
     *
     * Lấy một bài theo slug là việc của `/{typeKey}/{slug}`; sắp theo slug thì dùng
     * `sort=slug`, vốn đi vào cột thật.
     */
    if (def.t === 'slug') {
      return {
        ok: false,
        error: `Không lọc được theo field slug "${field}" — dùng /${typeKey}/{slug} để lấy một bài, hoặc sort=slug`,
      };
    }
    filter.push({ k: 'field', field, op: op as FilterOp, value: coerce(def, value) });
  }

  const taxonomyKey = sp.get('taxonomy') ?? undefined;
  // `from: 'url'` chứ không `'fixed'`: id danh mục là cuid nội bộ, và chỗ đổi
  // khoá→id là `public-read.ts`, nơi có DB. Ở đây chỉ ghi nhận rằng có điều kiện.
  if (taxonomyKey) filter.push({ k: 'taxonomy', from: 'url' });

  // ── populate: CHỈ field relation, sâu MỘT cấp
  const populate = (sp.get('populate') ?? '').split(',').map((s) => s.trim()).filter(Boolean);

  /*
   * Dạng `populate[field]=a,b`: field của bản ghi đích, ngoài tóm tắt.
   *
   * Trước khi có nhánh này, `populate[author]=name` không khớp khoá nào và bị BỎ QUA —
   * 200, trả id trần, đúng cái "nhận rồi im lặng" mà file này từ chối ở mọi chỗ khác.
   */
  const populateFields: Record<string, string[]> = {};
  for (const [key, value] of sp.entries()) {
    const m = POPULATE_RE.exec(key);
    if (!m) continue;
    const rel = m[1]!;
    const def = byKey.get(rel);
    if (!def || def.t !== 'relation') {
      return { ok: false, error: `Không populate được "${rel}" — chỉ field relation` };
    }
    if (populate.includes(rel) || rel in populateFields) {
      return { ok: false, error: `"${rel}" được xin populate hai lần — chọn một dạng` };
    }
    const asked = value.split(',').map((s) => s.trim()).filter(Boolean);
    if (!asked.length) {
      return { ok: false, error: `populate[${rel}] cần ít nhất một field; muốn tóm tắt thì dùng populate=${rel}` };
    }
    if (asked.length > MAX_POPULATE_FIELDS) {
      return { ok: false, error: `populate[${rel}] tối đa ${MAX_POPULATE_FIELDS} field` };
    }
    const targetSchema = targetFields?.(def.typeKey);
    if (!targetSchema) {
      return { ok: false, error: `Không tra được cấu trúc loại "${def.typeKey}" của "${rel}"` };
    }
    const targetByKey = new Map(targetSchema.map((f) => [f.key, f]));
    for (const k of asked) {
      const tf = targetByKey.get(k);
      if (!tf) return { ok: false, error: `Loại "${def.typeKey}" không có field "${k}"` };
      if (!POPULATE_FIELD_TYPES.has(tf.t)) {
        return {
          ok: false,
          error: `Field "${k}" của "${def.typeKey}" là ${tf.t} — không xin được qua populate`,
        };
      }
    }
    populateFields[rel] = [...new Set(asked)];
    populate.push(rel);
  }

  if (populate.length > MAX_POPULATE) {
    return { ok: false, error: `populate tối đa ${MAX_POPULATE} field` };
  }
  for (const key of populate) {
    const def = byKey.get(key);
    /*
     * Field `taxonomy` KHÔNG populate được, và trước đây nó ĐƯỢC NHẬN.
     *
     * `applyPopulate` chỉ xử lý `relation`, nên `?populate=cats` trả 200 và không đổi
     * gì — đúng cái "nhận rồi im lặng bỏ qua" mà cả file này từ chối làm với `sort` và
     * `filter`. Danh mục vốn đã đi kèm mỗi entry ở khoá `taxonomies` (`key` + `name`),
     * nên không có gì để mở thêm.
     */
    if (!def || def.t !== 'relation') {
      return { ok: false, error: `Không populate được "${key}" — chỉ field relation` };
    }
  }

  /*
   * ── fields: client quyết payload, không phải backend
   *
   * Không có nó thì một màn danh sách chỉ cần tiêu đề + ảnh bìa vẫn phải tải cả thân
   * bài: đo ngày 28/08/2026, 100 bài = 127KB, phần lớn là `body`. Và cách duy nhất để
   * giảm sẽ là đổi shape ở backend — tức mọi client khác phải sửa theo.
   *
   * Field `taxonomy` bị từ chối vì nó không có khoá trong `data` (xem `toPublicData`);
   * nhận nó là hứa một thứ không tồn tại.
   */
  const asked = (sp.get('fields') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  let sparse: string[] | undefined;
  if (asked.length) {
    for (const key of asked) {
      if ((RESERVED_KEYS as readonly string[]).includes(key)) continue;
      const def = byKey.get(key);
      if (!def) return { ok: false, error: `Không có field "${key}"` };
      if (def.t === 'taxonomy') {
        return {
          ok: false,
          error: `Field "${key}" là danh mục — đọc ở khoá taxonomies, không xin qua fields`,
        };
      }
    }
    // Khoá hệ thống bị LỌC BỎ khỏi danh sách: chúng luôn ra ngoài, nên để chúng lẫn
    // vào đây làm phép chiếu phải biết chúng là ngoại lệ.
    sparse = asked.filter((k) => !(RESERVED_KEYS as readonly string[]).includes(k));

    /*
     * `populate` một field KHÔNG có trong `fields` là một mâu thuẫn, và nó phải nổ.
     *
     * Hai cách sai đều tệ: tự thêm field đó vào `fields` là trả về nhiều hơn client
     * hỏi; bỏ qua nó là trả về ít hơn client hỏi, im lặng — và người viết client sẽ
     * đi tìm lỗi ở tầng decode.
     */
    const missing = populate.filter((k) => !sparse!.includes(k));
    if (missing.length) {
      return {
        ok: false,
        error: `populate="${missing.join(',')}" nhưng fields không xin field đó — thêm nó vào fields`,
      };
    }
  }

  const format = sp.get('format') ?? 'json';
  if (format !== 'json' && format !== 'html') {
    return { ok: false, error: 'format chỉ nhận json hoặc html' };
  }

  const locale = sp.get('locale') ?? undefined;
  if (locale !== undefined && !LOCALE_RE.test(locale)) {
    return { ok: false, error: `Mã ngôn ngữ "${locale}" không hợp lệ` };
  }

  return {
    ok: true,
    params: {
      query: {
        typeKey,
        filter: filter.length ? filter : undefined,
        sort: sort.length ? sort : [{ field: 'publishedAt', dir: 'desc' }],
        limit: pageSize,
        skip: (page - 1) * pageSize,
      },
      page,
      pageSize,
      locale,
      format,
      populate,
      populateFields,
      fields: sparse,
      taxonomyKey,
    },
  };
}
