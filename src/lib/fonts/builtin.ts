/** Inter của lõi (khớp `src/styles/base/typography.css`) và các tên họ dành riêng. */

export interface BuiltinFamily {
  cssName: string;
  tokens: string[];
  weight: string;
  faces: { url: string; unicodeRange: string }[];
}

export const BUILTIN_FAMILIES: readonly BuiltinFamily[] = [
  {
    cssName: 'Inter Variable',
    tokens: ['font-display', 'font-body'],
    weight: '100 900',
    faces: [
      {
        url: '/fonts/inter-latin-wght-normal.woff2',
        unicodeRange:
          'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+2000-206F, U+2074, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215',
      },
      {
        url: '/fonts/inter-vietnamese.woff2',
        unicodeRange:
          'U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+0300-0301, U+0303-0304, U+0308-0309, U+0323, U+0329, U+1EA0-1EF9, U+20AB',
      },
      {
        url: '/fonts/inter-latin-ext.woff2',
        unicodeRange:
          'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF',
      },
    ],
  },
];

/** Tên dự phòng trong `--font-*` của `tokens.css` lõi (test giữ khớp). */
const CORE_FALLBACK_NAMES = [
  'inter',
  'helvetica neue',
  'sf mono',
  'menlo',
  'consolas',
  'blinkmacsystemfont',
  '-apple-system',
  'system-ui',
  'ui-monospace',
  'sans-serif',
  'monospace',
];

const GENERIC_KEYWORDS = [
  'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-sans-serif',
  'ui-serif', 'ui-monospace', 'ui-rounded', 'emoji', 'math', 'fangsong', 'inherit', 'initial',
  'unset', 'revert', '-apple-system', 'blinkmacsystemfont',
];

const RESERVED = new Set<string>([
  ...BUILTIN_FAMILIES.map((f) => f.cssName.toLowerCase()),
  ...CORE_FALLBACK_NAMES,
  ...GENERIC_KEYWORDS,
]);

export function isReservedFamilyName(name: string): boolean {
  return RESERVED.has(name.trim().toLowerCase());
}

export function builtinFontFaceCss(): string {
  return BUILTIN_FAMILIES.flatMap((fam) =>
    fam.faces.map(
      (f) =>
        `@font-face {\n  font-family: "${fam.cssName}";\n  src: url("${f.url}") format("woff2");\n` +
        `  font-weight: ${fam.weight};\n  font-style: normal;\n  font-display: swap;\n` +
        `  unicode-range: ${f.unicodeRange};\n}`,
    ),
  ).join('\n');
}
