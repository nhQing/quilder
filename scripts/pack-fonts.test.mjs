import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseFontFaceCss } from '../src/lib/fonts/adopt';
import { emptyManifest, packFontsFile, packFontWarnings, parsePackFontCss, scanPackFonts, writePackFonts } from './pack-fonts.mjs';

const CSS = `/* Font của Gói Thử — giấy phép: OFL */
@font-face {
  font-family: "Sans Gốc";
  src: url("/p/fonts/sans-regular.woff2") format("woff2");
  font-weight: 400;
  font-display: swap;
}
@font-face {
  font-family: 'sans gốc';
  src: url('/p/fonts/sans-italic.ttf');
  font-weight: 400;
  font-style: italic;
}
@font-face {
  font-family: Serif Gốc;
  src: url(/p/fonts/serif.otf);
  font-weight: 300 700;
}
/* @font-face { font-family: "Bị comment"; src: url("/p/fonts/x.woff2"); } */
:root {
  --font-display: "Sans Gốc", system-ui,
    sans-serif;
  --lv-gap: 4px;
}
`;

function packRoot({ css = CSS, files = ['sans-regular.woff2', 'serif.otf', 'thua.woff2'] } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'quilder-packfonts-'));
  const dir = join(root, 'projects', 'thu');
  mkdirSync(join(dir, 'styles'), { recursive: true });
  mkdirSync(join(dir, 'public', 'fonts', 'con'), { recursive: true });
  if (css !== null) writeFileSync(join(dir, 'styles', 'fonts.css'), css);
  for (const f of files) writeFileSync(join(dir, 'public', 'fonts', f), 'x'.repeat(10));
  return root;
}

const PROJECT = { name: 'thu', dir: 'projects/thu' };

describe('parsePackFontCss', () => {
  it('khớp parseFontFaceCss của fonts:adopt trên cùng CSS (hai bộ đọc không được lệch)', () => {
    const fromScan = parsePackFontCss(CSS, 'thu').faces;
    const fromAdopt = parseFontFaceCss(CSS, 'thu');
    expect(fromScan).toEqual(fromAdopt);
    expect(fromScan.map((f) => f.family)).toEqual(['Sans Gốc', 'sans gốc', 'Serif Gốc']);
  });

  it('đọc --font-* trong :root (gộp khoảng trắng), bỏ biến không phải font', () => {
    expect(parsePackFontCss(CSS, 'thu').variables).toEqual({ 'font-display': '"Sans Gốc", system-ui, sans-serif' });
  });

  it('ghi chú giấy phép từ comment đầu file', () => {
    expect(parsePackFontCss(CSS, 'thu').licenseNote).toBe('Font của Gói Thử — giấy phép: OFL');
  });
});

describe('scanPackFonts', () => {
  it('gom face theo họ (không phân biệt hoa thường), đo dung lượng, báo file thiếu và file chưa khai', () => {
    const m = scanPackFonts(PROJECT, packRoot());
    expect(m.pack).toBe('thu');
    expect(m.css).toBe('projects/thu/styles/fonts.css');
    expect(m.families.map((f) => [f.cssName, f.faces.length])).toEqual([['Sans Gốc', 2], ['Serif Gốc', 1]]);
    expect(m.families[0].faces[0]).toEqual({
      weight: '400', style: 'normal', unicodeRange: '', url: '/p/fonts/sans-regular.woff2',
      file: 'projects/thu/public/fonts/sans-regular.woff2', bytes: 10,
    });
    expect(m.families[0].faces[1].bytes).toBeNull();
    expect(m.missing).toEqual(['projects/thu/public/fonts/sans-italic.ttf']);
    expect(m.undeclared).toEqual(['projects/thu/public/fonts/thua.woff2']);
    expect(packFontWarnings(m)).toContain('thiếu file: projects/thu/public/fonts/sans-italic.ttf');
  });

  it('không có gói / gói không có styles/fonts.css → manifest rỗng, không cảnh báo', () => {
    expect(scanPackFonts({ name: null, dir: 'src/project/none' }, packRoot())).toEqual(emptyManifest());
    const m = scanPackFonts(PROJECT, packRoot({ css: null }));
    expect(m).toEqual(emptyManifest('thu'));
    expect(packFontWarnings(m)).toBeNull();
  });
});

describe('writePackFonts', () => {
  it('ghi generated/pack-fonts/<gói>.json; chạy lại không đổi thì không ghi', () => {
    const root = packRoot();
    const first = writePackFonts(PROJECT, root);
    expect(first.changed).toBe(true);
    expect(packFontsFile('thu')).toBe('generated/pack-fonts/thu.json');
    expect(JSON.parse(readFileSync(join(root, packFontsFile('thu')), 'utf8'))).toEqual(first.manifest);
    expect(writePackFonts(PROJECT, root).changed).toBe(false);
  });

  it('không có gói → không ghi file nào', () => {
    const root = packRoot();
    expect(writePackFonts({ name: null, dir: 'src/project/none' }, root)).toMatchObject({ path: null, changed: false });
    expect(existsSync(join(root, 'generated'))).toBe(false);
  });
});
