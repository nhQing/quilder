/**
 * Giá trị style có hiệu lực tại một breakpoint.
 *
 * ## Vì sao inspector cần cái này
 *
 * Doc lưu override THƯA: `base` có đủ, còn `md` chỉ chứa thứ khác `base`. Nếu
 * inspector chỉ đọc đúng lớp đang xem thì ở màn Tablet gần như mọi ô đều trống —
 * trong khi trang thật rõ ràng có padding, có cỡ chữ. Người dùng sẽ tưởng giá
 * trị bị mất, rồi gõ lại y hệt vào lớp `md` và vô tình tạo ra một override thừa
 * mà từ đó `base` không còn ảnh hưởng tới Tablet nữa.
 *
 * Nên control hiện GIÁ TRỊ CÓ HIỆU LỰC (gộp từ base lên tới lớp đang xem), và
 * đánh dấu riêng những giá trị thật sự được đặt ở lớp này. Sửa thì ghi vào lớp
 * đang xem; xoá override thì quay về kế thừa.
 *
 * Thứ tự gộp phải khớp thứ tự `@media` mà compiler phát ra (mobile-first,
 * min-width tăng dần), nếu không thì inspector nói một đằng, trang hiện một nẻo.
 */

import { BREAKPOINTS, type Breakpoint } from '@/lib/design/breakpoints';
import type { Op } from '@/lib/doc/ops';
import type { Node, ResponsiveStyle, StyleProps } from '@/lib/doc/types';

/** Các lớp áp dụng tại `bp`, từ dưới lên. `base` luôn đứng đầu. */
export function layerChain(bp: Breakpoint): Breakpoint[] {
  const index = BREAKPOINTS.indexOf(bp);
  return BREAKPOINTS.slice(0, index + 1);
}

type Group = keyof StyleProps;

/** Lớp override của node tại `bp` — `undefined` nghĩa là chưa có gì riêng. */
export function ownLayer(node: Node, bp: Breakpoint): Partial<StyleProps> | undefined {
  if (bp === 'base') return node.style.base;
  return node.style[bp] as Partial<StyleProps> | undefined;
}

/** Gộp base → bp. Không sửa doc. */
export function effectiveStyle(node: Node, bp: Breakpoint): Partial<StyleProps> {
  const out: Record<string, Record<string, unknown>> = {};

  for (const layer of layerChain(bp)) {
    const style = ownLayer(node, layer);
    if (!style) continue;
    for (const [group, values] of Object.entries(style)) {
      if (!values || typeof values !== 'object' || Array.isArray(values)) {
        // `shadow` là mảng hoặc token ref, không phải nhóm key/value — lớp trên
        // thay hẳn lớp dưới chứ không trộn từng key.
        out[group] = values as unknown as Record<string, unknown>;
        continue;
      }
      out[group] = { ...(out[group] ?? {}), ...(values as Record<string, unknown>) };
    }
  }

  return out as Partial<StyleProps>;
}

export interface FieldState {
  /** Giá trị đang có hiệu lực tại breakpoint đang xem. */
  value: unknown;
  /** Được đặt ngay tại lớp này (không phải kế thừa). */
  isOwn: boolean;
  /** Lớp thật sự cấp giá trị này. null khi chưa ai đặt. */
  from: Breakpoint | null;
}

/**
 * Trạng thái của một ô trong inspector.
 *
 * Trả về cả `from` để UI nói được "đang kế thừa từ Mobile" — không có nó, một ô
 * có giá trị mà không phải override sẽ trông hệt như ô người dùng vừa gõ, và
 * người ta không biết sửa ở đây sẽ ảnh hưởng tới màn nào.
 */
export function fieldState(
  node: Node,
  bp: Breakpoint,
  group: Group,
  key: string,
): FieldState {
  let value: unknown;
  let from: Breakpoint | null = null;

  for (const layer of layerChain(bp)) {
    const groupValues = ownLayer(node, layer)?.[group] as Record<string, unknown> | undefined;
    if (groupValues && typeof groupValues === 'object' && key in groupValues) {
      value = groupValues[key];
      from = layer;
    }
  }

  return { value, from, isOwn: from === bp };
}

/* ── Phạm vi đang chỉnh: phần con của Composite và trạng thái ───────────── */

/**
 * Lớp inspector đang ghi vào. `part` = phần con của Composite (`style.parts.<part>`),
 * `state` = lớp hover / focusVisible. Cả hai null = chỉnh node như trước.
 */
export interface StyleScope {
  part: string | null;
  state: 'hover' | 'focusVisible' | null;
}

export const NO_SCOPE: StyleScope = { part: null, state: null };

/** Style của thứ đang chỉnh, nhìn như style của một node (chưa tính trạng thái). */
export function scopedStyle(node: Node, scope: StyleScope): ResponsiveStyle {
  if (!scope.part) return node.style;
  return node.style.parts?.[scope.part] ?? { base: {} as StyleProps };
}

/**
 * Op ghi style qua đúng một cửa. Trạng thái thì bỏ breakpoint: hover/focus là lớp riêng,
 * không phải lớp theo khổ màn (validator cũng chỉ nhận target = tên lớp).
 */
export function scopedSetStyleOp(
  nodeId: string,
  breakpoint: Breakpoint,
  scope: StyleScope,
  patch: Partial<StyleProps>,
): Extract<Op, { op: 'setStyle' }> {
  return {
    op: 'setStyle',
    nodeId,
    target: scope.state ?? breakpoint,
    ...(scope.part ? { part: scope.part } : {}),
    patch,
  };
}

/**
 * Node + breakpoint để ĐƯA CHO CONTROL đọc.
 *
 * Control đọc `fieldState(node, bp, …)`; thay vì dạy từng control về scope, ta đưa cho nó
 * một node mà style chính là lớp đang chỉnh. Với trạng thái: `base` = style có hiệu lực
 * tại khổ đang xem (giá trị kế thừa), lớp `sm` = lớp hover/focus, và breakpoint đưa đi là
 * `sm` — nhờ vậy ô nào do trạng thái đặt thì `isOwn`, còn lại hiện "kế thừa từ base".
 */
export function scopedView(
  node: Node,
  scope: StyleScope,
  breakpoint: Breakpoint,
): { node: Node; breakpoint: Breakpoint } {
  const src = scopedStyle(node, scope);
  if (!scope.state) return { node: src === node.style ? node : { ...node, style: src }, breakpoint };

  const eff = effectiveStyle({ ...node, style: src }, breakpoint);
  const layer = src[scope.state];
  const style: ResponsiveStyle = { base: eff as StyleProps };
  if (layer) style.sm = layer;
  return { node: { ...node, style }, breakpoint: 'sm' };
}
