/**
 * Nút hút theo con trỏ.
 *
 * Port từ ../new-website/js/effects/magnetic.js. Độ lệch ghi ra `--mag-x` /
 * `--mag-y`; CSS mới là bên ghép chúng vào transform, nên một media query phủ
 * quyết được cả effect mà không đụng file này.
 *
 * ## Vì sao có registry chung bên trong một effect per-instance
 *
 * Bản gốc đọc rect của TẤT CẢ target trước, rồi mới ghi style cho tất cả — một
 * lần layout flush mỗi frame thay vì một lần mỗi element. Nếu mỗi instance tự
 * đăng ký một callback rAF riêng và tự đọc-rồi-ghi, trình duyệt phải flush layout
 * xen kẽ N lần mỗi frame (layout thrashing), và với 6–8 nút CTA thì đó là khác
 * biệt thấy được.
 *
 * Nên: API vẫn per-instance, nhưng bên trong các instance gom vào một danh sách
 * và chia nhau ĐÚNG MỘT subscriber rAF cùng một listener pointermove. Subscriber
 * được tạo khi instance đầu tiên gắn và gỡ khi instance cuối cùng rời đi.
 */

import { z } from 'zod';

import { damp } from '../math';
import * as raf from '../raf';
import { defineEffect } from './types';

const paramsSchema = z.object({
  /** Phần khoảng cách con trỏ mà nút đi theo. 0.35 là mặc định của bản gốc. */
  strength: z.number().min(0).max(1).default(0.35),
  /** Vùng đệm quanh nút vẫn tính là "trong tầm", px. */
  radius: z.number().min(0).max(400).default(60),
});

type Params = z.infer<typeof paramsSchema>;

interface Item {
  el: HTMLElement;
  strength: number;
  padding: number;
  x: number;
  y: number;
  inRange: boolean;
}

/* ── Trạng thái dùng chung ────────────────────────────────────────────── */

const items: Item[] = [];
const pointer = { x: -9999, y: -9999 };
let unsubscribe: (() => void) | null = null;

function onPointerMove(event: PointerEvent): void {
  pointer.x = event.clientX;
  pointer.y = event.clientY;
}

function frame({ deltaSec }: raf.FrameInfo): void {
  // Giai đoạn ĐỌC: lấy hết rect trước.
  const rects = items.map((item) => item.el.getBoundingClientRect());

  // Giai đoạn TÍNH: không chạm DOM.
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i]!;
    const rect = rects[i]!;

    const dx = pointer.x - (rect.left + rect.width / 2);
    const dy = pointer.y - (rect.top + rect.height / 2);

    const inRange =
      Math.abs(dx) < rect.width / 2 + item.padding &&
      Math.abs(dy) < rect.height / 2 + item.padding;

    item.inRange = inRange;

    const targetX = inRange ? dx * item.strength : 0;
    const targetY = inRange ? dy * item.strength : 0;

    // Bắt nhanh lúc lại gần, buông mềm lúc rời đi.
    const smoothing = inRange ? 0.0001 : 0.000001;
    item.x = damp(item.x, targetX, smoothing, deltaSec);
    item.y = damp(item.y, targetY, smoothing, deltaSec);
  }

  // Giai đoạn GHI: chỉ bây giờ mới chạm style.
  for (const item of items) {
    item.el.dataset.magneticActive = item.inRange ? 'true' : 'false';

    // Dưới một phần ba pixel thì không ai thấy — ngừng ghi style.
    if (!item.inRange && Math.abs(item.x) < 0.3 && Math.abs(item.y) < 0.3) {
      if (item.x !== 0 || item.y !== 0) {
        item.x = 0;
        item.y = 0;
        item.el.style.removeProperty('--mag-x');
        item.el.style.removeProperty('--mag-y');
      }
      continue;
    }

    item.el.style.setProperty('--mag-x', `${item.x.toFixed(2)}px`);
    item.el.style.setProperty('--mag-y', `${item.y.toFixed(2)}px`);
  }
}

function ensureRunning(): void {
  if (unsubscribe) return;
  window.addEventListener('pointermove', onPointerMove, { passive: true });
  unsubscribe = raf.add(frame, raf.PRIORITY.effect + 4);
}

function stopIfEmpty(): void {
  if (items.length > 0 || !unsubscribe) return;
  window.removeEventListener('pointermove', onPointerMove);
  unsubscribe();
  unsubscribe = null;
  // Reset để instance sau không thừa hưởng vị trí con trỏ cũ.
  pointer.x = -9999;
  pointer.y = -9999;
}

/* ── Effect ───────────────────────────────────────────────────────────── */

export default defineEffect<Params>({
  key: 'magnetic',
  name: 'Hút theo con trỏ',
  paramsSchema,
  aiDescription:
    'Nút hoặc icon bị hút nhẹ về phía con trỏ khi lại gần. Dùng cho CTA chính. Chỉ chạy trên thiết bị có chuột.',
  runtimeCost: 'light',
  statesWritten: ['magnetic-active'],
  conflicts: ['tilt'],
  // Không có gì để hút về trên màn hình cảm ứng.
  gates: { finePointerOnly: true },

  init(el, params) {
    const item: Item = {
      el,
      strength: params.strength,
      padding: params.radius,
      x: 0,
      y: 0,
      inRange: false,
    };

    items.push(item);
    ensureRunning();

    return () => {
      const i = items.indexOf(item);
      if (i > -1) items.splice(i, 1);
      el.style.removeProperty('--mag-x');
      el.style.removeProperty('--mag-y');
      delete el.dataset.magneticActive;
      stopIfEmpty();
    };
  },
});
