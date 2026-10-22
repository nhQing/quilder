'use client';

import { useLayoutEffect, useRef, useState } from 'react';

import { cn } from '@/lib/builder/cn';
import { Icon } from '@/components/builder/ui/Icon';

export type StepState = 'future' | 'current' | 'done';

/**
 * Cột progress bên trái màn cài đặt: vòng tròn số cho mỗi step, nối bằng một thanh
 * dọc, và cả cột DÍNH (`sticky`) khi cuộn.
 *
 * ## Vì sao vị trí vòng tròn đo theo khung nhìn, không theo bố cục
 *
 * Hai yêu cầu kéo ngược nhau: đoạn của mỗi step phải CAO BẰNG box của nó, và cả cột
 * phải dính. Một cột dính thì đứng yên khi các box trôi đi — tính vị trí theo
 * `offsetTop` thì cuộn một chút là vòng tròn lệch khỏi tiêu đề box (đo 20/10/2026:
 * lệch ~30px ở 1280×900).
 *
 * Nên mỗi khung hình cuộn, vòng tròn được đặt đúng ngang tiêu đề box THẬT
 * (`getBoundingClientRect`) — khoảng giữa hai vòng chính là chiều cao box. Box trôi
 * khỏi khung nhìn thì vòng của nó dồn lại ở mép trên/dưới cột, xếp chồng theo thứ
 * tự, nên lúc nào cũng thấy đủ ba bước và bước đang làm.
 */

/** Từ mép trên box tới TÂM dòng tiêu đề (padding 20px + nửa dòng 24px). */
const TITLE_CENTER = 32;
const CIRCLE = 32;
/** Khoảng giữa hai vòng khi chúng dồn lại ở mép. */
const STACK_GAP = 6;
/** Khớp `top-6` của cột: đệm trên và dưới khi dính. */
const STICKY_PAD = 24;

export function ProgressRail({
  listRef,
  boxRefs,
  states,
  onJump,
}: {
  listRef: React.RefObject<HTMLElement | null>;
  boxRefs: React.RefObject<(HTMLElement | null)[]>;
  states: StepState[];
  onJump: (index: number) => void;
}) {
  const railRef = useRef<HTMLElement>(null);
  const [geom, setGeom] = useState<{ height: number; tops: number[] }>({ height: 0, tops: [] });

  useLayoutEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      const rail = railRef.current;
      const list = listRef.current;
      if (!rail || !list) return;
      const n = states.length;
      const height = Math.max(
        n * (CIRCLE + STACK_GAP),
        Math.min(list.offsetHeight, window.innerHeight - STICKY_PAD * 2),
      );
      const railTop = rail.getBoundingClientRect().top;
      const tops = boxRefs.current.slice(0, n).map((el, i) => {
        const raw = (el ? el.getBoundingClientRect().top - railTop : 0) + TITLE_CENTER - CIRCLE / 2;
        const min = i * (CIRCLE + STACK_GAP);
        const max = height - (n - i) * (CIRCLE + STACK_GAP) + STACK_GAP;
        return Math.min(max, Math.max(min, raw));
      });
      setGeom((g) =>
        g.height === height && g.tops.every((t, i) => Math.abs(t - (tops[i] ?? 0)) < 0.5) && g.tops.length === n
          ? g
          : { height, tops },
      );
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };

    measure();
    const ro = new ResizeObserver(schedule);
    if (listRef.current) ro.observe(listRef.current);
    for (const el of boxRefs.current) if (el) ro.observe(el);
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      ro.disconnect();
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, [listRef, boxRefs, states.length]);

  const { height, tops } = geom;
  const current = states.indexOf('current');
  const filled = states.every((s) => s === 'done')
    ? height
    : current === -1
      ? 0
      : (tops[current] ?? 0) + CIRCLE / 2;

  return (
    <nav
      ref={railRef}
      aria-label="Tiến độ cài đặt"
      data-testid="setup-rail"
      className="sticky top-6 w-8 shrink-0 self-start max-sm:hidden"
      style={{ height: height || undefined }}
    >
      <span aria-hidden className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 rounded-full bg-shell-line" />
      <span
        aria-hidden
        data-testid="setup-rail-fill"
        className="absolute top-0 left-1/2 w-0.5 -translate-x-1/2 rounded-full bg-shell-accent transition-[height] duration-300 ease-out motion-reduce:transition-none"
        style={{ height: Math.max(0, Math.min(height, filled)) }}
      />

      <ol>
        {states.map((state, i) => (
          <li key={i} className="absolute left-0" style={{ top: tops[i] ?? 0 }}>
            <button
              type="button"
              disabled={state === 'future'}
              onClick={() => onJump(i)}
              aria-current={state === 'current' ? 'step' : undefined}
              aria-label={`Bước ${i + 1}${state === 'done' ? ' — đã xong' : state === 'current' ? ' — đang làm' : ''}`}
              data-testid={`setup-rail-step-${i}`}
              className={cn(
                'grid size-8 place-items-center rounded-full text-small font-semibold transition-colors duration-200',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-shell-accent',
                state === 'done' && 'bg-shell-accent text-shell-on-accent',
                state === 'current' && 'border-2 border-shell-accent bg-shell-panel text-shell-accent',
                state === 'future' && 'border-2 border-shell-line-strong bg-shell-panel text-shell-muted',
              )}
            >
              {state === 'done' ? <Icon name="check" size={16} /> : i + 1}
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** Vòng tròn nhỏ cạnh tiêu đề box — thay cho cột progress ở màn hẹp. */
export function StepDot({ index, state }: { index: number; state: StepState }) {
  return (
    <span
      aria-hidden
      className={cn(
        'grid size-6 shrink-0 place-items-center rounded-full text-mini font-semibold sm:hidden',
        state === 'done' && 'bg-shell-accent text-shell-on-accent',
        state === 'current' && 'border-2 border-shell-accent text-shell-accent',
        state === 'future' && 'border-2 border-shell-line-strong text-shell-muted',
      )}
    >
      {state === 'done' ? <Icon name="check" size={12} /> : index + 1}
    </span>
  );
}
