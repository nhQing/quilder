/**
 * Style có kiểu → class Tailwind, để ĐỌC.
 *
 * ## Vì sao chỉ để đọc
 *
 * Trang sinh ra từ database KHÔNG dùng Tailwind — đó là quyết định cơ học, không
 * phải khẩu vị: JIT quét source lúc build, còn cây node đổi sau khi image đã
 * build, nên `class="pt-[53.25px]"` sinh từ một DB row sẽ không bao giờ được
 * compile. Site dùng stylesheet sinh từ `render/css.ts`.
 *
 * Khối class ở đây là một CÁCH ĐỌC khác của cùng dữ liệu đó — quen mắt với người
 * viết Tailwind hằng ngày. Nó không phải nguồn sự thật và không sửa được: ô có
 * kiểu vẫn là đường ghi duy nhất.
 *
 * ## Vì sao vẫn hiện thứ không map được
 *
 * Site dùng nhiều thứ Tailwind không có utility: token riêng (`--mm-nav-h:
 * 53.25px`), đơn vị container query (`cqw`), `clamp()`. Ẩn chúng đi thì khối
 * class trông sạch nhưng NÓI DỐI — người đọc sẽ tưởng node chỉ có bấy nhiêu
 * style. Nên chúng vẫn hiện, dưới dạng arbitrary property và có cờ `real: false`
 * để giao diện đánh dấu.
 */

import type { StyleProps } from '@/lib/doc/types';
import { STYLE_CSS_PROPERTY } from './style-css-map';

export interface TwClass {
  /** Chuỗi class hiển thị. */
  cls: string;
  /**
   * `true` = class Tailwind thật, gõ vào dự án Tailwind nào cũng chạy.
   * `false` = arbitrary property, chỉ là cách viết lại giá trị cho dễ đọc.
   */
  real: boolean;
  /** Property CSS mà compiler thật sự phát ra — nguồn sự thật, hiện trong tooltip. */
  prop: string;
}

/** Nhãn nhóm, đúng thứ tự inspector bày ra. */
export const TW_GROUPS: { key: keyof StyleProps; label: string }[] = [
  { key: 'layout', label: 'Bố cục' },
  { key: 'spacing', label: 'Khoảng cách' },
  { key: 'size', label: 'Kích thước' },
  { key: 'typography', label: 'Chữ' },
  { key: 'fill', label: 'Nền' },
  { key: 'border', label: 'Viền' },
  { key: 'effects', label: 'Hiệu ứng' },
  { key: 'position', label: 'Vị trí' },
];

/** Tiền tố Tailwind cho các ô nhận độ dài. */
const LEN_PREFIX: Record<string, string> = {
  'spacing.pt': 'pt', 'spacing.pb': 'pb', 'spacing.pl': 'ps', 'spacing.pr': 'pe',
  'spacing.mt': 'mt', 'spacing.mb': 'mb',
  'layout.gap': 'gap',
  'size.width': 'w', 'size.height': 'h', 'size.minHeight': 'min-h', 'size.maxWidth': 'max-w',
  'typography.size': 'text', 'typography.tracking': 'tracking',
  'border.radius': 'rounded', 'border.width': 'border',
};

/** Ô có giá trị enum → class Tailwind cố định. */
const ENUM_CLASS: Record<string, Record<string, string>> = {
  'layout.display': {
    flex: 'flex', grid: 'grid', block: 'block',
    'inline-flex': 'inline-flex', contents: 'contents', none: 'hidden',
  },
  'layout.align': {
    start: 'items-start', center: 'items-center', end: 'items-end',
    stretch: 'items-stretch', baseline: 'items-baseline',
  },
  'layout.justify': {
    start: 'justify-start', center: 'justify-center', end: 'justify-end',
    between: 'justify-between', around: 'justify-around',
  },
  'typography.align': { left: 'text-left', center: 'text-center', right: 'text-right' },
  'typography.weight': { '400': 'font-normal', '500': 'font-medium', '700': 'font-bold' },
  'effects.overflow': {
    visible: 'overflow-visible', hidden: 'overflow-hidden',
    clip: 'overflow-clip', auto: 'overflow-auto',
  },
  'position.kind': {
    static: 'static', relative: 'relative', absolute: 'absolute',
    sticky: 'sticky', fixed: 'fixed',
  },
  'size.width': { auto: 'w-auto', full: 'w-full' },
  'size.height': { auto: 'h-auto', full: 'h-full', svh: 'h-svh' },
  'size.maxWidth': { measure: 'max-w-[var(--measure)]', container: 'max-w-[var(--max-width)]' },
};

/**
 * px → bậc thang spacing của Tailwind (1 bậc = 0.25rem = 4px).
 *
 * Chỉ nhận bội số đúng của 4 và trong khoảng thang mặc định. `13px` không có
 * bậc nào, và bịa ra `p-3.25` là sai — trả `null` để bên gọi dùng arbitrary.
 */
function spacingStep(px: number): string | null {
  if (px === 0) return '0';
  if (px < 0 || px % 4 !== 0) return null;
  const step = px / 4;
  return step <= 96 ? String(step) : null;
}

function lenToClass(key: string, value: unknown): TwClass | null {
  const prefix = LEN_PREFIX[key];
  const prop = STYLE_CSS_PROPERTY[key]?.[0] ?? key;
  if (!prefix) return null;

  // Từ khoá (`auto`, `full`, `measure`…) đã nằm ở ENUM_CLASS.
  if (typeof value === 'string') {
    const cls = ENUM_CLASS[key]?.[value];
    return cls ? { cls, real: true, prop } : null;
  }
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;

  // Token của site: Tailwind không có utility nào, và cũng KHÔNG NÊN có — đổi
  // token là đổi cả hệ, đó là điểm mạnh của token chứ không phải thiếu sót.
  if (typeof v.$token === 'string') {
    return { cls: `[${prop}:var(--${v.$token})]`, real: false, prop };
  }

  if (typeof v.v === 'number' && typeof v.u === 'string') {
    const raw = `${v.v}${v.u}`;
    if (v.u === 'px') {
      const step = spacingStep(v.v);
      // Thang spacing chỉ đúng cho khoảng cách và kích thước, không cho cỡ chữ
      // hay bo góc — `text-4` không tồn tại.
      const onScale = step && !['text', 'rounded', 'tracking', 'border'].includes(prefix);
      if (onScale) return { cls: `${prefix}-${step}`, real: true, prop };
    }
    return { cls: `${prefix}-[${raw}]`, real: true, prop };
  }

  // clamp() / calc() / min() / max(): Tailwind không biểu diễn nổi.
  const shape = ['clamp', 'calc', 'min', 'max'].find((k) => k in v);
  return shape ? { cls: `[${prop}:${shape}(…)]`, real: false, prop } : null;
}

function colorToClass(key: string, value: unknown): TwClass | null {
  const prop = STYLE_CSS_PROPERTY[key]?.[0] ?? key;
  const prefix = key === 'fill.color' ? 'bg' : key === 'border.color' ? 'border' : 'text';
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;

  if (typeof v.$token === 'string') {
    return { cls: `${prefix}-[var(--${v.$token})]`, real: true, prop };
  }
  if (typeof v.hex === 'string') {
    return { cls: `${prefix}-[${v.hex}]`, real: true, prop };
  }
  return { cls: `[${prop}:color-mix(…)]`, real: false, prop };
}

/** Một ô → class, hoặc `null` nếu ô đó không biểu diễn được. */
export function tailwindFor(group: string, field: string, value: unknown): TwClass | null {
  if (value === undefined || value === null) return null;
  const key = `${group}.${field}`;
  const prop = STYLE_CSS_PROPERTY[key]?.[0] ?? key;

  const enumCls = typeof value === 'string' || typeof value === 'number'
    ? ENUM_CLASS[key]?.[String(value)]
    : undefined;
  if (enumCls) return { cls: enumCls, real: true, prop };

  if (key === 'effects.opacity' && typeof value === 'number') {
    const pct = Math.round(value * 100);
    return { cls: pct % 5 === 0 ? `opacity-${pct}` : `opacity-[${value}]`, real: true, prop };
  }
  if (key === 'typography.leading' && typeof value === 'number') {
    return { cls: `leading-[${value}]`, real: true, prop };
  }
  if (key === 'position.z' && typeof value === 'number') {
    return { cls: `z-[${value}]`, real: true, prop };
  }
  if (key === 'typography.color' || key === 'fill.color' || key === 'border.color') {
    return colorToClass(key, value);
  }
  return lenToClass(key, value);
}

export interface TwGroup {
  label: string;
  classes: TwClass[];
}

/**
 * Cả style của một lớp → class, đã chia nhóm theo loại thuộc tính.
 *
 * Nhóm rỗng bị bỏ hẳn: một tiêu đề nhóm không có gì bên dưới chỉ làm loãng.
 */
export function tailwindGroups(style: Partial<StyleProps>): TwGroup[] {
  const out: TwGroup[] = [];

  for (const { key, label } of TW_GROUPS) {
    const values = style[key];
    if (!values || typeof values !== 'object' || Array.isArray(values)) continue;

    const classes: TwClass[] = [];
    for (const [field, value] of Object.entries(values)) {
      const cls = tailwindFor(key, field, value);
      if (cls) classes.push(cls);
    }
    if (classes.length) out.push({ label, classes });
  }

  return out;
}
