/**
 * R1, phần ba — 5 preset chưa được chứng minh: hero, trust bar, s8 press,
 * s10 FAQ, footer.
 *
 * Bài học từ hai phần trước: chứng minh trên 2 section KHÔNG đủ để kết luận cho
 * cả 10. Audit 5 file còn lại tìm ra 8 thiếu sót nữa, trong đó `color` (màu chữ)
 * là nghiêm trọng — nó xuất hiện trong cả 5 file, và bản compiler đầu tiên không
 * có đường nào đặt nó, vì `fill.color` map sang `background-color`.
 *
 * Test này ghim từng thiếu sót lại để không tái diễn.
 */

import { describe, expect, it } from 'vitest';

import { compileDoc } from './css';
import type { Doc, SectionNode, StackNode } from '@/lib/doc/types';

const t = (name: string) => ({ $token: name });

function docWith(base: Record<string, unknown>): Doc {
  const node = {
    id: 'n0000001',
    type: 'Stack',
    direction: { base: 'column' },
    parentId: null,
    children: [],
    effects: [],
    style: { base },
  } as unknown as StackNode;
  return { schemaVersion: 1, rootId: 'n0000001', nodes: { n0000001: node } };
}

const css = (base: Record<string, unknown>) => compileDoc(docWith(base)).css;

describe('R1 phần ba — 8 thiếu sót tìm ra ở 5 preset còn lại', () => {
  it('MÀU CHỮ đặt được, và tách bạch với màu nền', () => {
    const out = css({
      typography: { color: t('mm-neutral-2') },
      fill: { color: t('mm-neutral-11') },
    });
    // Khẳng định trên declaration đầy đủ, không phải substring: chuỗi
    // 'background-color: …' có chứa 'color: …', nên toContain trần sẽ nói dối.
    const decls = out.match(/^\s*[a-z-]+: .+;$/gm)?.map((s) => s.trim()) ?? [];
    expect(decls).toContain('color: var(--mm-neutral-2);');
    expect(decls).toContain('background-color: var(--mm-neutral-11);');
    expect(decls).not.toContain('color: var(--mm-neutral-11);');
    expect(decls).not.toContain('background-color: var(--mm-neutral-2);');
  });

  it('cursor — hero CTA và FAQ toggle', () => {
    expect(css({ effects: { cursor: 'pointer' } })).toContain('cursor: pointer');
  });

  it('outline + offset — chỉ báo focus bàn phím', () => {
    const out = css({
      effects: {
        outline: {
          width: { v: 2, u: 'px' }, style: 'solid',
          color: t('color-focus'), offset: { v: 3, u: 'px' },
        },
      },
    });
    expect(out).toContain('outline: 2px solid var(--color-focus)');
    expect(out).toContain('outline-offset: 3px');
  });

  it('translate là property độc lập, KHÔNG gộp vào transform', () => {
    const out = css({
      transform: { translate: { y: t('mm-hero-drop') }, scale: 1.02 },
    });
    expect(out).toContain('translate: 0 var(--mm-hero-drop)');
    expect(out).toContain('transform: scale(1.02)');
    // Nếu gộp thì GSAP và CSS tranh nhau `transform` lúc effect chạy.
    expect(out).not.toContain('transform: translateY');
  });

  it('overflow-wrap — tên đối tác dài trong trust bar', () => {
    expect(css({ typography: { overflowWrap: 'anywhere' } }))
      .toContain('overflow-wrap: anywhere');
  });

  it('list-style — trust bar, s8, s10 đều bỏ bullet', () => {
    expect(css({ typography: { listStyle: 'none' } })).toContain('list-style: none');
  });

  it('grid-auto-columns + auto-flow — lưới press của Section 8', () => {
    const out = css({
      layout: {
        display: 'grid',
        autoFlow: 'column',
        gridAutoColumns: { kind: 'minmax', min: { v: 220, u: 'px' }, max: { kind: 'fr', v: 1 } as never },
      },
    });
    expect(out).toContain('grid-auto-flow: column');
    expect(out).toContain('grid-auto-columns: minmax(220px,');
  });

  it('place-items — footer', () => {
    expect(css({ layout: { display: 'grid', placeItems: 'center' } }))
      .toContain('place-items: center');
  });
});

describe('R1 phần ba — màu chữ hoạt động ở mọi lớp override', () => {
  it('đặt được ở breakpoint, state cố định, và state do effect điều khiển', () => {
    const node = {
      id: 'n0000001', type: 'Section', tag: 'section',
      parentId: null, children: [], effects: [],
      style: {
        base: { typography: { color: t('mm-neutral-2') } },
        md: { typography: { color: t('mm-neutral-4') } },
        hover: { typography: { color: t('mm-accent') } },
        states: { inverted: { typography: { color: { hex: '#ffffff' } } } },
      },
    } as unknown as SectionNode;

    const out = compileDoc({
      schemaVersion: 1, rootId: 'n0000001', nodes: { n0000001: node },
    }).css;

    expect(out).toContain('color: var(--mm-neutral-2)');
    expect(out).toContain('color: var(--mm-neutral-4)');
    expect(out).toContain('[data-n="n0000001"]:hover');
    // Header đảo màu chính là mẫu này — .header.is-inverted đặt chữ thành trắng.
    expect(out).toContain('[data-n="n0000001"][data-inverted="true"]');
    expect(out).toContain('color: #ffffff');
  });
});
