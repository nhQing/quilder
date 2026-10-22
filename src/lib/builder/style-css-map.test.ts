import { describe, expect, it } from 'vitest';
import { z } from 'zod';

/**
 * Bảng ánh xạ ô inspector → property CSS phải khớp compiler.
 *
 * `style-css-map.ts` chép lại phần ánh xạ của `declarations()` vì inspector là
 * client component còn `render/css.ts` kéo theo `node:crypto`. Chép tay thì sẽ
 * trôi — trừ khi có test DÒ THẬT compiler rồi đối chiếu, và đó là việc của file
 * này.
 *
 * Test chạy trong Node nên import `css.ts` thoải mái.
 */

import { declarations } from '@/lib/render/css';
import { zStyleProps } from '@/lib/doc/schema';
import type { StyleProps } from '@/lib/doc/types';
import {
  cssLabel,
  propertiesFor,
  stylePathsForProperty,
  STYLE_CSS_PROPERTY,
} from './style-css-map';

/** Giá trị dò cho từng ô — phải hợp lệ với compiler, nội dung không quan trọng. */
const PROBE: Record<string, unknown> = {
  'layout.display': 'flex',
  'layout.flexDirection': 'column',
  'layout.gap': { v: 1, u: 'px' },
  'layout.align': 'center',
  'layout.justify': 'center',
  'layout.wrap': true,
  'spacing.pt': { v: 1, u: 'px' },
  'spacing.pb': { v: 1, u: 'px' },
  'spacing.pl': { v: 1, u: 'px' },
  'spacing.pr': { v: 1, u: 'px' },
  'spacing.mt': { v: 1, u: 'px' },
  'spacing.mb': { v: 1, u: 'px' },
  'spacing.ml': { v: 1, u: 'px' },
  'spacing.mr': { v: 1, u: 'px' },
  'size.width': { v: 1, u: 'px' },
  'size.height': { v: 1, u: 'px' },
  'size.minWidth': { v: 1, u: 'px' },
  'size.maxWidth': { v: 1, u: 'px' },
  'size.minHeight': { v: 1, u: 'px' },
  'size.maxHeight': { v: 1, u: 'px' },
  'size.aspectRatio': '16/9',
  'position.kind': 'relative',
  'position.top': { v: 1, u: 'px' },
  'position.right': { v: 1, u: 'px' },
  'position.bottom': { v: 1, u: 'px' },
  'position.left': { v: 1, u: 'px' },
  'position.z': 3,
  'typography.color': { hex: '#fff' },
  'typography.size': { v: 1, u: 'rem' },
  'typography.weight': 700,
  'typography.leading': 1.4,
  'typography.tracking': { v: 1, u: 'px' },
  'typography.align': 'center',
  'typography.transform': 'uppercase',
  'typography.decoration': 'underline',
  'fill.color': { hex: '#fff' },
  'border.radius': { v: 1, u: 'px' },
  'border.width': { v: 1, u: 'px' },
  'border.hidden': true,
  'border.style': 'dashed',
  'border.color': { hex: '#fff' },
  'effects.opacity': 0.5,
  'effects.overflow': 'hidden',
  'effects.blur': { v: 2, u: 'px' },
  'effects.cursor': 'pointer',

  // Ô "thêm khi cần" — xem `extra-fields.ts`. Không có probe thì test ở dưới im lặng
  // bỏ qua chúng, và bảng ánh xạ của đúng những ô mới thêm là chỗ dễ sai nhất.
  'layout.rowGap': { v: 1, u: 'px' },
  'layout.columnGap': { v: 1, u: 'px' },
  'layout.alignSelf': 'center',
  'layout.alignContent': 'between',
  'layout.justifyItems': 'center',
  'layout.placeItems': 'center',
  'layout.gridArea': 'hero',
  'layout.autoFlow': 'row dense',
  'container.type': 'inline-size',
  'container.name': 'card',
  'typography.family': { $token: 'font-display' },
  'typography.wrap': 'balance',
  'typography.underlineOffset': { v: 2, u: 'px' },
  'typography.whiteSpace': 'nowrap',
  'typography.overflowWrap': 'anywhere',
  'typography.listStyle': 'none',
  'typography.variantNumeric': 'tabular-nums',
  'typography.clamp': 2,
  'effects.blend': 'multiply',
  'effects.pointerEvents': 'none',
  'effects.visibility': 'hidden',
  'effects.isolation': 'isolate',
  'effects.userSelect': 'none',
  'effects.objectFit': 'cover',
  'effects.objectPosition': 'center',
  'effects.backdropBlur': { v: 4, u: 'px' },
  'effects.backdropSaturate': 1.5,

  // Ô mà panel chưa bày (không có trong `extra-fields.ts`) nhưng schema có và
  // compiler phát ra — `resolve_style` và cảnh báo customCss vẫn phải biết chúng.
  'layout.flex': { grow: 0, shrink: 1, basis: 'auto' },
  'layout.gridTemplateColumns': [{ kind: 'fr', v: 1 }, { kind: 'auto' }],
  'layout.gridTemplateRows': [{ kind: 'px', v: 40 }],
  'layout.gridAutoColumns': { kind: 'fr', v: 1 },
  'layout.span': { column: 'full', row: 2 },
  'fill.gradient': {
    kind: 'linear',
    angle: 180,
    stops: [{ at: 0, color: { hex: '#000' } }, { at: 100, color: { hex: '#fff' } }],
  },
  'fill.image': { assetId: 'asset1', fit: 'cover', position: 'center' },
  'effects.outline': {
    width: { v: 2, u: 'px' }, style: 'solid', color: { hex: '#fff' }, offset: { v: 2, u: 'px' },
  },
  'transform.x': { v: 8, u: 'px' },
  'transform.y': { v: 8, u: 'px' },
  'transform.scale': 1.2,
  'transform.rotate': 45,
  'transform.origin': 'center',
  'transform.translate': { x: { v: 4, u: 'px' }, y: { v: 6, u: 'px' } },
  'transition.props': ['opacity'],
  'transition.duration': { $token: 'dur-base' },
  'transition.easing': { $token: 'ease-out' },
  'transition.delay': { $token: 'dur-fast' },

  // Thuộc tính cấp cao nhất: giá trị là CỦA CHÍNH nó, không nằm trong một nhóm.
  shadow: { $token: 'shadow-soft' },
};

/**
 * Field CÙNG NHÓM phải có mặt thì probe mới hợp lệ.
 *
 * Chỉ một ca, và nó là ràng buộc của schema chứ không phải tiện tay: `transition.props`
 * là field BẮT BUỘC (`z.array(...).min(1)`), nên `{ transition: { duration } }` một
 * mình không phải một style hợp lệ — compiler đọc `t.props.map` và ném. Dò ô `duration`
 * mà không kèm `props` là dò một trạng thái không tồn tại được.
 */
const PROBE_SIBLINGS: Record<string, Record<string, unknown>> = {
  transition: { props: ['opacity'] },
};

/** Property mà compiler thật sự phát ra khi chỉ đặt đúng một ô. */
function emitted(key: string): string[] {
  const [group, field] = key.split('.');
  // Khoá không có dấu chấm là thuộc tính cấp cao nhất — giá trị đặt thẳng, không
  // bọc thêm một tầng object. Xem docblock của `STYLE_CSS_PROPERTY`.
  const style = (
    field
      ? { [group!]: { ...PROBE_SIBLINGS[group!], [field]: PROBE[key] } }
      : { [group!]: PROBE[key] }
  ) as Partial<StyleProps>;
  return declarations(style).map(([prop]) => prop);
}

describe('bảng ánh xạ khớp compiler', () => {
  it.each(Object.keys(STYLE_CSS_PROPERTY))('%s', (key) => {
    const actual = emitted(key);
    expect(actual.length, `compiler không phát ra property nào cho ${key}`).toBeGreaterThan(0);
    expect([...actual].sort()).toEqual([...STYLE_CSS_PROPERTY[key]!].sort());
  });

  it('mọi ô đều có giá trị dò', () => {
    // Thiếu probe thì test ở trên im lặng bỏ qua ô đó.
    for (const key of Object.keys(STYLE_CSS_PROPERTY)) {
      expect(PROBE[key], `thiếu giá trị dò cho ${key}`).toBeDefined();
    }
  });
});

/* ── Đủ hay không, chứ không chỉ đúng hay không ────────────────────────── */

/**
 * Test ở trên duyệt `Object.keys(STYLE_CSS_PROPERTY)`, nên nó chỉ kiểm những mục
 * ĐÃ CÓ. Một field thiếu hẳn thì không có khoá nào để duyệt — nó im lặng.
 *
 * Và im lặng đó đã cắn thật: bảng thiếu toàn bộ `transform.*`, `fill.image`,
 * `fill.gradient`, `transition.*`. Hệ quả là `resolve_style` không trả lời được
 * *"ô này phát ra property gì"* cho chúng, và cảnh báo "customCss đang đè ô này"
 * mù ở đúng những ô ấy. Một người dựng đã kết luận `transform.translate` "không
 * render" vì `resolve_style` không nói được rằng nó phát property `translate`
 * (ĐỘC LẬP, không phải `transform`) — mất một vòng điều tra cho một thứ không hỏng.
 *
 * Nên phép kiểm phải đi từ SCHEMA xuống bảng, không phải từ bảng lên compiler.
 */

/** Mọi khoá `group.field` mà `zStyleProps` thật sự có. */
function schemaKeys(): string[] {
  const shape = (zStyleProps as unknown as z.ZodObject<z.ZodRawShape>).shape;
  const out: string[] = [];

  for (const group of Object.keys(shape)) {
    let entry: z.ZodTypeAny | undefined = shape[group];
    // `group()` bọc `.optional()`, bản patch lồng thêm `.nullable()`. Cởi hết vỏ.
    while (entry && !(entry instanceof z.ZodObject)) {
      const inner = (entry as unknown as { unwrap?: () => z.ZodTypeAny }).unwrap?.();
      if (!inner) break;
      entry = inner;
    }
    // Không phải object = thuộc tính cấp cao nhất (`shadow`): tên nhóm CHÍNH LÀ khoá.
    if (!(entry instanceof z.ZodObject)) out.push(group);
    else for (const field of Object.keys(entry.shape)) out.push(`${group}.${field}`);
  }

  return out;
}

/**
 * Field CÓ TRONG SCHEMA mà `declarations()` cố ý không phát ra property nào.
 *
 * Danh sách này phải ngắn và phải giải thích được từng dòng — nó là đường thoát
 * duy nhất khỏi phép kiểm bên dưới, nên một dòng thêm vào mà không có lý do sẽ
 * biến phép kiểm thành đồ trang trí.
 */
const NO_DECLARATION: Record<string, string> = {
  // Không phải một declaration mà là ĐIỀU KIỆN sinh khối `@supports not (...)`.
  // Compiler đọc nó ở phần lắp rule, không ở `declarations()` — xem `css.ts`.
  'effects.backdropFallbackColor': 'chỉ dùng để sinh khối @supports, không tự phát property',
};

describe('bảng ánh xạ ĐỦ so với schema', () => {
  it('không field nào của zStyleProps bị bỏ ngoài bảng', () => {
    const missing = schemaKeys().filter(
      (k) => !STYLE_CSS_PROPERTY[k] && !(k in NO_DECLARATION),
    );
    expect(
      missing,
      'field có trong schema mà không có trong STYLE_CSS_PROPERTY — `resolve_style` ' +
        'sẽ không nói được nó phát ra property gì, và cảnh báo customCss mù ở đó. ' +
        'Thêm vào bảng, hoặc khai vào NO_DECLARATION kèm lý do.',
    ).toEqual([]);
  });

  it('bảng không kê field đã biến mất khỏi schema', () => {
    // Mục thừa thì `resolve_style` đọc `effective[group][field]` ra `undefined`
    // mãi mãi — một dòng chết không ai phát hiện.
    const known = new Set(schemaKeys());
    const ghosts = Object.keys(STYLE_CSS_PROPERTY).filter((k) => !known.has(k));
    expect(ghosts, 'mục trong bảng không còn field tương ứng trong schema').toEqual([]);
  });

  it('NO_DECLARATION chỉ chứa field thật, và chúng thật sự không phát gì', () => {
    const known = new Set(schemaKeys());
    for (const [key, why] of Object.entries(NO_DECLARATION)) {
      expect(known.has(key), `${key} không còn trong schema — bỏ khỏi NO_DECLARATION`).toBe(true);
      expect(why.length, `${key} thiếu lý do`).toBeGreaterThan(10);
      expect(STYLE_CSS_PROPERTY[key], `${key} đã có trong bảng — bỏ khỏi NO_DECLARATION`)
        .toBeUndefined();
    }
  });
});

/**
 * Chính câu hỏi mà `resolve_style` trả lời sai suốt, đo bằng chính các hàm nó gọi.
 *
 * `it.each` ở trên đã kiểm bảng khớp compiler. Nhưng chẩn đoán sai đã xảy ra không
 * phải vì một dòng lệch — mà vì KHÔNG CÓ dòng nào, và một `undefined` thì không test
 * nào ở trên nhìn thấy. Ba khẳng định dưới đây là những câu mà người dựng cần nghe.
 */
describe('resolve_style nói được về transform và fill.image', () => {
  it('transform.translate phát `translate`, KHÔNG phải `transform`', () => {
    // Đây là toàn bộ chẩn đoán sai: `getComputedStyle().transform === 'none'` là
    // kết quả ĐÚNG, vì giá trị nằm ở property `translate`.
    expect(cssLabel('transform', 'translate')).toBe('translate');
    expect(STYLE_CSS_PROPERTY['transform.translate']).not.toContain('transform');
  });

  it('gõ `transform` trong customCss đè bốn ô, và KHÔNG đè `translate`', () => {
    const paths = stylePathsForProperty('transform');
    expect(paths).toEqual(['transform.rotate', 'transform.scale', 'transform.x', 'transform.y']);
    expect(paths).not.toContain('transform.translate');
  });

  it('gõ `background-image` chỉ ra cả ô ảnh nền lẫn ô gradient', () => {
    expect(stylePathsForProperty('background-image')).toEqual(['fill.gradient', 'fill.image']);
  });

  it('gõ `background` gộp cũng đè cả ba ô của nhóm Nền', () => {
    // `background: url(...)` trong customCss xoá sổ cả màu lẫn ảnh nền. Không tính
    // bí danh này thì cảnh báo im lặng đúng lúc nó cần nhất.
    expect(stylePathsForProperty('background')).toEqual([
      'fill.color', 'fill.gradient', 'fill.image',
    ]);
  });
});

describe('propertiesFor', () => {
  it('gồm cả bí danh mà người ta thật sự gõ', () => {
    // Compiler phát `padding-block-start`, nhưng không ai gõ thế trong panel CSS.
    const props = propertiesFor('spacing', 'pt');
    expect(props).toContain('padding-block-start');
    expect(props).toContain('padding-top');
    expect(props).toContain('padding');
  });

  it('ô không có trong bảng trả về mảng rỗng', () => {
    expect(propertiesFor('layout', 'khong-co')).toEqual([]);
  });

  it('không lặp tên', () => {
    for (const key of Object.keys(STYLE_CSS_PROPERTY)) {
      const [group, field] = key.split('.');
      const props = propertiesFor(group!, field!);
      expect(new Set(props).size, `${key} có tên lặp`).toBe(props.length);
    }
  });
});
