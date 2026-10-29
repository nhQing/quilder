/**
 * Chứng minh rủi ro R1 — "generated CSS không tái tạo được rule hand-tuned".
 *
 * Đây là bài test quan trọng nhất của Plan 1. Plan nói rõ: chứng minh ở tuần 1, không
 * phải tuần 12. Nếu file này fail thì toàn bộ hướng generated-stylesheet cần xét lại.
 *
 * Đối tượng: `.header__pill` — phần khó nhất của site, vì nó có HAI state
 * (expanded / collapsed do nav-collapse.js điều khiển), glass với fallback
 * `@supports not`, transition 6 property, và pointer-events đổi theo state.
 *
 * Nguồn đối chiếu: ../new-website/css/layout/_header.css dòng ~190–240.
 */

import { describe, expect, it } from 'vitest';

import { CssCompileError, color, compileDoc, len } from './css';
import { BREAKPOINT_PX } from '@/lib/design/breakpoints';
import type { Doc, SectionNode } from '@/lib/doc/types';

const t = (name: string) => ({ $token: name });

/** `.header__pill` dựng lại hoàn toàn bằng node schema. */
const pill: SectionNode = {
  id: 'pill0001',
  type: 'Section',
  tag: 'aside',
  parentId: 'hdr00001',
  children: [],
  name: 'Header pill',
  effects: [],
  style: {
    base: {
      position: {
        kind: 'absolute',
        top: t('mm-nav-inset-top'),
        bottom: t('mm-nav-inset-bottom'),
        left: t('gutter'),
        right: t('gutter'),
      },
      border: {
        width: { v: 1, u: 'px' },
        style: 'solid',
        // Khai transparent để border-color lúc collapsed có chỗ transition từ đó.
        color: { hex: '#000000', alpha: 0 },
        radius: t('mm-radius-pill'),
      },
      fill: { color: t('mm-pill-bg') },
      effects: {
        pointerEvents: 'none',
        backdropBlur: t('mm-pill-blur'),
        backdropFallbackColor: t('mm-pill-bg-collapsed-fallback'),
      },
      transition: {
        props: [
          'inset-block-start', 'inset-block-end',
          'inset-inline-start', 'inset-inline-end',
          'background-color', 'border-color',
        ],
        duration: t('mm-nav-dur'),
        easing: t('mm-nav-ease'),
      },
    },
    // Đây là thứ bộ ba hover/focusVisible/inView cố định KHÔNG biểu diễn được,
    // và là lý do `states` được thêm vào schema sau khi audit R1.
    states: {
      collapsed: {
        position: {
          top: { v: 0, u: 'px' }, bottom: { v: 0, u: 'px' },
          left: { v: 0, u: 'px' }, right: { v: 0, u: 'px' },
        },
        fill: { color: t('mm-pill-bg-collapsed') },
        border: { color: t('mm-pill-border-collapsed') },
        effects: { pointerEvents: 'auto' },
      },
    },
  },
};

const header: SectionNode = {
  id: 'hdr00001',
  type: 'Section',
  tag: 'header',
  parentId: null,
  children: ['pill0001'],
  name: 'Header',
  effects: [],
  style: {
    base: {
      position: { kind: 'fixed', top: { v: 0, u: 'px' }, z: t('z-header') },
      size: { width: 'full' },
      container: { type: 'inline-size' },
    },
    md: { spacing: { pt: t('space-s'), pb: t('space-s') } },
  },
};

const doc: Doc = {
  schemaVersion: 1,
  rootId: 'hdr00001',
  nodes: { hdr00001: header, pill0001: pill },
};

describe('R1 — tái tạo .header__pill bằng generated CSS', () => {
  const { css } = compileDoc(doc);

  it('giữ nguyên giá trị sub-pixel qua token, không làm tròn', () => {
    // --mm-nav-h: 53.25px sống trong tokens.css và đi vào CSS dưới dạng var().
    // Compiler không bao giờ tự tính lại giá trị token, nên không có chỗ nào để làm tròn.
    expect(css).toContain('var(--mm-nav-inset-top)');
  });

  it('dùng logical property đúng như bản gốc', () => {
    expect(css).toContain('inset-block-start: var(--mm-nav-inset-top)');
    expect(css).toContain('inset-inline-start: var(--gutter)');
  });

  it('biểu diễn được border transparent để border-color có chỗ transition từ đó', () => {
    expect(css).toContain('border-width: 1px');
    expect(css).toContain('border-style: solid');
    expect(css).toContain('color-mix(in srgb, #000000 0%, transparent)');
  });

  it('phát ra transition 6 property với token duration và easing', () => {
    expect(css).toContain('inset-block-start var(--mm-nav-dur) var(--mm-nav-ease)');
    expect(css).toContain('border-color var(--mm-nav-dur) var(--mm-nav-ease)');
  });

  it('state collapsed compile ra selector data-attribute', () => {
    expect(css).toContain('[data-n="pill0001"][data-collapsed="true"]');
    // Cờ nằm trên tổ tiên cũng áp: effect gắn ở node cha ghi cờ một lần cho cả cây con.
    expect(css).toContain('[data-collapsed="true"] [data-n="pill0001"]');
    expect(css).toContain('background-color: var(--mm-pill-bg-collapsed)');
    expect(css).toContain('pointer-events: auto');
  });

  it('tự sinh fallback @supports not cho backdrop-filter — tác giả không thể quên', () => {
    expect(css).toContain(
      '@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)))',
    );
    expect(css).toContain('var(--mm-pill-bg-collapsed-fallback)');
  });

  it('phát ra cả hai prefix của backdrop-filter', () => {
    expect(css).toContain('-webkit-backdrop-filter:');
    expect(css).toContain('backdrop-filter: blur(var(--mm-pill-blur))');
  });

  it('biểu diễn được container-type mà thang token cqw phụ thuộc vào', () => {
    expect(css).toContain('container-type: inline-size');
  });

  it('gom override theo breakpoint, không theo node', () => {
    expect(css).toContain(`@media (min-width: ${BREAKPOINT_PX.md}px)`);
    // Chỉ một khối @media cho md dù có nhiều node override ở đó.
    expect(css.match(new RegExp(`@media \\(min-width: ${BREAKPOINT_PX.md}px\\)`, 'g'))).toHaveLength(1);
  });

  it('nằm trong @layer doc để không tranh specificity với CSS tĩnh', () => {
    // Dòng đầu là khai thứ tự layer (`@layer doc, doc-custom;`), sau đó mới tới
    // khối doc. Khai thứ tự phải đứng trước để độ ưu tiên không phụ thuộc vị trí
    // xuất hiện của khối — xem css.customcss.test.ts.
    expect(css.startsWith('@layer doc, doc-custom;')).toBe(true);
    expect(css).toContain('@layer doc {');
  });
});

describe('R1 — tính deterministic (điều kiện để cache được)', () => {
  it('cùng doc cho ra cùng bytes và cùng hash', () => {
    const a = compileDoc(doc);
    const b = compileDoc(doc);
    expect(a.css).toBe(b.css);
    expect(a.hash).toBe(b.hash);
  });

  it('thứ tự key trong nodes không ảnh hưởng output', () => {
    const reordered: Doc = {
      ...doc,
      nodes: { pill0001: pill, hdr00001: header },
    };
    expect(compileDoc(reordered).hash).toBe(compileDoc(doc).hash);
  });

  it('đổi một giá trị thì hash phải đổi', () => {
    const changed: Doc = {
      ...doc,
      nodes: {
        ...doc.nodes,
        hdr00001: {
          ...header,
          style: { ...header.style, base: { ...header.style.base, size: { width: { v: 50, u: '%' } } } },
        },
      },
    };
    expect(compileDoc(changed).hash).not.toBe(compileDoc(doc).hash);
  });
});

describe('R1 — CSS injection bị chặn tại điểm emit', () => {
  /**
   * Bản đầu của compiler ĐÃ dính lỗi này: hex `red;background:url(...)` được nối
   * thẳng vào output và thoát ra thành một declaration thứ hai. Test dưới đây là
   * lý do nó bị phát hiện ở tuần 1 thay vì sau khi lên production.
   *
   * Chặn ở điểm emit chứ không chỉ ở validator: siết định dạng về sau vẫn bảo vệ
   * được dữ liệu đã nằm trong DB, và một bug ở tầng validator không biến thành
   * CSS injection trên site thật.
   */
  const withStyle = (base: Record<string, unknown>): Doc => ({
    ...doc,
    nodes: {
      ...doc.nodes,
      pill0001: {
        ...pill,
        style: { base: { ...pill.style.base, ...base } },
      } as SectionNode,
    },
  });

  it('hex chứa dấu ; bị ném lỗi, không lọt vào output', () => {
    const hostile = withStyle({
      fill: { color: { hex: 'red;background:url(javascript:alert(1))' } },
    });
    expect(() => compileDoc(hostile)).toThrow(CssCompileError);
  });

  it('hex hợp lệ vẫn đi qua bình thường', () => {
    const ok = withStyle({ fill: { color: { hex: '#0d1321' } } });
    expect(compileDoc(ok).css).toContain('background-color: #0d1321');
  });

  it('gridArea chứa dấu } bị ném lỗi', () => {
    const hostile = withStyle({ layout: { gridArea: 'a } body { display:none' } });
    expect(() => compileDoc(hostile)).toThrow(CssCompileError);
  });

  it('transform.origin chứa url() bị ném lỗi', () => {
    const hostile = withStyle({ transform: { origin: 'center;background:url(x)' } });
    expect(() => compileDoc(hostile)).toThrow(CssCompileError);
  });

  it('transition.props chứa dấu : bị ném lỗi', () => {
    const hostile = withStyle({
      transition: { props: ['opacity;color:red'], duration: t('dur-fast') },
    });
    expect(() => compileDoc(hostile)).toThrow(CssCompileError);
  });
});

describe('giá trị hỏng không được làm sập cả trang', () => {
  // `'clamp' in v` ném TypeError THÔ khi v không phải object. Compiler chạy trong
  // render của server component, nên TypeError đó làm sập cả trang builder với
  // một stack trỏ vào css.ts mà không nói được node nào, thuộc tính nào.
  it.each([undefined, null, 'auto', 42, true])('len(%s) ném CssCompileError', (bad) => {
    expect(() => len(bad as never)).toThrow(CssCompileError);
  });

  it('thông điệp nói rõ cần dạng gì', () => {
    expect(() => len('auto' as never)).toThrow(/\{ v, u \}|\$token/);
  });

  it('clamp sai số phần tử cũng báo rõ', () => {
    expect(() => len({ clamp: 5 } as never)).toThrow(/clamp cần đúng 3/);
    expect(() => len({ clamp: [] } as never)).toThrow(CssCompileError);
  });

  it('color với giá trị không phải object cũng vậy', () => {
    expect(() => color(undefined as never)).toThrow(CssCompileError);
    expect(() => color('red' as never)).toThrow(CssCompileError);
  });
});
