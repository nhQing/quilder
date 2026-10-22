/**
 * Header thu gọn khi cuộn — hai state Figma của thanh nav.
 *
 * Port từ ../new-website/js/effects/nav-collapse.js. Module này quyết định ĐÚNG
 * một chuyện: header có đang ở trạng thái thu gọn hay không. Mọi khác biệt thị
 * giác giữa thanh mở rộng và viên pill nổi đều nằm ở CSS, kể cả transition.
 * Không dòng nào ở đây ghi style.
 *
 * ## Khác bản gốc: data-attribute thay cho class
 *
 * Bản gốc bật/tắt class `.is-collapsed`. Ở đây nó ghi `data-collapsed="true"`,
 * khớp với `style.states` trong Doc schema — cùng cơ chế đã dựng khi chứng minh
 * R1. Nhờ vậy tác giả (và AI) khai được style cho trạng thái thu gọn ngay trong
 * inspector, thay vì phải sửa stylesheet viết tay.
 *
 * ## Trễ ngưỡng (hysteresis)
 *
 * Thu gọn và mở lại KHÔNG dùng chung một ngưỡng. Thanh thu gọn ở `collapseAt`
 * và chỉ mở lại khi cuộn tụt xuống dưới `collapseAt - hysteresis`. Thiếu vùng
 * chết đó thì một cú cuộn chậm dừng đúng ngưỡng sẽ lật state mỗi frame và thanh
 * nav nhấp nháy.
 *
 *      0 ─────────── 40 ─────── 60 ───────────▶  scrollY
 *      │  mở rộng     │ vùng chết │  thu gọn
 *
 * ## Kỷ luật frame
 *
 * Listener scroll chỉ đặt một cờ boolean rồi thoát. Việc đọc DOM (`scrollY`) và
 * lần ghi attribute duy nhất đều nằm trong vòng lặp chung, nên cuộn không bao
 * giờ kích hoạt layout đồng bộ ở đây.
 */

import { z } from 'zod';

import * as raf from '../raf';
import { defineEffect } from './types';

const paramsSchema = z.object({
  /** Vị trí cuộn mà thanh trở thành pill, px. */
  collapseAt: z.number().min(0).max(2000).default(60),
  /** Khoảng trễ. Mở lại cần cuộn tụt xuống dưới collapseAt trừ đi số này. */
  hysteresis: z.number().min(0).max(500).default(20),
});

type Params = z.infer<typeof paramsSchema>;

export default defineEffect<Params>({
  key: 'nav-collapse',
  name: 'Thanh điều hướng thu gọn',
  paramsSchema,
  aiDescription:
    'Header thu gọn thành thanh nổi khi cuộn xuống, mở lại khi về đầu trang. Ghi state "collapsed" để style theo.',
  runtimeCost: 'light',
  statesWritten: ['collapsed'],
  appliesTo: ['Section'],
  // Cố ý KHÔNG tắt khi reduced motion: đây là thay đổi trạng thái, không phải
  // chuyển động. Bản thân transition nằm ở CSS và chính CSS đã tắt nó khi cần.
  gates: { respectReducedMotion: false },

  init(el, params) {
    const expandAt = params.collapseAt - params.hysteresis;

    /*
     * Đánh dấu "đây là header của trang" bằng `data-header` — đúng attribute site gốc
     * dùng. Ba nơi khác dò header theo nó: `chapters-cover` (đo dải nav để đảo mực),
     * `modal` (đặt `inert` lên header khi mở), `scroll.bindAnchors` (trừ chiều cao
     * header khi cuộn tới neo). Trước 13/10/2026 không node nào mang nó, nên cả ba rơi
     * về số đoán. Header nằm trong component (Instance) chỉ có `data-cn`, không có
     * `data-n`, nên một attribute cố định là cách duy nhất để tìm thấy nó.
     */
    const ownsHeaderMark = !el.hasAttribute('data-header');
    if (ownsHeaderMark) el.setAttribute('data-header', '');

    let dirty = false;
    let collapsed = false;

    const apply = (next: boolean) => {
      collapsed = next;
      if (next) el.dataset.collapsed = 'true';
      else delete el.dataset.collapsed;
    };

    const onScroll = () => {
      dirty = true;
    };

    const onFrame = () => {
      if (!dirty) return;
      dirty = false;

      const y = window.scrollY;
      // Giữa expandAt và collapseAt không nhánh nào chạy và state hiện tại đơn
      // giản là giữ nguyên — khoảng trống đó chính là toàn bộ mục đích.
      const next = collapsed ? y > expandAt : y >= params.collapseAt;
      if (next === collapsed) return;
      apply(next);
    };

    // Deep link và reload có thể rơi vào giữa trang, nên chốt state trước lần
    // paint đầu tiên thay vì để nó animate vào chỗ sau đó.
    apply(window.scrollY >= params.collapseAt);

    window.addEventListener('scroll', onScroll, { passive: true });
    // Priority 1: sau khi scroll.ts đã chốt vị trí cuộn cho frame này.
    const unsubscribe = raf.add(onFrame, raf.PRIORITY.effect + 1);

    return () => {
      unsubscribe();
      window.removeEventListener('scroll', onScroll);
      delete el.dataset.collapsed;
      if (ownsHeaderMark) el.removeAttribute('data-header');
    };
  },
});
