'use client';

/**
 * Ranh giới client DUY NHẤT cho motion.
 *
 * Mount đúng một lần, trong `(site)/layout.tsx`. Mọi thứ khác của renderer là
 * server component không có JS. Một chỗ mount duy nhất chính là điều kiện để bất
 * biến "một vòng lặp animation" còn đúng dưới React — xem rủi ro R2.
 *
 * ## Bốn hiểm hoạ và cách chặn
 *
 * 1. **StrictMode double-mount ở dev.** Effect Ở ĐÂY tự dọn sạch trong cleanup,
 *    và mỗi effect trả về disposer riêng, nên mount lần hai bắt đầu từ số 0.
 * 2. **Client navigation.** Runtime key theo `usePathname()`, nên teardown chạy
 *    đầy đủ rồi mới init lại, và `scroll.refresh()` chạy sau khi cây mới paint.
 * 3. **Hai runtime cùng mount.** Cờ cấp module `mounted` — throw ở dev, cảnh báo
 *    ở prod. Đây là lỗi cấu hình, không phải lỗi runtime, nên phải ồn ào.
 * 4. **Rò rỉ.** `window.__mm.raf.count()` giữ nguyên từ site cũ để săn rò rỉ, và
 *    test Playwright assert số này về đúng baseline sau 3 vòng điều hướng.
 */

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

import { allows, type Gates } from './capabilities';
import { gatesFor, loadEffect } from './effects/registry';
import * as raf from './raf';
import * as scroll from './scroll';

export interface EffectManifestEntry {
  instanceId: string;
  nodeId: string;
  /** Có khi effect gắn trên node trong component: id node Instance của doc (xem NodeRenderer). */
  scopeId?: string;
  effect: string;
  params: Record<string, unknown>;
  gates?: Gates;
}

/** Chặn hai runtime cùng sống. Cấp module, nên nó sống đúng một page-load. */
let mounted = false;

export function EffectRuntime({ manifest }: { manifest: EffectManifestEntry[] }) {
  const pathname = usePathname();

  useEffect(() => {
    if (mounted) {
      const message =
        '[EffectRuntime] đã có một runtime đang mount. Chỉ được mount MỘT lần, ở (site)/layout.tsx.';
      if (process.env.NODE_ENV !== 'production') throw new Error(message);
      console.error(message);
      return;
    }
    mounted = true;

    let disposed = false;
    const disposers: Array<() => void> = [];

    // scroll.init() gọi raf.configure(gsap) rồi raf.start(). Phải chạy trước mọi
    // effect, vì effect đăng ký vào vòng lặp mà nó dựng lên.
    scroll.init();
    disposers.push(scroll.bindAnchors());

    (async () => {
      for (const entry of manifest) {
        if (disposed) return;

        // Kiểm SỚM bằng gates tĩnh của registry gộp với gates của node, để không
        // tải chunk của một effect chắc chắn không chạy. Dùng gates của node
        // một mình là sai: nó không biết mặc định của module — xem ghi chú trong
        // registry.ts, đây là bug mà test R2 bắt được.
        if (!allows({ ...gatesFor(entry.effect), ...entry.gates })) continue;

        const loader = loadEffect(entry.effect);
        if (!loader) {
          console.warn(`[EffectRuntime] effect không rõ: ${entry.effect}`);
          continue;
        }

        // Node trong component có `data-cn` (id local, trùng giữa các instance) nên phải
        // đi qua wrapper `data-n` của đúng instance — không thì effect gắn nhầm bản đầu.
        const el = document.querySelector<HTMLElement>(
          entry.scopeId
            ? `[data-n="${entry.scopeId}"] [data-cn="${entry.nodeId}"]`
            : `[data-n="${entry.nodeId}"]`,
        );
        if (!el) continue;

        try {
          const mod = await loader;
          if (disposed) return;

          // Gates của module là mặc định; gates trên node ghi đè từng trường.
          if (!allows({ ...mod.gates, ...entry.gates })) continue;

          const parsed = mod.paramsSchema.safeParse(entry.params);
          if (!parsed.success) {
            // Không ném: một effect sai tham số không được làm hỏng cả trang.
            console.warn(
              `[EffectRuntime] tham số không hợp lệ cho ${entry.effect}`,
              parsed.error.issues,
            );
            continue;
          }

          const dispose = mod.init(el, parsed.data);
          if (typeof dispose === 'function') disposers.push(dispose);
        } catch (error) {
          console.error(`[EffectRuntime] ${entry.effect} lỗi khi khởi tạo`, error);
        }
      }

      // Chiều cao document đã đổi sau khi effect gắn xong.
      if (!disposed) scroll.refresh();
    })();

    if (process.env.NODE_ENV !== 'production') {
      (window as unknown as { __mm: unknown }).__mm = {
        raf: { count: raf.count, getDriver: raf.getDriver },
        scroll: { getLenis: scroll.getLenis },
      };
    }

    return () => {
      disposed = true;
      // Ngược thứ tự: effect tháo trước, rồi mới tới scroll và vòng lặp.
      for (let i = disposers.length - 1; i >= 0; i -= 1) disposers[i]?.();
      scroll.destroy();
      raf.destroy();
      mounted = false;
    };
    // pathname có mặt để điều hướng phía client kích hoạt teardown + init lại.
  }, [manifest, pathname]);

  return null;
}
