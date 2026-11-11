import type { FontSeal, FontSealFace } from './types';

/**
 * Tên họ font → chuỗi CSS có nháy kép. Escape `"`, `\`, xuống dòng và `<` để tên lạ
 * đọc từ file font không phá được CSS hay thoát khỏi thẻ `<style>`.
 */
export function cssFamilyName(name: string): string {
  const body = name
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r?\n|\r/g, '\\a ')
    .replace(/</g, '\\3c ');
  return `"${body}"`;
}

/**
 * Tên họ ĐẦU TIÊN trong một chồng font CSS, bỏ nháy (`"Inter Variable", system-ui` →
 * `Inter Variable`). Hiểu nháy đơn/kép, `\"` và dấu phẩy nằm trong nháy; ngược với
 * `cssFamilyName` thì không cần giữ nguyên an toàn CSS — chỉ để làm nhãn hiển thị.
 */
export function firstFamilyName(stack: string): string {
  const s = stack.trim();
  const q = s[0];
  if (q === '"' || q === "'") {
    let out = '';
    for (let i = 1; i < s.length; i++) {
      const c = s[i]!;
      if (c === '\\' && i + 1 < s.length) {
        out += s[++i];
      } else if (c === q) {
        return out;
      } else {
        out += c;
      }
    }
    return out; // nháy không đóng: lấy phần đã đọc
  }
  return (s.split(',')[0] ?? '').trim();
}

const SAFE_KEY =/^[A-Za-z0-9._\-/]+$/;
const SAFE_WEIGHT = /^\d{1,4}( \d{1,4})?$/;
const SAFE_RANGE = /^[Uu+0-9A-Fa-f?,\s-]*$/;

const FORMATS: Record<string, string> = {
  woff2: 'woff2',
  woff: 'woff',
  ttf: 'truetype',
  otf: 'opentype',
};

function faceOk(f: FontSealFace): boolean {
  return (
    SAFE_KEY.test(f.key) &&
    !f.key.includes('..') &&
    SAFE_WEIGHT.test(f.weight) &&
    (f.style === 'normal' || f.style === 'italic') &&
    SAFE_RANGE.test(f.unicodeRange)
  );
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** FontSeal → các khối `@font-face` (thuần, xác định: sắp theo slug, weight, style, range). */
export function fontFaceCss(seal: FontSeal): string {
  const blocks: string[] = [];
  const families = [...seal.families].sort((a, b) => cmp(a.slug, b.slug));
  for (const fam of families) {
    const faces = fam.faces
      .filter(faceOk)
      .sort(
        (a, b) =>
          cmp(a.weight, b.weight) || cmp(a.style, b.style) || cmp(a.unicodeRange, b.unicodeRange),
      );
    for (const f of faces) {
      const ext = f.key.split('.').pop()!.toLowerCase();
      const format = FORMATS[ext] ?? 'woff2';
      const lines = [
        `font-family: ${cssFamilyName(fam.cssName)};`,
        `src: url("/mm-font/${f.key}") format("${format}");`,
        `font-weight: ${f.weight};`,
        `font-style: ${f.style};`,
        'font-display: swap;',
      ];
      if (f.unicodeRange.trim()) lines.push(`unicode-range: ${f.unicodeRange.trim()};`);
      blocks.push(['@font-face {', ...lines.map((l) => `  ${l}`), '}'].join('\n'));
    }
  }
  return blocks.join('\n');
}
