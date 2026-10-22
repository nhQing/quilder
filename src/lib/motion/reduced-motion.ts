/**
 * Tuỳ chọn reduced-motion, đọc trực tiếp.
 *
 * Mọi effect hỏi ở đây trước khi làm bất cứ điều gì có tính biểu đạt. Đây là
 * truy vấn trực tiếp chứ không phải ảnh chụp lúc boot — người dùng đổi cài đặt
 * hệ điều hành giữa phiên.
 *
 * Khác bản gốc: `matchMedia` khởi tạo LƯỜI. Bản gốc gọi nó ở top level module,
 * hợp lệ khi file chỉ chạy trong trình duyệt; ở đây module có thể bị kéo vào
 * RSC graph và `window` không tồn tại — top-level call là crash lúc build.
 */

const QUERY = '(prefers-reduced-motion: reduce)';

let mql: MediaQueryList | null = null;

function query(): MediaQueryList | null {
  if (mql) return mql;
  if (typeof window === 'undefined' || !window.matchMedia) return null;
  mql = window.matchMedia(QUERY);
  return mql;
}

export function prefersReducedMotion(): boolean {
  // Trên server trả false: HTML server-render không mang chuyển động nào, và
  // effect chỉ chạy phía client nơi giá trị thật đọc được.
  return query()?.matches ?? false;
}

/** Đăng ký theo dõi thay đổi. Trả về hàm huỷ. */
export function onReducedMotionChange(handler: (reduced: boolean) => void): () => void {
  const q = query();
  if (!q) return () => {};
  const listener = (event: MediaQueryListEvent) => handler(event.matches);
  q.addEventListener('change', listener);
  return () => q.removeEventListener('change', listener);
}

/** Chạy `full` bình thường, `reduced` khi chuyển động bị tắt. */
export function withMotion<T>(full: () => T, reduced: () => T): T {
  return prefersReducedMotion() ? reduced() : full();
}
