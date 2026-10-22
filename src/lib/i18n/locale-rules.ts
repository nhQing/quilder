/**
 * Luật cho mã và tên ngôn ngữ — thuần, test được không cần DB. Xem
 * docs/superpowers/specs/2026-10-21-them-ngon-ngu-design.md.
 */

import { RESERVED_FIRST_SEGMENTS } from '@/lib/builder/slug';

/** `ja`, `vi`, `zh-hant`, `pt-br`. Chữ thường: mã là tiền tố URL, `/JA` và `/ja` không được là hai thứ. */
export const LOCALE_CODE_RE = /^[a-z]{2,3}(-[a-z0-9]{2,8})?$/;
export const MAX_LOCALE_LABEL = 40;

/** Câu lỗi cho mã ngôn ngữ mới, hoặc `null` nếu dùng được. */
export function checkLocaleCode(code: string, existing: readonly string[]): string | null {
  if (!LOCALE_CODE_RE.test(code)) {
    return 'Mã ngôn ngữ là 2–3 chữ thường, có thể thêm biến thể sau gạch nối — ví dụ ja, ko, zh-hant.';
  }
  if ((RESERVED_FIRST_SEGMENTS as readonly string[]).includes(code)) {
    return `"${code}" là đường dẫn hệ thống, không dùng làm mã ngôn ngữ được.`;
  }
  if (existing.includes(code)) return `Ngôn ngữ "${code}" đã có.`;
  return null;
}

export function checkLocaleLabel(label: string): string | null {
  const t = label.trim();
  if (!t) return 'Cần tên hiển thị — ví dụ 日本語 hoặc Japanese.';
  if (t.length > MAX_LOCALE_LABEL) return `Tên hiển thị tối đa ${MAX_LOCALE_LABEL} ký tự.`;
  return null;
}

/**
 * Trang có đoạn đầu đường dẫn TRÙNG mã ngôn ngữ — bật ngôn ngữ đó là trang này bị hiểu thành
 * tiền tố ngôn ngữ và biến mất. Cùng luật `checkSlugPath` áp ở chiều ngược lại.
 */
export function slugsBlockingLocale(code: string, slugs: readonly string[]): string[] {
  return slugs.filter((s) => s.replace(/^\/+/, '').split('/')[0] === code);
}

/**
 * Tên gốc của ngôn ngữ, viết bằng chính ngôn ngữ đó (`ja` → 日本語, `ms` → Bahasa Melayu), lấy
 * từ `Intl.DisplayNames` có sẵn trong trình duyệt và Node — không cần tự giữ bảng tên.
 * `null` khi mã sai hoặc runtime không biết mã (nó trả lại chính mã).
 */
export function nativeLocaleName(code: string): string | null {
  if (!LOCALE_CODE_RE.test(code)) return null;
  try {
    const name = new Intl.DisplayNames([code], { type: 'language' }).of(code);
    if (!name || name.toLowerCase() === code) return null;
    // Một số ngôn ngữ viết thường tên mình ("español") — nhãn trong menu thì viết hoa chữ đầu.
    return name.charAt(0).toLocaleUpperCase(code) + name.slice(1);
  } catch {
    return null;
  }
}

/**
 * Mã gợi ý cho ô thêm ngôn ngữ (`<datalist>`) — chỉ là gợi ý, mã nào hợp `LOCALE_CODE_RE` cũng
 * nhận. Tên hiển thị lấy từ `nativeLocaleName`, không giữ bảng tên ở đây.
 */
export const COMMON_LOCALE_CODES: readonly string[] = [
  'en', 'ja', 'ko', 'zh', 'zh-hant', 'th', 'fr', 'de', 'es', 'ru', 'id', 'km', 'lo', 'vi',
];
