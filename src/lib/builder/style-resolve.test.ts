import { describe, expect, it } from 'vitest';

/**
 * Giá trị có hiệu lực theo breakpoint.
 *
 * Đây là thứ quyết định inspector nói gì. Sai ở đây thì người dùng thấy một
 * đằng, trang hiện một nẻo — và họ sẽ sửa theo thứ nhìn thấy, tạo ra override
 * thừa mà không biết.
 */

import { effectiveStyle, fieldState, layerChain, ownLayer, scopedSetStyleOp, scopedStyle, scopedView } from './style-resolve';
import type { Node } from '@/lib/doc/types';

const node = (style: Record<string, unknown>): Node =>
  ({
    id: 'n1', type: 'Stack', direction: { base: 'column' },
    parentId: null, children: [], effects: [], style,
  }) as unknown as Node;

const px = (v: number) => ({ v, u: 'px' as const });

describe('layerChain', () => {
  it('mobile-first, từ base lên tới lớp đang xem', () => {
    expect(layerChain('base')).toEqual(['base']);
    expect(layerChain('md')).toEqual(['base', 'sm', 'md']);
    expect(layerChain('xl')).toEqual(['base', 'sm', 'md', 'lg', 'xl']);
  });
});

describe('effectiveStyle', () => {
  it('lớp trên đè lớp dưới theo từng key, không thay cả nhóm', () => {
    // Nếu gộp theo NHÓM thì đặt `pt` ở md sẽ xoá sạch `pb` của base — và người
    // dùng mất padding dưới mà không hiểu vì sao.
    const n = node({
      base: { spacing: { pt: px(10), pb: px(20) } },
      md: { spacing: { pt: px(40) } },
    });
    const out = effectiveStyle(n, 'md');
    expect(out.spacing).toEqual({ pt: px(40), pb: px(20) });
  });

  it('không lấy lớp cao hơn lớp đang xem', () => {
    const n = node({ base: { spacing: { pt: px(10) } }, xl: { spacing: { pt: px(99) } } });
    expect(effectiveStyle(n, 'md').spacing).toEqual({ pt: px(10) });
  });

  it('gộp nhiều nhóm độc lập', () => {
    const n = node({
      base: { spacing: { pt: px(8) }, fill: { color: { hex: '#fff' } } },
      lg: { layout: { display: 'grid' } },
    });
    const out = effectiveStyle(n, 'lg');
    expect(out.spacing).toEqual({ pt: px(8) });
    expect(out.fill).toEqual({ color: { hex: '#fff' } });
    expect(out.layout).toEqual({ display: 'grid' });
  });

  it('shadow là mảng — lớp trên thay hẳn, không trộn từng phần tử', () => {
    const a = [{ x: px(0), y: px(1), blur: px(2), spread: px(0), color: { hex: '#000' } }];
    const b = [{ x: px(0), y: px(9), blur: px(9), spread: px(0), color: { hex: '#111' } }];
    const n = node({ base: { shadow: a }, md: { shadow: b } });
    expect(effectiveStyle(n, 'md').shadow).toEqual(b);
  });

  it('không sửa doc gốc', () => {
    const n = node({ base: { spacing: { pt: px(10) } }, md: { spacing: { pt: px(40) } } });
    const before = JSON.stringify(n.style);
    effectiveStyle(n, 'md');
    expect(JSON.stringify(n.style)).toBe(before);
  });
});

describe('fieldState', () => {
  it('phân biệt đặt-riêng với kế thừa', () => {
    const n = node({
      base: { spacing: { pt: px(10), pb: px(20) } },
      md: { spacing: { pt: px(40) } },
    });

    const own = fieldState(n, 'md', 'spacing', 'pt');
    expect(own).toEqual({ value: px(40), from: 'md', isOwn: true });

    const inherited = fieldState(n, 'md', 'spacing', 'pb');
    expect(inherited).toEqual({ value: px(20), from: 'base', isOwn: false });
  });

  it('chưa ai đặt thì from là null', () => {
    const n = node({ base: {} });
    expect(fieldState(n, 'md', 'spacing', 'pt')).toEqual({
      value: undefined, from: null, isOwn: false,
    });
  });

  it('`from` trỏ đúng lớp gần nhất, không phải lớp đầu tiên', () => {
    const n = node({
      base: { spacing: { pt: px(1) } },
      sm: { spacing: { pt: px(2) } },
      lg: { spacing: { pt: px(3) } },
    });
    expect(fieldState(n, 'md', 'spacing', 'pt').from).toBe('sm');
    expect(fieldState(n, 'lg', 'spacing', 'pt').from).toBe('lg');
  });

  it('giá trị null vẫn tính là đã đặt ở lớp đó', () => {
    // Sau khi gỡ override, `mergeDeep` xoá hẳn key nên trường hợp này hiếm —
    // nhưng nếu nó xuất hiện, "có key" phải khác "không có key".
    const n = node({ base: { spacing: { pt: px(1) } }, md: { spacing: { pt: null } } });
    expect(fieldState(n, 'md', 'spacing', 'pt').isOwn).toBe(true);
  });
});

describe('ownLayer', () => {
  it('trả undefined khi lớp chưa có gì', () => {
    expect(ownLayer(node({ base: {} }), 'md')).toBeUndefined();
  });

  it('base luôn có', () => {
    expect(ownLayer(node({ base: { spacing: { pt: px(1) } } }), 'base')).toEqual({
      spacing: { pt: px(1) },
    });
  });
});

describe('phạm vi style (phần con / trạng thái)', () => {
  const p = { fill: { color: { $token: 'x' } } } as never;
  const none = { part: null, state: null } as const;

  it('scopedSetStyleOp: phần con giữ breakpoint, thêm part', () => {
    expect(scopedSetStyleOp('f1', 'md', { part: 'submit', state: null }, p)).toEqual({
      op: 'setStyle', nodeId: 'f1', target: 'md', part: 'submit', patch: p,
    });
  });

  it('scopedSetStyleOp: trạng thái bỏ breakpoint, không có part thì không có khoá part', () => {
    expect(scopedSetStyleOp('f1', 'md', { part: 'submit', state: 'hover' }, p)).toEqual({
      op: 'setStyle', nodeId: 'f1', target: 'hover', part: 'submit', patch: p,
    });
    const op = scopedSetStyleOp('f1', 'lg', { part: null, state: 'focusVisible' }, p);
    expect(op).toEqual({ op: 'setStyle', nodeId: 'f1', target: 'focusVisible', patch: p });
    expect('part' in op).toBe(false);
    expect(scopedSetStyleOp('f1', 'sm', none, p)).toEqual({
      op: 'setStyle', nodeId: 'f1', target: 'sm', patch: p,
    });
  });

  it('scopedStyle: trả parts[part] hoặc {base:{}}, không phần thì style của node', () => {
    const sub = { base: { fill: { color: '#fff' } } };
    const n = node({ base: {}, parts: { submit: sub } });
    expect(scopedStyle(n, { part: 'submit', state: null })).toBe(sub);
    expect(scopedStyle(n, { part: 'input', state: null })).toEqual({ base: {} });
    expect(scopedStyle(n, none)).toBe(n.style);
  });

  it('scopedView: trạng thái = base đã gộp + lớp state, đặt ở lớp sm để isOwn đúng', () => {
    const n = node({ base: { spacing: { pt: px(1) } }, md: { spacing: { pb: px(2) } }, hover: { spacing: { pt: px(9) } } });
    const v = scopedView(n, { part: null, state: 'hover' }, 'md');
    expect(v.breakpoint).toBe('sm');
    expect(effectiveStyle(v.node, 'sm').spacing).toEqual({ pt: px(9), pb: px(2) });
    expect(ownLayer(v.node, 'sm')).toEqual({ spacing: { pt: px(9) } });
  });
});
