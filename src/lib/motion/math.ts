/**
 * Toán học dùng chung cho motion.
 * Port từ ../new-website/js/utils/{lerp,clamp}.js, giữ nguyên hành vi.
 */

export function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

/**
 * Lerp độc lập với frame rate.
 *
 * `lerp(a, b, 0.1)` mỗi frame chạy nhanh gấp đôi ở 120Hz so với 60Hz; hàm này
 * hiệu chỉnh theo delta thật. Đây là lý do mọi giá trị damped trong site cũ
 * (magnetic, tilt, cursor) không đổi cảm giác giữa các màn hình khác tần số.
 *
 * @param smoothing phần còn lại sau 1 giây (0..1, càng nhỏ càng bắt nhanh)
 * @param dt giây kể từ frame trước
 */
export function damp(from: number, to: number, smoothing: number, dt: number): number {
  return lerp(from, to, 1 - Math.pow(smoothing, dt));
}

export function mapRange(
  value: number, inMin: number, inMax: number, outMin: number, outMax: number,
): number {
  if (inMax === inMin) return outMin;
  return outMin + ((value - inMin) / (inMax - inMin)) * (outMax - outMin);
}

export function clamp(value: number, min = 0, max = 1): number {
  return Math.min(Math.max(value, min), max);
}

export function saturate(value: number): number {
  return clamp(value, 0, 1);
}
