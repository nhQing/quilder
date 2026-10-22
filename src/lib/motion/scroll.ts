/**
 * Lenis + đồng bộ GSAP ScrollTrigger.
 *
 * Port từ ../new-website/js/core/scroll.js. Lenis cuộn window một cách tự nhiên
 * (nó không transform một wrapper), nên ScrollTrigger không cần scrollerProxy —
 * chỉ cần được nhắc cập nhật ở mỗi frame Lenis. Bản thân Lenis được tick từ
 * vòng lặp duy nhất trong raf.ts.
 *
 * ## Khác bản gốc
 *
 * 1. gsap / ScrollTrigger / Lenis là ES module import, không đọc từ `window`.
 * 2. **Sửa hai chỗ rò rỉ.** Bản gốc gọi `onReducedMotionChange(...)` rồi vứt hàm
 *    huỷ, và `bindAnchors` gắn listener không có đường tháo. Vô hại với một trang
 *    tải đúng một lần; nhưng dưới client navigation của Next thì mỗi lần điều
 *    hướng để lại thêm một listener. Giờ `init()` gom mọi hàm huỷ và `destroy()`
 *    gọi hết.
 */

import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';

import { anchorOffset, isFocusableTarget } from './anchor-target';
import * as raf from './raf';
import { onReducedMotionChange, prefersReducedMotion } from './reduced-motion';

let lenis: Lenis | null = null;
let ready = false;
let cleanups: Array<() => void> = [];

export function init(): Lenis | null {
  if (ready) return lenis;

  gsap.registerPlugin(ScrollTrigger);
  // raf.ts cần chính instance gsap này để clock bằng ticker của nó — nếu không
  // nó sẽ dựng rAF riêng và ta có HAI vòng lặp, đúng thứ cả kiến trúc này tránh.
  raf.configure(gsap);

  // Reduced motion: không smoothing, không quán tính. Scroll gốc là hành vi
  // trung thực ở đây, và ScrollTrigger chạy tốt với nó.
  if (prefersReducedMotion()) {
    ScrollTrigger.refresh();
    ready = true;
    raf.start();
    return null;
  }

  lenis = new Lenis({
    duration: 1.05,
    easing: (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
    smoothWheel: true,
    // Thiết bị cảm ứng đã có quán tính gốc, và tốt hơn.
    syncTouch: false,
    touchMultiplier: 1.6,
    wheelMultiplier: 1,
    autoRaf: false,
  });

  const onScroll = () => ScrollTrigger.update();
  lenis.on('scroll', onScroll);
  cleanups.push(() => lenis?.off('scroll', onScroll));

  // Priority -100: vị trí scroll đã chốt trước khi bất kỳ effect nào đọc nó.
  cleanups.push(raf.add((frame) => lenis?.raf(frame.time), raf.PRIORITY.scroll));
  raf.start();

  // Người dùng bật reduced motion giữa phiên thì bỏ smoothing ngay.
  cleanups.push(
    onReducedMotionChange((reduced) => {
      if (!lenis) return;
      if (reduced) lenis.stop();
      else lenis.start();
    }),
  );

  ready = true;
  return lenis;
}

export function getLenis(): Lenis | null {
  return lenis;
}

/** Khoá cuộn (splash screen của site cũ dùng; giữ lại cho modal/menu mobile). */
export function lock(): void {
  lenis?.stop();
  document.documentElement.style.setProperty('overflow', 'clip');
}

export function unlock(): void {
  document.documentElement.style.removeProperty('overflow');
  if (!prefersReducedMotion()) lenis?.start();
}

export function scrollTo(
  target: string | number | HTMLElement,
  options: Record<string, unknown> = {},
): void {
  if (lenis) {
    lenis.scrollTo(target, { offset: -80, duration: 1.2, ...options });
    return;
  }

  const element = typeof target === 'string' ? document.querySelector(target) : target;
  if (element instanceof HTMLElement) {
    element.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  } else if (typeof target === 'number') {
    window.scrollTo({ top: target, behavior: 'auto' });
  }
}

/**
 * Chặn anchor cùng trang để chúng đi qua Lenis.
 * Trả về hàm tháo — bản gốc không có, và đó là chỗ rò rỉ thứ hai.
 */
export function bindAnchors(root: Document | Element = document): () => void {
  const handler = (event: Event) => {
    const link =
      event.target instanceof Element ? event.target.closest('a[href^="#"]') : null;
    if (!link) return;

    const hash = link.getAttribute('href');
    if (!hash || hash === '#') return;

    const target = document.querySelector(hash);
    if (!(target instanceof HTMLElement)) return;

    event.preventDefault();
    history.pushState(null, '', hash);

    // Đích là trường nhập (ô email chân trang): cuộn tới nơi RỒI mới đặt focus.
    // `focus()` gọi ngay sẽ tự keo trang tới phần tử và cắt ngang chính cú cuộn
    // mượt vừa bắt đầu; nên đợi tới nơi, và đặt bằng `preventScroll` để trình
    // duyệt không cuộn thêm một nhịp nữa.
    if (!isFocusableTarget(target)) {
      scrollTo(target);
      return;
    }

    const header = document.querySelector('[data-header]');
    const headerBottom = header instanceof HTMLElement ? header.getBoundingClientRect().bottom : 0;
    const offset = anchorOffset(true, headerBottom);
    const land = () => target.focus({ preventScroll: true });

    if (lenis) {
      scrollTo(target, { offset, onComplete: land });
      return;
    }
    // Không có Lenis (reduced motion): `scrollIntoView` bỏ qua offset nên tính
    // toạ độ tay, nhảy thẳng, rồi focus ngay — không có hoạt cảnh nào để cắt ngang.
    window.scrollTo({ top: target.getBoundingClientRect().top + window.scrollY + offset });
    land();
  };

  root.addEventListener('click', handler);
  return () => root.removeEventListener('click', handler);
}

/** Báo cho ScrollTrigger biết chiều cao document đã đổi. */
export function refresh(): void {
  ScrollTrigger.refresh();
}

export function destroy(): void {
  for (const fn of cleanups) fn();
  cleanups = [];
  lenis?.destroy();
  lenis = null;
  ready = false;
  ScrollTrigger.getAll().forEach((trigger) => trigger.kill());
}
