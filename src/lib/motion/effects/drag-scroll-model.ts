/**
 * Số học của đà quán tính khi thả cú kéo — thuần tính toán, không DOM.
 *
 * Port từ home-v2/model/dragScroll.js của site nguồn, giữ nguyên mọi hằng số.
 * Tách khỏi `drag-scroll.ts` vì phần đáng kiểm thử (một cú thả trôi ngược chiều
 * tay, một cú đặt tay xuống lại tự trôi thêm, một thời lượng khiến dải giật ở
 * khung đầu) là phần có thể sai trong im lặng, còn phần còn lại chỉ là listener.
 *
 * ## Quy ước dấu
 *
 * Mọi vận tốc ở đây là vận tốc của `scrollLeft`, px/ms: dương là dải chạy về
 * phía cuối (nội dung đi sang TRÁI, tức con trỏ kéo sang trái). Việc đổi dấu từ
 * chuyển động con trỏ sang chuyển động scrollport nằm ở drag-scroll.ts.
 */

/** Trọng số của mẫu mới khi làm trơn vận tốc (mẫu `pointermove` đơn lẻ rất nhiễu). */
export const FLICK_BLEND = 0.4;

/** Tay đứng yên quá ngần này ms trước khi nhả thì là ĐẶT xuống, không phải ném. */
export const IDLE_MS = 70;

/** Quãng trôi thêm = vận tốc lúc thả × số này (ms). */
export const PROJECTION_MS = 260;

/** Dưới vận tốc này (px/ms, ≈ 5px/khung 60Hz) là tay đang canh vị trí, không phải ném. */
export const MIN_FLICK = 0.08;

/**
 * Giới hạn thời lượng trôi (ms). `MAX_DURATION` còn là NGÂN SÁCH của cú vẩy:
 * thời lượng phải bằng 3|d|/|v| để vận tốc khởi hành khớp tay, nên mốc nào xa
 * hơn `|v|·MAX/3` bị LOẠI chứ không bị kẹp thời lượng (kẹp thì khung đầu phải
 * nhanh hơn bàn tay, đọc ra là một cú giật lúc nhả).
 */
export const MIN_DURATION = 200;
export const MAX_DURATION = 1200;

/** Lệch dưới ngưỡng này (px) thì coi như đã ở đúng chỗ. */
export const MIN_DISTANCE = 1;

/** Kéo quá ngưỡng này (px) thì nuốt cú `click` theo sau. */
export const DRAG_SLOP = 5;

export interface GlidePlan {
  from: number;
  to: number;
  /** ms */
  duration: number;
}

export interface GlideInput {
  scrollLeft: number;
  /** scrollWidth − clientWidth */
  max: number;
  /** px/ms, theo quy ước dấu của scrollLeft. */
  velocity: number;
  /** ms từ mẫu pointermove cuối tới lúc nhả. */
  idleMs: number;
  /** Các scrollLeft hợp lệ để dừng. Rỗng = không snap. */
  snaps: number[];
}

/** Làm trơn vận tốc bằng trung bình trượt. */
export function blendVelocity(previous: number, delta: number, deltaMs: number): number {
  // Hai mẫu cùng mốc thời gian không có vận tốc để đọc; chia cho 0 ra Infinity
  // và nhiễm vào mọi khung sau đó.
  if (!(deltaMs > 0)) return previous;
  const instant = delta / deltaMs;
  return previous + (instant - previous) * FLICK_BLEND;
}

/** Mốc snap gần `target` nhất, hoặc chính `target` nếu không có mốc nào. */
export function nearestSnap(positions: number[], target: number): number {
  let best = target;
  let bestGap = Infinity;
  for (const position of positions) {
    const gap = Math.abs(position - target);
    if (gap < bestGap) {
      bestGap = gap;
      best = position;
    }
  }
  return best;
}

/**
 * Trôi bao lâu để vận tốc đầu khớp vận tốc lúc thả: với easeOutCubic vận tốc ở
 * u=0 là 3d/T, nên T = 3|d|/|v|.
 */
export function glideDuration(distance: number, velocity: number): number {
  const speed = Math.abs(velocity);
  if (!(speed > 0)) return MAX_DURATION;
  const ideal = (3 * Math.abs(distance)) / speed;
  return Math.min(Math.max(ideal, MIN_DURATION), MAX_DURATION);
}

/** Cú vẩy đi xa nhất được bao nhiêu px mà vận tốc khởi hành vẫn khớp tay. */
export function reachDistance(velocity: number): number {
  return (Math.abs(velocity) * MAX_DURATION) / 3;
}

/** Đường cong giảm tốc: nhanh ngay lúc thả, dừng hẳn ở mốc. */
export function easeOutCubic(u: number): number {
  const t = Math.min(Math.max(u, 0), 1);
  return 1 - (1 - t) ** 3;
}

/**
 * Cú thả này có trôi không, và trôi tới đâu. `null` = không trôi (bỏ
 * `data-dragging` và để trình duyệt tự snap): tay đã đứng yên, vẩy quá nhẹ, mốc
 * ngoài tầm, hoặc mốc gần nhất nằm NGƯỢC chiều vẩy.
 */
export function planGlide({
  scrollLeft,
  max,
  velocity,
  idleMs,
  snaps,
}: GlideInput): GlidePlan | null {
  if (idleMs > IDLE_MS) return null;
  if (Math.abs(velocity) < MIN_FLICK) return null;

  const projected = Math.min(Math.max(scrollLeft + velocity * PROJECTION_MS, 0), max);

  // Kẹp mốc vào [0, max] TRƯỚC khi lọc: mốc cuối của một dải ngắn thường nằm
  // ngoài `max`, và chỗ dải thật sự dừng được là chính `max`.
  const reachable = snaps
    .map((position) => Math.min(Math.max(position, 0), max))
    .filter((position) => Math.abs(position - scrollLeft) <= reachDistance(velocity));

  let landing = projected;
  if (snaps.length) {
    if (!reachable.length) return null;
    landing = nearestSnap(reachable, projected);
  }

  const distance = landing - scrollLeft;
  if (Math.abs(distance) < MIN_DISTANCE) return null;
  if (Math.sign(distance) !== Math.sign(velocity)) return null;

  return { from: scrollLeft, to: landing, duration: glideDuration(distance, velocity) };
}
