/**
 * Từ `FieldDef[]` dựng ra zod validate `Entry.data`.
 *
 * ## Vì sao dựng lúc chạy chứ không sinh code
 *
 * Schema là DỮ LIỆU (một hàng trong `CollectionType`), nên validator của nó cũng
 * phải được dựng từ dữ liệu. Sinh code nghĩa là thêm một loại nội dung là một lần
 * build — đúng thứ mà cả thiết kế này tồn tại để tránh.
 *
 * ## Vì sao `.strip()` chứ không `.strict()`
 *
 * Ngược với `zFieldDef`, ở đây khoá lạ bị BỎ chứ không bị từ chối: xoá một field
 * khỏi schema không xoá giá trị trong JSONB của 500 entry cũ (spec §10), nên
 * `.strict()` sẽ làm mọi bài cũ không mở được nữa sau một lần sửa cấu trúc.
 */

import { z } from 'zod';

import { zRichDoc, zRichText } from '@/lib/doc/schema';
import type { RichDoc, RichText } from '@/lib/doc/types';
import { plainDoc } from '@/lib/render/richdoc';
import { plainText } from '@/lib/render/richtext';
import type { FieldDef, GroupTable } from './field-def';
import { htmlPlainText, isBlankHtml, sanitizeArticleHtml } from './html-sanitize';
import { zSeoValue } from './seo-schema';
import { viMessage, viPath } from './zod-vi';

/**
 * Ngữ cảnh mà validator cần NGOÀI schema.
 *
 * Hiện chỉ có một thứ: host được phép cho `<iframe>` trong field `html`. Nó là một
 * tham số CHẶT (không optional) ở mọi hàm public của file này, có chủ đích — mặc định
 * ngầm `[]` sẽ khiến một đường ghi nào đó âm thầm xoá video YouTube của tác giả và
 * không ai biết cho tới khi bài đã lên site. Bắt buộc khai thì trình biên dịch chỉ
 * đúng vào từng chỗ gọi.
 *
 * Rỗng vẫn là giá trị hợp lệ và có nghĩa: KHÔNG nhận iframe nào.
 *
 * `siteHost` (21/10/2026): host của site, cho canonical của field `seo` — chỉ URL cùng
 * site mới được nhận, và được cắt về đường dẫn. `null` = site chưa đặt domain
 * (`configuredSiteOrigin()` trả `null`), khi đó chỉ nhận đường dẫn. Bắt buộc vì cùng lý
 * do với `iframeHosts`: mặc định ngầm sẽ âm thầm từ chối canonical đúng của ai đó.
 */
export interface EntryDataCtx {
  iframeHosts: readonly string[];
  siteHost: string | null;
}

/**
 * Trần CỨNG cho chuỗi HTML thô, áp TRƯỚC khi làm sạch.
 *
 * `sanitize-html` dựng một cây parser cho cả chuỗi, nên chi phí của nó tỉ lệ với độ
 * dài đầu vào. Không có trần này thì một POST 50MB vào `/api/…/entries` là một lượt
 * chiếm CPU của cả process Node — không phải lỗ bảo mật dữ liệu, nhưng là một đường
 * làm sập site bằng một lời gọi. `maxChars` của field không thay được vai này: nó đo
 * SAU khi làm sạch, tức sau khi chi phí đã trả.
 *
 * 2MB HTML là khoảng 300 nghìn chữ — rộng hơn mọi bài thật, chặt hơn mọi cú dán vô ý.
 */
const MAX_HTML_BYTES = 2_000_000;

const zAssetPick = z.object({ assetId: z.string().min(1), alt: z.string().max(300).optional() }).strip();
const zLinkValue = z.object({ href: z.string().min(1).max(2000), label: z.string().max(200).optional() }).strip();

/**
 * Một field → zod cho GIÁ TRỊ của nó, chưa tính `required`.
 *
 * `taxonomy` bị LOẠI khỏi kiểu tham số, không phải bị bỏ nhánh trong `switch`: giá trị
 * của nó không sống trong `data` (xem `objectSchema`), nên một nhánh `case 'taxonomy'`
 * ở đây là code chết mà đọc như một luật còn hiệu lực. Loại ở kiểu thì trình biên dịch
 * giữ hai chỗ khớp nhau.
 */
function valueSchema(
  f: Exclude<FieldDef, { t: 'taxonomy' }>,
  groups: GroupTable,
  depth: number,
  ctx: EntryDataCtx,
): z.ZodTypeAny {
  // Chặn cứng ở tầng dựng: `schemaDepth` đã từ chối schema sâu quá 3 lúc lưu, nhưng
  // một hàng cũ trong DB có thể đã lưu trước khi luật đó tồn tại.
  if (depth > 4) return z.unknown();

  switch (f.t) {
    case 'text': {
      let s = z.string();
      if (f.maxLength) s = s.max(f.maxLength);
      return s;
    }
    case 'richtext': {
      /*
       * `maxLength` của `richtext` là CẤU HÌNH CHẾT cho tới đây: `SchemaEditor` cho
       * đặt nó, `zFieldDef` nhận nó, và không dòng nào đọc nó — chỉ `case 'text'`
       * bên trên có trần. Nghĩa là một ô có "tối đa 500 ký tự" trong cấu hình vẫn
       * nhận trọn một cú dán 5MB, và chỗ vỡ là lúc render chứ không phải lúc ghi.
       *
       * Đếm trên `plainText` chứ không trên `JSON.stringify`: người đặt trần nghĩ
       * bằng số CHỮ, còn kích thước JSON đổi theo mức lồng inline — cùng một đoạn
       * chữ có thể là 200 hay 2000 byte tuỳ có bao nhiêu `strong`/`link`.
       * `plainText` cũng gộp khoảng trắng, nên trần này hơi rộng tay hơn số ký tự
       * thô một chút; đó là hướng sai an toàn.
       */
      if (f.maxLength === undefined) return zRichText;
      const max = f.maxLength;
      // `as RichText`: `zRichText` suy ra `ZInline[]` (kiểu của schema), còn
      // `plainText` nhận `RichText` (kiểu của types.ts). Hai kiểu là hai bản khai
      // của CÙNG một hình dạng — `schema.ts` phải có bản riêng vì `z.lazy` cần
      // một kiểu để bám vào. Ép ở đây rẻ hơn nhiều so với việc hợp nhất hai bản,
      // vốn kéo theo `z.lazy` mất kiểu và cả cây inline hoá `any`.
      return zRichText.refine(
        (rt) => plainText(rt as RichText).length <= max,
        `Nội dung dài quá ${max} ký tự`,
      );
    }
    case 'richdoc': {
      // HAI trần trên hai trục khác nhau — xem ghi chú ở `zFieldDef`. `maxBlocks`
      // áp bằng `.max()` của mảng chứ không bằng `.refine()`, để câu lỗi của zod
      // chỉ đúng vào mảng khối thay vì vào cả field.
      const arr =
        f.maxBlocks === undefined
          ? zRichDoc
          : zRichDoc.max(f.maxBlocks, `Nội dung nhiều quá ${f.maxBlocks} khối`);

      /*
       * "alt rỗng chỉ hợp lệ khi `decorative`" được cưỡng chế Ở ĐÂY, không trong
       * `zRichDoc`.
       *
       * Trong schema thì không được: `.refine()` biến nhánh thành ZodEffects và
       * `discriminatedUnion` không nhận ZodEffects làm nhánh (cùng cái bẫy đã ghi ở
       * `ImageNode`). Với doc, luật này sống ở `doc/validate.ts`; entry KHÔNG có
       * tầng ngữ nghĩa tương đương, nên nếu không đặt ở đường ghi này thì nó không
       * tồn tại ở đâu cả — và một ảnh không alt là một ảnh vô hình với screen reader.
       */
      const withAlt = arr.refine(
        (doc) => doc.every((b) => b.b !== 'figure' || b.alt.trim() !== '' || b.decorative === true),
        'Ảnh trong nội dung phải có chữ thay ảnh (alt), hoặc được đánh dấu là ảnh trang trí',
      );

      if (f.maxChars === undefined) return withAlt;
      const max = f.maxChars;
      // Cùng lý do ép kiểu như nhánh `richtext` bên trên.
      return withAlt.refine(
        (doc) => plainDoc(doc as RichDoc).length <= max,
        `Nội dung dài quá ${max} ký tự`,
      );
    }
    /*
     * `html` — làm sạch NGAY Ở ĐÂY, trong validator, không ở một bước riêng.
     *
     * ## Vì sao `.transform()` chứ không một hàm `sanitizeEntry()` gọi trước
     *
     * Một bước riêng là một bước có thể bị quên. Đường ghi vào `Entry` không chỉ có
     * form admin: còn MCP (`collection-tools.ts`), còn HTTP API, còn script import,
     * còn lớp phủ bản dịch đi qua `validateEntryDataPartial`. Mỗi đường là một chỗ
     * phải nhớ gọi, và bản quên gọi là bản mở stored XSS. Đặt trong `zEntryData` thì
     * không có đường ghi nào đi vòng được — validator là cửa duy nhất.
     *
     * ## Thứ tự có ý nghĩa
     *
     * 1. `.max(MAX_HTML_BYTES)` — chặn TRƯỚC khi trả chi phí parse (xem hằng số đó).
     * 2. `.transform()` làm sạch, và chuẩn hoá bài rỗng về `''`. CKEditor để lại
     *    `<p>&nbsp;</p>` sau một lần bấm Enter rồi xoá, và một chuỗi như thế làm
     *    `localeCoverage` báo "đã dịch" cho một bản dịch trắng.
     * 3. `.refine(maxChars)` đếm SAU khi làm sạch, trên CHỮ. Đếm trước là đếm cả thẻ
     *    mà tác giả không gõ; đếm trên chuỗi HTML là đếm cả `style="color:#ff4d2e"`.
     *
     * Giá trị trả về của `safeParse` là chuỗi ĐÃ sạch, và `validateEntryData` trả
     * `parsed.data` — nên thứ đi vào database là bản đã lọc, không phải bản gốc.
     */
    case 'html': {
      const cleaned = z
        .string()
        .max(MAX_HTML_BYTES, 'Nội dung quá lớn')
        .transform((raw) => {
          const { html } = sanitizeArticleHtml(raw, { iframeHosts: ctx.iframeHosts });
          return isBlankHtml(html) ? '' : html;
        });

      if (f.maxChars === undefined) return cleaned;
      const max = f.maxChars;
      return cleaned.refine(
        (html) => htmlPlainText(html).length <= max,
        `Nội dung dài quá ${max} ký tự`,
      );
    }
    case 'number': {
      let s = z.number().finite();
      if (f.min !== undefined) s = s.min(f.min);
      if (f.max !== undefined) s = s.max(f.max);
      return s;
    }
    case 'boolean':
      return z.boolean();
    case 'date':
      return z.string().datetime({ offset: true }).or(z.string().date());
    case 'enum':
      return z.enum(f.options.map((o) => o.value) as [string, ...string[]]);
    case 'image': {
      const one = f.requireAlt
        ? zAssetPick.refine((v) => Boolean(v.alt && v.alt.trim()), 'Ảnh phải có chữ thay ảnh (alt)')
        : zAssetPick;
      return f.multiple ? z.array(one) : one;
    }
    case 'file':
      // `FieldDef` cho `file` không có cờ `multiple` (khác `image`) — luôn một tệp.
      return zAssetPick;
    case 'slug':
      return z.string().min(1).max(120);
    case 'relation':
      return f.cardinality === 'many' ? z.array(z.string().min(1)).max(50) : z.string().min(1);
    case 'link':
      return zLinkValue;
    case 'group': {
      const inner = groups[f.groupKey];
      // Nhóm mồ côi: nhận nguyên trạng thay vì làm hỏng cả entry. Cùng nguyên tắc
      // với bản dịch mồ côi và override mồ côi — vô hại và phát hiện được.
      const shape = inner ? objectSchema(inner, groups, depth + 1, ctx) : z.record(z.string(), z.unknown());
      if (!f.repeatable) return shape;
      let arr = z.array(shape);
      if (f.max) arr = arr.max(f.max);
      return arr;
    }
    case 'blocks': {
      const variants = f.allowed.map((key) => {
        const inner = groups[key];
        // Khối mồ côi (nhóm field đã bị xoá) đi qua NGUYÊN TRẠNG bằng `.passthrough()`
        // — `.strip()` ở đây sẽ xoá sạch dữ liệu của khối, mà dữ liệu đó là thứ duy
        // nhất còn lại để người dùng cứu nội dung. Nhưng `__type` thì LUÔN có.
        return inner
          ? objectSchema(inner, groups, depth + 1, ctx, { __type: z.literal(key) })
          : z.object({ __type: z.literal(key) }).passthrough();
      });
      // `discriminatedUnion` chứ không `union`: giờ mọi variant đều có `__type` là
      // literal, nên zod chọn đúng nhánh và báo lỗi CỦA nhánh đó. `union` trả về một
      // danh sách "đã thử mọi nhánh và đều trượt" — vô dụng cho người sửa.
      // Nó cũng bỏ luôn ca đặc biệt "chỉ có một variant" mà brief phải xử lý riêng.
      // `variants` được suy ra là `ZodObject<Record<string, ZodTypeAny>, ...> | ZodObject<{ __type: ZodLiteral }, ...>`
      // — TS không thấy `__type` tĩnh trong nhánh có field thật (nó nằm trong
      // `Record<string, ZodTypeAny>` chung), dù runtime luôn có mặt. Ép kiểu ở
      // đúng chỗ gọi này, không đổi cách dựng variant ở trên.
      const item = z.discriminatedUnion(
        '__type',
        variants as unknown as [z.ZodDiscriminatedUnionOption<'__type'>, ...z.ZodDiscriminatedUnionOption<'__type'>[]],
      );
      let arr = z.array(item);
      if (f.max) arr = arr.max(f.max);
      return arr;
    }
    case 'json':
      return z.unknown();
    // Luật nằm ở `seo.ts`, cùng chỗ với luật đọc — xem docblock của `zSeoValue`.
    case 'seo':
      return zSeoValue(ctx.siteHost);
  }
}

/**
 * `extra` để nhánh `blocks` cắm `__type` vào THẲNG shape.
 *
 * Không dùng intersection (`base.and(...)`): `.strip()` trên hai object rồi giao
 * nhau là hành vi không bảo đảm ở zod 3, và ca hỏng là `__type` bị loại khỏi
 * output — mất thứ duy nhất cho renderer biết khối đó là gì, mất im lặng.
 */
function objectSchema(
  fields: FieldDef[],
  groups: GroupTable,
  depth: number,
  ctx: EntryDataCtx,
  extra: Record<string, z.ZodTypeAny> = {},
  // `allOptional` bỏ phần áp `required` cho ĐÚNG tầng này — lớp phủ bản dịch cần nó.
  // Một tham số ở đây chứ không phải một bản copy của `valueSchema`: bản copy của một
  // luật là đúng loại trùng lặp mà mốc này đã phải hợp nhất lại bốn lần.
  allOptional = false,
) {
  const shape: Record<string, z.ZodTypeAny> = { ...extra };
  for (const f of fields) {
    // Field `taxonomy` là một KHAI BÁO ("loại này dùng danh mục"), không phải chỗ chứa
    // giá trị: liên kết danh mục sống ở bảng `EntryTaxonomy` và được ghi qua tham số
    // `taxonomyIds`. Để nó trong shape là giữ HAI bản của cùng một sự thật, mà bản
    // trong `data` thì không ai đọc — đường truy vấn lọc qua `taxonomies.some`
    // (`query-build.ts`), không qua `data`. Và bản đó là mảng cuid nội bộ, nên `data`
    // ra API công khai sẽ phát id nội bộ ra ngoài, trái đúng nguyên tắc mà spec đặt
    // cho `assetId`.
    //
    // Không có trong shape nghĩa là `.strip()` tự dọn `cats` còn sót của entry cũ —
    // không cần script sửa DB.
    //
    // `required` của field `taxonomy` được cưỡng chế ở `entry-write.ts`
    // (`checkRequiredTaxonomy`), trên `taxonomyIds`, vì validator của `data` không
    // thấy giá trị đó.
    if (f.t === 'taxonomy') continue;

    const v = valueSchema(f, groups, depth, ctx);
    const req = allOptional ? false : 'required' in f ? f.required === true : false;
    /*
     * Ô tuỳ chọn nhận `null` như VẮNG MẶT (21/10/2026).
     *
     * Form gửi `null` cho mọi ô trống không phải chữ — ảnh, tệp, số, ngày, quan hệ một
     * (`emptyValue` ở `form-state.ts`) — còn `.optional()` chỉ nhận `undefined`. Hệ quả
     * đo được: bài nào để trống một ô như thế là KHÔNG lưu được qua form ("author_photo:
     * Phải là đối tượng, không phải null"). `null` thành `undefined` để khoá không vào
     * JSONB: "trống" chỉ có một cách biểu diễn, và mọi đường đọc đã coi vắng là trống.
     *
     * Ô bắt buộc KHÔNG đổi: `null` ở đó vẫn là thiếu giá trị.
     */
    shape[f.key] = req ? v : v.nullish().transform((x: unknown) => (x === null ? undefined : x));
  }
  return z.object(shape).strip();
}

export function zEntryData(
  fields: FieldDef[],
  groups: GroupTable,
  ctx: EntryDataCtx,
): z.ZodType<Record<string, unknown>> {
  return objectSchema(fields, groups, 1, ctx) as unknown as z.ZodType<Record<string, unknown>>;
}

/**
 * Validator cho MỘT PHẦN của `data` — dùng cho lớp phủ bản dịch.
 *
 * ## Vì sao cần một validator riêng thay vì dùng lại `zEntryData`
 *
 * Bản dịch cố ý là `Partial<data>`: dịch tiêu đề mà chưa dịch thân bài là trạng thái
 * bình thường, nên field `required` không được bắt buộc ở đây. Nhưng field CÓ mặt thì
 * phải đúng shape — nếu không, `applyEntryLocale` sẽ đặt một chuỗi HTML thô vào đúng
 * chỗ mà `zRichText` tồn tại để chặn, và hai test của `zEntryData` bị vô hiệu hoá bởi
 * một đường ghi ở file khác.
 *
 * `required` chỉ được bỏ ở TẦNG NGOÀI. Bên trong một `group`/`blocks` thì luật cũ vẫn
 * áp: `applyEntryLocale` phủ CẠN — dịch một field nhóm lặp là thay cả mảng, không
 * merge từng mục — nên mảng đã dịch phải là một mảng hoàn chỉnh, đúng như bản gốc.
 */
export function zEntryDataPartial(
  fields: FieldDef[],
  groups: GroupTable,
  ctx: EntryDataCtx,
): z.ZodType<Record<string, unknown>> {
  return objectSchema(fields, groups, 1, ctx, {}, true) as unknown as z.ZodType<Record<string, unknown>>;
}

export type EntryDataChecked =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; error: string };

export function validateEntryData(
  fields: FieldDef[],
  groups: GroupTable,
  input: unknown,
  ctx: EntryDataCtx,
): EntryDataChecked {
  const parsed = zEntryData(fields, groups, ctx).safeParse(input);
  if (parsed.success) return { ok: true, data: parsed.data };

  const issue = parsed.error.issues[0];
  return { ok: false, error: `${viPath(issue)}: ${viMessage(issue)}` };
}

/**
 * Cùng khuôn `validateEntryData`, cho lớp phủ bản dịch.
 *
 * Một hàm riêng chứ không phải một cờ boolean thêm vào `validateEntryData`: chỗ gọi ở
 * `updateEntry` còn phải ghép mã ngôn ngữ vào câu lỗi, và một cờ ở lời gọi không nói
 * ra được là đang kiểm bản dịch hay bản gốc.
 */
export function validateEntryDataPartial(
  fields: FieldDef[],
  groups: GroupTable,
  input: unknown,
  ctx: EntryDataCtx,
): EntryDataChecked {
  const parsed = zEntryDataPartial(fields, groups, ctx).safeParse(input);
  if (parsed.success) return { ok: true, data: parsed.data };

  const issue = parsed.error.issues[0];
  return { ok: false, error: `${viPath(issue)}: ${viMessage(issue)}` };
}
