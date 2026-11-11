import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUILTIN_FAMILIES, builtinFontFaceCss, isReservedFamilyName } from './builtin';

const root = process.cwd();
const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

describe('BUILTIN_FAMILIES', () => {
  it('khớp @font-face trong typography.css', () => {
    const css = readFileSync(join(root, 'src/styles/base/typography.css'), 'utf8').replace(
      /\/\*[\s\S]*?\*\//g,
      '',
    );
    const blocks = [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => m[1]!);
    const fromCss = blocks
      .map((b) => {
        const url = /url\("([^"]+)"\)/.exec(b)![1]!;
        const range = /unicode-range:\s*([^;]+);/.exec(b)![1]!;
        return `${url}|${norm(range)}`;
      })
      .sort();
    const fromTs = BUILTIN_FAMILIES.flatMap((f) =>
      f.faces.map((x) => `${x.url}|${norm(x.unicodeRange)}`),
    ).sort();
    expect(fromTs).toEqual(fromCss);
    for (const b of blocks) {
      expect(/font-family:\s*"([^"]+)"/.exec(b!)![1]).toBe(BUILTIN_FAMILIES[0]!.cssName);
    }
  });

  it('mọi tên trong --font-* của tokens.css đều dành riêng', () => {
    const css = readFileSync(join(root, 'src/styles/tokens.css'), 'utf8');
    for (const name of ['--font-display', '--font-body', '--font-mono']) {
      const value = new RegExp(`${name}:\\s*([^;]+);`).exec(css)![1];
      const names = value!.split(',').map((s) => s.trim().replace(/^"|"$/g, ''));
      expect(names.length).toBeGreaterThan(1);
      for (const n of names) expect(isReservedFamilyName(n), `${name}: ${n}`).toBe(true);
    }
  });

  it('isReservedFamilyName', () => {
    for (const n of ['INTER', 'sans-serif', 'system-ui']) expect(isReservedFamilyName(n)).toBe(true);
    for (const n of ['gilroy', 'SF Pro Display', 'Be Vietnam Pro'])
      expect(isReservedFamilyName(n)).toBe(false);
  });

  it('builtinFontFaceCss sinh một khối mỗi face', () => {
    expect(builtinFontFaceCss().match(/@font-face/g)).toHaveLength(3);
  });
});
