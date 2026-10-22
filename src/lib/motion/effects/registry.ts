/**
 * Registry effect, tải lười.
 *
 * Mỗi entry có một `import()` động, nên bundler tách chúng thành chunk riêng và
 * trang chỉ tải đúng những effect nó thật sự dùng. Đây là quyết định performance
 * quan trọng nhất của Plan 2: three.js nặng ~2MB ở site cũ và được tải trên MỌI
 * trang; ở đây nó chỉ đi kèm chunk của effect WebGL.
 *
 * ## Vì sao gates được lặp lại ở đây
 *
 * Bản đầu chỉ có loader, và EffectRuntime kiểm `allows(entry.gates)` TRƯỚC khi
 * load — tức là không thể biết gates mặc định của module. Hậu quả thật, do test
 * R2 bắt được: `scroll-reveal` khai `respectReducedMotion: false` (nó phải tự
 * xử lý reduced motion bằng cách HIỆN nội dung ngay), nhưng phép kiểm sớm dùng
 * mặc định "tôn trọng reduced motion" và chặn thẳng effect — element kẹt vĩnh
 * viễn ở trạng thái ẩn do CSS đã armed.
 *
 * Bỏ hẳn phép kiểm sớm thì đúng nhưng lại tải chunk của effect ngay cả khi nó
 * chắc chắn không chạy — mất luôn lý do tồn tại của lazy load. Nên gates được
 * khai ở đây dưới dạng metadata tĩnh, và module vẫn giữ bản của nó làm nguồn
 * sự thật. Test `registry.test.ts` canh cho hai bên không lệch nhau.
 */

import type { Gates } from '../capabilities';
import type { AnyEffectModule } from './types';
import projectEffects from '@project/effects';

export interface Entry {
  load: () => Promise<{ default: AnyEffectModule }>;
  /** Bản sao tĩnh của `module.gates`, để kiểm được mà không phải tải chunk. */
  gates?: Gates;
}

/** Effect của LÕI Quilder. */
export const CORE_EFFECTS: Record<string, Entry> = {
  'scroll-reveal': {
    load: () => import('./scroll-reveal'),
    gates: { respectReducedMotion: false },
  },
  parallax: {
    load: () => import('./parallax'),
  },
  counter: {
    load: () => import('./counter'),
    gates: { respectReducedMotion: false },
  },
  marquee: {
    load: () => import('./marquee'),
  },
  tilt: {
    load: () => import('./tilt'),
    gates: { finePointerOnly: true },
  },
  magnetic: {
    load: () => import('./magnetic'),
    gates: { finePointerOnly: true },
  },
  cursor: {
    load: () => import('./cursor'),
    gates: { finePointerOnly: true },
  },
  'nav-collapse': {
    load: () => import('./nav-collapse'),
    gates: { respectReducedMotion: false },
  },
  'menu-toggle': {
    load: () => import('./menu-toggle'),
    // Đổi trạng thái, không phải chuyển động — cùng lý lẽ như nav-collapse.
    gates: { respectReducedMotion: false },
  },
  'nav-invert': {
    load: () => import('./nav-invert'),
    gates: { respectReducedMotion: false },
  },
  'rail-pin': {
    load: () => import('./rail-pin'),
    gates: { minBreakpoint: 'md' },
  },
  'image-sequence': {
    load: () => import('./image-sequence'),
    // Effect tốn băng thông nhất trong cả hệ — hàng chục MB ảnh. `saveData` hoặc
    // RAM ≤ 2 GB thì chặn từ đây, tức là KHÔNG tải cả chunk lẫn ảnh nào.
    gates: { minTier: 'full' },
  },
  slider: {
    load: () => import('./slider'),
    // Cùng lý lẽ với `carousel` ngay dưới: reduced motion tắt autoplay nhưng
    // mũi tên và pagination vẫn phải được nối. Đây cũng là effect DUY NHẤT kéo
    // theo một thư viện ngoài (`swiper`, ~130 KB), nên lazy-load ở đây không
    // phải tối ưu vi mô — nó là điều kiện để trang không có dải nào không phải
    // trả byte nào.
    gates: { respectReducedMotion: false },
  },
  carousel: {
    load: () => import('./carousel'),
    // Tự xử lý: reduced motion tắt autoplay nhưng mũi tên và nút dừng vẫn phải
    // được nối, nếu không dải chỉ cuộn được bằng cách kéo.
    gates: { respectReducedMotion: false },
  },
  modal: {
    load: () => import('./modal'),
    gates: { respectReducedMotion: false },
  },
  'drag-scroll': {
    load: () => import('./drag-scroll'),
    // Kéo là thao tác của người dùng, không phải chuyển động tự chạy.
    gates: { respectReducedMotion: false },
  },
  'video-lazy': {
    load: () => import('./video-lazy'),
    // Gate mặc định (tôn trọng reduced motion) chính là luật "giảm chuyển động
    // nghĩa là không tải": effect không init thì video không bao giờ được chạm.
  },
  'app-link': {
    load: () => import('./app-link'),
    // Đổi đích link, không phải chuyển động.
    gates: { respectReducedMotion: false },
  },
};

/**
 * Effect lõi + effect của gói dự án (`projects/<tên>/effects.ts`, qua alias `@project/effects`).
 *
 * Điểm vào RIÊNG cho effect, không qua `@project/index`: registry này chạy cả ở trình
 * duyệt (`EffectRuntime`), và `index.ts` của gói kéo theo composite — code có thể chỉ chạy
 * được trên server. Effect của gói trùng tên effect lõi thì ném lúc nạp.
 */
export const EFFECT_REGISTRY: Record<string, Entry> = mergeEffects(CORE_EFFECTS, projectEffects);

export function mergeEffects(core: Record<string, Entry>, extra: Record<string, Entry>): Record<string, Entry> {
  for (const key of Object.keys(extra)) {
    if (Object.hasOwn(core, key)) throw new Error(`Effect "${key}" của gói dự án trùng tên effect lõi.`);
  }
  return { ...core, ...extra };
}

export function isKnownEffect(key: string): boolean {
  // `Object.hasOwn`, không `in`: `'toString' in {}` là true.
  return Object.hasOwn(EFFECT_REGISTRY, key);
}

/** Gates mặc định của một effect, đọc được mà không tải chunk. */
export function gatesFor(key: string): Gates | undefined {
  return EFFECT_REGISTRY[key]?.gates;
}

const cache = new Map<string, Promise<AnyEffectModule>>();

/** Tải một effect. Gọi nhiều lần cùng key chỉ tải một lần. */
export function loadEffect(key: string): Promise<AnyEffectModule> | null {
  const entry = EFFECT_REGISTRY[key];
  if (!entry) return null;

  const hit = cache.get(key);
  if (hit) return hit;

  const promise = entry.load().then((mod) => mod.default);
  cache.set(key, promise);
  return promise;
}
