/**
 * Bộ field type của collection — ĐÓNG, đúng tinh thần 9 primitive node bị đóng băng.
 *
 * ## Vì sao đóng
 *
 * Cho tự do định nghĩa field type là mở lại đúng lỗ hổng mà `Len` và `ColorValue`
 * được thiết kế để bịt: một chuỗi tự do đi từ UI xuống render. Năng lực mới đến
 * qua `FieldGroupDef`, không qua kiểu mới — giống hệt "năng lực mới đến qua effect
 * và preset".
 *
 * KHÔNG có `import 'server-only'`: file này thuần, và cả form admin (client) lẫn
 * API (server) đều đọc nó.
 */

import { z } from 'zod';

import { viMessage, viPath } from './zod-vi';

export const FIELD_TYPES = [
  'text', 'richtext', 'richdoc', 'html', 'number', 'boolean', 'date', 'enum',
  'image', 'file', 'slug', 'relation', 'taxonomy', 'link',
  'group', 'blocks', 'json', 'seo',
] as const;

export type FieldType = (typeof FIELD_TYPES)[number];

export type FieldDef =
  | { t: 'text'; key: string; label: string; required?: boolean; unique?: boolean; multiline?: boolean; maxLength?: number; help?: string }
  | { t: 'richtext'; key: string; label: string; required?: boolean; maxLength?: number; help?: string }
  | { t: 'richdoc'; key: string; label: string; required?: boolean; maxBlocks?: number; maxChars?: number; help?: string }
  | { t: 'html'; key: string; label: string; required?: boolean; maxChars?: number; help?: string }
  | { t: 'number'; key: string; label: string; required?: boolean; min?: number; max?: number; format?: 'number' | 'currencyVND'; help?: string }
  | { t: 'boolean'; key: string; label: string; default?: boolean; help?: string }
  | { t: 'date'; key: string; label: string; required?: boolean; withTime?: boolean; help?: string }
  | { t: 'enum'; key: string; label: string; options: { value: string; label: string }[]; required?: boolean; help?: string }
  | { t: 'image'; key: string; label: string; required?: boolean; multiple?: boolean; requireAlt?: boolean; help?: string }
  | { t: 'file'; key: string; label: string; required?: boolean; accept?: string[]; help?: string }
  | { t: 'slug'; key: string; label: string; from: string; help?: string }
  | { t: 'relation'; key: string; label: string; typeKey: string; cardinality: 'one' | 'many'; help?: string }
  | { t: 'taxonomy'; key: string; label: string; required?: boolean; multiple?: boolean; help?: string }
  | { t: 'link'; key: string; label: string; required?: boolean; help?: string }
  | { t: 'group'; key: string; label: string; groupKey: string; repeatable?: boolean; max?: number; help?: string }
  | { t: 'blocks'; key: string; label: string; allowed: string[]; max?: number; help?: string }
  | { t: 'json'; key: string; label: string; help?: string }
  | { t: 'seo'; key: string; label: string; help?: string };

/**
 * Khoá field đi vào URL của API (`?filter[title][eq]=`), vào `path` của binding,
 * và vào tên thuộc tính JSON mà mobile đọc. Cho ký tự ngoài bộ này là mở đường cho
 * ba chỗ đó lệch nhau về cách escape.
 */
const zKey = z
  .string()
  .min(1)
  .max(40)
  .regex(/^[a-z][a-z0-9_]*$/, 'Khoá field chỉ gồm a-z, 0-9, _ và bắt đầu bằng chữ');

const zLabel = z.string().min(1).max(80);
const zHelp = z.string().max(200).optional();

/**
 * `.strict()` ở MỌI nhánh, có chủ đích: một khoá gõ sai (`maxLenght`) im lặng bị
 * bỏ qua nghĩa là cấu hình biến mất mà không ai biết, và nó chỉ lộ ra khi có người
 * nhập quá dài mà không bị chặn.
 */
export const zFieldDef: z.ZodType<FieldDef> = z.discriminatedUnion('t', [
  z.object({ t: z.literal('text'), key: zKey, label: zLabel, required: z.boolean().optional(), unique: z.boolean().optional(), multiline: z.boolean().optional(), maxLength: z.number().int().positive().max(20000).optional(), help: zHelp }).strict(),
  z.object({ t: z.literal('richtext'), key: zKey, label: zLabel, required: z.boolean().optional(), maxLength: z.number().int().positive().max(200000).optional(), help: zHelp }).strict(),
  /*
   * `richdoc` đo bằng HAI trần chứ không phải một `maxLength`.
   *
   * `maxChars` đếm trên `plainText` — người viết nghĩ bằng số chữ, không bằng số
   * byte JSON, và một tài liệu 2000 chữ có thể là 40KB JSON tuỳ mức lồng inline.
   * `maxBlocks` chặn một trục khác hẳn: một cú dán từ Word có thể sinh vài nghìn
   * đoạn rỗng mà tổng số chữ vẫn nhỏ, và chi phí render tỉ lệ với số khối.
   * Xem `entry-data.ts` cho chỗ cưỡng chế.
   */
  z.object({ t: z.literal('richdoc'), key: zKey, label: zLabel, required: z.boolean().optional(), maxBlocks: z.number().int().positive().max(5000).optional(), maxChars: z.number().int().positive().max(200000).optional(), help: zHelp }).strict(),
  /*
   * `html` — thân bài dạng CHUỖI HTML, ô soạn là CKEditor 5.
   *
   * ## Vì sao có kiểu này khi đã có `richdoc`
   *
   * `richdoc` là danh sách trắng ở tầng ĐỊNH DẠNG: chỉ đúng `p|h2|h3|h4`, danh sách
   * một tầng, `quote`, `figure`, `hr`. Bảng, iframe, `h1`/`h5`/`h6`, `<u>`, `<s>`,
   * `<mark>`, `<sup>`, `<sub>`, màu chữ, canh lề, cột — không thứ nào biểu diễn được,
   * và thêm từng thứ nghĩa là thêm một nhánh vào `zRichDoc`, một nhánh vào renderer
   * JSX, một nhánh vào bộ chuyển đổi ô soạn, một nhánh vào `plainDoc`, một nhánh vào
   * `public-shape`. `html` đổi phép giới hạn từ "kể tên từng khối" sang "danh sách
   * trắng thẻ + thuộc tính + giá trị style", nơi thêm một thẻ là thêm một dòng.
   *
   * ## Cái giá, nói thẳng
   *
   * Giá trị là chuỗi đi vào `dangerouslySetInnerHTML`. Toàn bộ an toàn của kiểu này
   * nằm ở `html-sanitize.ts` và ở việc nó được gọi ở CẢ đường ghi (`entry-data.ts`)
   * lẫn đường đọc (renderer). `richdoc` không cần thứ đó vì React tự escape mọi
   * chuỗi. Đây là đánh đổi có ý thức: năng lực soạn thảo đầy đủ, trả bằng một tầng
   * làm sạch phải được kiểm bằng test.
   *
   * KHÔNG có `maxBlocks`: khối trong HTML không đếm được mà không dựng cây, và
   * `maxChars` (đếm trên chữ sau khi bỏ thẻ) chặn đúng trục mà người đặt trần nghĩ tới.
   */
  z.object({ t: z.literal('html'), key: zKey, label: zLabel, required: z.boolean().optional(), maxChars: z.number().int().positive().max(400000).optional(), help: zHelp }).strict(),
  z.object({ t: z.literal('number'), key: zKey, label: zLabel, required: z.boolean().optional(), min: z.number().optional(), max: z.number().optional(), format: z.enum(['number', 'currencyVND']).optional(), help: zHelp }).strict(),
  z.object({ t: z.literal('boolean'), key: zKey, label: zLabel, default: z.boolean().optional(), help: zHelp }).strict(),
  z.object({ t: z.literal('date'), key: zKey, label: zLabel, required: z.boolean().optional(), withTime: z.boolean().optional(), help: zHelp }).strict(),
  z.object({ t: z.literal('enum'), key: zKey, label: zLabel, options: z.array(z.object({ value: z.string().min(1).max(60), label: zLabel }).strict()).min(1), required: z.boolean().optional(), help: zHelp }).strict(),
  z.object({ t: z.literal('image'), key: zKey, label: zLabel, required: z.boolean().optional(), multiple: z.boolean().optional(), requireAlt: z.boolean().optional(), help: zHelp }).strict(),
  z.object({ t: z.literal('file'), key: zKey, label: zLabel, required: z.boolean().optional(), accept: z.array(z.string().max(40)).max(20).optional(), help: zHelp }).strict(),
  z.object({ t: z.literal('slug'), key: zKey, label: zLabel, from: zKey, help: zHelp }).strict(),
  z.object({ t: z.literal('relation'), key: zKey, label: zLabel, typeKey: z.string().min(1).max(40), cardinality: z.enum(['one', 'many']), help: zHelp }).strict(),
  z.object({ t: z.literal('taxonomy'), key: zKey, label: zLabel, required: z.boolean().optional(), multiple: z.boolean().optional(), help: zHelp }).strict(),
  z.object({ t: z.literal('link'), key: zKey, label: zLabel, required: z.boolean().optional(), help: zHelp }).strict(),
  z.object({ t: z.literal('group'), key: zKey, label: zLabel, groupKey: z.string().min(1).max(40), repeatable: z.boolean().optional(), max: z.number().int().positive().max(50).optional(), help: zHelp }).strict(),
  z.object({ t: z.literal('blocks'), key: zKey, label: zLabel, allowed: z.array(z.string().min(1).max(40)).min(1), max: z.number().int().positive().max(100).optional(), help: zHelp }).strict(),
  z.object({ t: z.literal('json'), key: zKey, label: zLabel, help: zHelp }).strict(),
  /*
   * `seo` — bộ ghi đè SEO của một bài (xem `seo.ts`). KHÔNG có `required`: một ô SEO bắt
   * buộc là đúng cái bẫy mà luật rơi về tồn tại để tránh — người ta gõ bừa cho qua.
   */
  z.object({ t: z.literal('seo'), key: zKey, label: zLabel, help: zHelp }).strict(),
]);

export const zCollectionSchema: z.ZodType<FieldDef[]> = z.array(zFieldDef).max(80);

/** Bảng tra `FieldGroupDef.key` → field của nó. */
export type GroupTable = Record<string, FieldDef[]>;

/**
 * Sâu hơn 3 thì form admin phải render đệ quy quá ba tầng, và một schema tự tham
 * chiếu sẽ treo trình duyệt. Strapi giới hạn ở đúng chỗ này vì cùng lý do.
 */
export const MAX_FIELD_DEPTH = 3;

/**
 * Độ sâu của một schema: 1 nếu phẳng, +1 cho mỗi tầng `group`/`blocks`.
 *
 * `seen` chặn nhóm tự tham chiếu. Trả về `MAX_FIELD_DEPTH + 1` khi phát hiện vòng —
 * một con số quá ngưỡng là đủ để `validateCollectionSchema` từ chối, và nó không
 * cần biết vòng dài bao nhiêu.
 */
export function schemaDepth(fields: FieldDef[], groups: GroupTable, seen: readonly string[] = []): number {
  let deepest = 1;

  for (const f of fields) {
    const keys = f.t === 'group' ? [f.groupKey] : f.t === 'blocks' ? f.allowed : [];
    for (const gk of keys) {
      if (seen.includes(gk)) return MAX_FIELD_DEPTH + 1;
      const inner = groups[gk];
      // Nhóm mồ côi tính như một lá: làm trắng màn cấu trúc vì một tham chiếu đã
      // bị xoá thì tệ hơn hẳn việc hiện nó ra để người dùng sửa.
      const d = 1 + (inner ? schemaDepth(inner, groups, [...seen, gk]) : 1);
      if (d > deepest) deepest = d;
    }
  }

  return deepest;
}

export type SchemaChecked =
  | { ok: true; fields: FieldDef[] }
  | { ok: false; error: string };

/**
 * `kind` phân biệt schema của một LOẠI NỘI DUNG với schema của một NHÓM FIELD.
 *
 * Mặc định `'type'` để mọi chỗ gọi cũ không đổi hành vi.
 */
export function validateCollectionSchema(
  input: unknown,
  groups: GroupTable,
  kind: 'type' | 'group' = 'type',
): SchemaChecked {
  const parsed = zCollectionSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    // Kèm đường dẫn: một schema 20 field mà chỉ nói "Dài quá 80 ký tự" thì người
    // sửa phải mở từng field ra đoán.
    return { ok: false, error: `${viPath(issue)}: ${viMessage(issue)}` };
  }
  const fields = parsed.data;

  const seenKeys = new Set<string>();
  for (const f of fields) {
    if (seenKeys.has(f.key)) return { ok: false, error: `Trùng khoá field: ${f.key}` };
    seenKeys.add(f.key);
  }

  for (const f of fields) {
    if (f.t === 'slug' && !seenKeys.has(f.from)) {
      return { ok: false, error: `Field slug "${f.key}" sinh từ "${f.from}" nhưng không có field đó` };
    }
  }

  /*
   * `taxonomyIds` trên `Entry` là một danh sách PHẲNG, không mang khoá field —
   * nó liên kết entry↔danh mục, không field↔danh mục. Hai luật dưới đây giữ nó
   * đúng với đúng một hình dạng dữ liệu mà `EntryTaxonomy` biểu diễn được.
   */
  const taxonomyFields = fields.filter((f) => f.t === 'taxonomy');

  if (kind === 'group' && taxonomyFields.length > 0) {
    // `EntryTaxonomy` liên kết ENTRY với danh mục, không liên kết từng MỤC bên
    // trong một nhóm. Một field taxonomy trong `FieldGroupDef` hứa "mỗi mục có
    // danh mục riêng" — một tầng lưu trữ không tồn tại để biểu diễn điều đó.
    return {
      ok: false,
      error: `Nhóm field không được chứa field danh mục: ${taxonomyFields[0]!.key}`,
    };
  }

  if (kind === 'type' && taxonomyFields.length > 1) {
    // `taxonomyIds` là một danh sách phẳng không mang khoá field, nên hai ô chọn
    // danh mục sẽ ghi vào CÙNG một chỗ — một danh mục duy nhất sẽ làm cả hai ô
    // "đã điền", một lời nói dối trong giao diện.
    const keys = taxonomyFields.map((f) => f.key).join(', ');
    return {
      ok: false,
      error: `Một loại nội dung chỉ có một field danh mục (đang có: ${keys})`,
    };
  }

  /*
   * Field `seo`: tối đa MỘT, và chỉ ở tầng ngoài của loại.
   *
   * Renderer tìm field SEO theo kiểu ở tầng ngoài (`seoKeyOf`). Hai field là hai bộ
   * `<title>` cho một trang; một field trong nhóm là một bộ SEO mà không ai đọc —
   * lưu được, site không hiện, đúng lỗi "validator nhận ≠ renderer đọc".
   */
  const seoFields = fields.filter((f) => f.t === 'seo');
  if (kind === 'group' && seoFields.length > 0) {
    return { ok: false, error: `Nhóm field không được chứa field SEO: ${seoFields[0]!.key}` };
  }
  if (kind === 'type' && seoFields.length > 1) {
    const keys = seoFields.map((f) => f.key).join(', ');
    return { ok: false, error: `Một loại nội dung chỉ có một field SEO (đang có: ${keys})` };
  }

  if (schemaDepth(fields, groups) > MAX_FIELD_DEPTH) {
    return { ok: false, error: `Cấu trúc lồng sâu quá ${MAX_FIELD_DEPTH} tầng` };
  }

  return { ok: true, fields };
}
