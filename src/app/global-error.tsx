'use client';

/**
 * Lớp chặn cuối: lỗi xảy ra trong chính root layout (`(site)/layout.tsx` đọc DB cho
 * favicon, locale, bó CSS — hỏng ở đó thì `error.tsx` không có layout nào để nằm).
 *
 * Trang này THAY root layout, nên tự có `<html>`/`<body>` và không có `tokens.css`:
 * style là inline với giá trị dự phòng trung tính. Không đọc gì, không gọi gì — xem
 * `(site)/error.tsx` về lý do trang lỗi nằm trong code.
 */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="vi">
      <body
        style={{
          margin: 0,
          minHeight: '100svh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '1rem',
          padding: '2rem 1rem',
          textAlign: 'center',
          fontFamily: 'system-ui, sans-serif',
          background: 'Canvas',
          color: 'CanvasText',
        }}
      >
        <h1 style={{ fontSize: '1.75rem', margin: 0 }}>Đã có lỗi xảy ra</h1>
        <p style={{ margin: 0, opacity: 0.75, maxWidth: '36rem' }}>
          Website tạm thời không hiển thị được. Thử tải lại sau ít phút.
        </p>
        <div style={{ display: 'flex', gap: '1rem' }}>
          <button type="button" onClick={reset}>
            Thử lại
          </button>
          {/* `<a>`: trang này thay cả root layout — không có router nào đáng tin. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/">Về trang chủ</a>
        </div>
      </body>
    </html>
  );
}
