/**
 * `style.parts` — style có kiểu cho phần con của Composite (Form).
 *
 * Phần con không có `data-n` riêng nên compiler dịch khoá → selector trong `STYLE_PARTS`,
 * scope dưới node. Hai điều phải giữ: selector nhiều phần được scope TỪNG CÁI (nếu không,
 * `.a, .b` chỉ scope cái đầu và cái sau rò ra cả trang), và mọi thứ nằm trong `@layer doc`
 * để `customCss` (`doc-custom`) vẫn thắng.
 */

import { describe, expect, it } from 'vitest';

import { compileDoc } from './css';
import { BREAKPOINT_PX } from '@/lib/design/breakpoints';
import type { Doc, Node } from '@/lib/doc/types';

const fill = { fill: { color: { $token: 'brand' } } };

function formDoc(style: Record<string, unknown>, customCss?: string): Doc {
  const f1 = {
    id: 'f1', type: 'Composite', composite: 'Form', params: {}, slots: {},
    parentId: null, children: [], effects: [], customCss, style: { base: {}, ...style },
  } as unknown as Node;
  return { schemaVersion: 1, rootId: 'f1', nodes: { f1 } };
}

const docLayer = (css: string) => css.slice(css.indexOf('@layer doc {'), css.indexOf('@layer doc-custom {') > 0 ? css.indexOf('@layer doc-custom {') : undefined);

describe('style.parts — compiler', () => {
  it('base của phần → selector scope dưới node, trong @layer doc', () => {
    const { css } = compileDoc(formDoc({ parts: { submit: { base: fill } } }));
    expect(css).toContain('[data-n="f1"] .mm-form__submit {');
    expect(docLayer(css)).toContain('[data-n="f1"] .mm-form__submit {');
  });

  it('breakpoint nằm trong @media của breakpoint đó', () => {
    const { css } = compileDoc(formDoc({ parts: { input: { base: {}, md: fill } } }));
    const at = css.indexOf(`@media (min-width: ${BREAKPOINT_PX.md}px)`);
    expect(at).toBeGreaterThan(-1);
    const block = css.slice(at, css.indexOf('\n  }\n', at));
    expect(block).toContain('[data-n="f1"] .mm-form__input');
  });

  it('hover áp lên chính phần tử', () => {
    const { css } = compileDoc(formDoc({ parts: { submit: { base: {}, hover: fill } } }));
    expect(css).toContain('[data-n="f1"] .mm-form__submit:hover {');
  });

  it('focusVisible + selector nhiều phần: mỗi selector con đều được scope và nhận :focus-visible', () => {
    const { css } = compileDoc(formDoc({ parts: { input: { base: {}, focusVisible: fill } } }));
    expect(css).toContain(
      '[data-n="f1"] .mm-form__input:focus-visible, [data-n="f1"] .mm-form__checkbox:focus-visible {',
    );
  });

  it('base nhiều selector: scope từng cái', () => {
    const { css } = compileDoc(formDoc({ parts: { input: { base: fill } } }));
    expect(css).toContain('[data-n="f1"] .mm-form__input, [data-n="f1"] .mm-form__checkbox {');
  });

  it('phát sau rule của chính node (cùng lớp)', () => {
    const { css } = compileDoc(
      formDoc({ base: { spacing: { pt: { $token: 'space-l' } } }, parts: { submit: { base: fill } } }),
    );
    expect(css.indexOf('[data-n="f1"] {')).toBeLessThan(css.indexOf('[data-n="f1"] .mm-form__submit {'));
  });

  it('customCss của node vẫn ở @layer doc-custom', () => {
    const { css } = compileDoc(formDoc({ parts: { submit: { base: fill } } }, 'opacity: .5;'));
    expect(css.indexOf('[data-n="f1"] .mm-form__submit {')).toBeLessThan(css.indexOf('@layer doc-custom {'));
    expect(css.slice(css.indexOf('@layer doc-custom {'))).toContain('opacity: .5');
  });

  it('phần lạ (không có trong registry) bị bỏ, không sinh rule rác', () => {
    const { css } = compileDoc(formDoc({ parts: { nope: { base: fill } } }));
    expect(css).not.toContain('nope');
  });

  it('trong cây component dùng selIn', () => {
    const inst = {
      id: 'i1', type: 'Instance', componentId: 'c1', overrides: {},
      parentId: null, children: [], effects: [], style: { base: {} },
    } as unknown as Node;
    const doc: Doc = { schemaVersion: 1, rootId: 'i1', nodes: { i1: inst } };
    const cf = {
      id: 'cf', type: 'Composite', composite: 'Form', params: {}, slots: {},
      parentId: null, children: [], effects: [],
      style: { base: {}, parts: { submit: { base: fill, hover: fill }, input: { base: {}, lg: fill } } },
    } as unknown as Node;
    const { css } = compileDoc(doc, new Map([['c1', { nodes: { cf } }]]));
    expect(css).toContain('[data-c="c1"] [data-cn="cf"] .mm-form__submit {');
    expect(css).toContain('[data-c="c1"] [data-cn="cf"] .mm-form__submit:hover {');
    expect(css).toContain('[data-c="c1"] [data-cn="cf"] .mm-form__input, [data-c="c1"] [data-cn="cf"] .mm-form__checkbox {');
  });
});
