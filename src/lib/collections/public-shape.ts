/**
 * Entry → object công khai.
 *
 * ## Ba luật không được phá
 *
 *  1. **`assetId` không ra ngoài.** Client không nên phải biết bảng `Asset` tồn tại,
 *     và `blurhash` đi kèm để placeholder mượt mà không cần thêm một lượt gọi. Luật
 *     này áp cả BÊN TRONG một `richdoc`: khối `figure` mang `assetId` ngay trong cây
 *     chữ, nên trả cây đó nguyên trạng là rò `assetId` qua một cửa mà không ai nghĩ
 *     tới lúc đọc `fieldOut`.
 *  2. **Chỉ field CÓ TRONG SCHEMA đi ra.** Xoá một field chỉ ẩn nó (spec §10); nếu
 *     API vẫn trả thì "đã xoá" là một lời nói dối và mobile vẫn thấy nó.
 *  3. **HTML luôn được escape.** Chữ do người nhập gõ; không escape nghĩa là mỗi
 *     lời gọi `?format=html` là một đường XSS cho client.
 *
 * ## `richtext` và `richdoc` là HAI kiểu, không phải một
 *
 * `richtext` là mảng inline (đậm, nghiêng, link) — dùng cho sapo, cho nhãn.
 * `richdoc` thêm một tầng KHỐI (đoạn, tiêu đề, danh sách, ảnh, trích) — dùng cho thân
 * bài. Chiếu cả hai bằng cùng một hàm là mất hết cấu trúc khối, im lặng: mọi đoạn dính
 * làm một, mọi ảnh biến mất. Cùng cặp bẫy mà `entryBodies` trong
 * `src/lib/render/collection-page.ts` phải tránh ở đường render.
 *
 * Thuần, không `server-only`: để test được, và nó không chạm gì.
 */

import type { Block, InlineNode, RichDoc, RichText } from '@/lib/doc/types';
import type { FieldDef, GroupTable } from './field-def';
import { sanitizeArticleHtml } from './html-sanitize';
import { asSeo } from './seo';

export interface PublicAsset {
  url: string;
  width: number | null;
  height: number | null;
  blurhash: string | null;
  mime: string;
  alt: string | null;
}

export type AssetTable = Record<string, Omit<PublicAsset, 'alt'>>;

const ESC: Record<string, string> = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
};
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ESC[c]!);

const BAD_SCHEME = /^\s*(javascript|data|vbscript):/i;

/* ── Inline ───────────────────────────────────────────────────────────── */

export function richTextToHtml(rt: RichText): string {
  return rt.map(inlineToHtml).join('');
}

function inlineToHtml(n: InlineNode): string {
  switch (n.t) {
    case 'text':   return esc(n.v);
    case 'strong': return `<strong>${n.children.map(inlineToHtml).join('')}</strong>`;
    case 'em':     return `<em>${n.children.map(inlineToHtml).join('')}</em>`;
    case 'br':     return '<br>';
    case 'link': {
      // Hai lớp có chủ đích: zod chặn ở đường ghi, nhưng dữ liệu lưu TRƯỚC khi
      // luật đó tồn tại vẫn có thể mang scheme xấu.
      const href = BAD_SCHEME.test(n.href) ? '#' : esc(n.href);
      return `<a href="${href}">${n.children.map(inlineToHtml).join('')}</a>`;
    }
    // `split` là hiệu ứng tách chữ, không phải nội dung — phẳng thành chữ.
    case 'split':  return n.children.map(inlineToHtml).join('');
    case 'counter': return esc(`${n.to}${n.suffix ?? ''}`);
    // API không có ngữ cảnh binding, nên `fallback` là giá trị đúng duy nhất.
    case 'bind':   return esc(n.fallback);
  }
}

/* ── Khối ─────────────────────────────────────────────────────────────── */

/**
 * Khối `figure` sau khi đã thay `assetId` bằng ảnh thật.
 *
 * `image: null` khi asset đã bị xoá — cùng quy ước với field ảnh: một object nửa vời
 * `{ url: undefined }` lọt qua `if (block.image)` rồi vỡ lúc render.
 */
export interface PublicFigure {
  b: 'figure';
  image: PublicAsset | null;
  alt: string;
  decorative?: boolean;
  caption?: RichText;
}

export type PublicBlock = Exclude<Block, { b: 'figure' }> | PublicFigure;

/** `RichDoc` → cùng cây, nhưng không còn `assetId` nào. */
export function richDocToPublic(doc: RichDoc, assets: AssetTable): PublicBlock[] {
  return doc.map((b): PublicBlock => {
    if (b.b !== 'figure') return b;
    const meta = assets[b.assetId];
    return {
      b: 'figure',
      image: meta ? { ...meta, alt: b.alt } : null,
      alt: b.alt,
      ...(b.decorative ? { decorative: true } : {}),
      ...(b.caption ? { caption: b.caption } : {}),
    };
  });
}

/**
 * `RichDoc` → HTML.
 *
 * Tên thẻ đến từ một bảng ĐÓNG, không từ `b.b` nối chuỗi: `b` là dữ liệu JSONB thô và
 * một hàng lưu trước khi `zRichDoc` tồn tại có thể mang bất cứ chuỗi nào ở đó. Nối
 * thẳng vào `<${b.b}>` là chèn thẻ tuỳ ý — cùng loại lỗ với `href` không lọc scheme.
 */
const BLOCK_TAG = { p: 'p', h2: 'h2', h3: 'h3', h4: 'h4' } as const;

export function richDocToHtml(doc: RichDoc, assets: AssetTable): string {
  return doc
    .map((b) => {
      switch (b.b) {
        case 'p':
        case 'h2':
        case 'h3':
        case 'h4': {
          const tag = BLOCK_TAG[b.b];
          return `<${tag}>${richTextToHtml(b.children)}</${tag}>`;
        }
        case 'ul':
        case 'ol': {
          const tag = b.b === 'ul' ? 'ul' : 'ol';
          const items = b.items.map((it) => `<li>${richTextToHtml(it.children)}</li>`).join('');
          return `<${tag}>${items}</${tag}>`;
        }
        case 'quote':
          return `<blockquote>${richTextToHtml(b.children)}</blockquote>`;
        case 'figure': {
          const meta = assets[b.assetId];
          // Asset đã xoá: bỏ `<img>`, GIỮ `<figcaption>`. Một chú thích không có ảnh
          // vẫn đọc được; một `<img src="undefined">` là một ô vỡ trên trang.
          const img = meta
            ? `<img src="${esc(meta.url)}" alt="${esc(b.alt)}"` +
              (meta.width ? ` width="${meta.width}"` : '') +
              (meta.height ? ` height="${meta.height}"` : '') +
              '>'
            : '';
          const cap = b.caption ? `<figcaption>${richTextToHtml(b.caption)}</figcaption>` : '';
          return `<figure>${img}${cap}</figure>`;
        }
        case 'hr':
          return '<hr>';
      }
    })
    .join('');
}

/* ── Field ────────────────────────────────────────────────────────────── */

function assetOut(v: unknown, assets: AssetTable): PublicAsset | null {
  if (typeof v !== 'object' || v === null) return null;
  const pick = v as { assetId?: unknown; alt?: unknown };
  if (typeof pick.assetId !== 'string') return null;
  const meta = assets[pick.assetId];
  // Asset đã bị xoá: trả `null` chứ không trả một object nửa vời — client kiểm
  // `if (cover)` sẽ đúng, còn `{ url: undefined }` thì lọt qua và vỡ lúc render.
  if (!meta) return null;
  return { ...meta, alt: typeof pick.alt === 'string' ? pick.alt : null };
}

export interface ShapeOpts {
  assets: AssetTable;
  format: 'json' | 'html';
  /**
   * Host được phép cho `<iframe>` của field `html`. KHÔNG optional, có chủ đích.
   *
   * Field `html` đi ra API là một chuỗi đi vào `innerHTML` của client — app mobile,
   * một trang Next khác, một widget nhúng. Đường ghi đã làm sạch, nhưng luật 3 ở đầu
   * file ("HTML luôn được escape") tồn tại vì đường ghi KHÔNG phải nguồn duy nhất:
   * còn những hàng ghi trước khi `html-sanitize.ts` ra đời, còn SQL sửa tay, còn
   * một bản import. Nên đường đọc làm sạch lần nữa, và nó cần danh sách host.
   *
   * Bắt buộc khai để trình biên dịch chỉ đúng vào chỗ gọi mới, thay vì để một mặc
   * định ngầm `[]` âm thầm xoá mọi video khỏi API mà site vẫn hiện.
   */
  iframeHosts: readonly string[];
}

/** Mọi kiểu field CÓ giá trị trong `data` — `taxonomy` không có, xem `toPublicData`. */
type DataField = Exclude<FieldDef, { t: 'taxonomy' }>;

/**
 * Giá trị RỖNG của một field, quyết định bởi KIỂU của nó — không phải `null` cho tất cả.
 *
 * Luật: field hình dạng MẢNG rỗng là `[]`, field `richtext`/`richdoc` ở `format=html`
 * rỗng là `''`, còn lại là `null`. Một bộ decode ở client nhờ đó không bao giờ phải
 * hỏi "khoá này là mảng hay null" — nó `map` thẳng.
 *
 * Vì sao đây là chỗ đáng có một hàm riêng thay vì `return null` sớm: `null` cho một
 * field mảng đẩy phép kiểm sang MỌI client, và bản quên `?? []` sẽ vỡ đúng lúc biên
 * tập viên chưa điền field — tức lúc không ai đang xem log. Đo ngày 28/08/2026 trên
 * chính API này: `ctas`, `zone`, `related` cùng trả `null` trong khi tài liệu §3 hứa
 * `[]`.
 *
 * Áp cho cả trường hợp `raw` CÓ nhưng sai hình dạng (JSONB cũ, ghi trước khi validator
 * tồn tại): hai đường đó phải ra cùng một giá trị, nếu không client lại có hai ca.
 */
function emptyOut(f: DataField, opts: ShapeOpts): unknown {
  switch (f.t) {
    case 'richtext':
    case 'richdoc':
      return opts.format === 'html' ? '' : [];
    // `html` là CHUỖI ở cả hai format — không có cây JSON nào để trả.
    case 'html':
      return '';
    case 'image':
      return f.multiple ? [] : null;
    case 'blocks':
      return [];
    case 'group':
      return f.repeatable ? [] : null;
    case 'relation':
      return f.cardinality === 'many' ? [] : null;
    default:
      return null;
  }
}

function fieldOut(f: DataField, raw: unknown, groups: GroupTable, opts: ShapeOpts): unknown {
  if (raw === undefined || raw === null) return emptyOut(f, opts);

  switch (f.t) {
    case 'richtext':
      if (!Array.isArray(raw)) return emptyOut(f, opts);
      return opts.format === 'html' ? richTextToHtml(raw as RichText) : raw;

    case 'richdoc':
      if (!Array.isArray(raw)) return emptyOut(f, opts);
      return opts.format === 'html'
        ? richDocToHtml(raw as RichDoc, opts.assets)
        : richDocToPublic(raw as RichDoc, opts.assets);

    /*
     * Làm sạch LẦN NỮA ở đường đọc. Không phải vì không tin `entry-data.ts`.
     *
     * Xem docblock của `iframeHosts` trong `ShapeOpts`. Chi phí là một lượt parse
     * cho mỗi field `html` mỗi lời gọi API; nó nằm sau `unstable_cache` của
     * `public-read.ts` nên trả một lần cho mỗi lần revalidate, không mỗi request.
     */
    case 'html':
      if (typeof raw !== 'string') return emptyOut(f, opts);
      return sanitizeArticleHtml(raw, { iframeHosts: opts.iframeHosts }).html;

    case 'image': {
      // `multiple` chỉ có trên nhánh `image` — `file` KHÔNG có nó (xem `FieldDef`),
      // nên gộp hai case rồi đọc `f.multiple` không biên dịch được.
      if (!f.multiple) return assetOut(raw, opts.assets);
      return Array.isArray(raw)
        ? raw.map((v) => assetOut(v, opts.assets)).filter((a): a is PublicAsset => a !== null)
        : [];
    }

    case 'file':
      return assetOut(raw, opts.assets);

    case 'group': {
      const inner = groups[f.groupKey];
      // Nhóm mồ côi: trả nguyên trạng. Trả `null` làm dữ liệu biến mất vì một tham
      // chiếu hỏng ở tầng schema, thứ mà client không sửa được.
      if (!inner) return raw;
      if (f.repeatable) {
        return Array.isArray(raw)
          ? raw.map((v) => toPublicData(v as Record<string, unknown>, inner, groups, opts))
          : [];
      }
      if (typeof raw !== 'object' || Array.isArray(raw)) return emptyOut(f, opts);
      return toPublicData(raw as Record<string, unknown>, inner, groups, opts);
    }

    /**
     * Quan hệ: `string | null`, hoặc `string[]` khi `cardinality: 'many'` — hình dạng
     * do KIỂU quyết định, không do thứ đang nằm trong JSONB.
     *
     * Trước đây nhánh này rơi vào `default: return raw`, nên một hàng cũ chứa một
     * chuỗi ở field `many` sẽ trả ra một chuỗi, và client `map` lên nó là vỡ. `populate`
     * ghi đè giá trị này (xem `applyPopulate`), nhưng chỉ khi client hỏi.
     */
    case 'relation':
      if (f.cardinality === 'many') {
        return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : [];
      }
      return typeof raw === 'string' ? raw : null;

    case 'blocks': {
      if (!Array.isArray(raw)) return [];
      return raw.map((v) => {
        const rec = (typeof v === 'object' && v !== null ? v : {}) as Record<string, unknown>;
        const bk = typeof rec.__type === 'string' ? rec.__type : '';
        const inner = groups[bk];
        // Khối mồ côi đi ra nguyên trạng: client biết `__type` và tự quyết định
        // bỏ qua. Lọc nó ở đây làm số khối lệch giữa admin và API.
        if (!inner) return rec;
        return { __type: bk, ...toPublicData(rec, inner, groups, opts) };
      });
    }

    // Lối thoát: đi ra nguyên trạng, không biến đổi.
    case 'json':
      return raw;

    /*
     * GIÁ TRỊ GHI ĐÈ, không phải giá trị đã rơi về — `data` của API là dữ liệu của bài,
     * như mọi field khác. Giá trị hiệu lực (tiêu đề nối template, mô tả suy ra) phụ
     * thuộc trang mẫu và cài đặt site, tức chuyện của renderer.
     *
     * Mọi khoá luôn có mặt, `null`/`false` khi trống: cùng tinh thần `emptyOut`. Ảnh OG
     * ra `PublicAsset`, không ra `assetId` — đúng luật của field `image`.
     */
    case 'seo': {
      const s = asSeo(raw);
      // Form lưu `{}` cho mọi bài mới (`emptyValue`) — `{}` và "vắng" là CÙNG một trạng
      // thái "chưa đặt ô nào", nên ra cùng một hình dạng: `null`.
      if (Object.keys(s).length === 0) return null;
      return {
        metaTitle: s.metaTitle ?? null,
        metaDescription: s.metaDescription ?? null,
        keywords: s.keywords ?? null,
        ogImage: s.ogImage?.assetId ? assetOut(s.ogImage, opts.assets) : null,
        canonicalUrl: s.canonicalUrl ?? null,
        noindex: s.noindex === true,
        structuredData: s.structuredData ?? null,
      };
    }

    default:
      return raw;
  }
}

export function toPublicData(
  data: Record<string, unknown>,
  fields: FieldDef[],
  groups: GroupTable,
  opts: ShapeOpts,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  // Đi theo SCHEMA, không theo khoá của `data`: đó là điều làm field đã xoá không
  // rò ra API.
  for (const f of fields) {
    /*
     * Field `taxonomy` KHÔNG có khoá trong object trả về.
     *
     * Giá trị của nó không sống trong `data` — liên kết ở bảng `EntryTaxonomy`, và
     * `entry-data.ts` đã loại nó khỏi validator của `data` vì đúng lý do đó. Nhưng
     * JSONB của những hàng ghi TRƯỚC luật ấy vẫn còn `{"cats":["cmt1gnf…"]}`, và
     * nhánh `default` cũ trả nguyên trạng — tức API công khai đẩy cuid nội bộ của
     * danh mục ra ngoài. Đo ngày 28/08/2026 trên entry seed: `"cats":["cmt1gnf2u…"]`.
     *
     * Cùng loại rò với `assetId` ở luật 1 đầu file, và cùng cách chặn: đi theo schema
     * và BỎ nó ở đây, một chỗ. Danh mục của entry ra ngoài bằng khoá `taxonomies` cấp
     * entry (`key` + `name`), nơi client gõ được.
     */
    if (f.t === 'taxonomy') continue;
    out[f.key] = fieldOut(f, data[f.key], groups, opts);
  }
  return out;
}

/**
 * Mọi `assetId` xuất hiện ở BẤT KỲ đâu trong một `data` thô.
 *
 * Quét mù theo khoá `assetId` chứ không đi theo schema: khối `figure` của một
 * `richdoc` nằm sâu trong một cây chữ, và một nhóm lặp có thể lồng ba tầng. Đi theo
 * schema ở đây nghĩa là viết lại phép duyệt của `fieldOut` một lần nữa — và bản quên
 * cập nhật sẽ là bản làm ảnh biến mất, im lặng.
 */
export function collectAssetIds(value: unknown, into: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const v of value) collectAssetIds(v, into);
    return into;
  }
  if (typeof value !== 'object' || value === null) return into;
  const rec = value as Record<string, unknown>;
  if (typeof rec.assetId === 'string') into.add(rec.assetId);
  for (const v of Object.values(rec)) collectAssetIds(v, into);
  return into;
}
