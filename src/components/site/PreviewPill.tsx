'use client';

/**
 * Thanh nổi giữa đáy màn hình của các màn xem trước: một chip trạng thái luôn hiện, phần
 * công cụ thu gọn được, và nút thu gọn ở cuối.
 *
 * Dùng chung cho `PreviewChrome` (bản nháp) và `/preview/release/<id>` (một release) —
 * hai màn cùng vấn đề (nằm đè lên trang của người dùng) nên cùng một lời giải; chỉ
 * màu chip trạng thái là khác, để không ai nhầm bản nháp với bản đã từng lên site.
 * Hình dạng, font và lý do của CSS nằm ở `preview-pill.ts`.
 *
 * ## Vì sao thu gọn được
 *
 * Thanh không chiếm chỗ trong luồng, nên ở cuối trang nó nằm đúng giữa footer — chỗ của
 * dòng bản quyền và giấy phép. Thu gọn còn mỗi chip trạng thái (vài chục px) là cách xem
 * nốt phần đó mà KHÔNG phải đổi bố cục của trang đang soát. Chip vẫn ở lại: thu gọn mà
 * mất luôn dòng "chưa publish" thì một ảnh chụp màn hình không còn nói nó là bản nháp.
 *
 * Trạng thái thu gọn không được nhớ: các nút trong thanh là link, bấm là nạp trang mới,
 * và người vừa bấm một bề rộng là người muốn thấy thanh.
 */

import { useState } from 'react';

import { PILL_CSS, PILL_FONT_VARS } from './preview-pill';

export type PillTone = 'warn' | 'ok' | 'neutral';

export function PreviewPill({
  label,
  tone,
  status,
  statusTitle,
  data,
  children,
}: {
  /** Tên của cả nhóm cho screen reader, ví dụ "Công cụ xem nháp". */
  label: string;
  /** `warn` = bản nháp, `ok` = release đang chạy, `neutral` = release cũ. */
  tone: PillTone;
  /** Nội dung chip trạng thái — luôn hiện, kể cả khi thu gọn. */
  status: React.ReactNode;
  /** Câu đầy đủ của chip, cho lúc màn hẹp chỉ còn bản rút gọn. */
  statusTitle?: string;
  /** Thuộc tính `data-*` gắn lên gốc thanh — selector mà test và script đang dùng. */
  data?: Record<`data-${string}`, string>;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div
      data-preview-pill=""
      data-collapsed={collapsed ? '' : undefined}
      role="group"
      aria-label={label}
      style={PILL_FONT_VARS}
      {...data}
    >
      <style>{PILL_CSS}</style>

      <span data-pill-status="" data-tone={tone} title={statusTitle}>
        <span data-pill-dot="" aria-hidden="true" />
        {status}
      </span>

      {!collapsed && <div data-pill-body="">{children}</div>}

      <button
        type="button"
        data-pill-toggle=""
        aria-expanded={!collapsed}
        aria-label={collapsed ? 'Mở rộng thanh công cụ' : 'Thu gọn thanh công cụ'}
        title={collapsed ? 'Mở rộng thanh công cụ' : 'Thu gọn để xem phần trang bên dưới'}
        onClick={() => setCollapsed((c) => !c)}
      >
        {/* Cùng nét với bộ icon của vỏ (`ui/Icon.tsx`): lưới 24, nét 2 ở cỡ 16. Mũi tên
            chỉ hướng thanh sẽ co về: đang mở thì `‹` (gập về phía chip), đang gập thì `›`. */}
        <svg
          viewBox="0 0 24 24"
          width="16"
          height="16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d={collapsed ? 'M9 6l6 6-6 6' : 'M15 6l-6 6 6 6'} />
        </svg>
      </button>
    </div>
  );
}
