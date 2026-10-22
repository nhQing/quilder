/**
 * Zod schema cho Doc và Op — tầng 1 của validator.
 *
 * ## Vì sao file này tồn tại
 *
 * `types.ts` chỉ là kiểu TypeScript, và kiểu TypeScript BIẾN MẤT lúc chạy. Route
 * `/api/ops` trước đây nhận `body.ops` rồi ép kiểu `as Op[]` — nghĩa là tầng "cú
 * pháp" trong bốn tầng validator thật ra chưa hề tồn tại. Với op đến từ inspector
 * thì tạm không sao (chính code của ta sinh ra chúng), nhưng op đến từ AI là dữ
 * liệu do một model sinh ra và ta không kiểm soát hình dạng của nó.
 *
 * ## Một định nghĩa, ba chỗ dùng
 *
 * Cùng schema này được dùng cho: (1) validate op từ inspector, (2) validate op từ
 * AI, (3) sinh JSON Schema cho tool `apply_ops` mà model đọc. Nhờ vậy schema
 * không thể lệch nhau — thứ model được bảo là hợp lệ đúng bằng thứ server chấp
 * nhận, về mặt cấu trúc chứ không phải nhờ ai đó nhớ cập nhật cả hai.
 *
 * ## Vì sao `null` chỉ hợp lệ trong patch
 *
 * `setStyle.patch` dùng `null` để XOÁ một key (xem `mergeDeep` trong ops.ts). Còn
 * `insertNode` mang một StyleProps đầy đủ, ở đó `null` không có nghĩa gì — và tệ
 * hơn, nó sống sót vào DB rồi compiler phát ra `gap: null;` vì phép kiểm ở đó là
 * `!== undefined`. Nên hai schema tách nhau: patch cho phép null, style thì không.
 */

import { z } from 'zod';

import { BREAKPOINTS } from '@/lib/design/breakpoints';
import { isKnownParamPath } from '@/lib/render/param-paths';
import {
  CURRENT_SCHEMA_VERSION, LEAF_TYPES, MAX_QUERY_LIMIT, NODE_TYPES, SORTABLE_COLUMNS, partTokens,
} from './types';

/* ── Giá trị nguyên thuỷ ──────────────────────────────────────────────── */

export const zTokenRef = z
  .object({ $token: z.string().min(1).max(80) })
  .strict()
  .describe('Tham chiếu design token, compile ra var(--<tên>). Dùng search_tokens để tìm tên hợp lệ.');

const LENGTH_UNITS = ['px', 'rem', '%', 'vw', 'svh', 'ch', 'fr', 'cqw', 'cqi', 'cqh'] as const;

export type ZLen =
  | z.infer<typeof zTokenRef>
  | { v: number; u: (typeof LENGTH_UNITS)[number] }
  | { clamp: [ZLen, ZLen, ZLen] }
  | { max: ZLen[] }
  | { min: ZLen[] }
  | { calc: { op: 'add' | 'sub' | 'mul' | 'div'; a: ZLen; b: ZLen | number } }
  /** Xoá giá trị layer dưới đã đặt — xem `Len` trong `doc/types.ts`. */
  | { unset: true };

export const zLen: z.ZodType<ZLen> = z.lazy(() =>
  z.union([
    zTokenRef,
    z.object({ v: z.number().finite(), u: z.enum(LENGTH_UNITS) }).strict(),
    // Xoá giá trị layer dưới đã đặt. `z.literal(true)` chứ không `z.boolean()`:
    // `{ unset: false }` không có nghĩa nào, và nhận nó là mời người ta viết ra rồi
    // ngạc nhiên khi không có gì xảy ra.
    z.object({ unset: z.literal(true) }).strict(),
    z.object({ clamp: z.tuple([zLen, zLen, zLen]) }).strict(),
    z.object({ max: z.array(zLen).min(1) }).strict(),
    z.object({ min: z.array(zLen).min(1) }).strict(),
    z
      .object({
        calc: z
          .object({
            op: z.enum(['add', 'sub', 'mul', 'div']),
            a: zLen,
            b: z.union([zLen, z.number().finite()]),
          })
          .strict(),
      })
      .strict(),
  ]),
);

export type ZColor =
  | z.infer<typeof zTokenRef>
  | { hex: string; alpha?: number }
  | { mix: [ZColor, ZColor]; amount: number };

export const zColor: z.ZodType<ZColor> = z.lazy(() =>
  z.union([
    zTokenRef,
    z
      .object({
        // Cùng biểu thức mà compiler dùng lúc emit. Chặn ở đây là để model nhận
        // lỗi sớm và sửa được; chặn ở compiler là để một bug ở đây không thành
        // CSS injection trên production. Cần cả hai.
        hex: z.string().regex(
          /^#?(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/,
          // Thông điệp phải nói được cách sửa: bên đọc nó là một model đang thử
          // lại, và "Invalid" không cho nó biết gì để sửa.
          'Chỉ nhận hex #rgb, #rgba, #rrggbb hoặc #rrggbbaa. Không nhận tên màu, rgb() hay hsl(). Ưu tiên dùng { "$token": "..." }.',
        ),
        alpha: z.number().min(0).max(1).optional(),
      })
      .strict(),
    z.object({ mix: z.tuple([zColor, zColor]), amount: z.number().min(0).max(100) }).strict(),
  ]),
);

/** Charset của `safe()` trong css.ts. Giữ hai bên khớp nhau. */
const zSafeString = z.string().regex(/^[a-zA-Z0-9 _.\-%/]+$/, 'Chứa ký tự không cho phép trong CSS');

export const zGridTrack = z
  .object({
    kind: z.enum(['fr', 'px', 'rem', 'minmax', 'auto']),
    v: z.number().finite().optional(),
    min: zLen.optional(),
    max: zLen.optional(),
  })
  .strict();

/* ── StyleProps ───────────────────────────────────────────────────────── */

/**
 * `plain` cho style đầy đủ, `patch` cho bản vá.
 *
 * Một hàm dựng chung thay vì hai schema chép tay: chép tay thì lần thêm property
 * tiếp theo sẽ chỉ được thêm vào một bên, và bug đó im lặng — property mới đơn
 * giản là không xoá được.
 */
type Wrap = <T extends z.ZodTypeAny>(schema: T) => z.ZodTypeAny;

const plain: Wrap = (schema) => schema.optional();
const patch: Wrap = (schema) => schema.nullable().optional();

function makeStyleProps(w: Wrap) {
  const group = <T extends z.ZodRawShape>(shape: T) => w(z.object(shape).strict());

  return z
    .object({
      layout: group({
        display: w(z.enum(['flex', 'grid', 'block', 'inline-flex', 'contents', 'none'])),
        flexDirection: w(z.enum(['row', 'column', 'row-reverse', 'column-reverse'])),
        gap: w(zLen),
        rowGap: w(zLen),
        columnGap: w(zLen),
        align: w(z.enum(['start', 'center', 'end', 'stretch', 'baseline'])),
        justify: w(z.enum(['start', 'center', 'end', 'between', 'around'])),
        alignSelf: w(z.enum(['start', 'center', 'end', 'stretch', 'baseline', 'auto'])),
        alignContent: w(z.enum(['start', 'center', 'end', 'stretch', 'between'])),
        justifyItems: w(z.enum(['start', 'center', 'end', 'stretch'])),
        wrap: w(z.boolean()),
        flex: w(
          z
            .object({
              grow: z.number().finite().optional(),
              shrink: z.number().finite().optional(),
              basis: z.union([zLen, z.literal('auto')]).optional(),
            })
            .strict(),
        ),
        gridArea: w(zSafeString),
        gridTemplateColumns: w(z.array(zGridTrack)),
        gridTemplateRows: w(z.array(zGridTrack)),
        gridAutoColumns: w(zGridTrack),
        autoFlow: w(z.enum(['row', 'column', 'row dense', 'column dense'])),
        placeItems: w(z.enum(['start', 'center', 'end', 'stretch'])),
        span: w(
          z
            .object({
              column: z.union([z.number().int(), z.literal('full')]).optional(),
              row: z.number().int().optional(),
            })
            .strict(),
        ),
      }),

      size: group({
        width: w(z.union([zLen, z.enum(['auto', 'full'])])),
        height: w(z.union([zLen, z.enum(['auto', 'full', 'svh'])])),
        minWidth: w(zLen),
        maxWidth: w(z.union([zLen, z.enum(['measure', 'container'])])),
        minHeight: w(zLen),
        maxHeight: w(zLen),
        aspectRatio: w(zSafeString).describe("Ví dụ '16/9'. Giữ chỗ để CLS = 0."),
      }),

      spacing: group({
        pt: w(zLen), pr: w(zLen), pb: w(zLen), pl: w(zLen),
        mt: w(zLen), mr: w(zLen), mb: w(zLen), ml: w(zLen),
      }),

      position: group({
        kind: w(z.enum(['static', 'relative', 'absolute', 'sticky', 'fixed'])),
        top: w(zLen), right: w(zLen), bottom: w(zLen), left: w(zLen),
        z: w(z.union([zTokenRef, z.number().int()])),
      }),

      typography: group({
        color: w(zColor),
        family: w(zTokenRef),
        size: w(z.union([zTokenRef, zLen])),
        weight: w(
          z.union([z.literal(400), z.literal(500), z.literal(600), z.literal(700)]),
        ).describe('Chỉ bốn bậc, phản chiếu --weight-regular/medium/semibold/bold trong tokens.css.'),
        leading: w(z.union([zTokenRef, z.number().finite()])),
        tracking: w(z.union([zTokenRef, zLen])),
        align: w(z.enum(['left', 'center', 'right'])),
        transform: w(z.enum(['none', 'uppercase'])),
        wrap: w(z.enum(['balance', 'pretty', 'normal'])),
        decoration: w(z.enum(['none', 'underline'])),
        underlineOffset: w(zLen),
        whiteSpace: w(z.enum(['normal', 'nowrap', 'pre-line'])),
        overflowWrap: w(z.enum(['normal', 'anywhere', 'break-word'])),
        listStyle: w(z.enum(['none', 'disc', 'decimal'])),
        variantNumeric: w(z.enum(['normal', 'tabular-nums'])),
        clamp: w(z.number().int().min(1)),
      }),

      fill: group({
        color: w(zColor),
        gradient: w(
          z
            .object({
              kind: z.enum(['linear', 'radial']),
              angle: z.number().finite().optional(),
              stops: z.array(z.object({ at: z.number(), color: zColor }).strict()).min(2),
              hidden: z.literal(true).optional(),
            })
            .strict(),
        ),
        image: w(
          z
            .object({
              assetId: z.string().min(1),
              fit: z.enum(['cover', 'contain']),
              position: zSafeString.optional(),
              hidden: z.literal(true).optional(),
            })
            .strict(),
        ),
      }),

      border: group({
        width: w(zLen),
        style: w(z.enum(['solid', 'dashed'])),
        color: w(zColor),
        radius: w(z.union([zTokenRef, zLen])),
        hidden: w(z.literal(true)),
      }),

      shadow: w(
        z.union([
          zTokenRef,
          z.array(
            z
              .object({
                x: zLen, y: zLen, blur: zLen, spread: zLen,
                color: zColor,
                inset: z.boolean().optional(),
                hidden: z.literal(true).optional(),
              })
              .strict(),
          ),
        ]),
      ),

      container: group({
        type: w(z.enum(['inline-size', 'size', 'normal'])),
        name: w(zSafeString),
      }),

      effects: group({
        opacity: w(z.number().min(0).max(1)),
        blur: w(zLen),
        backdropBlur: w(zLen),
        backdropSaturate: w(z.number().finite()),
        backdropFallbackColor: w(zColor).describe(
          'Bắt buộc đi kèm backdropBlur nếu muốn có fallback — compiler tự sinh khối @supports.',
        ),
        blend: w(z.enum(['normal', 'difference', 'multiply', 'screen', 'overlay'])),
        overflow: w(z.enum(['visible', 'hidden', 'clip', 'auto'])),
        pointerEvents: w(z.enum(['none', 'auto'])),
        visibility: w(z.enum(['visible', 'hidden'])),
        isolation: w(z.enum(['auto', 'isolate'])),
        userSelect: w(z.enum(['none', 'auto'])),
        objectFit: w(z.enum(['cover', 'contain', 'fill', 'none'])),
        objectPosition: w(zSafeString),
        cursor: w(z.enum(['auto', 'pointer', 'none', 'not-allowed'])),
        outline: w(
          z
            .object({
              width: zLen,
              style: z.enum(['solid', 'dashed']),
              color: zColor,
              offset: zLen.optional(),
            })
            .strict(),
        ),
      }),

      transform: group({
        x: w(zLen), y: w(zLen),
        scale: w(z.number().finite()),
        rotate: w(z.number().finite()),
        origin: w(zSafeString),
        translate: w(z.object({ x: zLen.optional(), y: zLen.optional() }).strict()).describe(
          'Property translate ĐỘC LẬP, không phải hàm trong transform. Dùng nó khi node có effect GSAP, ' +
            'vì GSAP sở hữu transform lúc chạy và hai bên sẽ ghi đè nhau.',
        ),
      }),

      transition: group({
        props: w(z.array(zSafeString).min(1)),
        duration: w(z.union([zTokenRef, zLen])),
        easing: w(zTokenRef),
        delay: w(z.union([zTokenRef, zLen])),
      }),
    })
    .strict();
}

export const zStyleProps = makeStyleProps(plain);
export const zStylePatch = makeStyleProps(patch);

export const zResponsiveStyle = z
  .object({
    base: zStyleProps,
    sm: zStyleProps.optional(),
    md: zStyleProps.optional(),
    lg: zStyleProps.optional(),
    xl: zStyleProps.optional(),
    hover: zStyleProps.optional(),
    focusVisible: zStyleProps.optional(),
    inView: zStyleProps.optional(),
    states: z.record(z.string(), zStyleProps).optional(),
  })
  .strict();

/* ── Rich text ────────────────────────────────────────────────────────── */

export type ZInline =
  | { t: 'text'; v: string }
  | { t: 'em'; children: ZInline[] }
  | { t: 'strong'; children: ZInline[] }
  | { t: 'br' }
  | { t: 'link'; href: string; children: ZInline[] }
  | { t: 'split'; mode: 'lines' | 'words' | 'chars'; children: ZInline[] }
  | { t: 'counter'; to: number; decimals?: number; suffix?: string }
  | { t: 'bind'; ref: { source: 'site' | 'page' | 'collection'; path: string; format?: string }; fallback: string };

/**
 * `href` chặn `javascript:` và `data:` — đây là chỗ duy nhất trong doc mà một URL
 * do người/AI nhập đi thẳng vào thuộc tính HTML.
 */
const zHref = z
  .string()
  .max(2000)
  .refine(
    (v) => !/^\s*(javascript|data|vbscript):/i.test(v),
    'href không được dùng scheme javascript:, data: hay vbscript:',
  );

export const zInline: z.ZodType<ZInline> = z.lazy(() =>
  z.discriminatedUnion('t', [
    z.object({ t: z.literal('text'), v: z.string() }).strict(),
    z.object({ t: z.literal('em'), children: z.array(zInline) }).strict(),
    z.object({ t: z.literal('strong'), children: z.array(zInline) }).strict(),
    z.object({ t: z.literal('br') }).strict(),
    z.object({ t: z.literal('link'), href: zHref, children: z.array(zInline) }).strict(),
    z
      .object({
        t: z.literal('split'),
        mode: z.enum(['lines', 'words', 'chars']),
        children: z.array(zInline),
      })
      .strict(),
    z
      .object({
        t: z.literal('counter'),
        to: z.number().finite(),
        decimals: z.number().int().min(0).max(6).optional(),
        suffix: z.string().max(20).optional(),
      })
      .strict(),
    z
      .object({
        t: z.literal('bind'),
        ref: z
          .object({
            source: z.enum(['site', 'page', 'collection']),
            path: z.string().min(1),
            format: z.enum(['text', 'date', 'currencyVND', 'number']).optional(),
          })
          .strict(),
        fallback: z.string(),
      })
      .strict(),
  ]),
);

export const zRichText = z.array(zInline);

/* ── RichDoc: cấp KHỐI cho nội dung dài ───────────────────────────────── */

/**
 * `RichDoc` là `RichText` cộng một tầng khối — đoạn, tiêu đề, danh sách, trích
 * dẫn, ảnh có chú thích, đường kẻ. Nó phục vụ field `richdoc` của collection, chỗ
 * người viết cần một ô soạn kiểu Word.
 *
 * ## Vì sao thêm cấp khối chứ không sửa `zRichText`
 *
 * `RichText` là một `InlineNode[]` phẳng và mọi thứ đã dựa trên hình dạng đó:
 * `TextNode.content`, `ButtonNode.label`, bảng dịch, `sourceHash`, `flatRichText`.
 * Nhồi khối vào đấy nghĩa là mười chỗ kia phải học một hình dạng thứ hai. Ngược
 * lại, `children` của mỗi khối ở đây dùng lại ĐÚNG `zInline` trên — nên `zHref`,
 * `plainText`, `renderInline` và `sourceHash` chạy nguyên, không sửa một dòng.
 *
 * ## Vì sao `RichDoc` là một MẢNG ở tầng ngoài, không phải `{ type:'doc', content }`
 *
 * Hình dạng thứ hai là hình dạng Tiptap/ProseMirror dùng, nên nó là thứ dễ chọn
 * theo quán tính. Nhưng `isBlank` của bản dịch entry (`collections/i18n.ts`) nhận
 * "rỗng" qua `Array.isArray(v) && v.length === 0`. Một object luôn không rỗng theo
 * phép kiểm đó, nên MỌI field `richdoc` — kể cả `{}` — sẽ được tính là "đã dịch",
 * và `localeCoverage` báo 100% cho một bản dịch chưa có chữ nào. Mảng ở tầng ngoài
 * giữ hai hàm đó đúng mà không phải sửa chúng.
 *
 * Serializer đổi qua lại với hình dạng ProseMirror từng sống ở
 * `collections/richdoc-tiptap.ts`. Nó đã được gỡ ngày 04/09/2026 cùng với Tiptap —
 * ô soạn thân bài giờ là CKEditor và lưu chuỗi HTML (field `html`). Lập luận ở trên
 * vẫn đứng vì `RichDoc` vẫn là định dạng đọc của những hàng cũ, và
 * `scripts/richdoc-to-html.ts` là đường ra cho chúng.
 *
 * `b` (không phải `t`) để một khối không bao giờ lẫn được với một inline node ở
 * chỗ nào chỉ đọc discriminator.
 *
 * Chưa có `b:'table'` ở v1 — xem mục nợ trong plan: bảng là cây hai chiều cộng
 * merge cell cộng một bộ render responsive, tức một đợt riêng.
 */
export type ZBlock =
  | { b: 'p' | 'h2' | 'h3' | 'h4'; children: ZInline[] }
  | { b: 'ul' | 'ol'; items: { children: ZInline[] }[] }
  | { b: 'quote'; children: ZInline[] }
  | { b: 'figure'; assetId: string; alt: string; decorative?: boolean; caption?: ZInline[] }
  | { b: 'hr' };

/**
 * `h1` KHÔNG có trong danh sách: `h1` của một bài là tiêu đề entry, do template
 * trang render. Cho phép nó trong thân bài là mời mỗi bài có hai `h1` — một lỗi
 * a11y và SEO mà không có triệu chứng nào nhìn thấy được. `h5`/`h6` bị bỏ vì
 * typography của site không có bậc cho chúng, nên chúng sẽ render như `p`.
 */
export const zBlock: z.ZodType<ZBlock> = z.discriminatedUnion('b', [
  z.object({ b: z.enum(['p', 'h2', 'h3', 'h4']), children: z.array(zInline) }).strict(),
  z
    .object({
      b: z.enum(['ul', 'ol']),
      // `items` chứ không phải `children`: một mục danh sách là một hộp inline
      // riêng, và nếu cả danh sách chỉ là một `InlineNode[]` thì ranh giới giữa
      // các mục phải mã hoá bằng `br` — tức mất cấu trúc ngay ở tầng dữ liệu.
      items: z.array(z.object({ children: z.array(zInline) }).strict()),
    })
    .strict(),
  z.object({ b: z.literal('quote'), children: z.array(zInline) }).strict(),
  z
    .object({
      b: z.literal('figure'),
      // `min(1)` khác `ImageNode.assetId` (nullable ở đó): một node ảnh trên canvas
      // tồn tại trước khi người dùng chọn ảnh, còn một khối `figure` chỉ được sinh
      // ra BỞI hành động chọn ảnh. Một figure không có ảnh là một khối vô hình.
      assetId: z.string().min(1),
      alt: z.string().max(500),
      decorative: z.boolean().optional(),
      caption: z.array(zInline).optional(),
    })
    .strict(),
  z.object({ b: z.literal('hr') }).strict(),
]);

/**
 * `.min(1)` vì một tài liệu rỗng phải là `[{ b:'p', children:[…] }]`, không phải
 * `[]`: `[]` là chính giá trị mà `isBlank` đọc là "chưa dịch", nên một thân bài
 * lưu thành `[]` sẽ bị lớp phủ bản dịch bỏ qua thay vì ghi đè.
 *
 * Luật "alt rỗng chỉ hợp lệ khi `decorative`" KHÔNG ở đây, cùng lý do với
 * `ImageNode` phía dưới: `.refine()` biến nhánh thành ZodEffects và
 * `discriminatedUnion` không nhận ZodEffects. Nó được cưỡng chế ở đường GHI của
 * entry — `case 'richdoc'` trong `collections/entry-data.ts` — vì entry không có
 * tầng ngữ nghĩa như `doc/validate.ts` để đặt nó vào.
 */
export const zRichDoc = z.array(zBlock).min(1);

/* ── Collection: truy vấn và lặp ──────────────────────────────────────── */

const FILTER_OPS = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'contains'] as const;

/** Khoá field: cùng bộ ký tự với `zKey` trong collections/field-def.ts. */
const zFieldKey = z.string().min(1).max(40).regex(/^[a-z][a-z0-9_]*$/);

export const zCollectionFilter = z
  .discriminatedUnion('k', [
    z.object({
      k: z.literal('field'),
      field: zFieldKey,
      op: z.enum(FILTER_OPS),
      value: z.union([z.string().max(200), z.number().finite(), z.boolean()]),
    }).strict(),
    z.object({
      k: z.literal('taxonomy'),
      from: z.enum(['fixed', 'current-entry', 'url']),
      ids: z.array(z.string().min(1)).min(1).max(30).optional(),
    }).strict(),
    /*
     * Lọc theo field `relation` — xem docblock của `CollectionFilter` ở `types.ts`.
     *
     * KHÔNG có `current-entry`: nó cần ngữ cảnh "giá trị relation của bài đang mở",
     * thứ `QueryContext` chưa mang. Thêm một giá trị enum mà tầng truy vấn không
     * đọc được là thêm một cấu hình LƯU ĐƯỢC nhưng không bao giờ chạy — đúng hình
     * dạng của `map: { taxonomy: … }`, thứ đã tốn một lần truy nguyên.
     */
    z.object({
      k: z.literal('relation'),
      field: zFieldKey,
      from: z.enum(['fixed', 'url']),
      ids: z.array(z.string().min(1)).min(1).max(30).optional(),
    }).strict(),
    z.object({ k: z.literal('excludeCurrent') }).strict(),
  ])
  // Refine ở NGOÀI union, không trong nhánh: `.superRefine` trả về `ZodEffects`,
  // còn `discriminatedUnion` đòi mọi nhánh là `ZodObject` (nó đọc `type.shape`).
  .superRefine((v, ctx) => {
    if (v.k === 'taxonomy' && v.from === 'fixed' && (!v.ids || v.ids.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ids'],
        message: 'Lọc theo danh mục cố định phải chọn ít nhất một danh mục',
      });
    }
    if (v.k === 'relation' && v.from === 'fixed' && (!v.ids || v.ids.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ids'],
        message: 'Lọc theo quan hệ cố định phải chọn ít nhất một bản ghi',
      });
    }
  });

export const zCollectionQuery = z
  .object({
    typeKey: z.string().min(1).max(40),
    filter: z.array(zCollectionFilter).max(10).optional(),
    sort: z
      .array(
        z.object({
          // Chỉ cột THẬT: Prisma không sắp được theo đường dẫn trong JSONB, nên một
          // field của schema ở đây là một cấu hình không bao giờ có tác dụng. Chặn ở
          // đây để tác giả biết ngay lúc lưu, không phải lúc nhìn thấy trang trống.
          //
          // Danh sách lấy từ `SORTABLE_COLUMNS`, không chép tay: bản chép tay trước
          // đây đã từ chối đúng cột vừa được thêm cho tầng truy vấn.
          field: z.enum(SORTABLE_COLUMNS),
          dir: z.enum(['asc', 'desc']),
        }).strict(),
      )
      .max(3)
      .optional(),
    // Không `.default()`: một mặc định ngầm ở đây nghĩa là quên khai limit sẽ IM
    // LẶNG chạy được, và trang đầu tiên vượt trần sẽ là trang production.
    limit: z.number().int().positive().max(MAX_QUERY_LIMIT),
    skip: z.number().int().min(0).max(10000).optional(),
  })
  .strict()
  .describe('Truy vấn một loại nội dung. limit bắt buộc, trần 100.');

/**
 * Chữ trong `params` của Composite nằm TRONG instance: `{ "index.2.label": "Intro" }`.
 *
 * Khoá là đường dẫn vào params (xem `render/param-paths.ts`) và CHỈ nhận đường nằm
 * trong bảng trắng: `.strict()` của override chặn khoá lạ ở cấp trên, còn cái này
 * chặn một override ghi vào `endpointKey` hay `fields.0.name` — thứ không phải chữ.
 */
const zParamOverrides = z.record(
  z.string().max(80).refine(isKnownParamPath, 'đường dẫn params không dịch được'),
  z.string().min(1).max(2000),
);

/** Khớp đúng bộ khoá của `ContentOverride` — không có style, không có cấu trúc. */
const OVERRIDE_FIELDS = [
  'content', 'label', 'alt', 'assetId', 'posterAssetId', 'href', 'a11yLabel',
] as const;

export const zRepeatSpec = z
  .object({
    source: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('query'), query: zCollectionQuery }).strict(),
      z.object({ kind: z.literal('related'), typeKey: z.string().min(1).max(40), limit: z.number().int().positive().max(MAX_QUERY_LIMIT) }).strict(),
      z.object({
        kind: z.literal('taxonomy'),
        typeKey: z.string().min(1).max(40),
        // Cả hai `optional` và không `.default()`: vắng = hiện mọi danh mục, đúng
        // hành vi của mọi khối đang chạy. Một default ở đây đổi hình dạng những
        // trang đã publish vào lần lưu tiếp theo của chúng.
        filter: z
          .object({
            published: z.boolean().optional(),
            minEntries: z.number().int().min(0).max(1000).optional(),
          })
          .strict()
          .optional(),
        sort: z
          .object({
            field: z.enum(['order', 'name', 'count']),
            dir: z.enum(['asc', 'desc']),
          })
          .strict()
          .optional(),
      }).strict(),
      z.object({ kind: z.literal('group-entries'), limit: z.number().int().positive().max(MAX_QUERY_LIMIT) }).strict(),
      z.object({ kind: z.literal('relation'), path: zFieldKey, limit: z.number().int().positive().max(MAX_QUERY_LIMIT) }).strict(),
      z.object({ kind: z.literal('field'), path: zFieldKey }).strict(),
    ]),
    map: z.record(
      zFieldKey,
      z.object({ nodeId: z.string().min(1).max(40), as: z.enum(OVERRIDE_FIELDS) }).strict(),
    ),
    blockComponents: z.record(z.string().min(1).max(40), z.string().min(1)).optional(),
    empty: z
      .union([
        z.object({ hide: z.literal(true) }).strict(),
        z.object({ text: zRichText }).strict(),
      ])
      .optional(),
  })
  .strict()
  .describe('Lặp một Instance theo dữ liệu collection.');

/* ── Effect ───────────────────────────────────────────────────────────── */

export const zEffectAttachment = z
  .object({
    id: z.string().min(1).max(40).describe('Instance id, duy nhất trong một node.'),
    effect: z
      .string()
      .min(1)
      .describe(
        'Key trong registry, HOẶC key của một EffectPreset — dùng list_effects để xem cả hai. ' +
          'Preset được giải ra effect thật + params đã trộn ngay tại validator.',
      ),
    params: z.record(z.string(), z.unknown()).default({}),
    /** Chỉ truy vết, do `expandEffectPresets` điền. Xem `EffectAttachment.fromPreset`. */
    fromPreset: z.string().min(1).max(80).optional(),
    gates: z
      .object({
        minBreakpoint: z.enum(BREAKPOINTS).optional(),
        finePointerOnly: z.boolean().optional(),
        respectReducedMotion: z.boolean().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

/* ── Node ─────────────────────────────────────────────────────────────── */

/**
 * Id node — chữ, số, gạch dưới, gạch ngang. KHÔNG có `/` và KHÔNG có `:`.
 *
 * Hai ký tự đó bị cấm vì hai hệ địa chỉ khác đang dùng chúng làm dấu tách, và
 * nếu id chứa chúng thì cả hai hệ đọc sai mà không có gì báo:
 *
 *   `instanceId/localId`      đơn vị chữ bên trong một instance
 *   `locale:nodeId:field`     khoá ảnh chụp bản dịch trong `Release.translations`
 *
 * Trước đây luật chỉ là `min(1).max(40)`, tức là an toàn theo QUY ƯỚC. Siết ở
 * đây làm nó an toàn theo CẤU TRÚC. Đã kiểm 16.110 id đang có trong database:
 * không id nào vi phạm.
 */
const zNodeId = z.string().min(1).max(40).regex(
  /^[A-Za-z0-9_-]+$/,
  'id node chỉ gồm chữ, số, gạch dưới và gạch ngang',
);

function responsive<T extends z.ZodTypeAny>(inner: T) {
  return z
    .object({
      base: inner,
      sm: inner.optional(),
      md: inner.optional(),
      lg: inner.optional(),
      xl: inner.optional(),
    })
    .strict();
}

/**
 * Một vai trong `part`: slug thường, hoặc `entry:<khoá field>`.
 *
 * Hai hình dạng chứ không một, vì khoá field của collection cho phép `_`
 * (`field-def.ts`: `^[a-z][a-z0-9_]*$`) còn slug vai thì không. Trước đây regex
 * của `part` từ chối cả dấu `:`, nên `part="entry:body"` mà `NodeRenderer` và
 * `collection-page.ts` cùng trông đợi chỉ ghi được qua `setProps` — đường duy
 * nhất không kiểm hình dạng. Nó lọt vì không ai kiểm, không vì nó hợp lệ.
 */
const PART_ROLE = /^(?:entry:[a-z][a-z0-9_]*|[a-z][a-z0-9-]*)$/;

/**
 * `part` là danh sách 1–4 vai cách nhau bằng khoảng trắng — xem `NodeBase.part`.
 *
 * Trần 4 là để `[data-part~=]` còn đọc được bằng mắt trong devtools; một node cần
 * năm vai gần như chắc chắn là một node đang làm năm việc.
 */
const zPart = z.string().max(64).refine(
  (v) => {
    const roles = partTokens(v);
    return (
      roles.length > 0 &&
      roles.length <= 4 &&
      new Set(roles).size === roles.length &&
      roles.every((r) => PART_ROLE.test(r))
    );
  },
  {
    message:
      'part là 1–4 vai không trùng nhau, cách nhau bằng khoảng trắng; mỗi vai là slug ' +
      '(a-z, 0-9, gạch ngang) hoặc "entry:<khoá field>"',
  },
);

const zNodeBase = {
  id: zNodeId,
  parentId: zNodeId.nullable(),
  children: z.array(zNodeId),
  name: z.string().max(120).optional(),
  style: zResponsiveStyle,
  effects: z.array(zEffectAttachment).default([]),
  render: z.boolean().optional(),
  a11y: z
    .object({
      role: zSafeString.optional(),
      label: z.string().max(200).optional(),
      labelledBy: zNodeId.optional(),
    })
    .strict()
    .optional(),
  htmlId: z.string().regex(/^[a-z][a-z0-9-]*$/, 'htmlId phải là slug').optional(),
  part: zPart.optional(),
  customCss: z.string().max(8000).optional(),
  locked: z
    .object({ reason: z.string(), lockedBy: z.string(), lockedAt: z.string() })
    .strict()
    .optional(),
};

const zLeafChildren = z.array(z.never()).max(0).default([]);

export const zNode = z.discriminatedUnion('type', [
  z.object({
    ...zNodeBase,
    type: z.literal('Section'),
    tag: z.enum(['section', 'header', 'footer', 'main', 'nav', 'aside']),
  }).strict(),

  z.object({
    ...zNodeBase,
    type: z.literal('Stack'),
    direction: responsive(z.enum(['row', 'column'])),
  }).strict(),

  z.object({
    ...zNodeBase,
    type: z.literal('Grid'),
    areas: responsive(z.string().nullable()).optional(),
    columns: responsive(z.array(zGridTrack)).optional(),
  }).strict(),

  z.object({
    ...zNodeBase,
    type: z.literal('Text'),
    tag: z.enum(['h1', 'h2', 'h3', 'h4', 'p', 'span', 'blockquote', 'li']),
    content: zRichText,
    children: zLeafChildren,
  }).strict(),

  z.object({
    ...zNodeBase,
    type: z.literal('Image'),
    assetId: z.string().nullable(),
    alt: z.string(),
    decorative: z.boolean().optional(),
    fit: responsive(z.enum(['cover', 'contain', 'fill'])),
    ratio: responsive(z.string().nullable()).optional(),
    children: zLeafChildren,
    // Luật "alt rỗng chỉ hợp lệ khi decorative = true" nằm ở tầng ngữ nghĩa
    // trong validate.ts, không phải ở đây: `.refine()` biến schema thành
    // ZodEffects và discriminatedUnion không nhận ZodEffects làm nhánh.
  }).strict(),

  z.object({
    ...zNodeBase,
    type: z.literal('Button'),
    label: zRichText,
    action: z.discriminatedUnion('kind', [
      z.object({
        kind: z.literal('link'),
        href: zHref,
        target: z.literal('_blank').optional(),
        rel: zSafeString.optional(),
      }).strict(),
      z.object({ kind: z.literal('anchor'), toNodeId: zNodeId }).strict(),
      z.object({ kind: z.literal('submit'), formId: z.string().min(1) }).strict(),
      z.object({ kind: z.literal('none') }).strict(),
    ]),
    variant: z.enum(['primary', 'ghost', 'link']),
    children: zLeafChildren,
  }).strict(),

  z.object({
    ...zNodeBase,
    type: z.literal('Video'),
    assetId: z.string().nullable(),
    posterAssetId: z.string().nullable(),
    autoplay: z.boolean().optional(),
    loop: z.boolean().optional(),
    muted: z.boolean().optional(),
    controls: z.boolean().optional(),
    preload: z.enum(['none', 'metadata', 'auto']).optional(),
    children: zLeafChildren,
  }).strict(),

  z.object({
    ...zNodeBase,
    type: z.literal('Canvas'),
    program: z.enum(['gradient', 'displacement']),
    uniforms: z.record(z.string(), z.union([zTokenRef, z.number().finite()])),
    fallbackChildId: zNodeId.nullable(),
  }).strict(),

  z.object({
    ...zNodeBase,
    type: z.literal('CustomCode'),
    html: z.string().max(20000).optional(),
    css: z.string().max(20000).optional(),
    js: z.string().max(20000).optional(),
    mode: z.enum(['inline', 'iframe']),
    height: zLen.optional(),
    children: zLeafChildren,
  }).strict(),

  z.object({
    ...zNodeBase,
    type: z.literal('Composite'),
    // Chuỗi PascalCase, không phải enum (21/10/2026): gói dự án mang composite riêng
    // (src/lib/project/types.ts). Tên có thật hay không do validator kiểm
    // (`isKnownComposite` — lõi + gói đang chạy), vì schema này không biết gói nào bật.
    composite: z.string().regex(/^[A-Z][A-Za-z0-9]{0,59}$/, 'Tên composite dạng PascalCase, ví dụ "Form".'),
    params: z.unknown(),
    slots: z.record(z.string(), z.array(zNodeId)),
  }).strict(),

  z.object({
    ...zNodeBase,
    type: z.literal('Instance'),
    componentId: z.string().min(1),
    /**
     * Chỉ NỘI DUNG — xem ghi chú `ContentOverride` trong types.ts.
     *
     * `.strict()` ở đây chịu lực thật: nó là thứ chặn một override style lọt vào
     * qua op hoặc qua AI. Cho một khoá lạ đi qua nghĩa là mô hình "style luôn
     * theo component" mất hiệu lực mà không ai nhận ra.
     */
    overrides: z.record(
      zNodeId,
      z
        .object({
          content: zRichText.optional(),
          label: zRichText.optional(),
          alt: z.string().max(500).optional(),
          // `null` = quay về ảnh của component, khác hẳn với "không có khoá này".
          assetId: z.string().min(1).nullable().optional(),
          posterAssetId: z.string().min(1).nullable().optional(),
          href: zHref.optional(),
          a11yLabel: z.string().max(200).optional(),
          params: zParamOverrides.optional(),
        })
        .strict(),
    ),
    /**
     * Gần như luôn rỗng — nhưng KHÔNG phải `zLeafChildren`.
     *
     * Trần MỘT con, cho cây lặp hai cấp (`taxonomy` → `group-entries`). Luật
     * "con phải là gì" thì zod không nói được: nó cần nhìn node khác trong doc.
     * `validateOps` cưỡng chế phần ấy — xem `nestedRepeatIssue`.
     *
     * Trần ở đây chứ không chỉ ở validator, vì `zNode` là hàng rào cuối của mọi
     * `PageVersion` đọc lên: một doc cũ mang mười con dưới một instance sẽ được
     * chặn ở chỗ đọc thay vì render ra mười khối chồng nhau.
     */
    children: z.array(zNodeId).max(1).default([]),
    repeat: zRepeatSpec.optional(),
  }).strict(),
]);

/* ── Hợp đồng `setProps` ──────────────────────────────────────────────── */

/**
 * Field mà `setProps` KHÔNG được đụng — mỗi thứ có op riêng vì cần kiểm bất biến.
 *
 * Chép đúng danh sách mà `applyOne` ném. Hai bản của một luật thì trôi khỏi nhau,
 * nên `schema.test.ts` canh cho chúng bằng nhau.
 */
export const PROPS_OP_OWNED = ['id', 'parentId', 'children', 'type', 'style', 'effects'] as const;

/** Nhánh `zNode` của một node type, hoặc `undefined` nếu type không có thật. */
function nodeBranch(type: string) {
  return (zNode.options as unknown as z.ZodObject<z.ZodRawShape>[]).find(
    (o) => (o.shape.type as z.ZodLiteral<string>).value === type,
  );
}

const propsContractCache = new Map<string, z.ZodObject<z.ZodRawShape, 'strict'>>();

/**
 * Hợp đồng của `setProps` cho một node type: nhánh `zNode` tương ứng, bỏ những
 * field có op riêng, mọi field thành tuỳ chọn và nhận `null`.
 *
 * ## Vì sao phải có, dù `zNode` đã `.strict()`
 *
 * `zNode` chỉ chắn đường `insertNode`. Đường `setProps` khai
 * `props: z.record(z.string(), z.unknown())` — tức KHÔNG tầng nào nhìn vào bên
 * trong — rồi `applyOne` ghi thẳng từng khoá vào node. Hai đường ghi, một hình
 * dạng, và chỉ một đường được kiểm. Hậu quả đã đo được hai lần:
 *
 *  - `overrides: { logo: { style: … } }` qua `setProps` trả `ok: true` rồi bị bỏ
 *    qua lúc render — người dựng dải logo `/about-us` tưởng đã đặt được style rồi
 *    đi tìm nguyên nhân ở chỗ khác. Cùng object ấy qua `insertNode` thì `.strict()`
 *    của `overrides` chặn ngay.
 *  - `params: { … }` bịa ra trên một `Instance` trả `ok: true` và ghi một field mà
 *    không renderer nào đọc. `params` là field của node `Composite`, không phải
 *    của `Instance`.
 *
 * Luật `repeat_shape` trong `validateOps` chính là bản vá thủ công cho MỘT field
 * của cùng lỗ hổng này. Hàm này đóng nốt phần còn lại.
 *
 * ## Vì sao `nullable`
 *
 * `applyOne` XOÁ field khi giá trị là `null`. Không cho `null` qua là chặn đúng
 * thao tác dọn một field khỏi node cũ.
 *
 * ## Vì sao `repeat` chỉ được kiểm TÊN, không kiểm giá trị ở đây
 *
 * `validateOps` đã có luật riêng cho nó (`repeat_shape` cộng năm luật ngữ nghĩa
 * đi kèm), và câu lỗi của luật ấy nói được thứ zod không nói được: tổ tiên lặp, độ
 * sâu, khoá `map` có thật không. Kiểm hai lần cho ra hai câu lỗi cho một nguyên nhân.
 */
export function zPropsFor(type: string): z.ZodObject<z.ZodRawShape, 'strict'> | null {
  const cached = propsContractCache.get(type);
  if (cached) return cached;

  const branch = nodeBranch(type);
  if (!branch) return null;

  const shape: z.ZodRawShape = {};
  for (const [key, value] of Object.entries(branch.shape)) {
    if ((PROPS_OP_OWNED as readonly string[]).includes(key)) continue;
    shape[key] = key === 'repeat' ? z.unknown() : (value as z.ZodTypeAny).nullable().optional();
  }

  const built = z.object(shape).strict();
  propsContractCache.set(type, built);
  return built;
}

/** Field mà `setProps` đặt được trên một node type — để in ra trong câu lỗi. */
export function propsKeysFor(type: string): string[] {
  const branch = nodeBranch(type);
  if (!branch) return [];
  return Object.keys(branch.shape).filter(
    (k) => !(PROPS_OP_OWNED as readonly string[]).includes(k),
  );
}

export const zDoc = z
  .object({
    /*
     * `CURRENT_SCHEMA_VERSION` chứ không phải một literal gõ tay.
     *
     * Hard-code `1` ở đây nghĩa là ngày schema lên 2, mọi doc ĐÃ MIGRATE bị chính
     * validator từ chối — và nó từ chối ở tầng 1, tức trước mọi phép kiểm khác,
     * nên câu lỗi không nói gì về nguyên nhân thật. Doc luôn đi qua `migrateDoc`
     * trước khi tới đây, nên version hợp lệ duy nhất LÀ version hiện tại.
     */
    schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
    rootId: zNodeId,
    nodes: z.record(zNodeId, zNode),
  })
  .strict();

/* ── Op ───────────────────────────────────────────────────────────────── */

/**
 * Viết tường minh thay vì ghép từ BREAKPOINTS/STYLE_STATES: `z.enum` cần một
 * tuple literal, mà spread của một mảng đã lọc chỉ ra `string[]`. Test bên dưới
 * canh cho danh sách này không lệch khỏi hai nguồn kia.
 */
const STYLE_TARGETS = [
  'base', 'sm', 'md', 'lg', 'xl', 'hover', 'focusVisible', 'inView',
] as const;

/** Dùng trong test để chứng minh STYLE_TARGETS phủ đúng breakpoint + state. */
export const STYLE_TARGET_LIST: readonly string[] = STYLE_TARGETS;

/**
 * Lớp mà `setStyle` ghi vào.
 *
 * ## Vì sao state của effect là một object, không phải chuỗi thứ chín
 *
 * `style.states` nhận tên tuỳ ý (`zResponsiveStyle.states`), nên chuỗi tự do làm
 * `'hover'` mang hai nghĩa — lớp cố định `style.hover`, hay khoá
 * `style.states.hover`? Object thì `applyOne` phân nhánh tường minh.
 *
 * Trước 07/09/2026 target là enum đóng 8 giá trị, nên KHÔNG có op nào ghi được
 * vào `style.states` của một node đã tồn tại — dù schema nhận, compiler phát
 * selector, và hai effect (`nav-collapse`, `nav-invert`) đang ghi state ra DOM.
 * Chỉ đường `insertNode` mang sẵn `style.states` là qua được, tức một bất đối
 * xứng chứ không phải một điều cấm.
 *
 * Tên state là kebab-case chữ thường vì nó phải khớp TÊN ATTRIBUTE mà DOM sinh
 * ra: `el.dataset.carouselReady` ra `data-carousel-ready`, và compiler sinh
 * `[data-<tên>="true"]`. `carousel` đã trả giá cho chuyện này một lần —
 * `statesWritten` khai `'carouselReady'` được nhận rồi sinh selector không bao
 * giờ khớp. `registry.test.ts` canh phía effect; regex này canh phía op.
 */
const zStyleTarget = z.union([
  z.enum(STYLE_TARGETS),
  z
    .object({
      state: z
        .string()
        .regex(/^[a-z][a-z0-9-]*$/, 'tên state là kebab-case, chữ thường')
        .max(40),
    })
    .strict(),
]);

export const zOp = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('insertNode'),
    parentId: zNodeId,
    index: z.number().int().min(0),
    node: zNode,
  }).strict().describe('Chèn một node mới. id phải chưa tồn tại; children phải rỗng.'),

  z.object({ op: z.literal('removeNode'), nodeId: zNodeId }).strict()
    .describe('Xoá node và TOÀN BỘ cây con của nó.'),

  z.object({
    op: z.literal('moveNode'),
    nodeId: zNodeId,
    newParentId: zNodeId,
    newIndex: z.number().int().min(0),
  }).strict(),

  z.object({ op: z.literal('duplicateNode'), nodeId: zNodeId, newId: zNodeId }).strict()
    .describe('Nhân bản CHỈ node đó, không nhân cây con.'),

  z.object({
    op: z.literal('setProps'),
    nodeId: zNodeId,
    props: z.record(z.string(), z.unknown()),
  }).strict().describe(
    'Đổi field riêng của node (tag, variant, action, alt…). Không đụng được ' +
      'id/parentId/children/type/style/effects — mỗi thứ đó có op riêng.',
  ),

  z.object({
    op: z.literal('setStyle'),
    nodeId: zNodeId,
    target: zStyleTarget.describe(
      'base = nền mobile-first mà mọi lớp khác kế thừa. sm/md/lg/xl là override ' +
        'theo min-width (560/900/1200/1560). hover/focusVisible/inView là state. ' +
        'Còn { state: "<tên>" } ghi vào style.states — state do effect gắn trên node ' +
        'điều khiển, tên phải có trong statesWritten của nó (đọc list_effects). ' +
        'Ra CSS [data-n="<id>"][data-<tên>="true"].',
    ),
    patch: zStylePatch.describe('Merge sâu vào lớp đang có. null ở một key = xoá key đó.'),
  }).strict(),

  z.object({
    op: z.literal('setText'),
    nodeId: zNodeId,
    field: z.enum(['content', 'label']),
    value: zRichText,
  }).strict().describe("field = 'content' cho Text, 'label' cho Button."),

  z.object({
    op: z.literal('attachEffect'),
    nodeId: zNodeId,
    attachment: zEffectAttachment,
  }).strict(),

  z.object({
    op: z.literal('updateEffect'),
    nodeId: zNodeId,
    instanceId: z.string().min(1),
    params: z.record(z.string(), z.unknown()),
  }).strict(),

  z.object({
    op: z.literal('detachEffect'),
    nodeId: zNodeId,
    instanceId: z.string().min(1),
  }).strict(),

  z.object({
    op: z.literal('setCustomCss'),
    nodeId: zNodeId,
    css: z.string().max(8000).nullable(),
  }).strict().describe(
    'CSS thô, tự động scope về [data-n="<id>"]. Chỉ viết phần khai báo, không viết ' +
      'selector bao ngoài. null để xoá.',
  ),

  z.object({ op: z.literal('setName'), nodeId: zNodeId, name: z.string().max(120).nullable() }).strict(),

  z.object({
    op: z.literal('setLocked'),
    nodeId: zNodeId,
    locked: z.object({ reason: z.string(), lockedBy: z.string(), lockedAt: z.string() })
      .strict().nullable(),
  }).strict(),

  z.object({
    op: z.literal('setPresence'),
    nodeId: zNodeId,
    /** `null` xoá khoá — mặc định là CÓ render, nên đừng ghi `true` vào doc. */
    render: z.boolean().nullable(),
  }).strict().describe(
    'Có render node ra HTML không. render:false cắt node (và cả cây con) khỏi DOM ở ' +
      'MỌI bề rộng — nó KHÔNG phải ẩn theo màn hình. Muốn ẩn theo breakpoint thì dùng ' +
      'setStyle với layout.display hoặc effects.visibility ở lớp tương ứng; chỉ hai ' +
      'đường đó ra @media thật.',
  ),

  z.object({
    op: z.literal('setOverride'),
    nodeId: zNodeId,
    localId: zNodeId,
    patch: z
      .object({
        content: zRichText.optional(),
        label: zRichText.optional(),
        alt: z.string().max(500).nullable().optional(),
        assetId: z.string().min(1).nullable().optional(),
        // Khoá RIÊNG, không dùng chung `assetId`: `Video` có HAI nguồn asset (xem
        // `ContentOverride.posterAssetId`). Thiếu nó ở nhánh `.strict()` này nghĩa
        // là ảnh chờ của một video trong component không ghi đè và không dịch được
        // — `zInstance.overrides` đã nhận nó, chỉ đường OP là không.
        posterAssetId: z.string().min(1).nullable().optional(),
        href: zHref.optional(),
        a11yLabel: z.string().max(200).nullable().optional(),
        // Thay CẢ bản đồ (`setOverride` chỉ trộn nông theo khoá cấp trên).
        params: zParamOverrides.nullable().optional(),
      })
      .strict()
      .nullable(),
  }).strict().describe(
    'Ghi đè NỘI DUNG cho một node bên trong instance. `localId` là id node trong ' +
      'cây component. Chỉ chữ, ảnh, link và nhãn a11y — style và cấu trúc LUÔN theo ' +
      'component, đó là điểm của instance. `patch: null` gỡ trọn override, tức là ' +
      'quay về nội dung gốc của component.',
  ),
]);

export const zOps = z.array(zOp).min(1).max(80);

/* ── Tiện ích ─────────────────────────────────────────────────────────── */

export const LEAF_TYPE_SET: ReadonlySet<string> = new Set(LEAF_TYPES);
export const NODE_TYPE_LIST: readonly string[] = NODE_TYPES;

/** Lỗi Zod → cùng hình dạng ValidationIssue mà ba tầng còn lại dùng. */
/**
 * Issue thô của Zod, kèm `index` đã tách ra.
 *
 * Có mặt vì `validate.ts` cần chính `ZodIssue` để gợi khoá style gần nhất — phép
 * gợi đó cần `issue.keys` của `unrecognized_keys`, và `zodIssues` đã ném nó đi.
 * Không làm phép gợi ở ĐÂY vì nó phải đọc `zStyleProps`, tức `style-shape.ts`
 * import file này — làm ngược lại là một vòng import.
 */
export function zodIssuesRaw(error: z.ZodError): { index: number; issue: z.ZodIssue }[] {
  return error.issues.slice(0, 10).map((issue) => {
    const first = issue.path[0];
    return { index: typeof first === 'number' ? first : -1, issue };
  });
}

export function zodIssues(error: z.ZodError): { index: number; code: string; message: string }[] {
  return error.issues.slice(0, 10).map((issue) => {
    // Path của một mảng op bắt đầu bằng chỉ số — lấy nó ra để UI hiện lỗi ngay
    // cạnh đúng op, thay vì đổ một cục lỗi không rõ thuộc về op nào.
    const first = issue.path[0];
    return {
      index: typeof first === 'number' ? first : -1,
      code: `zod.${issue.code}`,
      message: `${issue.path.join('.') || 'ops'}: ${issue.message}`,
    };
  });
}

