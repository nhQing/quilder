/**
 * Parallax theo lớp.
 *
 * Port từ ../new-website/js/effects/parallax.js. Mỗi element scrub độ lệch y của
 * chính nó theo vị trí cuộn. `speed` là phần chiều cao của element mà nó đi
 * được trong cả lượt — 0.2 là trôi nhẹ, 0.6 là kịch tính.
 *
 * Media bên trong bị phóng to đúng theo tỉ lệ đó, để chuyển động không bao giờ
 * để lộ mép.
 *
 * ## Hai đường chạy (08/10/2026)
 *
 * Trình duyệt có CSS scroll-driven animation (`animation-timeline`) thì chuyển động
 * chạy bằng CSS trên compositor: không ScrollTrigger, không tween, không việc gì ở mỗi
 * khung hình trên luồng chính. Module chỉ ghi ba biến CSS và hai data-attribute, cộng
 * MỘT thẻ `<style>` (`TIMELINE_CSS` bên dưới). Trình duyệt chưa có thì GSAP chạy như cũ.
 *
 * CSS nằm TRONG module chứ không trong `src/styles/`: CSS tĩnh của site được niêm phong
 * theo từng release (`/mm-css/<hash>.css`), còn JS của effect là code đang chạy. Đặt rule
 * vào `site.css` thì sau một lần deploy, mọi trang ĐÃ publish chạy JS mới (chọn đường
 * CSS) trên bó CSS cũ (không có rule) — parallax đứng im cho tới lần publish sau. Effect
 * là code, nên phần CSS của nó đi cùng code.
 *
 * Đường CSS bám CỨNG vào vị trí cuộn — không có độ trễ `scrub`. Trên site điều đó gần
 * như không khác: Lenis đã làm mượt chính vị trí cuộn, và timeline đi theo vị trí đã
 * mượt đó. Ai đặt `scrub` lớn hơn mặc định là muốn độ trễ nặng có chủ đích, nên ca đó
 * vẫn đi GSAP.
 */

import { z } from 'zod';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

import { defineEffect } from './types';

/** `scrub` tối đa còn đi đường CSS — bằng mặc định. Xem docblock đầu file. */
const CSS_SCRUB_MAX = 0.6;

/**
 * Timeline có tên gắn trên ELEMENT (không phải trên media đang bị phóng to và dịch
 * chuyển): cùng mốc đầu–cuối với `trigger: el` của nhánh GSAP — `cover 0%` là đáy
 * viewport chạm đỉnh element, `cover 100%` là đỉnh viewport chạm đáy element.
 */
const TIMELINE_CSS = `
[data-mm-parallax='timeline'] { view-timeline: --mm-parallax block; }
[data-mm-parallax-target] {
  transform-origin: 50% 50%;
  animation: mm-parallax linear both;
  animation-timeline: --mm-parallax;
  animation-range: cover 0% cover 100%;
}
@keyframes mm-parallax {
  from { transform: translateY(var(--mm-px-from, 0)) scale(var(--mm-px-scale, 1)); }
  to { transform: translateY(var(--mm-px-to, 0)) scale(var(--mm-px-scale, 1)); }
}
@media (prefers-reduced-motion: reduce) { [data-mm-parallax-target] { animation: none; } }
`;

/** Một thẻ `<style>` cho mọi instance, đếm tham chiếu như `arm()` của scroll-reveal. */
let timelineUsers = 0;
function armTimelineCss(): () => void {
  timelineUsers += 1;
  if (!document.querySelector('style[data-mm-parallax-css]')) {
    const style = document.createElement('style');
    style.dataset.mmParallaxCss = '';
    style.textContent = TIMELINE_CSS;
    document.head.appendChild(style);
  }
  return () => {
    timelineUsers = Math.max(0, timelineUsers - 1);
    if (timelineUsers === 0) document.querySelector('style[data-mm-parallax-css]')?.remove();
  };
}

function supportsScrollTimeline(): boolean {
  return typeof CSS !== 'undefined' && typeof CSS.supports === 'function' &&
    CSS.supports('animation-timeline: view()');
}

const paramsSchema = z.object({
  speed: z.number().min(0).max(1).default(0.2),
  /**
   * Hệ số phóng để hành trình nằm gọn trong khung. 1.35 là con số của bản gốc —
   * đủ để speed 0.6 vẫn không lộ mép ở tỉ lệ khung phổ biến.
   */
  overscaleFactor: z.number().min(1).max(3).default(1.35),
  /** Độ trễ scrub, giây. 0 là bám cứng vào scroll. */
  scrub: z.number().min(0).max(3).default(0.6),
});

type Params = z.infer<typeof paramsSchema>;

export default defineEffect<Params>({
  key: 'parallax',
  name: 'Trôi nhiều lớp',
  paramsSchema,
  aiDescription:
    'Ảnh hoặc nền trôi chậm hơn trang khi cuộn, tạo chiều sâu. Dùng cho ảnh lớn và nền section.',
  runtimeCost: 'medium',
  // Effect ghim bằng sticky của gói dự án (panel-stack, chapter-parallax…) tự khai
  // xung đột với 'parallax': một transform trên node tổ tiên biến node đó thành
  // containing block, và `position: sticky` bên trong resolve theo nó thay vì theo
  // viewport — cơ chế ghim tắt hẳn, im lặng. Validator đọc conflicts cả hai phía.
  conflicts: ['scrub-timeline'],

  init(el, params) {
    // Media bên trong là thứ di chuyển; nếu không có thì chính element di chuyển.
    const media = el.querySelector<HTMLElement>('img, video, canvas, picture');
    const target = media ?? el;

    const overscale = 1 + params.speed * params.overscaleFactor;

    if (supportsScrollTimeline() && params.scrub <= CSS_SCRUB_MAX) {
      // Cùng hành trình với nhánh GSAP: từ đáy viewport chạm đỉnh element tới đỉnh
      // viewport chạm đáy element (`cover 0%` → `cover 100%`), yPercent ±speed·50.
      const disarm = armTimelineCss();
      el.dataset.mmParallax = 'timeline';
      target.dataset.mmParallaxTarget = '';
      target.style.setProperty('--mm-px-from', `${-params.speed * 50}%`);
      target.style.setProperty('--mm-px-to', `${params.speed * 50}%`);
      target.style.setProperty('--mm-px-scale', String(overscale));
      return () => {
        delete el.dataset.mmParallax;
        delete target.dataset.mmParallaxTarget;
        target.style.removeProperty('--mm-px-from');
        target.style.removeProperty('--mm-px-to');
        target.style.removeProperty('--mm-px-scale');
        disarm();
      };
    }

    gsap.set(target, { scale: overscale, transformOrigin: '50% 50%' });

    const tween = gsap.fromTo(
      target,
      { yPercent: -params.speed * 50 },
      {
        yPercent: params.speed * 50,
        ease: 'none',
        scrollTrigger: {
          trigger: el,
          start: 'top bottom',
          end: 'bottom top',
          scrub: params.scrub,
          // Cần thiết: chiều cao element đổi khi ảnh tải xong hoặc khi đổi
          // breakpoint, và không có cờ này thì hành trình tính theo số cũ.
          invalidateOnRefresh: true,
        },
      },
    );

    return () => {
      (tween.scrollTrigger as ScrollTrigger | undefined)?.kill();
      tween.kill();
      // clearProps chứ không set về 0: trả element về đúng những gì CSS nói,
      // thay vì ghi đè bằng một transform "trung tính" do JS quyết định.
      gsap.set(target, { clearProps: 'transform' });
    };
  },
});
