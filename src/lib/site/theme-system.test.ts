import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseSiteTheme } from './theme';

/** Các khai báo `--x: …` trong khối đầu tiên khớp `selector { … }`. */
function vars(css: string, selector: string): Record<string, string> {
  const at = css.indexOf(selector);
  expect(at, `không thấy ${selector}`).toBeGreaterThan(-1);
  const body = css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
  return Object.fromEntries(
    [...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]),
  );
}

const STYLES = join(__dirname, '..', '..', 'styles');

describe('theme "theo máy người xem"', () => {
  it('khối sáng nhân bản trùng từng biến với khối [data-theme="light"] của tokens.css', () => {
    const tokens = readFileSync(join(STYLES, 'tokens.css'), 'utf8');
    const system = readFileSync(join(STYLES, 'base', 'theme-system.css'), 'utf8');
    expect(vars(system, '[data-theme="system"]')).toEqual(vars(tokens, '[data-theme="light"]'));
  });

  it('site.css nạp theme-system SAU tokens.css', () => {
    const site = readFileSync(join(STYLES, 'site.css'), 'utf8');
    expect(site.indexOf("'./base/theme-system.css'")).toBeGreaterThan(site.indexOf("'./tokens.css'"));
  });
});

describe('parseSiteTheme', () => {
  it('giữ giá trị hợp lệ, giá trị lạ về light', () => {
    expect(parseSiteTheme('dark')).toBe('dark');
    expect(parseSiteTheme('system')).toBe('system');
    expect(parseSiteTheme('neon')).toBe('light');
    expect(parseSiteTheme(null)).toBe('light');
  });
});
