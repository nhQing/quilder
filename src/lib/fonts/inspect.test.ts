import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  interLatinExtWoff2,
  interLatinWoff2,
  interTtf,
  interVietnameseWoff2,
  restrictedTtf,
} from '../../../tests/fixtures/fonts/make-fixtures';
import { inspectFont } from './inspect';
import { FontError } from './types';
import { unicodeRangeSpans, VIETNAMESE_PROBE, vietnameseProbeFor } from './unicode';

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return e instanceof FontError ? e.code : `other:${String(e)}`;
  }
  return undefined;
}

describe('inspectFont', () => {
  it('Inter vietnamese woff2: biến thiên, 100-900', () => {
    const r = inspectFont(interVietnameseWoff2());
    expect(r.format).toBe('woff2');
    expect(r.variable).toBe(true);
    expect(r.weight).toBe('100 900');
    expect(r.style).toBe('normal');
    // Không assert `missing_vietnamese`: bộ `vietnamese` của Google không chứa `ã` (U+00E3,
    // nằm ở bộ latin) nên probe báo thiếu — đúng với file này, không phải lỗi.
    expect(r.family).toBe('Inter');
  });

  it('Inter latin woff2 thiếu tiếng Việt', () => {
    expect(inspectFont(interLatinWoff2()).warnings).toContain('missing_vietnamese');
  });

  it('TTF sinh từ Inter nhận là ttf', async () => {
    expect(inspectFont(await interTtf()).format).toBe('ttf');
  });

  it('TTF vá fsType=2 cảnh báo restricted_embedding', async () => {
    expect(inspectFont(await restrictedTtf()).warnings).toContain('restricted_embedding');
    expect(inspectFont(await interTtf()).warnings).not.toContain('restricted_embedding');
  });

  it('TTC bị từ chối collection_unsupported', () => {
    const ttc = new Uint8Array([0x74, 0x74, 0x63, 0x66, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 16]);
    expect(codeOf(() => inspectFont(ttc))).toBe('collection_unsupported');
  });

  it('PNG 1x1 là not_font', () => {
    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52,
    ]);
    expect(codeOf(() => inspectFont(png))).toBe('not_font');
  });

  it('quá 10 MB là too_large', () => {
    expect(codeOf(() => inspectFont(new Uint8Array(10 * 1024 * 1024 + 1)))).toBe('too_large');
  });
});

describe('inspectFont với unicode-range của face (file subset kiểu Google)', () => {
  // Dải lấy nguyên từ phản hồi css2 thật (fixture), không phải dải tự chế.
  const css = readFileSync(join(__dirname, '__fixtures__', 'css2-be-vietnam-pro.css'), 'utf8');
  const rangeOf = (subset: string) =>
    new RegExp(`/\\* ${subset} \\*/[^}]*unicode-range: ([^;]+);`).exec(css)![1]!;

  it('mỗi file latin / latin-ext / vietnamese chỉ bị kiểm phần chữ Việt trong dải của nó → không cảnh báo', () => {
    expect(inspectFont(interLatinWoff2(), { unicodeRange: rangeOf('latin') }).warnings).not.toContain('missing_vietnamese');
    expect(inspectFont(interLatinExtWoff2(), { unicodeRange: rangeOf('latin-ext') }).warnings).not.toContain('missing_vietnamese');
    expect(inspectFont(interVietnameseWoff2(), { unicodeRange: rangeOf('vietnamese') }).warnings).not.toContain('missing_vietnamese');
  });

  it('file thiếu chữ nằm TRONG dải của nó vẫn bị cảnh báo', () => {
    // File latin gắn dải vietnamese: dải đòi ạ ế ơ…, file không có.
    expect(inspectFont(interLatinWoff2(), { unicodeRange: rangeOf('vietnamese') }).warnings).toContain('missing_vietnamese');
  });

  it('dải rỗng = kiểm cả bộ (woff2 tải lên, file đã cắt)', () => {
    expect(inspectFont(interVietnameseWoff2(), { unicodeRange: '' }).warnings).toContain('missing_vietnamese');
  });
});

describe('vietnameseProbeFor / unicodeRangeSpans', () => {
  it('chọn đúng chữ trong dải; rỗng hoặc đọc không được → cả bộ', () => {
    expect(vietnameseProbeFor('U+0000-00FF')).toBe('ã');
    expect(vietnameseProbeFor('U+1E??')).toBe('ạảếộữ');
    expect(vietnameseProbeFor('')).toBe(VIETNAMESE_PROBE);
    expect(vietnameseProbeFor('rác')).toBe(VIETNAMESE_PROBE);
    expect(vietnameseProbeFor('U+0400-045F')).toBe('');
  });

  it('đọc dải đơn, khoảng và wildcard', () => {
    expect(unicodeRangeSpans('U+0131, U+0152-0153, U+4??, xx')).toEqual([
      [0x131, 0x131], [0x152, 0x153], [0x400, 0x4ff],
    ]);
  });
});
