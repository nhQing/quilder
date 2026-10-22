import { describe, expect, it } from 'vitest';

import { zStylePatch, zStyleProps } from '@/lib/doc/schema';
import type { StyleProps } from '@/lib/doc/types';

import { declarations } from './css';

/**
 * Cờ `hidden` (D4): tắt tạm một lớp bóng, gradient, ảnh nền hay nét viền mà không xoá
 * giá trị. Hợp đồng: phần bị ẩn không ra CSS; ẩn hết ở một breakpoint thì ra `none` để
 * đè được breakpoint thấp hơn; gỡ cờ là ra đúng CSS như trước khi ẩn.
 */

const px = (v: number) => ({ v, u: 'px' as const });
const black = { $token: 'mm-ink' };

const layer = (y: number, extra: Record<string, unknown> = {}) => ({
  x: px(0), y: px(y), blur: px(y * 2), spread: px(0), color: black, ...extra,
});

function css(style: Partial<StyleProps>): Record<string, string> {
  return Object.fromEntries(declarations(style));
}

describe('cờ hidden — bóng', () => {
  it('ẩn một lớp thì CSS không còn lớp đó; gỡ cờ thì đúng như cũ', () => {
    const before = css({ shadow: [layer(1), layer(8)] as StyleProps['shadow'] });
    const hidden = css({ shadow: [layer(1), layer(8, { hidden: true })] as StyleProps['shadow'] });
    const shown = css({ shadow: [layer(1), layer(8)] as StyleProps['shadow'] });

    expect(before['box-shadow']).toContain(', ');
    expect(hidden['box-shadow']).not.toContain(', ');
    expect(hidden['box-shadow']).not.toContain('16px');
    expect(shown).toEqual(before);
  });

  it('ẩn mọi lớp → `none`, không phải bỏ khai báo', () => {
    expect(css({ shadow: [layer(1, { hidden: true })] as StyleProps['shadow'] })['box-shadow']).toBe('none');
  });

  it('bóng token không bị ảnh hưởng', () => {
    expect(css({ shadow: { $token: 'shadow-1' } })['box-shadow']).toBe('var(--shadow-1)');
  });
});

describe('cờ hidden — nền', () => {
  const gradient = { kind: 'linear' as const, angle: 90, stops: [{ at: 0, color: black }, { at: 100, color: black }] };
  const image = { assetId: 'a1', fit: 'cover' as const };

  it('ẩn gradient → không có background-image, còn màu nền', () => {
    const out = css({ fill: { color: black, gradient: { ...gradient, hidden: true } } });
    expect(out['background-color']).toBeDefined();
    expect(out['background-image']).toBe('none');
  });

  it('ẩn ảnh nền khi có cả gradient → gradient hiện lại', () => {
    const out = css({ fill: { gradient, image: { ...image, hidden: true } } });
    expect(out['background-image']).toMatch(/^linear-gradient/);
    expect(out['background-size']).toBeUndefined();
  });

  it('gỡ cờ ảnh nền → đúng như trước khi ẩn', () => {
    expect(css({ fill: { image: { ...image } } })).toEqual(css({ fill: { image } }));
  });
});

describe('cờ hidden — viền', () => {
  it('ẩn viền → border-style none, bo góc giữ nguyên', () => {
    const out = css({ border: { width: px(1), color: black, radius: px(8), hidden: true } });
    expect(out).toEqual({ 'border-style': 'none', 'border-radius': '8px' });
  });
});

describe('cờ hidden — schema', () => {
  it('doc cũ không có cờ vẫn hợp lệ', () => {
    expect(zStyleProps.safeParse({ shadow: [layer(1)], border: { width: px(1) } }).success).toBe(true);
  });

  it('nhận `true`, từ chối `false` (gỡ khoá mới là bật lại)', () => {
    expect(zStyleProps.safeParse({ shadow: [layer(1, { hidden: true })] }).success).toBe(true);
    expect(zStyleProps.safeParse({ shadow: [layer(1, { hidden: false })] }).success).toBe(false);
  });

  it('patch gỡ cờ viền bằng null', () => {
    expect(zStylePatch.safeParse({ border: { hidden: null } }).success).toBe(true);
    expect(zStylePatch.safeParse({ border: { hidden: true } }).success).toBe(true);
  });
});
