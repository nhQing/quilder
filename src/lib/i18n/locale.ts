/**
 * Tách ngôn ngữ khỏi đường dẫn.
 *
 * Hàm thuần và tách riêng khỏi mọi thứ đọc DB: đây là chỗ một lỗi sẽ phục vụ
 * trang sai ngôn ngữ, và nó phải test được mà không dựng gì.
 *
 * ## Vì sao ngôn ngữ mặc định KHÔNG có tiền tố
 *
 * `/gioi-thieu` đang chạy và đã có thứ hạng tìm kiếm. Đổi nó thành
 * `/vi/gioi-thieu` là vứt đi thứ hạng đó để lấy một sự đối xứng chỉ lập trình
 * viên thấy đẹp.
 */

export interface LocaleInfo {
  code: string;
  label: string;
  isDefault: boolean;
}

export interface SplitResult {
  locale: LocaleInfo;
  /** Slug đã bỏ tiền tố ngôn ngữ, dạng `getPublishedPage` mong đợi. */
  slug: string;
}

/**
 * `['en', 'gioi-thieu']` → `{ locale: en, slug: 'gioi-thieu' }`.
 * `['gioi-thieu']` → `{ locale: mặc định, slug: 'gioi-thieu' }`.
 *
 * `locales` phải chứa đúng một dòng `isDefault`. Không có thì hàm này lấy dòng
 * đầu — thà phục vụ một ngôn ngữ nào đó còn hơn ném 500 cho mọi request vì một
 * hàng cấu hình sai.
 */
export function splitLocale(segments: string[], locales: LocaleInfo[]): SplitResult {
  const fallback = locales.find((l) => l.isDefault) ?? locales[0] ?? {
    code: 'vi', label: 'Tiếng Việt', isDefault: true,
  };

  const first = segments[0];
  if (!first) return { locale: fallback, slug: '' };

  // Khớp TRỌN đoạn đường dẫn, không khớp tiền tố chuỗi: `/english-guide` không
  // được hiểu là ngôn ngữ `en` cộng slug `lish-guide`.
  const hit = locales.find((l) => l.code === first && !l.isDefault);
  if (!hit) return { locale: fallback, slug: segments.join('/') };

  return { locale: hit, slug: segments.slice(1).join('/') };
}

/**
 * Đường dẫn của một slug trong một ngôn ngữ. Dùng cho hreflang và cho nút đổi
 * ngôn ngữ.
 */
export function localePath(locale: LocaleInfo, slug: string): string {
  const path = slug ? `/${slug}` : '/';
  return locale.isDefault ? path : `/${locale.code}${path === '/' ? '' : path}`;
}
