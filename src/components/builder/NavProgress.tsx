'use client';

/**
 * Thanh tiến độ mảnh ở mép trên của vỏ builder: "đã nhận cú bấm, đang mở trang".
 *
 * Vì sao cần nó dù đã có `loading.tsx`, và nó đọc tín hiệu từ đâu: docblock của
 * `lib/builder/nav-pending.ts`. Ngắn gọn — thanh chạy từ lúc bấm tới lúc trang THẬT hiện:
 * qua khoảng chờ server trả dòng đầu, qua khung đang tải, và qua những lượt chỉ đổi `?search`
 * mà khung đang tải không phủ tới.
 *
 * ## Vì sao bắt click ở pha CAPTURE trên `window`
 *
 * Để chạy TRƯỚC `onClick` của `<Link>`. Hai việc cần đúng thứ tự đó:
 *
 *  1. Bật cờ ngay cú bấm, kể cả với link không phải `<Link>` (link trong menu, breadcrumb).
 *  2. Chặn cú bấm LẶP LẠI vào đúng đích đang mở. `<Link>` bỏ qua cú bấm đã `defaultPrevented`
 *     (xem `onClick` trong `next/dist/client/app-dir/link.js`), nên `preventDefault()` ở đây
 *     là đủ: không có lượt điều hướng thứ hai, không có lượt render thứ hai ở server — mà các
 *     handler khác của cú bấm vẫn chạy (không `stopPropagation`), ví dụ menu vẫn tự đóng.
 *     Mỗi lượt bấm lại trước đây bỏ lượt đang chạy và bắt server render lại từ đầu, tức càng
 *     bấm càng chậm.
 *
 * Bấm vào CHÍNH chỗ đang đứng thì không bật gì: Next làm mới tại chỗ, URL không đổi, nên không
 * có tín hiệu nào để tắt thanh. Nếu đang có lượt khác chờ thì lượt đó bị router bỏ — tắt luôn.
 *
 * ## Vì sao hiện SAU 120ms
 *
 * Link đã prefetch (bản production) commit trong vài chục ms. Thanh hiện ngay thì mọi cú bấm
 * nhanh là một vạch nháy ở mép màn — thứ làm người ta tưởng có lỗi. `--shell-pending-delay`
 * trong builder.css là cùng con số cho spinner của link.
 *
 * ## Hoàn tất
 *
 * Thanh mọc tới ~90% rồi dừng (CSS). Khi hết chờ, nó được đẩy nốt tới 100% rồi mờ đi, xuất
 * phát từ ĐÚNG chỗ nó đang đứng — đọc `transform` đã tính, vì `transition` không bắt đầu từ
 * giá trị đang nằm giữa một `animation`. Giảm chuyển động: thanh đứng yên, hết chờ là biến mất.
 *
 * ## Khả năng truy cập
 *
 * `role="progressbar"` không có `aria-valuenow` = thanh không xác định. Một vùng `aria-live`
 * lịch sự đọc "Đang mở trang…" khi thanh hiện; trang mới tới thì bộ báo route của Next đọc tên
 * trang. Vùng đó KHÔNG mang `role="status"`: `text.spec.ts` gọi `getByRole('status')` ở chế độ
 * strict, và một status thứ hai thường trực trong layout sẽ làm nó đỏ.
 */

import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';

import {
  holdSkeleton,
  isNavigating,
  linkTarget,
  pendingTarget,
  routeKey,
  settleNavigation,
  startNavigation,
  subscribeNavigation,
} from '@/lib/builder/nav-pending';

/** Khớp `--shell-pending-delay` trong builder.css. */
const SHOW_AFTER_MS = 120;
/**
 * Lưới an toàn cho cú bấm không dẫn tới lượt commit nào (ví dụ đích redirect về đúng chỗ đang
 * đứng). Dài, vì lần mở đầu một route ở máy dev có thể mất cả chục giây biên dịch. Chỉ tắt cờ
 * của CÚ BẤM; khung đang tải vẫn giữ thanh của nó.
 */
const GIVE_UP_MS = 20_000;
const FINISH_MS = 340;

type Phase = 'idle' | 'running' | 'finishing';

const serverSnapshot = () => false;

export function NavProgress() {
  const pathname = usePathname();
  const search = useSearchParams()?.toString() ?? '';
  const busy = useSyncExternalStore(subscribeNavigation, isNavigating, serverSnapshot);
  const [phase, setPhase] = useState<Phase>('idle');
  // Mỗi lượt chạy là một phần tử mới: animation CSS bắt đầu lại từ đầu.
  const [run, setRun] = useState(0);
  const bar = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (!(anchor instanceof HTMLAnchorElement)) return;
      const key = linkTarget(
        {
          button: event.button,
          modified: event.metaKey || event.ctrlKey || event.shiftKey || event.altKey,
          href: anchor.href,
          target: anchor.getAttribute('target'),
          download: anchor.hasAttribute('download'),
        },
        window.location.href,
      );
      if (key === null) return;
      if (key === routeKey(new URL(window.location.href))) {
        settleNavigation();
        return;
      }
      if (key === pendingTarget()) {
        event.preventDefault();
        return;
      }
      startNavigation(key);
    };
    window.addEventListener('click', onClick, true);
    return () => window.removeEventListener('click', onClick, true);
  }, []);

  // URL đổi = router đã commit lượt điều hướng (khung đang tải hoặc trang thật).
  useEffect(() => {
    settleNavigation();
  }, [pathname, search]);

  useEffect(() => {
    if (!busy) return;
    const t = setTimeout(settleNavigation, GIVE_UP_MS);
    return () => clearTimeout(t);
  }, [busy]);

  useEffect(() => {
    if (busy) {
      if (phase === 'running') return;
      // Đang mờ dần mà lại có lượt mới: chạy lại ngay, không chờ thêm một nhịp trễ.
      const t = setTimeout(
        () => {
          setRun((n) => n + 1);
          setPhase('running');
        },
        phase === 'finishing' ? 0 : SHOW_AFTER_MS,
      );
      return () => clearTimeout(t);
    }
    if (phase === 'running') {
      setPhase('finishing');
      return;
    }
    if (phase === 'finishing') {
      const t = setTimeout(() => setPhase('idle'), FINISH_MS);
      return () => clearTimeout(t);
    }
  }, [busy, phase]);

  useLayoutEffect(() => {
    const el = bar.current;
    if (phase !== 'finishing' || !el) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      el.style.opacity = '0';
      return;
    }
    const from = getComputedStyle(el).transform;
    el.style.animation = 'none';
    el.style.transform = from;
    // Đọc layout để trình duyệt chốt điểm xuất phát trước khi đổi sang đích.
    void el.offsetWidth;
    el.style.transition = 'transform 180ms ease-out, opacity 200ms ease-in 140ms';
    el.style.transform = 'scaleX(1)';
    el.style.opacity = '0';
  }, [phase]);

  return (
    <>
      {phase !== 'idle' && (
        <div
          role="progressbar"
          aria-label="Đang mở trang"
          className="pointer-events-none fixed inset-x-0 top-0 z-50 h-0.75"
        >
          <div key={run} ref={bar} className="shell-nav-bar h-full rounded-r-full bg-shell-accent" />
        </div>
      )}
      <div aria-live="polite" className="sr-only">
        {phase === 'running' ? 'Đang mở trang…' : ''}
      </div>
    </>
  );
}

/**
 * Đặt trong mỗi khung `loading.tsx`: khung còn gắn là thanh còn chạy. Không vẽ gì.
 *
 * Khung gắn = router đã commit nhưng trang thật chưa tới. Không có nó, thanh tắt ngay lúc URL
 * đổi — tức đúng lúc khung hiện — và phần chờ dài nhất (server đọc DB) không còn gì báo.
 */
export function NavSkeletonHold() {
  useEffect(() => holdSkeleton(), []);
  return null;
}
