import { describe, expect, it } from 'vitest';

/**
 * Style có kiểu → class Tailwind (chỉ để đọc).
 *
 * Tính chất chịu lực: KHÔNG được im lặng bỏ sót. Site dùng nhiều thứ Tailwind
 * không có utility — token riêng, `cqw`, `clamp()` — và ẩn chúng đi thì khối
 * class trông sạch nhưng nói dối: người đọc tưởng node chỉ có bấy nhiêu style.
 */

import { tailwindFor, tailwindGroups } from './tailwind-map';

const cls = (g: string, f: string, v: unknown) => tailwindFor(g, f, v)?.cls;
const real = (g: string, f: string, v: unknown) => tailwindFor(g, f, v)?.real;

describe('giá trị enum → class Tailwind thật', () => {
  it.each([
    ['layout', 'display', 'flex', 'flex'],
    ['layout', 'display', 'none', 'hidden'],
    ['layout', 'align', 'center', 'items-center'],
    ['layout', 'justify', 'between', 'justify-between'],
    ['typography', 'align', 'center', 'text-center'],
    ['typography', 'weight', 700, 'font-bold'],
    ['effects', 'overflow', 'hidden', 'overflow-hidden'],
    ['position', 'kind', 'sticky', 'sticky'],
    ['size', 'width', 'full', 'w-full'],
  ])('%s.%s = %s → %s', (g, f, v, expected) => {
    expect(cls(g, f, v)).toBe(expected);
    expect(real(g, f, v)).toBe(true);
  });

  it('weight nhận cả số lẫn chuỗi', () => {
    // Doc lưu số; nhưng dữ liệu cũ có thể còn chuỗi.
    expect(cls('typography', 'weight', 700)).toBe('font-bold');
    expect(cls('typography', 'weight', '700')).toBe('font-bold');
  });
});

describe('độ dài px → bậc thang khi khớp', () => {
  it('bội số của 4 dùng bậc thang', () => {
    expect(cls('spacing', 'pt', { v: 16, u: 'px' })).toBe('pt-4');
    expect(cls('layout', 'gap', { v: 8, u: 'px' })).toBe('gap-2');
    expect(cls('spacing', 'pt', { v: 0, u: 'px' })).toBe('pt-0');
  });

  it('không khớp bậc thì dùng arbitrary, KHÔNG bịa bậc lẻ', () => {
    // `p-3.25` không tồn tại; bịa ra là dạy người đọc một class không chạy.
    expect(cls('spacing', 'pt', { v: 13, u: 'px' })).toBe('pt-[13px]');
    expect(cls('spacing', 'pt', { v: 53.25, u: 'px' })).toBe('pt-[53.25px]');
  });

  it('cỡ chữ và bo góc KHÔNG dùng thang spacing', () => {
    // `text-4` và `rounded-4` không phải class Tailwind.
    expect(cls('typography', 'size', { v: 16, u: 'px' })).toBe('text-[16px]');
    expect(cls('border', 'radius', { v: 8, u: 'px' })).toBe('rounded-[8px]');
  });

  it('đơn vị khác px giữ nguyên trong arbitrary', () => {
    expect(cls('size', 'maxWidth', { v: 50, u: 'cqw' })).toBe('max-w-[50cqw]');
    expect(cls('spacing', 'pt', { v: 1.5, u: 'rem' })).toBe('pt-[1.5rem]');
  });

  it('logical inline dùng ps/pe, đúng property compiler phát ra', () => {
    expect(cls('spacing', 'pl', { v: 16, u: 'px' })).toBe('ps-4');
    expect(cls('spacing', 'pr', { v: 16, u: 'px' })).toBe('pe-4');
    expect(tailwindFor('spacing', 'pl', { v: 16, u: 'px' })?.prop).toBe('padding-inline-start');
  });
});

describe('thứ Tailwind không biểu diễn được vẫn phải HIỆN', () => {
  it('token của site → arbitrary property, đánh dấu không phải class thật', () => {
    const r = tailwindFor('spacing', 'pt', { $token: 'space-l' });
    expect(r!.cls).toBe('[padding-block-start:var(--space-l)]');
    expect(r!.real).toBe(false);
  });

  it('clamp/calc → hiện dạng rút gọn, đánh dấu không thật', () => {
    const c = tailwindFor('typography', 'size', { clamp: [1, 2, 3] });
    expect(c!.cls).toContain('clamp(…)');
    expect(c!.real).toBe(false);

    expect(tailwindFor('layout', 'gap', { calc: {} })!.real).toBe(false);
  });

  it('màu: token và hex đều ra class dùng được', () => {
    expect(cls('fill', 'color', { $token: 'color-accent' })).toBe('bg-[var(--color-accent)]');
    expect(cls('typography', 'color', { hex: '#0d1321' })).toBe('text-[#0d1321]');
    expect(cls('border', 'color', { hex: '#fff' })).toBe('border-[#fff]');
    expect(real('fill', 'color', { $token: 'color-accent' })).toBe(true);
  });

  it('color-mix không biểu diễn được, đánh dấu rõ', () => {
    expect(real('fill', 'color', { mix: [{ hex: '#000' }, { hex: '#fff' }], amount: 50 })).toBe(false);
  });
});

describe('số', () => {
  it('opacity dùng bậc chẵn 5, lẻ thì arbitrary', () => {
    expect(cls('effects', 'opacity', 0.5)).toBe('opacity-50');
    expect(cls('effects', 'opacity', 0.55)).toBe('opacity-55');
    expect(cls('effects', 'opacity', 0.42)).toBe('opacity-[0.42]');
  });

  it('leading và z-index', () => {
    expect(cls('typography', 'leading', 1.4)).toBe('leading-[1.4]');
    expect(cls('position', 'z', 3)).toBe('z-[3]');
  });
});

describe('tailwindGroups', () => {
  it('chia đúng nhóm, đúng thứ tự inspector', () => {
    const groups = tailwindGroups({
      effects: { opacity: 0.5 },
      spacing: { pt: { v: 16, u: 'px' } },
      layout: { display: 'flex' },
    });
    expect(groups.map((g) => g.label)).toEqual(['Bố cục', 'Khoảng cách', 'Hiệu ứng']);
  });

  it('bỏ hẳn nhóm rỗng', () => {
    // Một tiêu đề nhóm không có gì bên dưới chỉ làm loãng.
    expect(tailwindGroups({ spacing: {} })).toEqual([]);
    expect(tailwindGroups({})).toEqual([]);
  });

  it('gom đủ mọi ô trong một nhóm', () => {
    const [g] = tailwindGroups({
      spacing: { pt: { v: 4, u: 'px' }, pb: { v: 8, u: 'px' }, pl: { $token: 'space-l' } },
    });
    expect(g!.classes.map((c) => c.cls)).toEqual([
      'pt-1', 'pb-2', '[padding-inline-start:var(--space-l)]',
    ]);
  });

  it('không ném với giá trị lạ', () => {
    expect(() => tailwindGroups({ spacing: { pt: null } } as never)).not.toThrow();
    expect(() => tailwindGroups({ shadow: [] } as never)).not.toThrow();
  });
});
