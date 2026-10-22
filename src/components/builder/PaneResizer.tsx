'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/builder/cn';
import {
  clampRightPane,
  RIGHT_PANE_MAX,
  RIGHT_PANE_MIN,
  RIGHT_PANE_STEP,
  RIGHT_PANE_STEP_BIG,
} from '@/lib/builder/pane-width';
import { readInt, remove, safeStorage, STORAGE_KEYS, write } from '@/lib/builder/persisted';

/**
 * Bề rộng Inspector do người dùng kéo — `null` = mặc định `--shell-right` của `builder.css`.
 *
 * Đọc giá trị đã lưu SAU khi mount, cùng lý do với `leftCollapsed`: server không có
 * `localStorage`, đọc lúc render là HTML hai bên lệch nhau. Bề rộng hiển thị bị kẹp theo
 * cửa sổ hiện tại (`clampRightPane`), còn giá trị lưu thì giữ nguyên.
 */
export function useRightPaneWidth() {
  const [stored, setStored] = useState<number | null>(null);
  const [viewport, setViewport] = useState(0);

  useEffect(() => {
    setStored(readInt(safeStorage(), STORAGE_KEYS.rightWidth, RIGHT_PANE_MIN, RIGHT_PANE_MAX));
    const read = () => setViewport(window.innerWidth);
    read();
    window.addEventListener('resize', read);
    return () => window.removeEventListener('resize', read);
  }, []);

  const commit = useCallback((px: number | null) => {
    setStored(px);
    if (px === null) remove(safeStorage(), STORAGE_KEYS.rightWidth);
    else write(safeStorage(), STORAGE_KEYS.rightWidth, String(px));
  }, []);

  const width = stored !== null && viewport ? clampRightPane(stored, viewport) : null;
  /** Gắn vào `style` của lưới shell — lưới đọc `var(--shell-right)`. */
  const gridVar = width !== null ? ({ '--shell-right': `${width}px` } as React.CSSProperties) : {};
  return { width, gridVar, commit };
}

/**
 * Tay kéo ở mép trái Inspector.
 *
 * ## Vì sao trong lúc kéo KHÔNG setState
 *
 * Mỗi `pointermove` đổi thẳng biến `--shell-right` trên lưới. Re-render cả editor
 * (Canvas, cây node, Inspector) 60 lần mỗi giây chỉ để dời một cột là cái giật thấy được.
 * Thả tay mới ghi state + `localStorage` một lần.
 *
 * `setPointerCapture` là bắt buộc: con trỏ đi ngang canvas là đi vào một `<iframe>`, và
 * không capture thì iframe nuốt mất `pointermove` — cột đứng khựng giữa đường.
 */
export function PaneResizer({
  gridRef,
  width,
  onCommit,
}: {
  gridRef: React.RefObject<HTMLElement | null>;
  /** Bề rộng đang áp (px), hoặc `null` khi đang dùng mặc định. */
  width: number | null;
  onCommit: (px: number | null) => void;
}) {
  const handleRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; w: number; last: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [measured, setMeasured] = useState<number | null>(null);

  const current = () => handleRef.current?.parentElement?.getBoundingClientRect().width ?? RIGHT_PANE_MIN;
  const apply = (px: number) => gridRef.current?.style.setProperty('--shell-right', `${px}px`);

  useEffect(() => setMeasured(Math.round(current())), [width]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const w = current();
    drag.current = { x: e.clientX, w, last: Math.round(w) };
    setDragging(true);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    // Tay kéo ở mép TRÁI: kéo sang trái là rộng ra.
    const next = clampRightPane(d.w + (d.x - e.clientX), window.innerWidth);
    if (next !== d.last) {
      d.last = next;
      apply(next);
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    setDragging(false);
    e.currentTarget.releasePointerCapture(e.pointerId);
    onCommit(d.last);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? RIGHT_PANE_STEP_BIG : RIGHT_PANE_STEP;
    let next: number | null = null;
    if (e.key === 'ArrowLeft') next = current() + step;
    else if (e.key === 'ArrowRight') next = current() - step;
    else if (e.key === 'Home') next = RIGHT_PANE_MIN;
    else if (e.key === 'End') next = RIGHT_PANE_MAX;
    if (next === null) return;
    e.preventDefault();
    const px = clampRightPane(next, window.innerWidth);
    apply(px);
    onCommit(px);
  };

  const reset = () => {
    gridRef.current?.style.removeProperty('--shell-right');
    onCommit(null);
  };

  return (
    <div
      ref={handleRef}
      role="separator"
      aria-orientation="vertical"
      aria-label="Đổi bề rộng Inspector — kéo, hoặc dùng phím mũi tên. Bấm đúp để về mặc định."
      aria-valuemin={RIGHT_PANE_MIN}
      aria-valuemax={RIGHT_PANE_MAX}
      aria-valuenow={width ?? measured ?? undefined}
      tabIndex={0}
      title="Kéo để đổi bề rộng · bấm đúp để về mặc định"
      data-testid="inspector-resizer"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={reset}
      onKeyDown={onKeyDown}
      className={cn(
        'group absolute inset-y-0 left-0 z-30 w-2 cursor-col-resize touch-none',
        'focus-visible:outline-none',
      )}
    >
      {/* Vạch hiện khi hover/kéo/focus — dải bấm rộng 8px, vạch nhìn thấy chỉ 2px. */}
      <span
        aria-hidden
        className={cn(
          'absolute inset-y-3 left-0.5 w-0.5 rounded-full transition-colors duration-150',
          dragging
            ? 'bg-shell-accent'
            : 'bg-transparent group-hover:bg-shell-line-strong group-focus-visible:bg-shell-accent',
        )}
      />
    </div>
  );
}
