/** Đọc phản hồi css2 của Google Fonts (§8). Hàm thuần, không gọi mạng. */

import type { FontStyle } from './types';

export interface GoogleFace {
  subset: string;
  weight: string;
  style: FontStyle;
  unicodeRange: string;
  url: string;
}

/** Chỉ ba bộ chứa tiếng Việt và Latin; cyrillic, greek… bỏ. */
const KEPT_SUBSETS = new Set(['vietnamese', 'latin-ext', 'latin']);

const BLOCK_RE = /\/\*\s*([a-z0-9-]+)\s*\*\/\s*@font-face\s*\{([^}]*)\}/gi;

const prop = (body: string, name: string): string | undefined =>
  new RegExp(`(?:^|[;\\s])${name}\\s*:\\s*([^;]+)`, 'i').exec(body)?.[1]?.trim();

/** `css2` → danh sách face của ba bộ được giữ, theo thứ tự xuất hiện. */
export function parseGoogleCss(css: string): GoogleFace[] {
  const out: GoogleFace[] = [];
  for (const m of css.matchAll(BLOCK_RE)) {
    const subset = (m[1] ?? '').toLowerCase();
    if (!KEPT_SUBSETS.has(subset)) continue;
    const body = m[2] ?? '';
    const url = /url\(\s*['"]?([^'")\s]+)['"]?\s*\)/i.exec(body)?.[1];
    const unicodeRange = prop(body, 'unicode-range');
    if (!url || !unicodeRange) continue;
    const weight = (prop(body, 'font-weight') ?? '400').replace(/\s+/g, ' ');
    const style: FontStyle = prop(body, 'font-style') === 'italic' ? 'italic' : 'normal';
    out.push({ subset, weight, style, unicodeRange, url });
  }
  return out;
}

/** Tên họ từ khối `@font-face` đầu tiên của phản hồi (nếu có). */
export function googleCssFamilyName(css: string): string | undefined {
  const raw = /font-family\s*:\s*([^;]+)/i.exec(css)?.[1]?.trim();
  return raw?.replace(/^['"]|['"]$/g, '') || undefined;
}

/** Tên họ từ tên thẳng hoặc link `fonts.google.com/specimen/Be+Vietnam+Pro`. */
export function parseGoogleFamily(input: string): string {
  let text = input.trim();
  const m = /fonts\.google\.com\/specimen\/([^/?#]+)/i.exec(text);
  if (m) {
    try {
      text = decodeURIComponent(m[1] ?? '');
    } catch {
      text = m[1] ?? '';
    }
    text = text.replace(/\+/g, ' ');
  }
  return text.replace(/\s+/g, ' ').trim();
}
