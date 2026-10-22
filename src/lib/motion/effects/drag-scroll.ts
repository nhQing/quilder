/**
 * Kéo chuột để cuộn ngang một viewport overflow.
 *
 * Port từ home-v2/effects/useDragScroll.js. Các dải ngang của trang chủ không có
 * nút prev/next trong thiết kế, nên chạm, trackpad và phím mũi tên đến được con
 * chuột rồi thì không — đây là cách bù, và nó chỉ làm đúng việc đó.
 *
 * ## Hai điều CÓ Ý không làm
 *
 *  - Không nghe `wheel`: biến cuộn dọc thành cuộn ngang là cướp lấy trang của
 *    người đọc.
 *  - Thoát ngay với `pointerType !== 'mouse'`: quán tính gốc của trình duyệt
 *    tốt hơn bất cứ thứ gì viết tay ở đây.
 *
 * ## Phối hợp với effect khác cùng ghi `scrollLeft`
 *
 * Autoplay (story-carousel) hay marquee cuộn CÙNG viewport sẽ đánh nhau với tay
 * kéo. Effect ghi `data-dragging` lên viewport: "true" khi đang kéo, "glide" khi
 * đang trôi theo đà. Effect kia chỉ cần tạm dừng khi attribute này có mặt.
 *
 * ## Một vòng lặp duy nhất
 *
 * Bản gốc tự gọi `requestAnimationFrame` cho cú trôi; ở đây nó đi qua `raf.ts`.
 */

import { z } from 'zod';

import * as raf from '../raf';
import { prefersReducedMotion } from '../reduced-motion';
import { DRAG_SLOP, easeOutCubic, planGlide, type GlidePlan } from './drag-scroll-model';
import { defineEffect } from './types';

const paramsSchema = z.object({
  /** Vai của track chứa các item. Không thấy thì dùng con đầu tiên của viewport. */
  trackPart: z.string().min(1).max(40).default('drag-track'),
  /** Vai của từng item để tính mốc snap. Không thấy thì dùng con trực tiếp của track. */
  itemPart: z.string().min(1).max(40).default('drag-item'),
  /** Thả tay thì trôi theo đà rồi hạ cánh ở một mốc. Tắt khi có thứ khác cũng ghi scrollLeft. */
  momentum: z.boolean().default(false),
  /** Khi trôi theo đà thì hạ cánh đúng mép một item. Chỉ có nghĩa khi `momentum` bật. */
  snap: z.boolean().default(true),
});

type Params = z.infer<typeof paramsSchema>;

export default defineEffect<Params>({
  key: 'drag-scroll',
  name: 'Kéo chuột để cuộn ngang',
  paramsSchema,
  aiDescription:
    'Cho phép kéo bằng chuột để cuộn ngang một viewport có overflow-x (chỉ chuột; chạm và wheel để nguyên). Gắn vào chính viewport cuộn (overflow-x: auto); track bên trong đánh part "drag-track", từng thẻ đánh part "drag-item" (không đánh thì dùng con đầu tiên và các con trực tiếp của nó). Kéo quá 5px thì nuốt cú click theo sau nên link trong thẻ không bị bấm nhầm. momentum bật thì thả tay trôi theo đà rồi snap vào mép thẻ (snap=false để trôi tự do). Ghi state "dragging" ("true" khi kéo, "glide" khi đang trôi) để effect autoplay khác tạm dừng và để CSS đổi cursor/tắt scroll-snap. Chỉ cuộn được khi nội dung thật sự rộng hơn viewport.',
  runtimeCost: 'light',
  statesWritten: ['dragging'],
  // Kéo là thao tác của người dùng chứ không phải chuyển động tự chạy, nên
  // reduced motion không tắt nó. Chỉ cú TRÔI THEO ĐÀ là chuyển động thêm, và nó
  // tự kiểm `prefersReducedMotion()` lúc thả.
  gates: { respectReducedMotion: false },

  init(el, params) {
    let pointerId: number | null = null;
    let startX = 0;
    let startScroll = 0;
    let lastX = 0;
    let lastT = 0;
    let velocity = 0;
    let dragged = 0;
    let glide: (GlidePlan & { elapsed: number }) | null = null;
    let unsubscribe: (() => void) | null = null;

    const track = (): Element | undefined =>
      el.querySelector(`[data-part~="${params.trackPart}"]`) ?? el.children[0] ?? undefined;

    /**
     * Mốc snap đo TƯƠNG ĐỐI với item đầu tiên.
     *
     * Không đọc `scroll-padding-inline-start`: getComputedStyle trả chuỗi chưa
     * giải kiểu `max(20px, 50% - 754px)`, parseFloat ra 0 và mọi đích lệch cả một
     * gutter. Đo từ item đầu thì phép trừ triệt tiêu padding đi.
     */
    const snapPositions = (): number[] => {
      const host = track();
      if (!host) return [0];
      const tagged = host.querySelectorAll<HTMLElement>(`[data-part~="${params.itemPart}"]`);
      const items = (tagged.length ? Array.from(tagged) : Array.from(host.children)) as HTMLElement[];
      if (!items.length) return [0];
      const base = items[0]!.offsetLeft;
      return items.map((item) => item.offsetLeft - base);
    };

    const stopGlide = () => {
      unsubscribe?.();
      unsubscribe = null;
      glide = null;
    };

    const runGlide = (plan: GlidePlan) => {
      glide = { ...plan, elapsed: 0 };
      el.dataset.dragging = 'glide';
      unsubscribe = raf.add((frame) => {
        if (!glide) return;
        glide.elapsed += frame.deltaMs;
        const p = Math.min(1, glide.elapsed / glide.duration);
        el.scrollLeft = glide.from + (glide.to - glide.from) * easeOutCubic(p);
        if (p < 1) return;
        stopGlide();
        delete el.dataset.dragging;
      }, raf.PRIORITY.effect);
    };

    const onPointerDown = (event: PointerEvent) => {
      // Chạm có quán tính riêng, và nó tốt hơn.
      if (event.pointerType !== 'mouse' || event.button !== 0) return;
      stopGlide();
      delete el.dataset.dragging;
      pointerId = event.pointerId;
      startX = event.clientX;
      lastX = event.clientX;
      lastT = event.timeStamp;
      startScroll = el.scrollLeft;
      velocity = 0;
      dragged = 0;
    };

    const onPointerMove = (event: PointerEvent) => {
      if (pointerId !== event.pointerId) return;
      const delta = event.clientX - startX;
      if (!el.dataset.dragging && Math.abs(delta) > 1) {
        // CSS bỏ snap và scroll-behavior khi có attribute này, không thì dải
        // đánh nhau với con trỏ.
        el.dataset.dragging = 'true';
        try {
          el.setPointerCapture(pointerId);
        } catch {
          // Pointer đã biến mất giữa chừng — kéo vẫn chạy được qua listener window.
        }
      }
      if (!el.dataset.dragging) return;

      const dt = event.timeStamp - lastT;
      if (dt > 0) {
        velocity = (event.clientX - lastX) / dt;
        lastX = event.clientX;
        lastT = event.timeStamp;
      }
      dragged = Math.abs(delta);
      event.preventDefault();
      el.scrollLeft = startScroll - delta;
    };

    const onPointerUp = (event: PointerEvent) => {
      if (pointerId !== event.pointerId) return;
      pointerId = null;
      if (!el.dataset.dragging) return;

      if (params.momentum && !prefersReducedMotion()) {
        const plan = planGlide({
          scrollLeft: el.scrollLeft,
          max: el.scrollWidth - el.clientWidth,
          // Đổi dấu: con trỏ sang phải là scrollLeft giảm.
          velocity: -velocity,
          idleMs: event.timeStamp - lastT,
          snaps: params.snap ? snapPositions() : [],
        });
        if (plan) {
          runGlide(plan);
          return;
        }
      }
      delete el.dataset.dragging;
    };

    // Cú kéo quá ngưỡng nuốt luôn `click` theo sau, để kéo bắt đầu trên một link
    // thì cuộn chứ không điều hướng.
    const onClick = (event: Event) => {
      if (dragged > DRAG_SLOP) {
        event.preventDefault();
        event.stopPropagation();
        dragged = 0;
      }
    };

    // Ảnh là phần tử kéo được sẵn: một cú nắm trúng ảnh mở drag-and-drop thật và
    // treo bóng ma của ảnh ở con trỏ.
    const onDragStart = (event: Event) => event.preventDefault();

    el.addEventListener('dragstart', onDragStart);
    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    el.addEventListener('click', onClick, true);

    return () => {
      stopGlide();
      delete el.dataset.dragging;
      el.removeEventListener('dragstart', onDragStart);
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      el.removeEventListener('click', onClick, true);
    };
  },
});
