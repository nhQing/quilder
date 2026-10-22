'use client';

/**
 * Nhóm nút lọc liền nhau, mỗi nút có số đếm (Tất cả · Đang chạy · Có thay đổi…).
 *
 * Là `role="group"` + `aria-pressed`, KHÔNG phải tablist: thứ bên dưới vẫn là cùng một
 * danh sách, chỉ được lọc. Mục đầu luôn là "Tất cả". Số đếm là số thật, kể cả 0.
 *
 * `LinkTabs` cùng hình nhưng mỗi mục là một LINK sang route khác (Tài khoản · Kết nối
 * Claude): đổi mục là đổi trang, nên nó là `nav` + `aria-current`, không phải nút bấm.
 */

import Link from 'next/link';

import { cn } from '@/lib/builder/cn';
import { focusRing } from '@/lib/builder/ui';

export interface TabItem<T extends string = string> {
  id: T;
  label: React.ReactNode;
  count?: number | string;
  /** Thuộc tính `data-*` gắn lên nút của mục này (selector cho test, đo đạc). */
  data?: Record<`data-${string}`, string>;
}

const GROUP = 'inline-flex max-w-full gap-1 overflow-x-auto rounded-lg bg-shell-raised p-1';

function itemClass(on: boolean, size: 'sm' | 'md') {
  return cn(
    'inline-flex shrink-0 items-center gap-2 whitespace-nowrap font-medium text-shell-muted transition-colors hover:text-shell-ink',
    /*
     * Bo ĐỒNG TÂM với nhóm: bán kính nhóm (`rounded-lg`) trừ đúng phần đệm `p-1`.
     * Nút bo nhỏ hơn thế (6px trong nhóm 20px) thì ở hai đầu, góc của nút đang chọn
     * không chạy theo đường cong của nhóm — trông như vỡ.
     *
     * Vòng focus vẽ VÀO TRONG nút (`outline-offset` âm): `focusRing` mặc định nằm
     * ngoài 4px, bằng đúng phần đệm, nên ở nút đầu/cuối nó chạm mép cong của nhóm
     * và bị `overflow-x-auto` cắt mất một phần.
     */
    'rounded-[calc(var(--radius-lg)-0.25rem)]',
    focusRing,
    'focus-visible:outline-offset-[-2px]',
    size === 'md' ? 'min-h-10 px-3.5 text-ui' : 'h-control-sm px-2.5 text-small',
    on && 'bg-shell-panel font-semibold text-shell-ink shadow-shell-card',
  );
}

function Count({ value, on }: { value: number | string; on: boolean }) {
  return (
    <span
      className={cn(
        'min-w-5.5 rounded-full px-1.5 text-center text-micro font-semibold',
        on ? 'bg-shell-accent text-shell-on-accent' : 'bg-shell-line text-shell-muted',
      )}
    >
      {value}
    </span>
  );
}

export function Tabs<T extends string>({
  label,
  items,
  value,
  onChange,
  size = 'md',
  className,
}: {
  label: string;
  items: readonly TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  size?: 'sm' | 'md';
  className?: string;
}) {
  return (
    <div role="group" aria-label={label} className={cn(GROUP, className)}>
      {items.map((it) => {
        const on = it.id === value;
        return (
          <button
            key={it.id}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(it.id)}
            {...it.data}
            className={itemClass(on, size)}
          >
            {it.label}
            {it.count !== undefined && <Count value={it.count} on={on} />}
          </button>
        );
      })}
    </div>
  );
}

export function LinkTabs<T extends string>({
  label,
  items,
  value,
  size = 'md',
  className,
}: {
  label: string;
  items: readonly (TabItem<T> & { href: string })[];
  value: T;
  size?: 'sm' | 'md';
  className?: string;
}) {
  return (
    <nav aria-label={label} className={cn(GROUP, className)}>
      {items.map((it) => {
        const on = it.id === value;
        return (
          <Link
            key={it.id}
            href={it.href}
            aria-current={on ? 'page' : undefined}
            {...it.data}
            className={itemClass(on, size)}
          >
            {it.label}
            {it.count !== undefined && <Count value={it.count} on={on} />}
          </Link>
        );
      })}
    </nav>
  );
}
