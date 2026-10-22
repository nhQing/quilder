/**
 * Vòng lặp animation DUY NHẤT của ứng dụng.
 *
 * Port từ ../new-website/js/core/raf.js, giữ nguyên hành vi. Không module nào
 * khác được gọi `requestAnimationFrame` cho việc per-frame. Lenis, mọi effect và
 * mọi WebGL renderer đều đăng ký ở đây. Một vòng lặp nghĩa là một thứ tự cập nhật,
 * một chỗ pause khi ẩn tab, và không có scheduler nào tranh nhau cùng một frame.
 *
 * ## Vì sao clock bằng gsap.ticker
 *
 * GSAP chạy rAF riêng qua `gsap.ticker`, và ScrollTrigger đăng ký vĩnh viễn ở đó.
 * Không có cách nào được hỗ trợ để gỡ nó ra, nên "raf.ts sở hữu một rAF riêng"
 * sẽ có nghĩa là *hai* vòng lặp rAF sống, không phải một. Vì vậy module này dùng
 * `gsap.ticker` làm clock khi GSAP có mặt, và chỉ rơi về rAF gốc khi không.
 *
 * ## Khác bản gốc ở đúng hai chỗ, cả hai đều do môi trường React/Next
 *
 * 1. GSAP được TIÊM VÀO qua `configure()` thay vì đọc `window.gsap`. Bản gốc
 *    tải GSAP bằng thẻ <script> nên nó nằm trên window; ở đây nó là ES module,
 *    và ép mọi thứ qua window chỉ để giữ giống bản cũ là tự tạo global không cần.
 * 2. Listener `visibilitychange` gắn khi `start()` chứ không phải lúc import.
 *    Module này có thể bị import trong ngữ cảnh server (RSC graph), nơi `document`
 *    không tồn tại — gắn ở top level là crash lúc build.
 */

export interface FrameInfo {
  /** ms kể từ mốc bắt đầu của clock. */
  time: number;
  deltaMs: number;
  deltaSec: number;
  /** giây kể từ mốc bắt đầu. */
  elapsed: number;
}

export type FrameCallback = (frame: FrameInfo) => void;

export type Driver = 'gsap' | 'raf';

/** Chỉ dùng phần ticker của GSAP — không phụ thuộc phần còn lại của API. */
export interface GsapTickerLike {
  ticker: {
    add(fn: (elapsedSec: number, deltaMs: number, frameCount: number) => void): void;
    remove(fn: (elapsedSec: number, deltaMs: number, frameCount: number) => void): void;
    lagSmoothing(value: number): void;
  };
}

interface Subscriber {
  fn: FrameCallback;
  priority: number;
}

let subscribers: Subscriber[] = [];
let running = false;
let needsSort = false;
let driver: Driver | null = null;
let rafId: number | null = null;
let nativeLast = 0;
let nativeStart = 0;
let gsapRef: GsapTickerLike | null = null;

/**
 * Delta dài nhất được báo, tính bằng ms. Chặn một khoảng trống nhiều giây
 * (khôi phục tab, đổi breakpoint lúc frame đang dừng) khỏi làm mọi giá trị
 * damped nhảy vọt.
 */
const MAX_DELTA_MS = 100;

/**
 * Dải priority đã đặt trước — giữ nguyên từ bản gốc:
 *   -100  tích hợp scroll (Lenis) — chạy trước mọi thứ đọc vị trí scroll
 *      0  effect (mặc định)
 *     50  renderer — WebGL draw call chạy sau cùng
 */
export const PRIORITY = {
  scroll: -100,
  effect: 0,
  renderer: 50,
} as const;

/** Tiêm GSAP trước khi `start()`. Không gọi thì rơi về rAF gốc. */
export function configure(gsap: GsapTickerLike | null): void {
  gsapRef = gsap;
}

function dispatch(frame: FrameInfo): void {
  if (needsSort) {
    subscribers.sort((a, b) => a.priority - b.priority);
    needsSort = false;
  }

  // Chụp lại: một subscriber có thể tự gỡ mình giữa frame.
  const current = subscribers;
  for (let i = 0; i < current.length; i += 1) {
    const entry = current[i];
    if (!entry) continue;
    try {
      entry.fn(frame);
    } catch (error) {
      // Một effect hỏng không được kéo cả vòng lặp xuống theo.
      console.error('[raf] subscriber ném lỗi — gỡ nó ra', error);
      remove(entry.fn);
    }
  }
}

/** Chữ ký của gsap.ticker: (elapsedSeconds, deltaMs, frameCount). */
function onGsapTick(elapsedSec: number, rawDeltaMs: number): void {
  const deltaMs = Math.min(rawDeltaMs, MAX_DELTA_MS);
  dispatch({
    time: elapsedSec * 1000,
    deltaMs,
    deltaSec: deltaMs / 1000,
    elapsed: elapsedSec,
  });
}

function onNativeTick(time: number): void {
  rafId = requestAnimationFrame(onNativeTick);
  const deltaMs = Math.min(time - nativeLast, MAX_DELTA_MS);
  nativeLast = time;
  dispatch({
    time,
    deltaMs,
    deltaSec: deltaMs / 1000,
    elapsed: (time - nativeStart) / 1000,
  });
}

/**
 * Đăng ký một callback chạy mỗi frame.
 * Trả về hàm huỷ đăng ký. Gọi hai lần với cùng một fn là no-op.
 */
export function add(fn: FrameCallback, priority: number = PRIORITY.effect): () => void {
  if (typeof fn !== 'function') throw new TypeError('raf.add cần một hàm');
  if (subscribers.some((entry) => entry.fn === fn)) return () => remove(fn);

  subscribers = [...subscribers, { fn, priority }];
  needsSort = true;
  return () => remove(fn);
}

export function remove(fn: FrameCallback): void {
  subscribers = subscribers.filter((entry) => entry.fn !== fn);
}

/* ── visibility ──────────────────────────────────────────────────────── */

// Tab nền vốn đã bị throttle rAF về ~0Hz, nhưng tách hẳn ra nghĩa là delta đầu
// tiên khi quay lại là một delta sạch. Chỉ tự chạy lại vòng lặp mà CHÍNH TA đã
// pause, không bao giờ chạy lại vòng lặp mà app cố ý dừng.
let pausedByVisibility = false;
let visibilityBound = false;

function onVisibilityChange(): void {
  if (document.hidden) {
    if (running) {
      pausedByVisibility = true;
      stop();
    }
  } else if (pausedByVisibility) {
    pausedByVisibility = false;
    start();
  }
}

/* ── lifecycle ───────────────────────────────────────────────────────── */

/** Bật vòng lặp. Idempotent. */
export function start(): void {
  if (running) return;
  running = true;

  if (!visibilityBound && typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibilityChange);
    visibilityBound = true;
  }

  if (gsapRef?.ticker) {
    driver = 'gsap';
    // Không có dòng này thì GSAP bịa ra một delta ngắn giả sau mỗi frame dài,
    // làm Lenis lệch khỏi thời gian thực.
    gsapRef.ticker.lagSmoothing(0);
    gsapRef.ticker.add(onGsapTick);
  } else {
    driver = 'raf';
    nativeLast = performance.now();
    nativeStart = nativeLast;
    rafId = requestAnimationFrame(onNativeTick);
  }
}

/** Tắt vòng lặp. Idempotent. */
export function stop(): void {
  if (!running) return;
  running = false;

  if (driver === 'gsap') {
    gsapRef?.ticker.remove(onGsapTick);
  } else if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  driver = null;
}

/**
 * Gỡ sạch: dừng vòng lặp, xoá mọi subscriber, tháo listener.
 *
 * Bản gốc không cần hàm này vì trang chỉ tải một lần. Dưới client navigation của
 * Next, EffectRuntime unmount rồi mount lại — không có đường tháo listener thì
 * mỗi lần điều hướng để lại một listener nữa.
 */
export function destroy(): void {
  stop();
  subscribers = [];
  needsSort = false;
  pausedByVisibility = false;
  if (visibilityBound && typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', onVisibilityChange);
    visibilityBound = false;
  }
}

export function isRunning(): boolean {
  return running;
}

/** Clock nào đang chạy vòng lặp. */
export function getDriver(): Driver | null {
  return driver;
}

/** Số subscriber — dùng để săn rò rỉ. Xem test Playwright của Plan 2. */
export function count(): number {
  return subscribers.length;
}
