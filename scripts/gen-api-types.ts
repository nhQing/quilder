/**
 * `/api/public/v1/types` → một file `.d.ts` cho client.
 *
 * ## Vì sao script này tồn tại
 *
 * Câu hỏi thật của team FE/mobile không phải "API có những endpoint nào" mà "API đổi
 * thì tôi phải sửa bao nhiêu". Tài liệu không trả lời được câu đó: một biên tập viên
 * đổi cấu trúc lúc 10 giờ sáng không sửa tài liệu, và client biết bằng cách vỡ lúc
 * render.
 *
 * Sinh kiểu TỪ CHÍNH API thì đổi cấu trúc trở thành một LỖI BIÊN DỊCH ở client, ngay
 * lúc chạy lại script — sớm nhất có thể, và ở chỗ có người đang đọc. Đó là toàn bộ giá
 * trị của `/types` trả về `FieldDef` nguyên trạng thay vì một bản rút gọn.
 *
 * ## Chạy
 *
 *   pnpm api:types                                    # đọc localhost:3001, ghi generated/
 *   pnpm api:types --url https://site/api/public/v1/types --out ../mobile/src/api.d.ts
 *
 * ## Ba luật của phần kiểu sinh ra
 *
 *  1. **Mảng luôn là mảng.** `richtext`, `richdoc`, `blocks`, ảnh `multiple`, nhóm lặp,
 *     `relation many` KHÔNG bao giờ `null` (xem `emptyOut` ở `public-shape.ts`), nên
 *     client không phải khai optional và không phải viết `?? []`.
 *  2. **Scalar luôn có thể `null`.** Kể cả field `required: true`: `required` được
 *     cưỡng chế ở ĐƯỜNG GHI, còn một entry đăng TRƯỚC khi field đó tồn tại vẫn hợp lệ
 *     và vẫn đi ra ngoài với giá trị rỗng. Sinh ra `string` (không `| null`) cho những
 *     field đó là một lời hứa mà backend không giữ được.
 *  3. **Field `taxonomy` không có mặt.** Giá trị của nó không sống trong `data`; danh
 *     mục ra ngoài ở khoá `taxonomies` cấp entry.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import type { FieldDef } from '../src/lib/collections/field-def';

interface PublicType {
  key: string;
  name: string;
  namePlural: string;
  singleton: boolean;
  titleField: string;
  slugField: string | null;
  fields: FieldDef[];
}

interface TypesPayload {
  data: PublicType[];
  fieldGroups: { key: string; fields: FieldDef[] }[];
}

/* ── Tham số dòng lệnh ────────────────────────────────────────────────── */

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}

const URL_TYPES = arg('url', 'http://localhost:3001/api/public/v1/types');
const OUT = resolve(arg('out', 'generated/public-api.d.ts'));

/* ── Tên ──────────────────────────────────────────────────────────────── */

/**
 * `tin-tuc` → `TinTuc`. Khoá loại là chữ thường + gạch (`zKey`), nên phép đổi này
 * không mất thông tin và luôn cho một tên TS hợp lệ.
 */
function pascal(key: string): string {
  const out = key
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((s) => s[0]!.toUpperCase() + s.slice(1))
    .join('');
  // Khoá bắt đầu bằng số là hợp lệ ở DB nhưng không hợp lệ làm tên TS.
  return /^[0-9]/.test(out) ? `T${out}` : out;
}

const groupName = (key: string) => `Group${pascal(key)}`;

/* ── FieldDef → kiểu TS ───────────────────────────────────────────────── */

function tsType(f: FieldDef): string {
  switch (f.t) {
    case 'text':
    case 'slug':
    case 'link':
      return 'string | null';
    case 'date':
      /** ISO-8601. Không sinh `Date`: JSON không có kiểu ngày, và bộ decode tự chọn. */
      return 'string | null';
    case 'enum': {
      // Union literal, không phải `string`: đó là toàn bộ lý do khai `options` trong
      // schema, và nó biến một `switch` thiếu nhánh ở client thành lỗi biên dịch.
      const lits = f.options.map((o) => JSON.stringify(o.value)).join(' | ');
      return lits ? `${lits} | null` : 'string | null';
    }
    case 'number':
      return 'number | null';
    case 'boolean':
      return 'boolean | null';
    case 'richtext':
      return 'InlineNode[]';
    case 'richdoc':
      return 'Block[]';
    case 'image':
      return f.multiple ? 'PublicAsset[]' : 'PublicAsset | null';
    case 'file':
      return 'PublicAsset | null';
    case 'relation':
      // `RelationRef` chứ không phải `string`: `?populate=` đổi id thành tóm tắt, nên
      // hai hình dạng đều hợp lệ trên cùng một field. Client hẹp bằng
      // `typeof x === 'string'`.
      return f.cardinality === 'many' ? 'RelationRef[]' : 'RelationRef | null';
    case 'group':
      return f.repeatable ? `${groupName(f.groupKey)}[]` : `${groupName(f.groupKey)} | null`;
    case 'blocks': {
      // Mỗi khối mang `__type` — đó là thẻ để phân biệt, nên union có thẻ là kiểu đúng.
      const union = f.allowed
        .map((k) => `({ __type: ${JSON.stringify(k)} } & ${groupName(k)})`)
        .join(' | ');
      return union ? `Array<${union}>` : 'Array<{ __type: string }>';
    }
    case 'json':
      return 'unknown';
    // `null` khi bài chưa đặt ô nào (kể cả `{}`); có thì mọi khoá đều có mặt — xem `fieldOut`.
    case 'seo':
      return 'SeoValue | null';
    /*
     * `string`, KHÔNG `string | null`.
     *
     * `emptyOut` trong `public-shape.ts` trả `''` cho field `html` — chuỗi rỗng, ở
     * cả hai format, kể cả khi giá trị vắng mặt hoặc sai hình dạng. Sinh `| null`
     * ở đây là bắt mọi client kiểm một ca không bao giờ xảy ra.
     *
     * Thiếu nhánh này thì `switch` không còn toàn phần, và lỗi hiện ra ở dạng
     * "Function lacks ending return statement" — một câu không nói gì về việc
     * `FieldDef` vừa có thêm một kiểu. Đó là cái giá của việc trông cậy vào tính
     * toàn phần thay vì một `default` bịa ra.
     */
    case 'html':
      return 'string';
    case 'taxonomy':
      // Không có mặt — chỗ gọi đã lọc, nhánh này chỉ để `switch` là toàn phần.
      return 'never';
  }
}

/**
 * Khoá hệ thống THẮNG khoá field — cùng luật với `public-read.ts`.
 *
 * Một loại có field kiểu `slug` với khoá `slug` là chuyện bình thường (mọi loại mặc
 * định đều có). Nhưng giá trị đi ra ngoài là `Entry.slug` (luôn có), không phải
 * `data.slug` (có thể rỗng) — nên sinh lại khoá đó từ schema là khai `slug: string |
 * null` chồng lên `slug: string` của `EntrySystemKeys`, và cả file không biên dịch được.
 */
const RESERVED = new Set(['id', 'slug', 'publishedAt', 'updatedAt', 'taxonomies']);

function fieldLines(fields: FieldDef[], indent = '  ', skipReserved = false): string {
  return fields
    .filter((f) => f.t !== 'taxonomy')
    .filter((f) => !(skipReserved && RESERVED.has(f.key)))
    .map((f) => {
      const label = f.label ? `${indent}/** ${f.label} */\n` : '';
      return `${label}${indent}${f.key}: ${tsType(f)};`;
    })
    .join('\n');
}

/* ── Phần khung, giống nhau cho mọi site ──────────────────────────────── */

const PRELUDE = `/**
 * SINH TỰ ĐỘNG từ \`GET /api/public/v1/types\` — KHÔNG sửa tay.
 *
 * Sinh lại:  pnpm api:types --url <BASE>/api/public/v1/types --out <file này>
 *
 * Ba luật (xem \`scripts/gen-api-types.ts\`):
 *  1. Field hình dạng mảng KHÔNG BAO GIỜ \`null\` — khỏi phải \`?? []\`.
 *  2. Field scalar LUÔN có thể \`null\`, kể cả khi schema khai \`required\`.
 *  3. Field \`taxonomy\` không có mặt — danh mục ở khoá \`taxonomies\` cấp entry.
 *
 * Với \`?format=html\`, mọi field \`richtext\`/\`richdoc\` trả \`string\` (HTML đã escape)
 * thay cho \`InlineNode[]\`/\`Block[]\`; dùng \`HtmlOf<T>\` nếu client đi đường đó.
 */

/* eslint-disable */

/** Ảnh/tệp. \`assetId\` cố ý KHÔNG có ở bất kỳ đâu trong API. */
export interface PublicAsset {
  url: string;
  width: number | null;
  height: number | null;
  /** Placeholder mượt mà không cần thêm một lượt gọi. */
  blurhash: string | null;
  mime: string;
  alt: string | null;
}

/**
 * Tóm tắt một entry được \`?populate=\` mở ra. Một cấp, không sâu hơn.
 *
 * Xin bằng \`?populate[field]=a,b\` thì object có thêm đúng các field đó của loại đích —
 * kiểu của chúng là kiểu field của loại đích, nên ở đây để mở.
 */
export interface RelationSummary {
  id: string;
  slug: string;
  title: string | null;
  publishedAt: string | null;
  [field: string]: unknown;
}

/** Chưa \`populate\` là id; đã \`populate\` là tóm tắt. */
export type RelationRef = string | RelationSummary;

/** Node inline của \`richtext\`. */
export type InlineNode =
  | { t: 'text'; v: string }
  | { t: 'strong'; children: InlineNode[] }
  | { t: 'em'; children: InlineNode[] }
  | { t: 'br' }
  | { t: 'link'; href: string; children: InlineNode[] }
  | { t: 'split'; mode?: string; children: InlineNode[] }
  | { t: 'counter'; to: number; decimals?: number; suffix?: string }
  | { t: 'bind'; ref: string; fallback: string };

/** Khối của \`richdoc\`. Khối \`figure\` mang ảnh THẬT, không mang \`assetId\`. */
export type Block =
  | { b: 'p' | 'h2' | 'h3' | 'h4'; children: InlineNode[] }
  | { b: 'ul' | 'ol'; items: { children: InlineNode[] }[] }
  | { b: 'quote'; children: InlineNode[] }
  | { b: 'figure'; image: PublicAsset | null; alt: string; decorative?: boolean; caption?: InlineNode[] }
  | { b: 'hr' };

/** Danh mục của một entry — KHOÁ và tên, không phải id nội bộ. */
export interface TaxonomyRef {
  key: string;
  name: string;
}

/**
 * Field \`seo\` — GIÁ TRỊ GHI ĐÈ của bài (đã phủ ngôn ngữ khi có \`?locale=\`), không phải
 * giá trị site đang dùng. Trống thì site tự suy ra: \`metaTitle ?? <tiêu đề bài>\`.
 */
export interface SeoValue {
  metaTitle: string | null;
  metaDescription: string | null;
  keywords: string | null;
  ogImage: PublicAsset | null;
  /** Đường dẫn trên site, ví dụ \`/blogs/post/abc\` — không bao giờ URL tuyệt đối. */
  canonicalUrl: string | null;
  noindex: boolean;
  /** JSON-LD tự khai. */
  structuredData: Record<string, unknown> | Record<string, unknown>[] | null;
}

/** Năm khoá hệ thống, có mặt trong MỌI entry. */
export interface EntrySystemKeys {
  id: string;
  /** Slug HIỆU LỰC của ngôn ngữ đang phục vụ — dựng URL chi tiết từ đây. */
  slug: string;
  publishedAt: string | null;
  updatedAt: string;
  taxonomies: TaxonomyRef[];
}

/** Envelope của endpoint danh sách. */
export interface ListResponse<T> {
  data: T[];
  meta: { page: number; pageSize: number; total: number; pageCount: number };
}

/** Envelope của endpoint một entry. */
export interface OneResponse<T> {
  data: T;
}

/** Lỗi. Rẽ nhánh theo \`code\` (tập đóng), KHÔNG theo câu tiếng Việt trong \`error\`. */
export interface PublicError {
  error: string;
  code: 'bad_param' | 'unknown_type' | 'not_found' | 'unknown_view' | 'view_invalid';
}

/** Hình dạng khi gọi \`?format=html\`: cây chữ thành chuỗi HTML. */
export type HtmlOf<T> = {
  [K in keyof T]: T[K] extends InlineNode[] | Block[] ? string : T[K];
};
`;

/* ── Dựng file ───────────────────────────────────────────────────────── */

function render(payload: TypesPayload): string {
  const parts: string[] = [PRELUDE];

  parts.push('/* ── Nhóm field ─────────────────────────────────────────── */\n');
  for (const g of payload.fieldGroups) {
    parts.push(`export interface ${groupName(g.key)} {\n${fieldLines(g.fields)}\n}\n`);
  }

  parts.push('/* ── Loại nội dung ──────────────────────────────────────── */\n');
  for (const t of payload.data) {
    const name = pascal(t.key);
    const notes = [
      `Khoá API: \`${t.key}\` — \`GET /api/public/v1/${t.key}\``,
      t.singleton
        ? 'SINGLETON: danh sách luôn có nhiều nhất MỘT phần tử — đọc `data[0] ?? null`.'
        : t.slugField
          ? `Chi tiết: \`GET /api/public/v1/${t.key}/{slug}\``
          : 'Loại này KHÔNG có trang chi tiết (`slugField` rỗng).',
    ];
    parts.push(
      `/**\n * ${t.name}\n *\n${notes.map((n) => ` * ${n}`).join('\n')}\n */\n` +
        `export interface ${name} extends EntrySystemKeys {\n${fieldLines(t.fields, '  ', true)}\n}\n`,
    );
  }

  /*
   * Bảng tra khoá → kiểu.
   *
   * Nó là thứ làm một hàm gọi API có kiểu chặt mà không cần khai lại từng loại:
   *
   *   function list<K extends PublicCollectionKey>(k: K): Promise<ListResponse<PublicEntry[K]>>
   *
   * Thiếu bảng này thì mỗi chỗ gọi phải tự nhớ loại nào ứng với khoá nào, và bản nhớ
   * sai là một `as` không ai kiểm được.
   */
  const keys = payload.data.map((t) => JSON.stringify(t.key)).join(' | ') || 'never';
  const rows = payload.data
    .map((t) => `  ${JSON.stringify(t.key)}: ${pascal(t.key)};`)
    .join('\n');
  parts.push(
    '/* ── Bảng tra ───────────────────────────────────────────── */\n\n' +
      `export type PublicCollectionKey = ${keys};\n\n` +
      `export interface PublicEntry {\n${rows}\n}\n\n` +
      'export type PublicSingletonKey = ' +
      (payload.data.filter((t) => t.singleton).map((t) => JSON.stringify(t.key)).join(' | ') ||
        'never') +
      ';\n',
  );

  return parts.join('\n');
}

async function main(): Promise<void> {
  const res = await fetch(URL_TYPES, { headers: { accept: 'application/json' } });
  if (!res.ok) {
    // Nói rõ URL: lỗi hay gặp nhất là chạy khi server chưa bật, hoặc gõ sai cổng.
    throw new Error(`Đọc ${URL_TYPES} thất bại: HTTP ${res.status}`);
  }
  const payload = (await res.json()) as TypesPayload;
  if (!Array.isArray(payload.data)) {
    throw new Error(`${URL_TYPES} không trả về { data: [...] } — đúng URL /types chưa?`);
  }

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, render(payload), 'utf8');

  const n = payload.data.length;
  const g = payload.fieldGroups.length;
  console.log(`Đã ghi ${OUT}\n  ${n} loại nội dung, ${g} nhóm field, nguồn: ${URL_TYPES}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
