import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  EMPTY_PACK_FONTS,
  packFamilyNamed,
  packFontFaceCss,
  parsePackFonts,
  readPackFonts,
  withPackVariables,
  type PackFontManifest,
} from './pack';

const face = (over: Partial<PackFontManifest['families'][number]['faces'][number]> = {}) => ({
  weight: '400', style: 'normal' as const, unicodeRange: '', url: '/p/fonts/a.woff2',
  file: 'projects/thu/public/fonts/a.woff2', bytes: 10, ...over,
});

const M: PackFontManifest = {
  ...EMPTY_PACK_FONTS,
  pack: 'thu',
  css: 'projects/thu/styles/fonts.css',
  families: [
    { cssName: 'SF Pro Display', faces: [face(), face({ weight: '700', url: '/p/fonts/b.woff2', bytes: null })] },
  ],
  variables: { 'font-display': '"SF Pro Display", system-ui, sans-serif' },
};

describe('parsePackFonts', () => {
  it('sai phiên bản / hỏng → rỗng', () => {
    expect(parsePackFonts(null)).toEqual(EMPTY_PACK_FONTS);
    expect(parsePackFonts({ version: 2, families: [] })).toEqual(EMPTY_PACK_FONTS);
    expect(parsePackFonts({ version: 1, families: 'x' })).toEqual(EMPTY_PACK_FONTS);
  });

  it('giữ họ hợp lệ, bỏ họ hỏng', () => {
    const m = parsePackFonts({ ...M, families: [...M.families, { cssName: 1 }] });
    expect(m.families.map((f) => f.cssName)).toEqual(['SF Pro Display']);
  });
});

describe('readPackFonts', () => {
  it('trong vitest, không truyền root → rỗng (không phụ thuộc gói đang clone trên máy)', () => {
    expect(readPackFonts()).toEqual(EMPTY_PACK_FONTS);
  });

  it('đọc generated/pack-fonts/<QUILDER_PROJECT>.json dưới root; thiếu file / không gói / tên lạ → rỗng', () => {
    const root = mkdtempSync(join(tmpdir(), 'quilder-pack-'));
    const env = { QUILDER_PROJECT: 'thu' };
    expect(readPackFonts(root, env)).toEqual(EMPTY_PACK_FONTS);
    mkdirSync(join(root, 'generated', 'pack-fonts'), { recursive: true });
    writeFileSync(join(root, 'generated', 'pack-fonts', 'thu.json'), JSON.stringify(M));
    expect(readPackFonts(root, env).families[0]!.cssName).toBe('SF Pro Display');
    expect(readPackFonts(root, {})).toEqual(EMPTY_PACK_FONTS);
    expect(readPackFonts(root, { QUILDER_PROJECT: '../thu' })).toEqual(EMPTY_PACK_FONTS);
  });
});

describe('packFamilyNamed', () => {
  it('không phân biệt hoa thường và khoảng trắng thừa', () => {
    expect(packFamilyNamed('sf  pro display', M)?.cssName).toBe('SF Pro Display');
    expect(packFamilyNamed('SF Pro', M)).toBeNull();
  });
});

describe('withPackVariables', () => {
  it('đè giá trị token gói đã đè trong :root; token khác giữ nguyên', () => {
    const rows = [
      { name: 'font-display', value: '"Inter Variable", sans-serif', category: 'font' },
      { name: 'font-mono', value: 'monospace', category: 'font' },
    ];
    expect(withPackVariables(rows, M)).toEqual([
      { name: 'font-display', value: '"SF Pro Display", system-ui, sans-serif', category: 'font' },
      rows[1],
    ]);
  });
});

describe('packFontFaceCss', () => {
  it('một @font-face cho mỗi face có file; bỏ face thiếu file', () => {
    const css = packFontFaceCss(M);
    expect(css.match(/@font-face/g)).toHaveLength(1);
    expect(css).toContain('font-family: "SF Pro Display"');
    expect(css).toContain('src: url("/p/fonts/a.woff2")');
    expect(css).not.toContain('b.woff2');
  });
});
