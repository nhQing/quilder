// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../scroll', () => ({ lock: vi.fn(), unlock: vi.fn() }));

import effect from './menu-toggle';

/** Trình đơn mobile có hai nhóm con (Sản phẩm / Tin tức), mỗi nhóm một nút + một khối. */
function build(withPanels = true) {
  document.body.innerHTML = `
    <header id="h">
      <button data-part="burger" id="burger">menu</button>
      <nav data-part="menu-panel">
        <div id="row-p">
          <button data-part="menu-sub-toggle" id="tp">Sản phẩm</button>
          ${withPanels ? '<div data-part="menu-sub-panel" id="sp"><a href="/a">A</a></div>' : ''}
        </div>
        <div id="row-n">
          <button data-part="menu-sub-toggle" id="tn">Tin tức</button>
          ${withPanels ? '<div data-part="menu-sub-panel" id="sn"><a href="/b">B</a></div>' : ''}
        </div>
      </nav>
    </header>`;
  return document.getElementById('h')!;
}

const click = (id: string) => document.getElementById(id)!.click();
const expanded = (id: string) => document.getElementById(id)!.getAttribute('aria-expanded');

describe('menu-toggle nhóm con độc lập (menu-sub-panel)', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  });
  afterEach(() => vi.unstubAllGlobals());

  const mount = (withPanels = true, extra: Record<string, unknown> = {}) => {
    const el = build(withPanels);
    const dispose = effect.init(el, effect.paramsSchema.parse(extra)) as () => void;
    return { el, dispose };
  };

  it('ghép nút ↔ khối cùng hàng, đặt aria-controls và inert', () => {
    const { dispose } = mount();
    expect(document.getElementById('tp')!.getAttribute('aria-controls')).toBe('sp');
    expect(document.getElementById('tn')!.getAttribute('aria-controls')).toBe('sn');
    expect(document.getElementById('sp')!.hasAttribute('inert')).toBe(true);
    dispose();
  });

  it('mở Sản phẩm rồi Tin tức: nhóm trước gập, state nằm trên nút và khối', () => {
    const { el, dispose } = mount();
    click('tp');
    expect(expanded('tp')).toBe('true');
    expect(document.getElementById('sp')!.dataset.menuSubOpen).toBe('true');
    expect(document.getElementById('sp')!.hasAttribute('inert')).toBe(false);
    click('tn');
    expect(expanded('tp')).toBe('false');
    expect(document.getElementById('sp')!.dataset.menuSubOpen).toBeUndefined();
    expect(expanded('tn')).toBe('true');
    expect(document.getElementById('sn')!.dataset.menuSubOpen).toBe('true');
    click('tn');
    expect(document.getElementById('sn')!.dataset.menuSubOpen).toBeUndefined();
    expect(el.dataset.menuSubOpen).toBeUndefined();
    dispose();
  });

  /*
   * Lỗi thật trên maimoney.com (mobile, 19/11/2026): mở "Sản phẩm" thì khối "Tin tức"
   * cũng bung, và ngược lại. Renderer phát state style dưới hai dạng — cờ trên chính
   * node HOẶC trên một tổ tiên (`[data-menu-sub-open="true"] <khối>`). Nếu node gắn
   * effect (tổ tiên của mọi khối) cũng mang cờ, dạng tổ tiên khớp MỌI khối cùng lúc.
   */
  it('mở một nhóm không làm khối của nhóm kia khớp selector dạng tổ tiên', () => {
    const { el, dispose } = mount();
    click('tp');
    expect(el.dataset.menuSubOpen).toBeUndefined();
    expect(document.querySelector('[data-menu-sub-open="true"] #sn')).toBeNull();
    expect(document.querySelector('[data-menu-sub-open="true"] #sp')).toBeNull();
    expect(document.getElementById('sp')!.matches('[data-menu-sub-open="true"]')).toBe(true);
    click('tn');
    expect(document.querySelector('[data-menu-sub-open="true"] #sp')).toBeNull();
    expect(document.getElementById('sp')!.matches('[data-menu-sub-open="true"]')).toBe(false);
    dispose();
  });

  it('subExclusive=false cho mở cùng lúc', () => {
    const { dispose } = mount(true, { subExclusive: false });
    click('tp');
    click('tn');
    expect(expanded('tp')).toBe('true');
    expect(expanded('tn')).toBe('true');
    dispose();
  });

  it('đóng trình đơn thì gập mọi nhóm', () => {
    const { el, dispose } = mount();
    click('burger');
    click('tp');
    click('burger');
    expect(expanded('tp')).toBe('false');
    expect(el.dataset.menuSubOpen).toBeUndefined();
    dispose();
  });

  it('không có khối riêng thì chạy như cũ: một state chung trên node gắn effect', () => {
    const { el, dispose } = mount(false);
    click('tp');
    expect(el.dataset.menuSubOpen).toBe('true');
    expect(expanded('tp')).toBe('true');
    expect(expanded('tn')).toBe('true');
    dispose();
  });

  it('dọn sạch', () => {
    const { el, dispose } = mount();
    click('tp');
    dispose();
    expect(el.dataset.menuSubOpen).toBeUndefined();
    expect(document.getElementById('tp')!.hasAttribute('aria-controls')).toBe(false);
    expect(document.getElementById('sp')!.hasAttribute('inert')).toBe(false);
  });
});
