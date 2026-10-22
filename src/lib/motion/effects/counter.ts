/**
 * Đếm số khi vào viewport.
 *
 * Port từ ../new-website/js/effects/counter.js. Định dạng qua `Intl.NumberFormat`
 * theo `lang` của tài liệu, nên số tiền VND hiện đúng dấu phân cách.
 *
 * ## Khác bản gốc: giá trị đích đến từ params, không từ data-attribute
 *
 * Bản gốc đọc `data-counter-to` mà render.js gán từ content.json. Ở đây con số
 * nằm trong Doc (inline node `counter` của RichText) và được server render sẵn,
 * nên không-JS và reduced-motion đều thấy đúng giá trị cuối — effect chỉ thêm
 * phần chạy số.
 */

import { z } from 'zod';

import { clamp } from '../math';
import { observe } from '../observer';
import * as raf from '../raf';
import { prefersReducedMotion } from '../reduced-motion';
import { defineEffect } from './types';

const paramsSchema = z.object({
  to: z.number(),
  from: z.number().default(0),
  /** Giây. */
  duration: z.number().min(0.1).max(10).default(2),
  decimals: z.number().int().min(0).max(4).default(0),
  suffix: z.string().max(16).default(''),
  prefix: z.string().max(16).default(''),
});

type Params = z.infer<typeof paramsSchema>;

/** Chậm dần mạnh về cuối — con số "đậu" xuống thay vì phanh gấp. */
function easeOutQuint(t: number): number {
  return 1 - Math.pow(1 - t, 5);
}

export default defineEffect<Params>({
  key: 'counter',
  name: 'Số đếm lên',
  paramsSchema,
  aiDescription:
    'Con số chạy từ giá trị đầu tới giá trị đích khi cuộn tới. Dùng cho số liệu, thành tích, số tiền. Định dạng theo locale.',
  runtimeCost: 'light',
  appliesTo: ['Text'],
  // Không có mặc định hợp lý: đếm tới đâu là câu hỏi chỉ tác giả trả lời được.
  requiredParams: ['to'],
  gates: { respectReducedMotion: false },

  init(el, params) {
    const format = new Intl.NumberFormat(document.documentElement.lang || 'vi', {
      minimumFractionDigits: params.decimals,
      maximumFractionDigits: params.decimals,
    });

    const write = (value: number) => {
      el.textContent = `${params.prefix}${format.format(value)}${params.suffix}`;
    };

    // Reduced motion: nhảy thẳng tới giá trị cuối. Không phải "tắt effect" —
    // con số vẫn phải đúng.
    if (prefersReducedMotion()) {
      write(params.to);
      return () => {};
    }

    let unsubscribeFrame: (() => void) | null = null;

    const run = () => {
      if (unsubscribeFrame) return;
      let elapsed = 0;

      const tick = ({ deltaSec }: raf.FrameInfo) => {
        elapsed += deltaSec;
        const progress = clamp(elapsed / params.duration, 0, 1);
        write(params.from + (params.to - params.from) * easeOutQuint(progress));

        if (progress >= 1) {
          write(params.to);
          unsubscribeFrame?.();
          unsubscribeFrame = null;
        }
      };

      unsubscribeFrame = raf.add(tick, raf.PRIORITY.effect + 2);
    };

    // Hiện giá trị đầu ngay để ô số không bao giờ trống.
    write(params.from);

    const stop = observe(el, (entry) => { if (entry.isIntersecting) run(); }, {
      once: true,
      rootMargin: '0px 0px -15% 0px',
    });

    return () => {
      stop();
      unsubscribeFrame?.();
      // Trả về giá trị cuối, không phải giá trị đầu: element rời khỏi effect
      // phải để lại con số ĐÚNG, không phải số 0.
      write(params.to);
    };
  },
});
