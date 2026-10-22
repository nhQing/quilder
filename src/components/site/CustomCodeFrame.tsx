'use client';

/**
 * Khung iframe cho một khối `CustomCode`.
 *
 * ## `sandbox="allow-scripts"` — và KHÔNG có `allow-same-origin`
 *
 * Đây là dòng quan trọng nhất trong file. Hai cờ đó đặt cùng nhau thì iframe
 * **tự gỡ được sandbox của chính nó**: nó có cùng origin với trang cha, nên nó
 * chạm được `parent.document`, đọc được cookie, và mọi thứ sandbox định chặn trở
 * thành hình thức.
 *
 * Thiếu `allow-same-origin` nghĩa là origin mờ: không cookie của site, không
 * localStorage của site, không đọc được DOM cha. Đó là toàn bộ lý do khối này
 * được phép chạy JS tự do.
 *
 * Cũng KHÔNG có: `allow-forms` (khối này không phải chỗ thu dữ liệu),
 * `allow-popups`, `allow-top-navigation` (một khối trang trí không được phép điều
 * hướng cả trang), `allow-modals` (một `alert()` chặn toàn bộ event của trang).
 *
 * ## Vì sao phải kiểm `event.source`
 *
 * Bất kỳ frame nào trong trang cũng `postMessage` được lên cha. Không kiểm nguồn
 * thì một khối CustomCode khác — hoặc một quảng cáo nhúng ở đâu đó — đặt được
 * chiều cao cho khối này. So `contentWindow` là phép kiểm duy nhất đúng.
 */

import { useEffect, useRef, useState } from 'react';

/** Trần chiều cao tự động. Một khối báo 10 triệu px thì đó là bug, không phải ý định. */
const MAX_AUTO_HEIGHT = 4000;
const MIN_AUTO_HEIGHT = 40;

export function CustomCodeFrame({
  srcdoc,
  title,
  fixedHeight,
}: {
  srcdoc: string;
  title: string;
  /** Khi có, dùng cố định và KHÔNG nghe resize. */
  fixedHeight?: string;
}) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(MIN_AUTO_HEIGHT * 4);

  useEffect(() => {
    if (fixedHeight) return;

    const onMessage = (event: MessageEvent) => {
      // Chỉ tin thông điệp đến từ CHÍNH iframe này.
      if (!ref.current || event.source !== ref.current.contentWindow) return;

      const data = event.data as { __mm?: string; height?: unknown };
      if (data?.__mm !== 'resize' || typeof data.height !== 'number') return;
      if (!Number.isFinite(data.height)) return;

      setHeight(Math.min(MAX_AUTO_HEIGHT, Math.max(MIN_AUTO_HEIGHT, Math.ceil(data.height))));
    };

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [fixedHeight]);

  return (
    <iframe
      ref={ref}
      title={title}
      srcDoc={srcdoc}
      sandbox="allow-scripts"
      // `lazy`: một khối three.js là vài trăm KB. Nó không nên tải khi còn ở dưới
      // màn hình, và nó không ảnh hưởng LCP nếu chưa nhìn thấy.
      loading="lazy"
      referrerPolicy="no-referrer"
      style={{
        display: 'block',
        width: '100%',
        height: fixedHeight ?? `${height}px`,
        border: 0,
        // `colorScheme: 'normal'` chặn trình duyệt áp nền tối mặc định vào tài
        // liệu con — không có nó, một khối nền trong suốt vẫn ra một ô xám.
        colorScheme: 'normal',
      }}
    />
  );
}
