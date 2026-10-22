/**
 * Hiện dần khi vào viewport.
 *
 * Port từ ../new-website/js/effects/scroll-reveal.js.
 *
 * ## Hai thứ phải giữ nguyên, nếu không là hỏng cả trang
 *
 * 1. **Trạng thái thị giác nằm ở CSS** (`effects/reveal.css`); module này chỉ lật
 *    `data-revealed` và ghi delay. Tách như vậy nghĩa là một lỗi ở đây để lại nội
 *    dung HIỆN, chứ không phải kẹt ở `opacity: 0`.
 * 2. **`data-reveal-ready` chỉ bật khi đã chắc chắn có thứ bỏ ẩn.** CSS chỉ ẩn
 *    khi cờ này có mặt. Nếu bundle effect không tải được, cờ không bao giờ bật,
 *    và trang hiện bình thường.
 *
 * ## Khác bản gốc: batch tự làm thay vì ScrollTrigger.batch
 *
 * Bản gốc gom mọi element cùng vượt ngưỡng trong một frame rồi stagger theo chỉ
 * số trong batch. Mô hình per-instance ở đây không còn khái niệm batch, nên
 * scheduler nhỏ bên dưới gom các element cùng hiện trong MỘT frame và đánh chỉ số
 * theo thứ tự DOM — cùng kết quả thị giác, không cần ScrollTrigger.
 */

import { z } from 'zod';

import { observe } from '../observer';
import { prefersReducedMotion } from '../reduced-motion';
import { defineEffect } from './types';

const paramsSchema = z.object({
  /** Giây giữa hai element cùng hiện trong một frame. */
  stagger: z.number().min(0).max(2).default(0.08),
  /** Delay cố định, giây. Đặt thì bỏ qua stagger. */
  delay: z.number().min(0).max(5).optional(),
  /** Kích hoạt sớm/muộn so với đáy viewport. */
  rootMargin: z.string().default('0px 0px -10% 0px'),
  /** Chỉ hiện một lần, không ẩn lại khi cuộn ngược. */
  once: z.boolean().default(true),
});

type Params = z.infer<typeof paramsSchema>;

/* ── Cờ "đã sẵn sàng", đếm tham chiếu ─────────────────────────────────── */

// Cờ này mang tính toàn trang nhưng effect thì gắn theo từng element, nên phải
// đếm: bật khi instance đầu tiên gắn, tắt khi instance cuối cùng rời đi.
let armedCount = 0;

function arm(): void {
  armedCount += 1;
  if (armedCount === 1 && typeof document !== 'undefined') {
    document.documentElement.dataset.revealReady = 'true';
  }
}

function disarm(): void {
  armedCount = Math.max(0, armedCount - 1);
  if (armedCount === 0 && typeof document !== 'undefined') {
    delete document.documentElement.dataset.revealReady;
  }
}

/* ── Gom theo frame để stagger ────────────────────────────────────────── */

let pending: Array<{ el: HTMLElement; stagger: number }> = [];
let flushScheduled = false;

function flush(): void {
  flushScheduled = false;
  // Thứ tự DOM, để stagger chạy từ trên xuống chứ không theo thứ tự
  // IntersectionObserver ngẫu nhiên trả về.
  const batch = pending.sort((a, b) =>
    a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
  );
  pending = [];

  batch.forEach(({ el, stagger }, index) => {
    el.style.setProperty('--reveal-delay', `${(index * stagger).toFixed(3)}s`);
    el.dataset.revealed = 'true';
  });
}

function queue(el: HTMLElement, stagger: number): void {
  pending.push({ el, stagger });
  if (flushScheduled) return;
  flushScheduled = true;
  // Không dùng raf.add: đây là việc một lần, không phải per-frame. Đưa vào vòng
  // lặp chung sẽ để lại một subscriber sống mãi cho một việc chạy đúng một lần.
  requestAnimationFrame(flush);
}

/* ── Effect ───────────────────────────────────────────────────────────── */

export default defineEffect<Params>({
  key: 'scroll-reveal',
  name: 'Hiện dần khi cuộn',
  paramsSchema,
  aiDescription:
    'Nội dung mờ dần hiện lên và nhích lên khi cuộn tới. Effect nền tảng, dùng được cho hầu hết section và thẻ.',
  runtimeCost: 'light',
  statesWritten: ['revealed'],
  // Không đặt respectReducedMotion: false — nhưng effect vẫn phải HIỆN nội dung
  // khi reduced motion bật, nên nó tự xử lý bên dưới thay vì bị runtime chặn.
  gates: { respectReducedMotion: false },

  init(el, params) {
    arm();

    const revealNow = () => {
      el.style.setProperty('--reveal-delay', `${params.delay ?? 0}s`);
      el.dataset.revealed = 'true';
    };

    // Reduced motion: hiện ngay, không quan sát gì cả. Đây là lý do gate
    // respectReducedMotion bị tắt — nếu để runtime chặn thì element sẽ nằm mãi
    // ở trạng thái ẩn do CSS đã armed.
    if (prefersReducedMotion()) {
      revealNow();
      return () => {
        disarm();
        delete el.dataset.revealed;
        el.style.removeProperty('--reveal-delay');
      };
    }

    const stop = observe(
      el,
      (entry) => {
        if (entry.isIntersecting) {
          if (params.delay !== undefined) revealNow();
          else queue(el, params.stagger);
        } else if (!params.once) {
          delete el.dataset.revealed;
        }
      },
      { rootMargin: params.rootMargin, once: params.once },
    );

    return () => {
      stop();
      disarm();
      pending = pending.filter((p) => p.el !== el);
      delete el.dataset.revealed;
      el.style.removeProperty('--reveal-delay');
    };
  },
});
