/**
 * Tên danh mục theo ngôn ngữ — phần THUẦN.
 *
 * `Taxonomy.i18n` là map `locale → { name }`, cùng khuôn với `Entry.i18n`: một lớp
 * phủ lên cột gốc, ngôn ngữ mặc định không có khoá nào (quy ước `locale ===
 * undefined`, xem `entry-locale.ts`).
 *
 * ## Vì sao chưa dịch thì rơi về tên gốc, khác hẳn entry
 *
 * Entry chưa dịch thì VẮNG khỏi `/en` — một bài nửa Việt nửa Anh là nội dung hỏng.
 * Danh mục thì không vắng được: nó chỉ là nhãn của những bài ĐÃ dịch. Một tab trống
 * chữ trông như lỗi, còn một nhãn tiếng Việt trên trang tiếng Anh thì ít ra vẫn bấm
 * được và nói đúng chuyện.
 *
 * Không `server-only`: trang quản trị danh mục (client) đọc cùng luật này.
 */

export type TaxonomyI18n = Record<string, { name: string }>;

function asMap(i18n: unknown): Record<string, unknown> {
  return i18n !== null && typeof i18n === 'object' && !Array.isArray(i18n)
    ? (i18n as Record<string, unknown>)
    : {};
}

/** Tên đã dịch của một ngôn ngữ, hoặc `null` khi chưa dịch / dữ liệu hỏng. */
export function translatedName(i18n: unknown, locale: string): string | null {
  const entry = asMap(i18n)[locale];
  if (entry === null || typeof entry !== 'object') return null;
  const name = (entry as { name?: unknown }).name;
  return typeof name === 'string' && name.trim() ? name.trim() : null;
}

/** Tên hiện cho người đọc ở `locale`. `undefined` = ngôn ngữ mặc định. */
export function taxonomyName(t: { name: string; i18n?: unknown }, locale: string | undefined): string {
  if (!locale) return t.name;
  return translatedName(t.i18n, locale) ?? t.name;
}

/**
 * `i18n` mới sau khi đặt (hoặc gỡ, khi `name` rỗng/`null`) tên của một ngôn ngữ.
 *
 * Giữ nguyên bản của các ngôn ngữ khác, và bỏ những khoá hỏng có sẵn thay vì chép
 * chúng sang — mỗi lần ghi là một lần cột này sạch lại.
 */
export function setTaxonomyName(i18n: unknown, locale: string, name: string | null): TaxonomyI18n {
  const out: TaxonomyI18n = {};
  for (const code of Object.keys(asMap(i18n))) {
    const existing = translatedName(i18n, code);
    if (existing && code !== locale) out[code] = { name: existing };
  }
  const next = name?.trim();
  if (next) out[locale] = { name: next };
  return out;
}
