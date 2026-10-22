/**
 * R1, phần hai — strip bleed của Section 6.
 *
 * Đây là thứ khó thứ nhì sau header, và khó theo một kiểu khác hẳn: không phải
 * state mà là *hình học*. `_section6.css` giải thích rõ vì sao strip phải full-bleed
 * trong khi header thì không — track trong Figma rộng 5114px, absolute ở `left: 50%`
 * với translate −50%, nên nó tràn khỏi content box 1280 đúng 1917px mỗi bên.
 *
 * Bản dựng lại đó thành một scrollport full-bleed, và gutter của content box được
 * áp LẠI làm padding của chính track:
 *
 *   padding-inline: max(var(--mm-block-gutter), (100% - var(--mm-block-w)) / 2)
 *
 * Đây là biểu thức bắt buộc compiler phải diễn đạt được — `max()` bọc một phép trừ
 * rồi chia. `Len` ban đầu chỉ có `clamp`, nên Section 6 chính là chỗ làm lộ ra
 * thiếu sót đó.
 */

import { describe, expect, it } from 'vitest';

import { compileDoc, CssCompileError, len } from './css';
import { BREAKPOINT_PX } from '@/lib/design/breakpoints';
import type { Doc, Len, SectionNode, StackNode } from '@/lib/doc/types';

const t = (name: string) => ({ $token: name });

/** max(var(--mm-block-gutter), (100% - var(--mm-block-w)) / 2) */
const contentGutter: Len = {
  max: [
    t('mm-block-gutter'),
    {
      calc: {
        op: 'div',
        a: { calc: { op: 'sub', a: { v: 100, u: '%' }, b: t('mm-block-w') } },
        b: 2,
      },
    },
  ],
};

const s6: SectionNode = {
  id: 's6000001',
  type: 'Section',
  tag: 'section',
  parentId: null,
  children: ['s6head01', 's6strip1'],
  name: 'Section 6 — testimonials',
  effects: [],
  style: {
    base: {
      // Không phải --mm-surface: Figma bind fill này vào biến Neutral/11.
      fill: { color: t('mm-neutral-11') },
      spacing: { pt: t('mm-s6-pad-y'), pb: t('mm-s6-pad-y') },
      layout: { display: 'flex', align: 'center', gap: t('mm-s6-stack-gap') },
    },
  },
};

/** `.s6__head` — nằm trong content box, KHÔNG bleed. */
const head: StackNode = {
  id: 's6head01',
  type: 'Stack',
  direction: { base: 'column' },
  parentId: 's6000001',
  children: [],
  name: 'Head',
  effects: [],
  style: {
    base: {
      size: { width: 'full' },
      spacing: { pl: contentGutter, pr: contentGutter },
      layout: { display: 'flex', align: 'center', gap: t('mm-s6-head-gap') },
      typography: { align: 'center', wrap: 'balance' },
    },
  },
};

/** `.s6__track` — full-bleed, gutter áp lại làm padding của chính nó. */
const strip: StackNode = {
  id: 's6strip1',
  type: 'Stack',
  direction: { base: 'row' },
  parentId: 's6000001',
  children: [],
  name: 'Strip',
  effects: [],
  style: {
    base: {
      size: { width: 'full' },
      // Cùng một biểu thức gutter, viết lần thứ hai — đúng như file gốc mô tả:
      // "The 320-wide gutter is therefore written twice in this file".
      spacing: { pl: contentGutter, pr: contentGutter },
      layout: { display: 'flex', gap: t('mm-s6-card-gap') },
      effects: { overflow: 'auto' },
    },
    md: { layout: { gap: t('mm-s6-card-gap-md') } },
  },
};

const doc: Doc = {
  schemaVersion: 1,
  rootId: 's6000001',
  nodes: { s6000001: s6, s6head01: head, s6strip1: strip },
};

describe('R1 — Section 6 full-bleed strip', () => {
  const { css } = compileDoc(doc);

  it('diễn đạt được max() bọc phép trừ rồi chia', () => {
    expect(css).toContain(
      'padding-inline-start: max(var(--mm-block-gutter), calc(calc(100% - var(--mm-block-w)) / 2))',
    );
  });

  it('gutter xuất hiện đúng hai lần — head và track — như bản gốc', () => {
    const occurrences = css.match(/max\(var\(--mm-block-gutter\)/g) ?? [];
    // 2 node × 2 cạnh (inline-start + inline-end) = 4
    expect(occurrences).toHaveLength(4);
  });

  it('text-wrap balance và pretty phân biệt được', () => {
    expect(css).toContain('text-wrap: balance');
    const pretty = compileDoc({
      ...doc,
      nodes: {
        ...doc.nodes,
        s6head01: {
          ...head,
          style: { base: { ...head.style.base, typography: { wrap: 'pretty' } } },
        } as StackNode,
      },
    });
    expect(pretty.css).toContain('text-wrap: pretty');
  });

  it('giữ background bind vào Neutral/11 chứ không phải surface', () => {
    expect(css).toContain('background-color: var(--mm-neutral-11)');
  });

  it('override breakpoint của strip nằm trong khối md chung', () => {
    expect(css).toContain(`@media (min-width: ${BREAKPOINT_PX.md}px)`);
    expect(css.match(/@media/g)).toHaveLength(1);
  });
});

describe('R1 — biểu thức số học bị bó, không phải chuỗi tự do', () => {
  it('calc lồng nhau giữ đúng thứ tự ưu tiên bằng ngoặc', () => {
    // 100% - (var(--x) / 2)  KHÁC  (100% - var(--x)) / 2
    const inner = len({
      calc: { op: 'sub', a: { v: 100, u: '%' }, b: { calc: { op: 'div', a: t('x'), b: 2 } } },
    });
    expect(inner).toBe('calc(100% - calc(var(--x) / 2))');

    const outer = len({
      calc: { op: 'div', a: { calc: { op: 'sub', a: { v: 100, u: '%' }, b: t('x') } }, b: 2 },
    });
    expect(outer).toBe('calc(calc(100% - var(--x)) / 2)');
    expect(inner).not.toBe(outer);
  });

  it('hệ số âm hoạt động — calc(-1 * var(--mm-hero-art-drop)) của hero', () => {
    expect(len({ calc: { op: 'mul', a: t('mm-hero-art-drop'), b: -1 } }))
      .toBe('calc(var(--mm-hero-art-drop) * -1)');
  });

  it('toán tử lạ bị ném lỗi', () => {
    expect(() => len({ calc: { op: 'pow' as never, a: t('x'), b: 2 } }))
      .toThrow(CssCompileError);
  });

  it('NaN và Infinity bị chặn', () => {
    expect(() => len({ v: Number.NaN, u: 'px' })).toThrow(CssCompileError);
    expect(() => len({ calc: { op: 'mul', a: t('x'), b: Number.POSITIVE_INFINITY } }))
      .toThrow(CssCompileError);
  });

  it('max() rỗng bị ném lỗi thay vì sinh CSS hỏng', () => {
    expect(() => len({ max: [] })).toThrow(CssCompileError);
  });
});
