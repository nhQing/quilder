import { describe, expect, it } from 'vitest';

import showMore from './show-more';

/**
 * DOM giả, chỉ đủ những gì `show-more` chạm tới.
 *
 * Repo không cài jsdom/happy-dom; dựng cả một DOM cho một effect bốn chục dòng là
 * kéo theo một phụ thuộc chỉ để test. Đổi lại: thêm API DOM mới vào effect thì
 * phải thêm vào đây — test đỏ sẽ nói ngay thiếu cái gì.
 */
class FakeText {
  readonly nodeType = 3;
  constructor(public nodeValue: string) {}
  get textContent() {
    return this.nodeValue;
  }
}

class FakeEl {
  readonly nodeType = 1;
  childNodes: (FakeEl | FakeText)[] = [];
  attrs = new Map<string, string>();
  dataset: Record<string, string | undefined> = {};
  style: Record<string, string> = {};
  hidden = false;
  id = '';
  private listeners = new Map<string, Set<(e: { preventDefault(): void }) => void>>();

  constructor(public part?: string) {}

  append(...kids: (FakeEl | FakeText)[]) {
    this.childNodes.push(...kids);
    return this;
  }
  get textContent(): string {
    return this.childNodes.map((c) => c.textContent).join('');
  }
  setAttribute(k: string, v: string) {
    this.attrs.set(k, v);
  }
  getAttribute(k: string) {
    return this.attrs.get(k) ?? null;
  }
  removeAttribute(k: string) {
    this.attrs.delete(k);
  }
  querySelectorAll(sel: string): FakeEl[] {
    const role = /\[data-part~="([^"]+)"\]/.exec(sel)?.[1];
    const out: FakeEl[] = [];
    const walk = (n: FakeEl) => {
      for (const c of n.childNodes) {
        if (c instanceof FakeEl) {
          if (c.part?.split(/\s+/).includes(role ?? '')) out.push(c);
          walk(c);
        }
      }
    };
    walk(this);
    return out;
  }
  addEventListener(type: string, fn: (e: { preventDefault(): void }) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }
  removeEventListener(type: string, fn: (e: { preventDefault(): void }) => void) {
    this.listeners.get(type)?.delete(fn);
  }
  click() {
    for (const fn of this.listeners.get('click') ?? []) fn({ preventDefault() {} });
  }
}

function build() {
  const label = new FakeText('Xem thêm');
  const toggle = new FakeEl('more-toggle').append(new FakeEl().append(label));
  const panel = new FakeEl('more-panel').append(new FakeText('6 hàng ngân hàng'));
  const root = new FakeEl().append(new FakeEl().append(panel), toggle);
  return { root, toggle, panel, label };
}

const init = (root: FakeEl, params: Record<string, unknown> = {}) =>
  showMore.init(root as unknown as HTMLElement, showMore.paramsSchema.parse(params));

describe('show-more', () => {
  it('gắn vào là gập: panel ẩn, nút báo aria-expanded=false', () => {
    const { root, toggle, panel } = build();
    init(root);
    expect(panel.hidden).toBe(true);
    expect(panel.style.display).toBe('none');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('aria-controls')).toBe(panel.id);
    expect(root.dataset.moreOpen).toBeUndefined();
  });

  it('bấm là mở: hiện panel, đổi nhãn, ghi state more-open', () => {
    const { root, toggle, panel, label } = build();
    init(root);
    toggle.click();
    expect(panel.hidden).toBe(false);
    expect(panel.style.display).toBe('');
    expect(label.nodeValue).toBe('Thu gọn');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(root.dataset.moreOpen).toBe('true');
  });

  it('bấm lần nữa là gập và trả nhãn gốc', () => {
    const { root, toggle, panel, label } = build();
    init(root);
    toggle.click();
    toggle.click();
    expect(panel.hidden).toBe(true);
    expect(label.nodeValue).toBe('Xem thêm');
    expect(root.dataset.moreOpen).toBeUndefined();
  });

  it('nhãn khi mở lấy từ params', () => {
    const { root, toggle, label } = build();
    init(root, { labelOpen: 'Ẩn bớt' });
    toggle.click();
    expect(label.nodeValue).toBe('Ẩn bớt');
  });

  it('thiếu nút hoặc panel thì không làm gì và không ném', () => {
    const root = new FakeEl().append(new FakeEl('more-panel'));
    expect(() => init(root)).not.toThrow();
    expect((root.childNodes[0] as FakeEl).hidden).toBe(false);
  });

  it('dọn là trả mọi thứ về như trước khi gắn', () => {
    const { root, toggle, panel, label } = build();
    const dispose = init(root);
    toggle.click();
    dispose?.();
    expect(panel.hidden).toBe(false);
    expect(panel.style.display).toBe('');
    expect(label.nodeValue).toBe('Xem thêm');
    expect(toggle.getAttribute('aria-expanded')).toBeNull();
    expect(root.dataset.moreOpen).toBeUndefined();
    toggle.click();
    expect(panel.hidden).toBe(false);
  });
});
