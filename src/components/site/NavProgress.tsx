'use client';

/**
 * Thanh tiến trình mảnh trên đầu trang khi chuyển trang (kiểu nprogress).
 *
 * ## Vì sao tự viết (17/11/2026)
 *
 * App Router không phát sự kiện "bắt đầu điều hướng" — chỉ biết khi đường dẫn ĐÃ đổi
 * (`usePathname`). Nên điểm bắt đầu là cú bấm vào một link nội bộ (hoặc Back/Forward),
 * điểm kết thúc là lúc `pathname`/`searchParams` đổi. Thư viện như nprogress làm đúng
 * việc này cộng thêm CSS riêng; ở đây style nằm inline để không phải đổi bó CSS đã niêm
 * phong theo release (`Release.cssHash`) — component có mặt ngay sau deploy.
 *
 * Không chạy cho: link ra domain khác, `target` khác `_self`, `download`, chỉ đổi hash
 * (neo trong trang), bấm kèm phím Ctrl/⌘/Shift/Alt (mở tab mới), và link tới đúng URL
 * đang xem.
 */

import { usePathname, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';

/** Quá thời gian này mà trang chưa đổi (lỗi mạng, link bị chặn) thì tự kết thúc. */
const GIVE_UP_MS = 10_000;

/** Đích của một cú bấm có phải điều hướng nội bộ sang URL KHÁC không. */
export function isInternalNavigation(e: MouseEvent, here: Location): boolean {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return false;
  const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
  if (!a) return false;
  if (a.hasAttribute('download')) return false;
  const target = a.getAttribute('target');
  if (target && target !== '_self') return false;
  let url: URL;
  try {
    url = new URL(a.getAttribute('href') ?? '', here.href);
  } catch {
    return false;
  }
  if (url.origin !== here.origin) return false;
  // Cùng trang (chỉ khác hash, hoặc y hệt): không có lần tải nào để chờ.
  return url.pathname !== here.pathname || url.search !== here.search;
}

function Bar() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const [progress, setProgress] = useState(0);
  const [visible, setVisible] = useState(false);
  const loading = useRef(false);
  const timers = useRef<number[]>([]);

  const clear = () => {
    for (const t of timers.current) {
      // Cùng một bể id cho timeout và interval trong trình duyệt; gọi cả hai cho chắc.
      window.clearTimeout(t);
      window.clearInterval(t);
    }
    timers.current = [];
  };

  const finish = () => {
    if (!loading.current) return;
    loading.current = false;
    clear();
    setProgress(1);
    timers.current.push(
      window.setTimeout(() => {
        setVisible(false);
        timers.current.push(window.setTimeout(() => setProgress(0), 300));
      }, 200),
    );
  };

  const start = () => {
    clear();
    loading.current = true;
    setVisible(true);
    setProgress(0.08);
    // Nhích dần về 90%, chậm lại khi càng gần — không bao giờ tự chạm 100%.
    timers.current.push(
      window.setInterval(() => setProgress((p) => (p < 0.9 ? p + (0.9 - p) * 0.12 : p)), 200),
    );
    timers.current.push(window.setTimeout(finish, GIVE_UP_MS));
  };

  // Bắt đầu: bấm link nội bộ, hoặc Back/Forward.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (isInternalNavigation(e, window.location)) start();
    };
    const onPop = () => start();
    document.addEventListener('click', onClick);
    window.addEventListener('popstate', onPop);
    return () => {
      document.removeEventListener('click', onClick);
      window.removeEventListener('popstate', onPop);
      clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- start/clear chỉ đụng ref và setter
  }, []);

  // Kết thúc: đường dẫn đã đổi xong.
  useEffect(() => {
    finish();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- finish chỉ đụng ref và setter
  }, [pathname, search]);

  return (
    <div
      aria-hidden="true"
      data-nav-progress=""
      style={{
        position: 'fixed',
        insetInline: 0,
        top: 0,
        height: 3,
        zIndex: 2147483000,
        pointerEvents: 'none',
        opacity: visible ? 1 : 0,
        transition: 'opacity 300ms ease',
      }}
    >
      <div
        style={{
          height: '100%',
          background: 'var(--mm-violet, #6937ff)',
          boxShadow: '0 0 8px var(--mm-violet, #6937ff)',
          transformOrigin: '0 50%',
          transform: `scaleX(${progress})`,
          transition: progress === 0 ? 'none' : 'transform 200ms ease-out',
        }}
      />
    </div>
  );
}

/**
 * `useSearchParams` bắt buộc nằm trong `<Suspense>` ở App Router — thiếu nó thì cả
 * layout rơi về render phía client lúc build.
 */
export function NavProgress() {
  return (
    <Suspense fallback={null}>
      <Bar />
    </Suspense>
  );
}
