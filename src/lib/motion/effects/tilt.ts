/**
 * Nghiêng 3D theo con trỏ.
 *
 * Port từ ../new-website/js/effects/tilt.js. Góc được ghi ra `--tilt-x` /
 * `--tilt-y` và CSS mới là bên ghép chúng lại — nhờ vậy một media query có thể
 * phủ quyết cả effect mà không phải đụng file này. Giữ nguyên quy ước đó.
 */

import { z } from 'zod';

import * as raf from '../raf';
import { clamp, damp } from '../math';
import { defineEffect } from './types';

const paramsSchema = z.object({
  /** Góc xoay tối đa, độ. */
  max: z.number().min(0).max(30).default(7),
  /** Phần còn lại sau 1 giây khi con trỏ đang ở trên — nhỏ hơn = bắt nhanh hơn. */
  smoothingHover: z.number().min(0).max(1).default(0.0002),
  /** Như trên, khi con trỏ đã rời đi. Chậm hơn để về vị trí gốc mềm mại. */
  smoothingRest: z.number().min(0).max(1).default(0.000002),
});

type Params = z.infer<typeof paramsSchema>;

export default defineEffect<Params>({
  key: 'tilt',
  name: 'Nghiêng 3D theo con trỏ',
  paramsSchema,
  aiDescription:
    'Nghiêng 3D nhẹ theo con trỏ khi rê qua. Dùng cho thẻ, ảnh, khối nội dung. Chỉ chạy trên thiết bị có chuột.',
  runtimeCost: 'light',
  statesWritten: ['tilt-active'],
  conflicts: ['magnetic'],
  gates: { finePointerOnly: true },

  init(el, params) {
    let rect: DOMRect | null = null;
    let hovering = false;
    let x = 0;
    let y = 0;
    let targetX = 0;
    let targetY = 0;

    const onEnter = () => {
      hovering = true;
      rect = el.getBoundingClientRect();
      el.dataset.tiltActive = 'true';
    };

    const onMove = (event: PointerEvent) => {
      if (!rect) rect = el.getBoundingClientRect();

      // -0.5 .. 0.5 theo mỗi trục.
      const px = (event.clientX - rect.left) / rect.width - 0.5;
      const py = (event.clientY - rect.top) / rect.height - 0.5;

      // Con trỏ dưới tâm thì mép trên ngả về phía người xem, nên đảo dấu.
      targetX = clamp(-py, -0.5, 0.5) * params.max * 2;
      targetY = clamp(px, -0.5, 0.5) * params.max * 2;
    };

    const onLeave = () => {
      hovering = false;
      rect = null;
      targetX = 0;
      targetY = 0;
      el.dataset.tiltActive = 'false';
    };

    const frame = ({ deltaSec }: raf.FrameInfo) => {
      const smoothing = hovering ? params.smoothingHover : params.smoothingRest;
      x = damp(x, targetX, smoothing, deltaSec);
      y = damp(y, targetY, smoothing, deltaSec);

      // Gần 0 thì xoá hẳn custom property thay vì ghi '0.000deg' mỗi frame —
      // trả element về đúng trạng thái CSS mặc định của nó.
      if (!hovering && Math.abs(x) < 0.02 && Math.abs(y) < 0.02) {
        if (x !== 0 || y !== 0) {
          x = 0;
          y = 0;
          el.style.removeProperty('--tilt-x');
          el.style.removeProperty('--tilt-y');
        }
        return;
      }

      el.style.setProperty('--tilt-x', `${x.toFixed(3)}deg`);
      el.style.setProperty('--tilt-y', `${y.toFixed(3)}deg`);
    };

    el.addEventListener('pointerenter', onEnter);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', onLeave);
    const unsubscribe = raf.add(frame, raf.PRIORITY.effect);

    return () => {
      unsubscribe();
      el.removeEventListener('pointerenter', onEnter);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
      el.style.removeProperty('--tilt-x');
      el.style.removeProperty('--tilt-y');
      delete el.dataset.tiltActive;
    };
  },
});
