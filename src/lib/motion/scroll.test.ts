import { describe, expect, it, vi } from 'vitest';

const lenisOptions: Array<Record<string, unknown>> = [];

vi.mock('lenis', () => ({
  default: class {
    constructor(opts: Record<string, unknown>) {
      lenisOptions.push(opts);
    }
    on() {}
    off() {}
    raf() {}
    start() {}
    stop() {}
  },
}));
vi.mock('gsap', () => ({ gsap: { registerPlugin() {} } }));
vi.mock('gsap/ScrollTrigger', () => ({ ScrollTrigger: { update() {}, refresh() {} } }));
vi.mock('./raf', () => ({ configure() {}, start() {}, add: () => () => {}, PRIORITY: { scroll: -100 } }));
vi.mock('./reduced-motion', () => ({ prefersReducedMotion: () => false, onReducedMotionChange: () => () => {} }));

import { init } from './scroll';

/**
 * Lenis chặn bánh xe chuột ở mọi phần tử con rồi tự cuộn window. Khung có thanh cuộn
 * riêng (danh sách "Bài viết nổi bật" ở /blogs) vì thế không cuộn được bằng chuột: rê
 * vào rồi lăn là cả trang chạy. `allowNestedScroll` trả bánh xe về cho khung đó, và khi
 * khung đã chạm đáy thì trang cuộn tiếp như thường.
 */
describe('scroll.init', () => {
  it('để khung cuộn con tự cuộn bằng bánh xe chuột', () => {
    init();
    expect(lenisOptions).toHaveLength(1);
    expect(lenisOptions[0]).toMatchObject({ allowNestedScroll: true });
  });
});
