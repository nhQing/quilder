import { describe, expect, it } from 'vitest';

import steps from './steps';

/**
 * DOM giả, chỉ đủ những gì `steps` chạm tới — cùng lý do với show-more.test.ts:
 * repo không cài jsdom/happy-dom.
 */
type Listener = (e: { key?: string; preventDefault(): void }) => void;

class FakeEl {
  readonly nodeType = 1;
  children: FakeEl[] = [];
  attrs = new Map<string, string>();
  dataset: Record<string, string | undefined> = {};
  props = new Map<string, string>();
  style = {
    setProperty: (k: string, v: string) => void this.props.set(k, v),
    removeProperty: (k: string) => void this.props.delete(k),
  };
  private listeners = new Map<string, Set<Listener>>();

  constructor(public part?: string) {}

  append(...kids: FakeEl[]) {
    this.children.push(...kids);
    return this;
  }
  setAttribute(k: string, v: string) {
    this.attrs.set(k, v);
  }
  getAttribute(k: string) {
    return this.attrs.get(k) ?? null;
  }
  hasAttribute(k: string) {
    return this.attrs.has(k);
  }
  removeAttribute(k: string) {
    this.attrs.delete(k);
  }
  querySelectorAll(sel: string): FakeEl[] {
    const role = /\[data-part~="([^"]+)"\]/.exec(sel)?.[1];
    const out: FakeEl[] = [];
    const walk = (n: FakeEl) => {
      for (const c of n.children) {
        if (c.part?.split(/\s+/).includes(role ?? '')) out.push(c);
        walk(c);
      }
    };
    walk(this);
    return out;
  }
  addEventListener(type: string, fn: Listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }
  removeEventListener(type: string, fn: Listener) {
    this.listeners.get(type)?.delete(fn);
  }
  fire(type: string, key?: string) {
    let prevented = false;
    for (const fn of this.listeners.get(type) ?? []) fn({ key, preventDefault: () => { prevented = true; } });
    return prevented;
  }
}

function build(n = 3) {
  const items = Array.from({ length: n }, () => new FakeEl('step'));
  const media = Array.from({ length: n }, () => new FakeEl('step-media'));
  const root = new FakeEl().append(new FakeEl().append(...items), new FakeEl().append(...media));
  return { root, items, media };
}

const init = (root: FakeEl, params: Record<string, unknown> = {}) =>
  steps.init(root as unknown as HTMLElement, steps.paramsSchema.parse(params));

const flags = (els: FakeEl[]) =>
  els.map((e) => (e.dataset.stepActive === 'true' ? 'A' : e.dataset.stepInactive === 'true' ? 'i' : '-')).join('');

describe('steps', () => {
  it('gắn vào: bước đầu đang chọn, các bước khác ghi step-inactive', () => {
    const { root, items, media } = build();
    init(root);
    expect(flags(items)).toBe('Aii');
    expect(flags(media)).toBe('Aii');
    expect(items.map((e) => e.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false']);
  });

  it('ảnh nhận --step-offset = bước đang chọn − thứ tự ảnh', () => {
    const { root, items, media } = build();
    init(root);
    expect(media.map((m) => m.props.get('--step-offset'))).toEqual(['0', '-1', '-2']);
    items[1]!.fire('click');
    expect(media.map((m) => m.props.get('--step-offset'))).toEqual(['1', '0', '-1']);
  });

  it('bấm một bước là chọn bước đó', () => {
    const { root, items, media } = build();
    init(root);
    items[2]!.fire('click');
    expect(flags(items)).toBe('iiA');
    expect(flags(media)).toBe('iiA');
  });

  it('Enter / Space chọn bước, phím khác thì không', () => {
    const { root, items } = build();
    init(root);
    expect(items[1]!.fire('keydown', 'Tab')).toBe(false);
    expect(flags(items)).toBe('Aii');
    expect(items[1]!.fire('keydown', 'Enter')).toBe(true);
    expect(flags(items)).toBe('iAi');
    items[2]!.fire('keydown', ' ');
    expect(flags(items)).toBe('iiA');
  });

  it('bước tới được bằng bàn phím: role tab + tabindex', () => {
    const { root, items } = build();
    init(root);
    expect(items[0]!.getAttribute('role')).toBe('tab');
    expect(items[0]!.getAttribute('tabindex')).toBe('0');
  });

  it('initial chọn bước mở sẵn, ngoài khoảng thì kẹp lại', () => {
    const a = build();
    init(a.root, { initial: 1 });
    expect(flags(a.items)).toBe('iAi');
    const b = build();
    init(b.root, { initial: 9 });
    expect(flags(b.items)).toBe('iiA');
  });

  it('chưa có bước nào thì không làm gì và không ném', () => {
    const root = new FakeEl().append(new FakeEl('step-media'));
    expect(() => init(root)).not.toThrow();
    expect(root.children[0]!.dataset.stepActive).toBeUndefined();
  });

  it('dọn là trả mọi thứ về như trước khi gắn', () => {
    const { root, items, media } = build();
    const dispose = init(root);
    items[1]!.fire('click');
    dispose?.();
    expect(flags(items)).toBe('---');
    expect(flags(media)).toBe('---');
    expect(media[0]!.props.has('--step-offset')).toBe(false);
    expect(items[0]!.getAttribute('role')).toBeNull();
    expect(items[0]!.getAttribute('tabindex')).toBeNull();
    items[2]!.fire('click');
    expect(flags(items)).toBe('---');
  });
});
