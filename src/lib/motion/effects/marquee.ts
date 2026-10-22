/**
 * Băng chạy vô tận, tăng tốc theo vận tốc cuộn.
 *
 * Port từ ../new-website/js/effects/marquee.js. Offset ghi ra `--marquee-x`;
 * CSS dịch track. Clone được nhân bản đủ để phủ ít nhất hai lần bề rộng
 * viewport, và điểm nối rơi vào nội dung giống hệt nhau nên mắt không thấy mối.
 *
 * ## Khác bản gốc
 *
 * - Track tìm bằng `[data-marquee-track]` thay vì class `.marquee__track`:
 *   class do preset đặt tên và có thể đổi, còn data-attribute là hợp đồng.
 *   Không tìm thấy track thì lấy con đầu tiên — đủ cho cấu trúc thường gặp.
 * - Vận tốc cuộn lấy từ Lenis nếu có; không có Lenis (reduced motion đã chặn
 *   trước, hoặc thiết bị cảm ứng) thì boost đơn giản là 0, băng vẫn chạy đều.
 */

import { z } from 'zod';

import { damp } from '../math';
import * as raf from '../raf';
import { getLenis } from '../scroll';
import { defineEffect } from './types';

const paramsSchema = z.object({
  /** px mỗi giây khi trang đứng yên. */
  speed: z.number().min(0).max(1000).default(60),
  /** -1 chạy sang trái, 1 chạy sang phải. */
  direction: z.union([z.literal(-1), z.literal(1)]).default(-1),
  /** Vận tốc cuộn có đảo chiều băng không. */
  reverseOnScroll: z.boolean().default(true),
  /** Hệ số tăng tốc theo vận tốc cuộn. 0 là tắt. */
  velocityBoost: z.number().min(0).max(50).default(14),
});

type Params = z.infer<typeof paramsSchema>;

function debounce<T extends (...args: never[]) => void>(fn: T, ms: number) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const wrapped = (...args: Parameters<T>) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
  wrapped.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  return wrapped;
}

export default defineEffect<Params>({
  key: 'marquee',
  name: 'Dải chữ chạy',
  paramsSchema,
  aiDescription:
    'CŨ — dùng "slider" với preset: "marquee" cho khối mới. Effect này chỉ ghi biến ' +
    '--marquee-x và để class preset .marquee__track lo phần transform, mà cây node dựng ' +
    'qua MCP không đặt được class, nên gắn vào một cây node tự dựng thì nó KHÔNG nhúc ' +
    'nhích (và vẫn nhân đôi DOM). Giữ lại cho các trang đã dùng nó. ' +
    'Hàng logo hoặc chữ chạy ngang liên tục, không có điểm đầu cuối. Tăng tốc theo vận tốc cuộn.',
  runtimeCost: 'medium',
  statesWritten: ['marquee-ready'],
  // Ba effect cùng dời một track thì triệt tiêu nhau, và thứ tự gắn quyết định
  // ai thắng. `registry.test.ts` bắt buộc quan hệ này hai chiều.
  conflicts: ['slider', 'carousel'],

  init(el, params) {
    const track =
      el.querySelector<HTMLElement>('[data-marquee-track]') ??
      (el.firstElementChild as HTMLElement | null);

    if (!track) return;

    let copyWidth = 0;
    let offset = 0;
    let direction: 1 | -1 = params.direction;
    let boost = 0;

    /** Nhân bản nội dung cho tới khi track phủ ít nhất hai lần viewport. */
    const fill = () => {
      // Khôi phục bộ gốc trước khi nhân lại, để resize không cộng dồn.
      const originals = [...track.children].filter(
        (child): child is HTMLElement =>
          child instanceof HTMLElement && !child.dataset.clone,
      );
      track.querySelectorAll('[data-clone]').forEach((clone) => clone.remove());
      if (!originals.length) return;

      const contentWidth = originals.reduce((total, child) => {
        const style = getComputedStyle(child);
        return total + child.offsetWidth + Number.parseFloat(style.marginInlineEnd || '0');
      }, 0);
      const gap = Number.parseFloat(getComputedStyle(track).columnGap || '0') || 0;
      copyWidth = contentWidth + gap * originals.length;
      if (copyWidth <= 0) return;

      const needed = Math.ceil((window.innerWidth * 2) / copyWidth) + 1;
      for (let copy = 0; copy < needed; copy += 1) {
        for (const child of originals) {
          const clone = child.cloneNode(true) as HTMLElement;
          clone.dataset.clone = 'true';
          // Bản sao là trang trí thuần — screen reader chỉ nên đọc bộ gốc.
          clone.setAttribute('aria-hidden', 'true');
          track.append(clone);
        }
      }
    };

    const frame = ({ deltaSec }: raf.FrameInfo) => {
      if (copyWidth <= 0) return;

      const velocity = getLenis()?.velocity ?? 0;

      // Cuộn xuống thì chạy trái, cuộn lên thì chạy phải.
      if (params.reverseOnScroll && Math.abs(velocity) > 0.6) {
        direction = velocity > 0 ? -1 : 1;
      }

      boost = damp(boost, Math.abs(velocity) * params.velocityBoost, 0.0005, deltaSec);

      offset += (params.speed + boost) * direction * deltaSec;
      // Cuốn vòng theo đúng một bề rộng bản sao — mối nối rơi vào nội dung giống hệt.
      offset %= copyWidth;

      // Giữ offset âm để track luôn phủ kín mép trái.
      const x = offset > 0 ? offset - copyWidth : offset;
      track.style.setProperty('--marquee-x', `${x.toFixed(2)}px`);
    };

    fill();
    el.dataset.marqueeReady = 'true';

    const onResize = debounce(fill, 200);
    window.addEventListener('resize', onResize);
    const unsubscribe = raf.add(frame, raf.PRIORITY.effect + 3);

    return () => {
      unsubscribe();
      window.removeEventListener('resize', onResize);
      onResize.cancel();
      track.querySelectorAll('[data-clone]').forEach((clone) => clone.remove());
      track.style.removeProperty('--marquee-x');
      delete el.dataset.marqueeReady;
    };
  },
});
