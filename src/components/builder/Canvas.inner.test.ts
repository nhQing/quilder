import { describe, expect, it } from 'vitest';

import { innerLocalIdOf } from './Canvas';

/** Phần tử giả: chỉ có `closest`, `contains`, `getAttribute` — đúng thứ hàm đọc. */
function el(cn: string | null, parent: Element | null = null) {
  const self: Record<string, unknown> = {
    parent,
    getAttribute: (k: string) => (k === 'data-cn' ? cn : null),
    closest(sel: string) {
      if (sel !== '[data-cn]') return null;
      let cur = self;
      while (cur) {
        if ((cur.getAttribute as (k: string) => string | null)('data-cn')) return cur;
        cur = cur.parent as Record<string, unknown>;
      }
      return null;
    },
    contains(other: unknown) {
      let cur = other as Record<string, unknown> | null;
      while (cur) {
        if (cur === self) return true;
        cur = cur.parent as Record<string, unknown> | null;
      }
      return false;
    },
  };
  return self as unknown as Element;
}

describe('innerLocalIdOf', () => {
  it('bấm vào phần tử trong instance → id local của phần tử gần nhất', () => {
    const owner = el(null);
    const mid = el('card', owner);
    const leaf = el('btn', mid);
    expect(innerLocalIdOf(leaf, owner)).toBe('btn');
  });

  it('bấm vào chính instance (không có data-cn bên trong) → null', () => {
    const owner = el(null);
    expect(innerLocalIdOf(owner, owner)).toBeNull();
  });

  it('data-cn gần nhất nằm NGOÀI owner thì không tính', () => {
    const outer = el('outerLocal');
    const owner = el(null, outer);
    const target = el(null, owner);
    expect(innerLocalIdOf(target, owner)).toBeNull();
  });

  it('thiếu target hoặc owner → null', () => {
    expect(innerLocalIdOf(null, el(null))).toBeNull();
    expect(innerLocalIdOf(el('x'), null)).toBeNull();
  });
});
