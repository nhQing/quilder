/**
 * Field `seo` — MỌI luật SEO của một entry nằm ở đây, một chỗ.
 *
 * Validator (`entry-data.ts`), lớp phủ ngôn ngữ (`i18n.ts`), renderer
 * (`collection-page.ts`, `[[...slug]]/page.tsx`), sitemap, API công khai và form admin
 * đều đọc file này. Chép luật sang chỗ khác là đúng cái lỗi "validator nhận ≠ renderer
 * đọc": ô lưu được mà site không hiện, hoặc khung xem trước Google trong form nói một
 * đằng còn `<title>` thật nói một nẻo.
 *
 * ## Mọi ô đều là GIÁ TRỊ GHI ĐÈ (21/10/2026)
 *
 * Ô trống thì rơi về luật suy ra có từ trước: `titleField`, `excerpt/summary/…`, ảnh
 * đầu tiên — xem `resolveEntrySeo`. Lý do giữ luật suy ra: người biên tập sẽ để trống
 * phần lớn các ô, và một `<title>` trống là thứ Google hiển thị.
 *
 * Tên khoá con khớp component `shared.seo` của Strapi, để dữ liệu nhập lại được.
 *
 * Thuần, không `server-only`, không DB: form admin (client) dùng chung.
 */


import type { FieldDef } from './field-def';

export const SEO_LIMITS = {
  /** Google thường cắt tiêu đề sau khoảng này — chỉ cảnh báo. */
  titleWarn: 60,
  titleMax: 120,
  descWarn: 160,
  descMax: 300,
  keywordsMax: 500,
  altMax: 300,
  /** `JSON.stringify(structuredData).length`. */
  structuredMax: 20_000,
} as const;

export type JsonLd = Record<string, unknown> | Record<string, unknown>[];

export interface SeoValue {
  metaTitle?: string;
  metaDescription?: string;
  keywords?: string;
  /** `alt` một mình hợp lệ: lớp phủ ngôn ngữ dịch alt của ảnh bản gốc. */
  ogImage?: { assetId?: string; alt?: string };
  /** Luôn là ĐƯỜNG DẪN (`/blogs/x`), không bao giờ URL tuyệt đối — xem `normalizeCanonical`. */
  canonicalUrl?: string;
  /** Chỉ có mặt khi `true`. */
  noindex?: boolean;
  structuredData?: JsonLd;
}

/** Đếm theo code point: người viết đếm một emoji là một ký tự, `s.length` đếm hai. */
export function charCount(s: string): number {
  return [...s].length;
}

/* ── canonical ─────────────────────────────────────────────────────────── */

function bareHost(h: string): string {
  return h.toLowerCase().replace(/^www\./, '');
}

/**
 * Canonical chỉ được trỏ vào CHÍNH site này, và được lưu dưới dạng đường dẫn.
 *
 * Lưu đường dẫn để cùng một dữ liệu chạy được trên local, stg và prod: `metadataBase`
 * của layout ghép origin lúc render. Lưu URL tuyệt đối thì bài nhập từ prod có
 * canonical trỏ prod ngay trên stg.
 *
 * `//host/x` bị từ chối dù trông như một đường dẫn: trình duyệt và Google đọc nó là URL
 * không giao thức tới `host`. `/\host` cũng vậy — trình duyệt đổi `\` thành `/`.
 *
 * `siteHost` `null` = site chưa đặt domain: không có gì để so, nên chỉ nhận đường dẫn.
 */
export function normalizeCanonical(
  raw: string,
  siteHost: string | null,
): { ok: true; path: string } | { ok: false; error: string } {
  const bad = siteHost
    ? `Đường dẫn chuẩn phải thuộc site này (${siteHost}). Nhập dạng /duong-dan.`
    : 'Đường dẫn chuẩn phải là đường dẫn trên site, dạng /duong-dan.';
  const s = raw.trim();
  if (/\s/.test(s)) return { ok: false, error: bad };

  if (s.startsWith('/')) {
    if (s.startsWith('//') || s.startsWith('/\\')) return { ok: false, error: bad };
    return { ok: true, path: s.split('#')[0]! };
  }

  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return { ok: false, error: bad };
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, error: bad };
  if (!siteHost || bareHost(u.host) !== bareHost(siteHost)) return { ok: false, error: bad };
  return { ok: true, path: (u.pathname || '/') + u.search };
}

/* ── đọc JSONB thô ─────────────────────────────────────────────────────── */

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

/**
 * JSON-LD có NỘI DUNG: object có ít nhất một khoá, hoặc mảng toàn object như thế.
 *
 * `{}` và `[{}]` tính là KHÔNG khai: JSON-LD của bài thắng JSON-LD của trang mẫu và
 * `Article` tự sinh (`pickJsonLd`), nên một `{}` gõ nhầm — hay một `structured_data`
 * rỗng nhập từ Strapi — sẽ xoá sạch structured data của trang mà không ai thấy.
 */
export function isJsonLd(v: unknown): v is JsonLd {
  const obj = (x: unknown) =>
    typeof x === 'object' && x !== null && !Array.isArray(x) && Object.keys(x).length > 0;
  return obj(v) || (Array.isArray(v) && v.length > 0 && v.every(obj));
}

/**
 * Giá trị SEO đọc PHÒNG THỦ từ JSONB, không ném.
 *
 * Đường đọc không tin đường ghi: còn hàng ghi bằng SQL tay, còn hàng nhập bằng script.
 * Khoá sai kiểu bị bỏ như thể trống — tức rơi về luật suy ra, thứ luôn an toàn.
 */
export function asSeo(v: unknown): SeoValue {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return {};
  const r = v as Record<string, unknown>;
  const out: SeoValue = {};
  const metaTitle = str(r.metaTitle);
  const metaDescription = str(r.metaDescription);
  const keywords = str(r.keywords);
  if (metaTitle) out.metaTitle = metaTitle;
  if (metaDescription) out.metaDescription = metaDescription;
  if (keywords) out.keywords = keywords;
  if (typeof r.ogImage === 'object' && r.ogImage !== null) {
    const img = r.ogImage as Record<string, unknown>;
    const assetId = str(img.assetId);
    const alt = str(img.alt);
    if (assetId || alt) out.ogImage = { ...(assetId ? { assetId } : {}), ...(alt ? { alt } : {}) };
  }
  const canonicalUrl = str(r.canonicalUrl);
  if (canonicalUrl) out.canonicalUrl = canonicalUrl;
  if (r.noindex === true) out.noindex = true;
  if (isJsonLd(r.structuredData)) out.structuredData = r.structuredData;
  return out;
}

/** Khoá của field `seo` trong một schema. Tìm theo KIỂU: đổi tên khoá không làm gãy gì. */
export function seoKeyOf(fields: readonly FieldDef[]): string | null {
  return fields.find((f) => f.t === 'seo')?.key ?? null;
}

/* ── ngôn ngữ ──────────────────────────────────────────────────────────── */

/**
 * Giá trị SEO hiệu lực của một ngôn ngữ KHÔNG mặc định.
 *
 * Chỉ `ogImage.assetId` kế thừa bản gốc — ảnh không mang ngôn ngữ. Mọi thứ khác KHÔNG
 * kế thừa, có chủ đích:
 *
 *  - Chữ: không có tiêu đề SEO tiếng Anh thì luật suy ra trên dữ liệu tiếng Anh (tiêu
 *    đề bài tiếng Anh) đúng hơn hẳn tiêu đề SEO tiếng Việt.
 *  - `canonicalUrl`: kế thừa là bảo Google "trang tiếng Anh là bản sao của trang tiếng
 *    Việt, hãy bỏ nó" — bản tiếng Anh biến khỏi Google mà không có lỗi nào.
 *  - `noindex`: mỗi ngôn ngữ có trạng thái đăng riêng; kế thừa thì tab tiếng Anh cần
 *    một ô ba trạng thái mà biên tập viên không hiểu.
 *  - `structuredData`: JSON-LD tiếng Việt trên trang tiếng Anh.
 *
 * Áp CẢ khi không có lớp phủ nào — đó chính là ca nguy hiểm nhất.
 */
export function localizeSeo(base: unknown, overlay: unknown): SeoValue {
  const b = asSeo(base);
  const { ogImage, ...own } = asSeo(overlay);
  const out: SeoValue = own;
  const assetId = ogImage?.assetId ?? b.ogImage?.assetId;
  if (assetId) out.ogImage = { assetId, ...(ogImage?.alt ? { alt: ogImage.alt } : {}) };
  return out;
}

/** Có ô CHỮ nào không — thứ duy nhất của field SEO có thể "dịch". */
export function hasSeoText(v: unknown): boolean {
  const s = asSeo(v);
  return Boolean(s.metaTitle || s.metaDescription || s.keywords || s.ogImage?.alt);
}

/* ── luật rơi về ───────────────────────────────────────────────────────── */

export interface EntrySeo {
  /** Không bao giờ là `''`. */
  title: string | null;
  /** `true` khi lấy từ `metaTitle` — render dạng `title.absolute`, không nối template. */
  titleIsOverride: boolean;
  /** Không bao giờ là `''`; cắt 300. */
  description: string | null;
  /** Tiêu đề CỦA BÀI (`titleField`), bỏ qua `metaTitle` — cho `Article.headline`. */
  articleTitle: string | null;
  /** Mô tả suy ra, bỏ qua `metaDescription`. */
  articleDescription: string | null;
  imageAssetId: string | null;
  /** Alt của ảnh OG ĐÃ KHAI, chỉ có khi ảnh đó là `imageAssetId`. */
  imageAlt: string | null;
  keywords: string | null;
  noindex: boolean;
  /** Đường dẫn đã kiểm, hoặc `null` = dùng luật mặc định (bài trỏ về chính nó). */
  canonical: string | null;
  jsonLd: JsonLd | null;
}

/** Khoá thường dùng cho mô tả ngắn, theo thứ tự ưu tiên. */
const DESCRIPTION_KEYS = ['excerpt', 'summary', 'description', 'sapo', 'mo_ta'];

/** Trần 300: dài hơn thì mọi công cụ cắt, và cắt ở đây thì ta chọn được chỗ cắt. */
const DESCRIPTION_CUT = 300;

function derivedDescription(shape: { titleField: string | null; fields: readonly FieldDef[] }, data: Record<string, unknown>) {
  for (const key of DESCRIPTION_KEYS) {
    const v = data[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  const firstText = shape.fields.find(
    (f) => f.t === 'text' && f.key !== shape.titleField && typeof data[f.key] === 'string',
  );
  const v = firstText ? data[firstText.key] : undefined;
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function firstImage(fields: readonly FieldDef[], data: Record<string, unknown>): string | null {
  for (const f of fields) {
    if (f.t !== 'image') continue;
    const v = data[f.key];
    const pick = Array.isArray(v) ? v[0] : v;
    if (typeof pick === 'object' && pick !== null && typeof (pick as { assetId?: unknown }).assetId === 'string') {
      return (pick as { assetId: string }).assetId;
    }
  }
  return null;
}

/**
 * Metadata của một entry: ô SEO đã điền trước, luật suy ra sau.
 *
 * `data` là dữ liệu ĐÃ phủ ngôn ngữ (`applyEntryLocale` với `seoKey`), nên với `/en`
 * field SEO ở đây đã qua `localizeSeo`.
 *
 * Canonical được kiểm LẠI ở đây bằng `normalizeCanonical(…, null)` — chỉ nhận đường
 * dẫn. Đường ghi đã cắt URL về đường dẫn, nên mọi giá trị hợp lệ đều qua; thứ không
 * qua là JSONB sửa tay, và nó rơi về luật mặc định thay vì trỏ Google ra domain khác.
 */
export function resolveEntrySeo(
  shape: { titleField: string | null; fields: readonly FieldDef[] },
  data: Record<string, unknown>,
  /**
   * `derive: false` — CHỈ giá trị ghi đè, không luật suy ra. Cho trang danh mục đọc SEO
   * của bản ghi đích: suy ra từ tên danh mục là đổi `<title>` của mọi trang danh mục
   * đang chạy, kể cả loại chưa ai điền SEO.
   */
  opts: { derive?: boolean } = {},
): EntrySeo {
  const derive = opts.derive !== false;
  const key = seoKeyOf(shape.fields);
  const s = key ? asSeo(data[key]) : {};

  const titleRaw = derive && shape.titleField ? data[shape.titleField] : undefined;
  const articleTitle = typeof titleRaw === 'string' && titleRaw.trim() ? titleRaw.trim() : null;
  const desc = derive ? derivedDescription(shape, data) : null;
  const articleDescription = desc ? desc.slice(0, DESCRIPTION_CUT) : null;

  const canonical = s.canonicalUrl ? normalizeCanonical(s.canonicalUrl, null) : null;

  return {
    title: s.metaTitle ?? articleTitle,
    titleIsOverride: Boolean(s.metaTitle),
    description: s.metaDescription ? s.metaDescription.slice(0, DESCRIPTION_CUT) : articleDescription,
    articleTitle,
    articleDescription,
    imageAssetId: s.ogImage?.assetId ?? (derive ? firstImage(shape.fields, data) : null),
    imageAlt: s.ogImage?.assetId && s.ogImage.alt ? s.ogImage.alt : null,
    keywords: s.keywords ?? null,
    noindex: s.noindex === true,
    canonical: canonical?.ok ? canonical.path : null,
    jsonLd: s.structuredData ?? null,
  };
}
