'use client';

import { useEffect } from 'react';

/**
 * Trang lỗi (500) của site công khai.
 *
 * ## Vì sao nằm trong CODE, không sửa được bằng builder như trang 404
 *
 * Trang này hiện ra đúng lúc DB hoặc phần dựng trang vừa hỏng — tức lúc dữ liệu
 * trong DB là thứ không tin được. Next cũng bắt `error.tsx` là client component, nên
 * nó không đọc được DB kể cả khi muốn. Nội dung cố định, ngắn, và không gọi gì ra
 * ngoài: một trang lỗi đi gọi API là một trang lỗi có thể tự lỗi.
 *
 * Style chỉ dùng biến token: `tokens.css` nạp ở layout của site, nên trang vẫn mang
 * màu và chữ của dự án mà không gõ cứng giá trị nào.
 */
export default function SiteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main
      style={{
        minBlockSize: '60svh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 'var(--space-s)',
        paddingInline: 'var(--gutter)',
        paddingBlock: 'var(--space-2xl)',
        textAlign: 'center',
      }}
    >
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--step-3)' }}>Đã có lỗi xảy ra</h1>
      <p style={{ color: 'var(--color-ink-muted)', maxInlineSize: 'var(--measure)' }}>
        Trang này tạm thời không hiển thị được. Thử tải lại sau ít phút.
      </p>
      {/* Mã lỗi để người dùng đọc lại cho bộ phận hỗ trợ — tra được trong log server. */}
      {error.digest && (
        <p style={{ color: 'var(--color-ink-muted)', fontSize: 'var(--step--1)' }}>Mã lỗi: {error.digest}</p>
      )}
      <div style={{ display: 'flex', gap: 'var(--space-s)', marginBlockStart: 'var(--space-m)' }}>
        <button type="button" onClick={reset}>
          Thử lại
        </button>
        {/* `<a>` chứ không `Link`: router phía client có thể chính là thứ đang hỏng. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a href="/">Về trang chủ</a>
      </div>
    </main>
  );
}
