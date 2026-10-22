/**
 * Điều chỉnh sitemap tự sinh: `Site.sitemapRules = { include?, exclude? }`.
 *
 * Không cho thay cả file XML (spec D8): sửa tay XML là sitemap thôi cập nhật theo bài
 * mới — đúng lúc bài mới cần được crawl nhất. Hai việc người dùng thật sự cần là
 * LOẠI một nhánh đường dẫn (trang thử, chiến dịch đã hết) và THÊM vài URL không do
 * builder dựng.
 */

export const MAX_SITEMAP_RULES = 200;

export interface SitemapRules {
  /** Đường dẫn bắt đầu bằng `/`, hoặc URL tuyệt đối cùng origin. */
  include: string[];
  /** Tiền tố đường dẫn, bắt đầu bằng `/`. */
  exclude: string[];
}

export interface SitemapEntryLike {
  url: string;
  lastModified?: string | Date;
  changeFrequency?: 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never';
  priority?: number;
}

function strings(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((s): s is string => typeof s === 'string')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, MAX_SITEMAP_RULES);
}

/** JSON trong DB → luật. Phần tử sai dạng bị BỎ, không ném: sitemap không được sập vì một dòng gõ sai. */
export function parseSitemapRules(json: unknown): SitemapRules {
  const o = json && typeof json === 'object' ? (json as Record<string, unknown>) : {};
  return {
    include: strings(o.include),
    exclude: strings(o.exclude).filter((p) => p.startsWith('/')),
  };
}

/** Kiểm khi LƯU — trả lỗi tiếng Việt cho từng dòng sai, thay vì lặng lẽ bỏ như lúc đọc. */
export function checkSitemapRules(rules: { include: string[]; exclude: string[] }, origin: string): string[] {
  const errors: string[] = [];
  if (rules.include.length > MAX_SITEMAP_RULES || rules.exclude.length > MAX_SITEMAP_RULES) {
    errors.push(`Mỗi danh sách tối đa ${MAX_SITEMAP_RULES} dòng.`);
  }
  for (const p of rules.exclude) {
    if (!p.startsWith('/')) errors.push(`Tiền tố loại trừ phải bắt đầu bằng "/": ${p}`);
  }
  for (const u of rules.include) {
    if (resolveInclude(u, origin) === null) {
      errors.push(`URL thêm vào phải là đường dẫn bắt đầu bằng "/" hoặc URL thuộc ${origin}: ${u}`);
    }
  }
  return errors;
}

function resolveInclude(raw: string, origin: string): string | null {
  if (raw.startsWith('/')) return `${origin}${raw === '/' ? '' : raw}`;
  try {
    const u = new URL(raw);
    if (u.origin !== new URL(origin).origin) return null;
    return u.href.replace(/\/$/, u.pathname === '/' ? '' : '/');
  } catch {
    return null;
  }
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname || '/';
  } catch {
    return url;
  }
}

/**
 * Áp luật lên danh sách tự sinh: loại theo tiền tố, rồi thêm URL (bỏ trùng).
 *
 * Tiền tố so theo ĐOẠN: `/tin-tuc` loại `/tin-tuc` và `/tin-tuc/abc`, không loại
 * `/tin-tuc-cu`. So chuỗi trần thì một tiền tố ngắn nuốt mất những nhánh không ai
 * định loại.
 */
/**
 * `localeCodes` — mã các ngôn ngữ KHÔNG mặc định (`en`). Từ 21/10/2026 sitemap phát cả
 * `/en/...` của bài viết, và luật người dùng viết trước đó (`/blogs/test`) phải loại luôn
 * bản tiếng Anh của nhánh ấy — không thì nhánh đã ẩn hiện lại bằng tiếng Anh, im lặng.
 * Luật viết thẳng tiền tố (`/en/blogs/test`) vẫn chỉ loại đúng ngôn ngữ đó.
 */
export function applySitemapRules<T extends SitemapEntryLike>(
  entries: T[],
  rules: SitemapRules,
  origin: string,
  localeCodes: readonly string[] = [],
): (T | SitemapEntryLike)[] {
  const matches = (path: string) =>
    rules.exclude.some((p) => {
      const prefix = p.replace(/\/+$/, '') || '/';
      return prefix === '/' ? true : path === prefix || path.startsWith(`${prefix}/`);
    });
  const withoutLocale = (path: string) => {
    for (const code of localeCodes) {
      if (path === `/${code}`) return '/';
      if (path.startsWith(`/${code}/`)) return path.slice(code.length + 1);
    }
    return null;
  };
  const excluded = (url: string) => {
    const path = pathOf(url);
    if (matches(path)) return true;
    const bare = withoutLocale(path);
    // Trang chủ ngôn ngữ (`/en`) không bị luật nào khác `/` loại theo — `/` loại tất cả rồi.
    return bare !== null && bare !== '/' && matches(bare);
  };

  const out: (T | SitemapEntryLike)[] = entries.filter((e) => !excluded(e.url));
  const seen = new Set(out.map((e) => e.url));
  for (const raw of rules.include) {
    const url = resolveInclude(raw, origin);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push({ url, changeFrequency: 'weekly', priority: 0.5 });
  }
  return out;
}
