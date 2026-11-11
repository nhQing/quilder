import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseGoogleCss, parseGoogleFamily } from './google-parse';

const css = readFileSync(join(__dirname, '__fixtures__', 'css2-be-vietnam-pro.css'), 'utf8');

describe('parseGoogleCss', () => {
  const faces = parseGoogleCss(css);

  it('5 khối → chỉ giữ vietnamese, latin-ext, latin', () => {
    expect(faces.map((f) => f.subset)).toEqual(['vietnamese', 'latin-ext', 'latin']);
  });

  it('mang đúng weight, style, unicode-range và URL gstatic', () => {
    const vi = faces[0]!;
    expect(vi.weight).toBe('400');
    expect(vi.style).toBe('normal');
    expect(vi.unicodeRange).toMatch(/^U\+0102-0103, U\+0110-0111,.*U\+1EA0-1EF9, U\+20AB$/);
    expect(vi.url).toBe(
      'https://fonts.gstatic.com/s/bevietnampro/v12/QdVPSTAyLFyeg_IDWvOJmVES_Hw4BXoKZA.woff2',
    );
    expect(faces[2]!.unicodeRange.startsWith('U+0000-00FF,')).toBe(true);
  });

  it('đọc dải variable và italic', () => {
    const out = parseGoogleCss(`/* latin */
@font-face {
  font-family: 'X';
  font-style: italic;
  font-weight: 100 900;
  src: url(https://fonts.gstatic.com/s/x/a.woff2) format('woff2');
  unicode-range: U+0000-00FF;
}`);
    expect(out).toEqual([
      {
        subset: 'latin',
        weight: '100 900',
        style: 'italic',
        unicodeRange: 'U+0000-00FF',
        url: 'https://fonts.gstatic.com/s/x/a.woff2',
      },
    ]);
  });
});

describe('parseGoogleFamily', () => {
  it('nhận link specimen', () => {
    expect(parseGoogleFamily('https://fonts.google.com/specimen/Be+Vietnam+Pro')).toBe('Be Vietnam Pro');
    expect(parseGoogleFamily('https://fonts.google.com/specimen/Be+Vietnam+Pro?query=be')).toBe(
      'Be Vietnam Pro',
    );
  });
  it('nhận tên thẳng', () => {
    expect(parseGoogleFamily('  Be   Vietnam Pro ')).toBe('Be Vietnam Pro');
  });
});
