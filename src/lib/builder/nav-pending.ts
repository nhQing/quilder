/**
 * "Đang chuyển trang" của vỏ builder — một kho nhỏ NGOÀI React, đọc bằng
 * `useSyncExternalStore` ở `NavProgress` (thanh tiến độ) và giữ bởi khung `loading.tsx`.
 *
 * ## Vì sao cần, khi Next đã có `loading.tsx`
 *
 * Gần như mọi màn builder là `force-dynamic`: mỗi cú bấm là một lượt render ở server. Router
 * của Next GIỮ NGUYÊN màn cũ cho tới khi server trả dòng RSC đầu tiên — không đổi URL, không
 * đổi một pixel nào. Ở máy dev, lần mở đầu một route còn phải biên dịch, tức vài giây. Người
 * dùng thấy "bấm rồi mà không có gì xảy ra", và bấm lại liên tục — đúng câu họ đã báo.
 *
 * `loading.tsx` lo phần SAU dòng đầu tiên: router commit ngay với khung đang tải của màn
 * đích. Còn hai khoảng không ai báo:
 *
 *  - TRƯỚC dòng đầu tiên (chờ server, chờ biên dịch);
 *  - lượt chỉ đổi `?search` (`/builder/text?page=…`, `/builder/assets?folder=…`). Khoá React
 *    của một trang BỎ search params (`createRouterCacheKey(segment, true)` ở `layout-router`),
 *    nên boundary của `loading.tsx` không dựng lại và khung đang tải không hiện — màn cũ đứng
 *    nguyên tới khi màn mới xong.
 *
 * Kho này là phần đó.
 *
 * ## Hai nguồn, một cờ
 *
 *  - `target`: đích của cú bấm đang chờ router commit. `NavProgress` bật nó khi bắt được một
 *    cú bấm link (pha capture), và tắt khi `usePathname`/`useSearchParams` đổi — tức router đã
 *    commit, dù là khung đang tải hay trang thật.
 *  - `skeletons`: số khung `loading.tsx` đang hiện. Khung còn hiện nghĩa là router đã commit
 *    nhưng trang thật chưa tới, nên thanh phải chạy tiếp tới khi khung bị thay.
 *
 * Thanh chạy khi một trong hai còn bật. Không vá `history.pushState`, không bọc `router.push`:
 * cả hai tín hiệu đều là thứ Next phát ra công khai (URL đã commit, Suspense fallback đang gắn).
 *
 * File này không import React và không đụng DOM, nên test được trong `environment: 'node'`.
 */

type Listener = () => void;

const listeners = new Set<Listener>();
let target: string | null = null;
let skeletons = 0;

function emit(): void {
  for (const listener of listeners) listener();
}

export function subscribeNavigation(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Snapshot cho `useSyncExternalStore` — boolean, nên so sánh giữa hai lần đọc luôn ổn định. */
export function isNavigating(): boolean {
  return target !== null || skeletons > 0;
}

/** Đích (pathname + search) của cú bấm đang chờ, hoặc `null`. */
export function pendingTarget(): string | null {
  return target;
}

export function startNavigation(key: string): void {
  if (target === key) return;
  target = key;
  emit();
}

/** Router đã commit (URL đổi), hoặc lưới an toàn hết giờ. */
export function settleNavigation(): void {
  if (target === null) return;
  target = null;
  emit();
}

/**
 * Một khung `loading.tsx` vừa gắn. Trả về hàm nhả — gọi hai lần cũng chỉ nhả một lần, vì
 * Strict Mode chạy effect hai lượt và một bộ đếm âm sẽ tắt thanh của khung khác.
 */
export function holdSkeleton(): () => void {
  skeletons += 1;
  emit();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    skeletons -= 1;
    emit();
  };
}

/** Khoá so sánh hai địa chỉ: pathname + search. `#hash` không phải một lượt điều hướng. */
export function routeKey(url: URL): string {
  return url.pathname + url.search;
}

export interface LinkClick {
  /** `MouseEvent.button` — 0 là chuột trái. */
  button: number;
  /** Đang giữ Ctrl / ⌘ / Shift / Alt: trình duyệt mở tab hoặc cửa sổ mới, không phải router. */
  modified: boolean;
  /** `HTMLAnchorElement.href` — trình duyệt đã phân giải thành địa chỉ tuyệt đối. */
  href: string;
  target: string | null;
  download: boolean;
}

/**
 * Khoá đích của một cú bấm link NẾU đó là lượt điều hướng trong vỏ builder mà router của
 * Next sẽ làm; `null` với mọi thứ trình duyệt tự lo — tab mới, tải file, chuột giữa, link ra
 * ngoài — và với địa chỉ ngoài `/builder`.
 *
 * Chỉ `/builder`: link tới một route API trả file (không có `download`) không làm trang rời
 * đi, nên một thanh bật ở đó sẽ chạy tới khi lưới an toàn hết giờ. Ra site (`/`) là đổi root
 * layout — trình duyệt tải lại cả trang, và thanh tiến độ của chính trình duyệt đã lo.
 *
 * Trả về cả khi đích TRÙNG chỗ đang đứng: bên gọi cần biết để không bật thanh cho một lượt
 * "làm mới tại chỗ" (URL không đổi, nên không có gì để tắt nó).
 */
export function linkTarget(click: LinkClick, currentHref: string): string | null {
  if (click.button !== 0 || click.modified || click.download) return null;
  if (click.target && click.target !== '_self') return null;

  let to: URL;
  let from: URL;
  try {
    from = new URL(currentHref);
    to = new URL(click.href, from);
  } catch {
    return null;
  }
  if (to.origin !== from.origin) return null;
  if (to.pathname !== '/builder' && !to.pathname.startsWith('/builder/')) return null;
  return routeKey(to);
}
