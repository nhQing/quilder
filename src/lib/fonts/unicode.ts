/**
 * Tập ký tự giữ lại khi cắt font (§7.2): hợp của ba bộ `latin`, `latin-ext`, `vietnamese`
 * theo cách Google chia. Dùng cho `unicode-range` của face và cho `subset-font`.
 */

const LATIN =
  'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, ' +
  'U+0329, U+2000-206F, U+2074, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD';
const LATIN_EXT =
  'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, ' +
  'U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, ' +
  'U+2C60-2C7F, U+A720-A7FF';
const VIETNAMESE =
  'U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+0300-0301, ' +
  'U+0303-0304, U+0308-0309, U+0323, U+0329, U+1EA0-1EF9, U+20AB';

function parseRanges(list: string): Array<[number, number]> {
  return list.split(',').map((part) => {
    const m = /^\s*U\+([0-9A-F]+)(?:-([0-9A-F]+))?\s*$/i.exec(part);
    if (!m) throw new Error(`unicode-range sai: ${part}`);
    const lo = parseInt(m[1]!, 16);
    return [lo, m[2] ? parseInt(m[2], 16) : lo];
  });
}

const hex = (n: number) => n.toString(16).toUpperCase().padStart(4, '0');

const merged = (() => {
  const all = [LATIN, LATIN_EXT, VIETNAMESE].flatMap(parseRanges).sort((a, b) => a[0] - b[0]);
  const out: Array<[number, number]> = [];
  for (const [lo, hi] of all) {
    const last = out[out.length - 1];
    if (last && lo <= last[1] + 1) last[1] = Math.max(last[1], hi);
    else out.push([lo, hi]);
  }
  return out;
})();

export const SUBSET_UNICODE_RANGE: string = merged
  .map(([lo, hi]) => (lo === hi ? `U+${hex(lo)}` : `U+${hex(lo)}-${hex(hi)}`))
  .join(', ');

export const SUBSET_CODEPOINTS: number[] = merged.flatMap(([lo, hi]) =>
  Array.from({ length: hi - lo + 1 }, (_, i) => lo + i),
);

/** Chữ Việt dùng kiểm font có phủ tiếng Việt (không kiểm ₫, §7.1). */
export const VIETNAMESE_PROBE = 'ạảãếộữơưƯĐ';
