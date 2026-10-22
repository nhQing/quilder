/**
 * Panel CSS tuỳ chỉnh — thứ tự ưu tiên và phạm vi.
 *
 * `customCss` không phải escape hatch dùng hiếm: đó là một panel trong builder,
 * người dùng gõ vào hằng ngày và AI cũng ghi được (mức "Vừa" — qua allowlist
 * property, luôn hiện trong diff preview).
 *
 * Vì vậy hai tính chất dưới đây là hợp đồng với người dùng, không phải chi tiết
 * cài đặt: gõ CSS vào panel thì PHẢI thấy nó có tác dụng, và CSS của một node
 * KHÔNG được chạm tới node khác.
 */

import { describe, expect, it } from 'vitest';

import { compileDoc } from './css';
import type { Doc, StackNode } from '@/lib/doc/types';

const t = (name: string) => ({ $token: name });

function docWith(customCss: string | undefined, extra: Record<string, unknown> = {}): Doc {
  const node = {
    id: 'n0000001',
    type: 'Stack',
    direction: { base: 'column' },
    parentId: null,
    children: [],
    effects: [],
    customCss,
    style: { base: { spacing: { pt: t('space-l') } , ...extra } },
  } as unknown as StackNode;
  return { schemaVersion: 1, rootId: 'n0000001', nodes: { n0000001: node } };
}

describe('customCss — thứ tự ưu tiên', () => {
  it('khai thứ tự layer trước, doc-custom sau doc', () => {
    const { css } = compileDoc(docWith('padding: 40px;'));
    // Thứ tự KHAI quyết định độ ưu tiên, không phụ thuộc vị trí khối bên dưới.
    expect(css.startsWith('@layer doc, doc-custom;')).toBe(true);
    expect(css.indexOf('@layer doc {')).toBeLessThan(css.indexOf('@layer doc-custom {'));
  });

  it('customCss thắng style props dù specificity thấp hơn', () => {
    const { css } = compileDoc(docWith('padding: 40px;'));
    // Cả hai cùng tồn tại; layer quyết định ai thắng, nên style props không bị xoá.
    expect(css).toContain('padding-block-start: var(--space-l)');
    expect(css).toContain('padding: 40px');
  });

  it('không có customCss thì không sinh layer rỗng', () => {
    const { css } = compileDoc(docWith(undefined));
    expect(css).not.toContain('@layer doc-custom {');
    // Nhưng vẫn khai thứ tự, để thêm customCss sau này không đổi độ ưu tiên.
    expect(css).toContain('@layer doc, doc-custom;');
  });
});

describe('customCss — phạm vi', () => {
  it('bọc trong selector của chính node', () => {
    const { css } = compileDoc(docWith('color: red;'));
    const layer = css.slice(css.indexOf('@layer doc-custom {'));
    expect(layer).toContain('[data-n="n0000001"] {');
  });

  it('CSS của node này không chạm node khác', () => {
    const base = docWith('color: red;');
    const two: Doc = {
      ...base,
      nodes: {
        ...base.nodes,
        n0000002: {
          ...(base.nodes.n0000001 as StackNode),
          id: 'n0000002',
          customCss: undefined,
        } as StackNode,
      },
    };
    const layer = compileDoc(two).css.slice(compileDoc(two).css.indexOf('@layer doc-custom'));
    expect(layer).toContain('[data-n="n0000001"]');
    expect(layer).not.toContain('[data-n="n0000002"]');
  });
});

describe('customCss — an toàn', () => {
  it("gỡ '<' thay vì ném lỗi — một node hỏng không được hạ cả trang", () => {
    // ĐỔI HÀNH VI so với bản trước, có chủ đích.
    //
    // Trước đây gặp '<' là `compileDoc` ném CssCompileError, tức là toàn bộ
    // trang không render được vì MỘT node có ký tự lạc. Trên site thật, đó là sự
    // cố nghiêm trọng hơn nhiều so với thứ nó phòng: đổi một ký tự trong panel
    // CSS làm sập cả trang chủ.
    //
    // Sanitizer bây giờ gỡ '<' và giữ phần còn lại. Trang vẫn lên, phần nguy
    // hiểm biến mất, và người dùng thấy cảnh báo trong panel.
    const { css } = compileDoc(docWith('opacity: .5 }</style><script>alert(1)</script>'));
    expect(css).not.toContain('<');
    expect(css).not.toContain('script');
  });

  it('sanitizer chạy trong compileDoc, không phải chỉ ở lớp validator', () => {
    // Sanitize lúc RENDER: customCss đã nằm sẵn trong database từ trước ngày
    // siết luật vẫn phải được bảo vệ.
    const { css } = compileDoc(docWith('@import url("//evil.example/x.css"); position: fixed;'));
    expect(css).not.toContain('@import');
    expect(css).not.toContain('fixed');
    expect(css).toContain('absolute');
  });

  it('selector trần bị giam trong node, không thoát ra toàn cục', () => {
    const { css } = compileDoc(docWith('body, html { display: none }'));
    expect(css).not.toMatch(/\n\s*(body|html)\s*[,{]/);
    expect(css).toContain('[data-n="n0000001"] body');
  });

  it('CSS bình thường vẫn đi qua', () => {
    expect(() => compileDoc(docWith('border-radius: 12px; opacity: .8;'))).not.toThrow();
  });
});

/**
 * customCss của node BÊN TRONG component.
 *
 * Tới 07/09/2026 khối này không tồn tại và `compileDoc` bỏ qua hẳn: vòng lặp
 * customCss chỉ duyệt node của doc trang, còn vòng lặp component phát base +
 * breakpoint + state mà không phát customCss. Chuỗi CSS lưu đúng trong database,
 * `get_component_node` trả về nó, và HTML chứa nó 0 lần — không lỗi, không cảnh
 * báo. Hệ quả: component không mang được escape hatch nào, nên cách duy nhất
 * còn lại là đóng dấu mọi thứ thành node trang và bỏ hẳn thư viện component.
 */
describe('customCss — trong cây component', () => {
  const instanceDoc = (): Doc => ({
    schemaVersion: 1,
    rootId: 'n0000001',
    nodes: {
      n0000001: {
        id: 'n0000001', type: 'Instance', componentId: 'cmp1', overrides: {},
        parentId: null, children: [], effects: [], style: { base: {} },
      } as unknown as StackNode,
    },
  });

  const tree = (customCss: string) => ({
    rootId: 'local1',
    nodes: {
      local1: {
        id: 'local1', type: 'Stack', direction: { base: 'column' },
        parentId: null, children: [], effects: [], customCss,
        style: { base: {} },
      } as unknown as StackNode,
    },
  });

  it('ra CSS, scope theo component chứ không theo data-n', () => {
    const { css } = compileDoc(
      instanceDoc(),
      new Map([['cmp1', tree('backdrop-filter: blur(12px);')]]),
    );
    expect(css).toContain('[data-cn="local1"]:is([data-c="cmp1"] *)');
    expect(css).toContain('backdrop-filter: blur(12px)');
    // KHÔNG được scope về data-n: id đó là của Instance trên trang, và một trang
    // mang mười instance thì rule phải dùng chung theo component.
    expect(css).not.toContain('[data-n="local1"]');
  });

  it('nằm trong @layer doc-custom, tức vẫn thắng style props', () => {
    const { css } = compileDoc(
      instanceDoc(),
      new Map([['cmp1', tree('opacity: 0.5;')]]),
    );
    const layerAt = css.indexOf('@layer doc-custom {');
    expect(layerAt).toBeGreaterThan(-1);
    expect(css.indexOf('[data-cn="local1"]:is([data-c="cmp1"] *)')).toBeGreaterThan(layerAt);
  });

  it('ngữ cảnh tổ tiên (`[data-collapsed] &`) vẫn khớp — scope là MỘT compound', () => {
    // Dạng hai compound `[data-c] [data-cn]` biến selector này thành "wrapper component
    // nằm trong phần tử mang state", không bao giờ khớp (header thu gọn, 13/10/2026).
    const { css } = compileDoc(
      instanceDoc(),
      new Map([['cmp1', tree('[data-collapsed="true"] & { opacity: 0.5; }')]]),
    );
    expect(css).toContain('[data-collapsed="true"] [data-cn="local1"]:is([data-c="cmp1"] *)');
    expect(css).not.toContain('[data-collapsed="true"] [data-c="cmp1"]');
  });

  it('component không có customCss thì không sinh layer rỗng', () => {
    const { css } = compileDoc(instanceDoc(), new Map([['cmp1', tree('')]]));
    expect(css).not.toContain('@layer doc-custom {');
  });

  it('sanitizer vẫn chạy: at-rule không cho phép bị gỡ', () => {
    const { css } = compileDoc(
      instanceDoc(),
      new Map([['cmp1', tree('@keyframes spin { to { transform: rotate(1turn); } }')]]),
    );
    expect(css).not.toContain('@keyframes');
  });
});
