'use client';

import { forwardRef } from 'react';

import { cn } from '@/lib/builder/cn';
import { ui } from '@/lib/builder/ui';
import { Icon } from '@/components/builder/ui/Icon';
import { StepDot, type StepState } from './ProgressRail';

/**
 * Một box của màn cài đặt.
 *
 *  - **Đang làm:** viền màu nhấn, mở đầy đủ.
 *  - **Đã xong:** thu gọn còn tiêu đề + tóm tắt + dấu ✓; bấm tiêu đề để mở lại.
 *  - **Chưa tới:** mờ và `inert` — không focus, không gõ được, screen reader bỏ qua.
 *    Chỉ làm mờ thì Tab vẫn nhảy vào ô của một bước chưa tới lượt.
 */
export const StepBox = forwardRef<
  HTMLLIElement,
  {
    index: number;
    title: string;
    state: StepState;
    open: boolean;
    summary?: React.ReactNode;
    onToggle?: () => void;
    children: React.ReactNode;
  }
>(function StepBox({ index, title, state, open, summary, onToggle, children }, ref) {
  const canToggle = state === 'done' && onToggle;
  const headId = `setup-step-${index}-title`;

  return (
    <li
      ref={ref}
      data-testid={`setup-step-${index}`}
      data-state={state}
      aria-labelledby={headId}
      inert={state === 'future' || undefined}
      className={cn(
        ui.card,
        'scroll-mt-6 p-5 transition-[opacity,box-shadow] duration-200',
        state === 'current' && 'ring-2 ring-shell-accent',
        state === 'future' && 'opacity-55',
      )}
    >
      <h2 id={headId} className="flex min-h-6 items-center gap-2.5 text-[1.0625rem] leading-6 font-semibold">
        <StepDot index={index} state={state} />
        {canToggle ? (
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            className="flex min-w-0 flex-1 items-center gap-2 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-shell-accent"
          >
            <span className="min-w-0 flex-1">{title}</span>
            <span className={cn(ui.chip, ui.tone.ok)}>
              <Icon name="check" size={12} />
              Xong
            </span>
            <Icon name={open ? 'chevron-up' : 'chevron-down'} size={16} />
          </button>
        ) : (
          <span className="min-w-0 flex-1">{title}</span>
        )}
      </h2>

      {state === 'done' && !open && summary && (
        <p className="mt-1.5 text-small text-shell-muted sm:pl-0">{summary}</p>
      )}

      {(state !== 'done' || open) && <div className="mt-4">{children}</div>}
    </li>
  );
});
