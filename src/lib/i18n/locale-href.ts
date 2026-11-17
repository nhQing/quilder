/**
 * Link nội bộ theo ngôn ngữ đang phục vụ.
 *
 * ## Vì sao làm ở renderer, không bắt tác giả gõ `/en/...`
 *
 * Doc là MỘT cây cho mọi ngôn ngữ: nút "Xem tất cả" mang `href: '/blogs'` và bản dịch
 * chỉ phủ CHỮ. Trước 17/11/2026 trang `/en/blogs` vì thế đưa khách sang `/blogs` (tiếng
 * Việt) ở mọi link chưa có bản dịch `href` riêng — người đọc tiếng Anh bấm một nút là rơi
 * về tiếng Việt. Dịch `href` từng nút trên từng trang là việc không ai làm hết được; một
 * luật ở chỗ render thì đúng cho mọi link, kể cả link của thẻ tin dựng từ slug.
 *
 * ## Không đụng tới
 *
 * Link ngoài (`https://`, `//`, `mailto:`, `tel:`), hash thuần (`#x`), link đã mang tiền
 * tố của MỘT ngôn ngữ đang bật (`/en/...` — bản dịch `href` cũ vẫn đúng), và đường dẫn
 * tới file hay route hệ thống (`/_next`, `/api`, `/mm-css`, có đuôi file) — chúng không
 * có bản theo ngôn ngữ.
 *
 * ## Nút đổi ngôn ngữ
 *
 * Node mang part `locale-<mã>` (vd `locale-vi`, `locale-en`) là nút ĐỔI ngôn ngữ: href
 * của nó là bản của CHÍNH trang đang xem ở ngôn ngữ đó (`alternates` — cùng bảng mà
 * trang khai cho hreflang), và nó KHÔNG bị gắn tiền tố của ngôn ngữ hiện tại. Không có
 * bản ở ngôn ngữ đó (bài chưa đăng bản dịch) thì về trang chủ của ngôn ngữ đó.
 */

export interface LinkLocale {
  /** Mã ngôn ngữ đang phục vụ, ví dụ `vi`, `en`. */
  code: string;
  /** Ngôn ngữ mặc định (không có tiền tố URL) không? */
  isDefault: boolean;
  /** Mã của MỌI ngôn ngữ đang bật — để nhận ra link đã có tiền tố. */
  codes: readonly string[];
  /** Mã của ngôn ngữ mặc định — nút `locale-<mã mặc định>` về đường không tiền tố. */
  defaultCode: string;
  /** Đường dẫn của trang đang xem theo từng mã ngôn ngữ (hreflang). */
  alternates?: Readonly<Record<string, string>>;
}

const SYSTEM_PREFIX = /^\/(?:_next|api|mm-css|mm-font|fonts|builder|preview|render)(?:[/?#]|$)/;
/** Đoạn cuối có đuôi file (`/files/bao-cao.pdf`) — file không có bản theo ngôn ngữ. */
const FILE_TAIL = /\/[^/?#]+\.[a-z0-9]{2,5}(?:[?#]|$)/i;

function hasLocalePrefix(href: string, codes: readonly string[]): boolean {
  const first = href.slice(1).split(/[/?#]/, 1)[0]?.toLowerCase() ?? '';
  return codes.some((c) => c.toLowerCase() === first);
}

/** Href nội bộ `/...` → bản có tiền tố của ngôn ngữ đang phục vụ. Mọi dạng khác giữ nguyên. */
export function localizeHref(href: string, locale: LinkLocale | undefined): string {
  if (!locale || locale.isDefault) return href;
  if (!href.startsWith('/') || href.startsWith('//')) return href;
  if (SYSTEM_PREFIX.test(href) || FILE_TAIL.test(href)) return href;
  if (hasLocalePrefix(href, locale.codes)) return href;

  const prefix = `/${locale.code}`;
  // `/` → `/en`, `/#x` → `/en#x`, `/?q=1` → `/en?q=1` — không để lại `/en/` thừa dấu gạch.
  if (href === '/' || href.startsWith('/#') || href.startsWith('/?')) return prefix + href.slice(1);
  return prefix + href;
}

/** Vai `locale-<mã>` trong `part`, nếu node là nút đổi ngôn ngữ. */
export function switchLocaleOf(part: string | undefined, locale: LinkLocale | undefined): string | null {
  if (!part || !locale) return null;
  for (const role of part.trim().split(/\s+/)) {
    if (!role.startsWith('locale-')) continue;
    const code = role.slice('locale-'.length);
    const hit = locale.codes.find((c) => c.toLowerCase() === code);
    if (hit) return hit;
  }
  return null;
}

/** Href của nút đổi sang ngôn ngữ `code`: bản của trang đang xem, rơi về trang chủ ngôn ngữ đó. */
export function switchLocaleHref(code: string, locale: LinkLocale): string {
  const own = locale.alternates?.[code];
  if (own) return own;
  return code === locale.defaultCode ? '/' : `/${code}`;
}

/** Locale BCP-47 để định dạng NGÀY. Mặc định giữ `vi-VN` như trước. */
export function dateLocaleOf(locale: LinkLocale | undefined): string {
  return !locale || locale.isDefault ? 'vi-VN' : locale.code;
}
