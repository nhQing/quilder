/**
 * IntersectionObserver dùng chung, gộp theo chữ ký option.
 *
 * Port từ ../new-website/js/core/observer.js, giữ nguyên hành vi. Trăm target
 * reveal cùng threshold tốn một observer chứ không phải một trăm.
 *
 * Khác bản gốc đúng một chỗ: `destroy()` cũng xoá pool, và pool là module
 * singleton nên nó sống đúng một page-load — hợp với vòng đời client bundle của
 * Next. EffectRuntime gọi `destroy()` khi unmount.
 */

export type ObserveHandler = (
  entry: IntersectionObserverEntry,
  io: IntersectionObserver,
) => void;

export interface ObserveOptions {
  root?: Element | null;
  rootMargin?: string;
  threshold?: number | number[];
  /** Ngừng quan sát sau lần giao cắt đầu tiên. */
  once?: boolean;
}

interface PoolEntry {
  io: IntersectionObserver;
  handlers: WeakMap<Element, ObserveHandler>;
}

const pool = new Map<string, PoolEntry>();

function keyFor({ root, rootMargin, threshold }: IntersectionObserverInit): string {
  const rootEl = root as Element | null | undefined;
  const rootKey = rootEl ? rootEl.id || rootEl.tagName || 'el' : 'viewport';
  const th = Array.isArray(threshold) ? threshold.join(',') : String(threshold);
  return `${rootKey}|${rootMargin}|${th}`;
}

function getObserver(options: IntersectionObserverInit): PoolEntry {
  const key = keyFor(options);
  const existing = pool.get(key);
  if (existing) return existing;

  const handlers = new WeakMap<Element, ObserveHandler>();
  const io = new IntersectionObserver((entries) => {
    for (const ioEntry of entries) {
      const handler = handlers.get(ioEntry.target);
      if (handler) handler(ioEntry, io);
    }
  }, options);

  const entry: PoolEntry = { io, handlers };
  pool.set(key, entry);
  return entry;
}

/** Quan sát một element. Trả về hàm ngừng quan sát. */
export function observe(
  element: Element,
  handler: ObserveHandler,
  options: ObserveOptions = {},
): () => void {
  const {
    root = null,
    // Mặc định của bản gốc: kích hoạt hơi sớm trước khi chạm đáy viewport.
    rootMargin = '0px 0px -12% 0px',
    threshold = 0,
    once = false,
  } = options;

  const { io, handlers } = getObserver({ root, rootMargin, threshold });

  const wrapped: ObserveHandler = (entry, observer) => {
    handler(entry, observer);
    if (once && entry.isIntersecting) {
      observer.unobserve(element);
      handlers.delete(element);
    }
  };

  handlers.set(element, wrapped);
  io.observe(element);

  return () => {
    io.unobserve(element);
    handlers.delete(element);
  };
}

/** Quan sát nhiều element với cùng một handler. */
export function observeAll(
  elements: Iterable<Element>,
  handler: ObserveHandler,
  options: ObserveOptions = {},
): () => void {
  const stops = [...elements].map((element) => observe(element, handler, options));
  return () => stops.forEach((stop) => stop());
}

/**
 * Resolve khi element đã vào viewport. Dùng để hoãn phần setup đắt tiền
 * (WebGL context) tới lúc nó gần lên màn hình.
 */
export function whenInView(element: Element, options: ObserveOptions = {}): Promise<void> {
  return new Promise((resolve) => {
    const stop = observe(
      element,
      (entry) => {
        if (!entry.isIntersecting) return;
        stop();
        resolve();
      },
      { rootMargin: '25% 0px', ...options },
    );
  });
}

/** Tháo mọi observer trong pool. */
export function destroy(): void {
  for (const { io } of pool.values()) io.disconnect();
  pool.clear();
}
