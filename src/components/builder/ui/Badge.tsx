/**
 * Phần tử nhỏ báo trạng thái hoặc danh tính: Badge, Kbd, Avatar, Progress, Tile.
 *
 * Badge viết thường đầu câu ("đang chạy", "nháp"). Màu chỉ đi kèm chữ — trạng thái
 * không bao giờ là một chấm màu đứng một mình.
 */

import { cn } from '@/lib/builder/cn';
import { tintAt, ui, type Tone } from '@/lib/builder/ui';

import { Icon, type IconName } from './Icon';

export function Badge({
  tone = 'neutral',
  dot,
  size,
  className,
  children,
  ...rest
}: {
  tone?: Tone;
  dot?: boolean;
  size?: 'sm';
  children: React.ReactNode;
} & Omit<React.HTMLAttributes<HTMLSpanElement>, 'children'>) {
  // `...rest` để giữ được `data-*`, `title`, `aria-*` mà test hoặc tooltip cần.
  return (
    <span className={cn(ui.chip, ui.tone[tone], size === 'sm' && 'px-2 py-px text-micro', className)} {...rest}>
      {dot && <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-current" />}
      {children}
    </span>
  );
}

export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        'font-shell-mono rounded-sm border border-shell-line-strong bg-shell-panel px-1.5 text-micro whitespace-nowrap text-shell-muted',
        className,
      )}
    >
      {children}
    </kbd>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0];
  if (!first) return '?';
  const a = first.charAt(0);
  const b = parts.length > 1 ? (parts[parts.length - 1] ?? '').charAt(0) : '';
  return (a + b).toUpperCase();
}

const AVATAR = { sm: 'size-7 text-micro', md: 'size-9.5 text-small', lg: 'size-14 text-section' } as const;

/** Ảnh đại diện tròn; chữ cái đầu khi chưa có ảnh. `aria-hidden` khi tên đã in cạnh. */
export function Avatar({
  name,
  src,
  size = 'md',
  index,
  className,
}: {
  name: string;
  src?: string | null;
  size?: keyof typeof AVATAR;
  /** Vị trí trong danh sách — chọn màu nền xoay vòng. Bỏ trống thì dùng accent. */
  index?: number;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-grid shrink-0 place-items-center overflow-hidden rounded-full font-bold',
        index === undefined ? 'bg-shell-accent-soft text-shell-accent' : tintAt(index),
        AVATAR[size],
        className,
      )}
    >
      {src ? (
        // Ảnh avatar đã là ảnh nhỏ trong kho asset; next/image không thêm được gì.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="size-full object-cover" />
      ) : (
        initials(name)
      )}
    </span>
  );
}

/** Thanh tiến độ mỏng có nhãn: SEO đủ mấy mục, bản dịch được bao nhiêu phần trăm. */
export function Progress({
  value,
  max = 100,
  label,
  valueLabel,
  tone,
  className,
}: {
  value: number;
  max?: number;
  label?: string;
  valueLabel?: React.ReactNode;
  tone?: 'ok' | 'warn' | 'danger';
  className?: string;
}) {
  const pct = Math.max(0, Math.min(100, Math.round((value / (max || 1)) * 100)));
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      {(label || valueLabel !== undefined) && (
        <div className="flex justify-between gap-2 text-mini text-shell-muted">
          <span>{label}</span>
          <span>{valueLabel ?? `${pct}%`}</span>
        </div>
      )}
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
        className="h-1.5 overflow-hidden rounded-full bg-shell-line"
      >
        <div
          className={cn(
            'h-full rounded-full',
            tone === 'ok'
              ? 'bg-shell-ok'
              : tone === 'warn'
                ? 'bg-shell-warn'
                : tone === 'danger'
                  ? 'bg-shell-danger'
                  : 'bg-shell-accent',
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

/** Ô vuông màu ở đầu thẻ: chữ cái đầu, hoặc một icon. */
export function Tile({
  index = 0,
  icon,
  children,
  size = 'md',
  className,
}: {
  index?: number;
  icon?: IconName;
  children?: React.ReactNode;
  size?: 'sm' | 'md';
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'grid shrink-0 place-items-center font-bold',
        size === 'md' ? 'size-11 rounded-md text-[1.0625rem]' : 'size-9 rounded text-small',
        tintAt(index),
        className,
      )}
    >
      {icon ? <Icon name={icon} size={size === 'md' ? 22 : 18} /> : children}
    </span>
  );
}
