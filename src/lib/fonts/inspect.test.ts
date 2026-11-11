import { describe, expect, it } from 'vitest';

import {
  interLatinWoff2,
  interTtf,
  interVietnameseWoff2,
  restrictedTtf,
} from '../../../tests/fixtures/fonts/make-fixtures';
import { inspectFont } from './inspect';
import { FontError } from './types';

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
