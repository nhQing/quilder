import * as fontkit from 'fontkit';
import subsetFont from 'subset-font';
import { describe, expect, it } from 'vitest';

import {
  interLatinExtWoff2,
  interVietnameseWoff2,
} from '../../../tests/fixtures/fonts/make-fixtures';
import { toWoff2 } from './convert';
import { inspectFont } from './inspect';
import { FontError } from './types';
import { SUBSET_CODEPOINTS, SUBSET_UNICODE_RANGE, VIETNAMESE_PROBE } from './unicode';

const fk = (b: Uint8Array) => fontkit.create(Buffer.from(b)) as fontkit.Font;

/** TTF đầy đủ bộ ký tự cắt, sinh từ Inter vietnamese (chưa cắt bằng toWoff2). */
async function wideTtf(): Promise<Uint8Array> {
  const text = String.fromCodePoint(...SUBSET_CODEPOINTS) + VIETNAMESE_PROBE;
  const out = await subsetFont(Buffer.from(interVietnameseWoff2()), text, {
    targetFormat: 'truetype',
  });
  return new Uint8Array(out);
}

describe('toWoff2', () => {
  it('woff2 vào thì trả nguyên byte, range rỗng', async () => {
    const input = interVietnameseWoff2();
    const out = await toWoff2(input, 'woff2');
    expect(out.bytes).toBe(input);
    expect(out.unicodeRange).toBe('');
  });

  it('TTF → woff2, giữ trục variable và mọi chữ Việt mà đầu vào có', async () => {
    const input = await wideTtf();
    const out = await toWoff2(input, 'ttf');
    expect(Buffer.from(out.bytes.subarray(0, 4)).toString('latin1')).toBe('wOF2');
    expect(out.unicodeRange).toBe(SUBSET_UNICODE_RANGE);
    expect(inspectFont(out.bytes).variable).toBe(true);

    const before = fk(input);
    const after = fk(out.bytes);
    const present = [...VIETNAMESE_PROBE].filter((c) =>
      before.hasGlyphForCodePoint(c.codePointAt(0)!),
    );
    expect(present.length).toBeGreaterThan(0);
    for (const c of present) expect(after.hasGlyphForCodePoint(c.codePointAt(0)!)).toBe(true);
  });

  it('latin-ext cũng qua cắt được', async () => {
    const ttf = new Uint8Array(
      await subsetFont(Buffer.from(interLatinExtWoff2()), 'Ā', { targetFormat: 'truetype' }),
    );
    const out = await toWoff2(ttf, 'ttf');
    expect(fk(out.bytes).hasGlyphForCodePoint(0x100)).toBe(true);
  });

  it('timeoutMs: 1 → too_large, gợi ý woff2', async () => {
    const input = await wideTtf();
    const err = await toWoff2(input, 'ttf', { timeoutMs: 1 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FontError);
    expect((err as FontError).code).toBe('too_large');
    expect((err as FontError).message).toContain('woff2');
  });
});
