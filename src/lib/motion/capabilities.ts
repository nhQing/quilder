/**
 * Cổng năng lực — một chỗ duy nhất quyết định effect có được chạy hay không.
 *
 * Site cũ rải các phép kiểm này khắp từng module effect. Gom lại đây có một lợi
 * ích cụ thể cho nền tảng: **AI có thể hoàn toàn phớt lờ chuyện gating**. Nó
 * không thể gắn một effect chưa được gate, vì runtime chứ không phải effect mới
 * là bên quyết định.
 *
 * Port từ ../new-website/js/core/breakpoints.js (phần hasFinePointer) cộng các
 * phép kiểm vốn nằm rải trong effect.
 */

import { BREAKPOINT_PX, type Breakpoint } from '@/lib/design/breakpoints';
import { prefersReducedMotion } from './reduced-motion';

const cache = new Map<string, MediaQueryList>();

function mq(query: string): MediaQueryList | null {
  if (typeof window === 'undefined' || !window.matchMedia) return null;
  const hit = cache.get(query);
  if (hit) return hit;
  const created = window.matchMedia(query);
  cache.set(query, created);
  return created;
}

/**
 * Con trỏ chính xác (chuột/trackpad), không phải ngón tay.
 * tilt, magnetic và custom cursor đều vô nghĩa khi không có nó.
 */
export function hasFinePointer(): boolean {
  return mq('(pointer: fine)')?.matches ?? false;
}

export function hasHover(): boolean {
  return mq('(hover: hover)')?.matches ?? false;
}

export function atLeast(bp: Breakpoint): boolean {
  if (bp === 'base') return true;
  return mq(`(min-width: ${BREAKPOINT_PX[bp]}px)`)?.matches ?? false;
}

/**
 * WebGL dùng được không. Tạo thử context rồi vứt đi — cách duy nhất đáng tin,
 * vì driver blacklist không lộ ra ở đâu khác.
 */
let webglCache: boolean | null = null;
export function hasWebGL(): boolean {
  if (webglCache !== null) return webglCache;
  if (typeof document === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    webglCache = Boolean(ctx);
    // Giải phóng ngay: giữ context sống chỉ để trả lời một câu hỏi boolean là
    // tiêu mất một trong số ít context mà trình duyệt cho phép.
    if (ctx && 'getExtension' in ctx) {
      (ctx.getExtension('WEBGL_lose_context') as { loseContext(): void } | null)?.loseContext();
    }
  } catch {
    webglCache = false;
  }
  return webglCache;
}

/** Người dùng bật tiết kiệm dữ liệu. Phần lớn traffic VN là Android tầm trung. */
export function saveData(): boolean {
  if (typeof navigator === 'undefined') return false;
  const conn = (navigator as { connection?: { saveData?: boolean } }).connection;
  return Boolean(conn?.saveData);
}

/**
 * Hạng thiết bị, quyết định bậc degradation.
 *
 *   full    — chạy hết
 *   reduced — chỉ CSS, không WebGL, không effect theo con trỏ
 *   static  — không chuyển động
 */
export type MotionTier = 'full' | 'reduced' | 'static';

export function motionTier(): MotionTier {
  if (prefersReducedMotion()) return 'static';
  if (saveData()) return 'reduced';
  // deviceMemory là gợi ý thô nhưng là tín hiệu rẻ duy nhất có sẵn.
  const mem = (navigator as { deviceMemory?: number }).deviceMemory;
  if (typeof mem === 'number' && mem <= 2) return 'reduced';
  return 'full';
}

export interface Gates {
  minBreakpoint?: Breakpoint;
  finePointerOnly?: boolean;
  /** Mặc định true. */
  respectReducedMotion?: boolean;
  requiresWebGL?: boolean;
  /** Hạng thấp nhất mà effect vẫn được chạy. Mặc định 'reduced'. */
  minTier?: MotionTier;
}

const TIER_ORDER: Record<MotionTier, number> = { static: 0, reduced: 1, full: 2 };

/** Effect này có được phép chạy trong môi trường hiện tại không. */
export function allows(gates: Gates | undefined): boolean {
  const g = gates ?? {};

  // `respectReducedMotion: false` nghĩa là effect TỰ xử lý reduced motion, không
  // phải là nó phớt lờ. scroll-reveal là ví dụ: khi reduced motion bật nó phải
  // chạy để HIỆN nội dung ngay — bị chặn thì element kẹt vĩnh viễn ở trạng thái
  // ẩn mà CSS đã armed.
  const selfManaged = g.respectReducedMotion === false;

  if (!selfManaged && prefersReducedMotion()) return false;
  if (g.finePointerOnly && !hasFinePointer()) return false;
  if (g.minBreakpoint && !atLeast(g.minBreakpoint)) return false;
  if (g.requiresWebGL && !hasWebGL()) return false;

  // Cổng tier cũng phải tôn trọng selfManaged. Không thì có hai cổng cùng nói về
  // reduced motion mà mâu thuẫn nhau — đúng bug mà test R2 bắt được: effect qua
  // được cổng thứ nhất rồi chết ở cổng thứ hai, im lặng.
  if (!selfManaged) {
    const min = g.minTier ?? 'reduced';
    if (TIER_ORDER[motionTier()] < TIER_ORDER[min]) return false;
  }

  return true;
}

/** Chỉ dùng trong test. */
export function resetCapabilityCache(): void {
  cache.clear();
  webglCache = null;
}
