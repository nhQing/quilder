/**
 * Effect `video-lazy` — video nền chỉ tải và phát khi thật sự có người xem.
 *
 * Port từ home-v2/effects/useHeroVideo.js. Sáu luật gốc, giữ nguyên tinh thần:
 *
 *   1. ẢNH TĨNH LÀ SỰ THẬT. State `data-playing` — thứ duy nhất làm video hiện ra
 *      (CSS fade opacity) — chỉ được bật SAU KHI `play()` resolve. Thiếu file,
 *      codec không nhận, request bị chặn, hay tự phát bị từ chối: cả bốn đều để
 *      poster nguyên vẹn, và không nói gì cả.
 *   2. GIẢM CHUYỂN ĐỘNG NGHĨA LÀ KHÔNG TẢI. Gate mặc định (tôn trọng reduced
 *      motion) chặn effect ngay từ `init`, nên không gì chạm tới video. Đổi giữa
 *      phiên thì `onReducedMotionChange` dừng video đang chạy.
 *   3. Dừng phát khi tab ẩn và khi phần tử rời khung nhìn.
 *   4. `minWidth` (KHOÁ breakpoint, ví dụ 'sm' = 768): dưới ngưỡng thì không tải
 *      gì. Kiểm lại khi resize, debounce 150ms — xoay ngang điện thoại có thể
 *      vượt ngưỡng.
 *   5. Tổ tiên mang `data-vis` (lớp do composite xếp chồng quản) thì chỉ phát khi nó
 *      KHÁC "0" — đó là cách khối chương báo một lớp đang bị che khuất. Phải PHẢN
 *      ỨNG (MutationObserver), vì khối chương lật `data-vis` giữa chừng cuộn.
 *
 * ## Vì sao author đặt autoplay=false, preload='none'
 *
 * Renderer SSR phát `<video src preload>`; `preload="none"` + không `autoplay` thì
 * trình duyệt không tải byte nào của video (chỉ poster). Nếu để autoplay thì
 * trình duyệt tải ngay khi parse HTML — đúng cái effect này sinh ra để tránh. Cả
 * `muted` lẫn `playsinline` đều cần cho autoplay policy; renderer đã phát
 * `playsinline`, còn `muted` thì effect tự ép bằng thuộc tính DOM (React không
 * phát attribute `muted` ổn định) trước khi `play()`.
 *
 * ## CSS sở hữu trạng thái
 *
 * Effect chỉ ghi `data-playing="true"`; poster/opacity/fade nằm ở
 * `styles/effects/video-lazy.css`.
 */

import { z } from 'zod';

import { BREAKPOINTS } from '@/lib/design/breakpoints';

import { atLeast } from '../capabilities';
import { onReducedMotionChange, prefersReducedMotion } from '../reduced-motion';
import { defineEffect } from './types';

const paramsSchema = z.object({
  /**
   * Dưới breakpoint này thì không bao giờ tải. Bỏ trống = mọi bề rộng. KHOÁ
   * breakpoint của builder ('sm' = 768px), không phải số px — xem
   * `lib/design/breakpoints.ts`.
   */
  minWidth: z.enum(BREAKPOINTS).optional(),
});

type Params = z.infer<typeof paramsSchema>;

const RESIZE_DEBOUNCE_MS = 150;

export default defineEffect<Params>({
  key: 'video-lazy',
  name: 'Video tải lười',
  paramsSchema,
  aiDescription:
    'Video nền chỉ tải và phát khi vào màn hình: không tải gì lúc SSR, dừng khi ra khỏi màn hình hoặc tab ẩn, không bao giờ tải khi người dùng bật giảm chuyển động. Gắn lên node Video; node Video PHẢI đặt autoplay=false, preload="none", muted=true, loop theo ý, và posterAssetId (ảnh tĩnh hiện trước và khi video không phát được). Effect ép muted + playsinline rồi mới play(). ' +
    'Ghi state data-video-lazy-ready khi sẵn sàng và data-playing="true" SAU KHI play() thành công. CSS mặc định: khi ready, video opacity 0 → 1 (0.9s linear, chỉnh qua --video-lazy-dur) lúc playing — nên phải có ảnh tĩnh nằm DƯỚI video (node Image anh em, hoặc nền của khung cha) để lộ ra trong lúc chờ. ' +
    'Tham số minWidth (khoá breakpoint, ví dụ "sm" = 768px): dưới bề rộng đó không bao giờ tải — dùng cho video nền chỉ dành cho desktop. Nếu video nằm trong một lớp mà composite đánh dấu bằng data-vis (tổ tiên có data-vis) thì chỉ phát khi lớp đó đang hiện.',
  appliesTo: ['Video'],
  runtimeCost: 'medium',
  statesWritten: ['playing', 'video-lazy-ready'],
  // Gate mặc định (tôn trọng reduced motion) LÀ luật 2: không tải dưới reduced
  // motion. Không khai `gates` nên registry cũng không lặp lại.

  init(el, params) {
    if (!(el instanceof HTMLVideoElement)) return;
    const video = el;

    let visible = false;
    let cancelled = false;
    let reduced = prefersReducedMotion();

    /** Luật 4. `minWidth` là khoá breakpoint; `atLeast('base')` luôn đúng. */
    const wideEnough = () => !params.minWidth || atLeast(params.minWidth);

    /** Luật 5: tổ tiên gần nhất mang `data-vis` phải không phải "0". */
    const gate = video.closest('[data-vis]');
    const ungated = () => !gate || gate.getAttribute('data-vis') !== '0';

    const start = () => {
      if (cancelled || reduced || !visible || document.hidden) return;
      if (!wideEnough() || !ungated()) return;

      // Autoplay policy: chỉ video MUTED + playsinline mới được tự phát. Đặt
      // bằng thuộc tính DOM chứ không bằng attribute (React không phát `muted`
      // ổn định) và ngay trước `play()`.
      video.muted = true;
      video.playsInline = true;

      video
        .play()
        .then(() => {
          // Chỉ đến lúc này mới có gì để xem. Kiểm lại: tab/lớp có thể đã bị ẩn
          // trong lúc promise còn bay.
          if (cancelled || reduced || document.hidden || !visible || !ungated()) {
            video.pause();
            return;
          }
          video.dataset.playing = 'true';
        })
        .catch(() => {
          // Tự phát bị từ chối, hoặc file không phát được. Luật 1: im lặng và
          // để ảnh tĩnh ở nguyên đó.
          delete video.dataset.playing;
        });
    };

    /** `hide` = cũng gỡ state để CSS đưa video về opacity 0 (lộ lại poster). */
    const stop = (hide = false) => {
      video.pause();
      if (hide) delete video.dataset.playing;
    };

    const io = new IntersectionObserver(
      ([entry]) => {
        visible = entry?.isIntersecting ?? false;
        if (visible) start();
        else stop();
      },
      { rootMargin: '0px', threshold: 0 },
    );
    io.observe(video);

    const onVisibility = () => {
      if (document.hidden) stop();
      else start();
    };
    document.addEventListener('visibilitychange', onVisibility);

    // Luật 5 phải PHẢN ỨNG, không chỉ kiểm một lần: khối chương lật `data-vis`
    // giữa chừng cuộn, và clip của lớp vừa hiện ra phải chạy.
    let gateObserver: MutationObserver | null = null;
    if (gate) {
      gateObserver = new MutationObserver(() => {
        if (ungated()) start();
        else stop(true);
      });
      gateObserver.observe(gate, { attributes: true, attributeFilter: ['data-vis'] });
    }

    // Luật 4 cũng vậy: xoay ngang điện thoại có thể vượt ngưỡng.
    let resizeTimer = 0;
    const onResize = () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        if (wideEnough()) start();
        else stop(true);
      }, RESIZE_DEBOUNCE_MS);
    };
    if (params.minWidth) window.addEventListener('resize', onResize);

    // Luật 2, nhánh giữa phiên: bật giảm chuyển động khi video đang chạy thì dừng
    // ngay và trả về ảnh tĩnh.
    const offReduced = onReducedMotionChange((next) => {
      reduced = next;
      if (next) stop(true);
      else start();
    });

    // Lên đạn cho CSS: từ đây video mới trong suốt cho tới khi có `data-playing`.
    video.dataset.videoLazyReady = 'true';

    return () => {
      cancelled = true;
      delete video.dataset.videoLazyReady;
      document.removeEventListener('visibilitychange', onVisibility);
      if (params.minWidth) window.removeEventListener('resize', onResize);
      window.clearTimeout(resizeTimer);
      gateObserver?.disconnect();
      offReduced();
      io.disconnect();
      stop(true);
    };
  },
});
