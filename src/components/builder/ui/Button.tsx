/**
 * Nút của design system "Quilder UI": `Button` (có chữ) và `IconButton`.
 *
 * Ba cỡ theo mật độ: `lg` 44px ở dashboard và dialog, `md` 36px trên thanh công cụ,
 * `sm` 28px trong panel editor. Bậc màu giống `btn.ts` — xem luật dùng ở đó.
 * Không có `'use client'`: dùng được trong server component (khi không truyền handler).
 */

import Link from 'next/link';
import { forwardRef } from 'react';

import { cn } from '@/lib/builder/cn';
import { focusRing } from '@/lib/builder/ui';

import { Icon, type IconName } from './Icon';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-solid';
export type ControlSize = 'sm' | 'md' | 'lg';

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-shell-accent text-shell-on-accent hover:brightness-110',
  secondary: 'border border-shell-line-strong bg-shell-panel text-shell-ink hover:bg-shell-raised',
  ghost: 'text-shell-ink hover:bg-shell-raised',
  danger: 'border border-shell-danger bg-shell-panel text-shell-danger hover:bg-shell-danger-soft',
  'danger-solid': 'bg-shell-danger text-shell-on-danger hover:brightness-110',
};

const SIZE: Record<ControlSize, string> = {
  lg: 'h-control-lg gap-2 rounded-md px-4.5 text-ui',
  md: 'h-control-md gap-2 rounded-md px-3.5 text-small',
  sm: 'h-control-sm gap-1.5 rounded px-2.5 text-small',
};

export function buttonClass(variant: ButtonVariant = 'secondary', size: ControlSize = 'lg', className?: string) {
  return cn(
    'inline-flex shrink-0 items-center justify-center whitespace-nowrap font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 aria-disabled:cursor-not-allowed aria-disabled:opacity-40',
    focusRing,
    SIZE[size],
    VARIANT[variant],
    className,
  );
}

type ButtonOwn = {
  variant?: ButtonVariant;
  size?: ControlSize;
  icon?: IconName;
  iconRight?: IconName;
  /** Đang chạy: hiện vòng quay và khoá nút. Đổi cả nhãn nếu được ("Đang kiểm tra…"). */
  loading?: boolean;
  full?: boolean;
};

export function Button({
  variant = 'secondary',
  size = 'lg',
  icon,
  iconRight,
  loading,
  full,
  className,
  children,
  type = 'button',
  disabled,
  ...rest
}: ButtonOwn & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const iconSize = size === 'sm' ? 15 : 18;
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClass(variant, size, cn(full && 'w-full', className))}
      {...rest}
    >
      {loading ? <Spinner /> : icon ? <Icon name={icon} size={iconSize} /> : null}
      {children}
      {iconRight && <Icon name={iconRight} size={iconSize} />}
    </button>
  );
}

/** Nút trông như Button nhưng là một link sang màn khác. */
export function ButtonLink({
  href,
  variant = 'secondary',
  size = 'lg',
  icon,
  iconRight,
  full,
  className,
  children,
  ...rest
}: ButtonOwn & { href: string } & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>) {
  const iconSize = size === 'sm' ? 15 : 18;
  return (
    <Link href={href} className={buttonClass(variant, size, cn(full && 'w-full', className))} {...rest}>
      {icon && <Icon name={icon} size={iconSize} />}
      {children}
      {iconRight && <Icon name={iconRight} size={iconSize} />}
    </Link>
  );
}

const ICON_SIZE: Record<ControlSize, string> = {
  lg: 'size-control-lg rounded-md',
  md: 'size-control-md rounded',
  sm: 'size-control-sm rounded-sm',
};

/**
 * Nút chỉ có icon. `label` bắt buộc và thành cả `aria-label` lẫn `title`.
 * `variant="surface"` khi nút đứng một mình trên `shell-bg`; `pressed` cho công tắc.
 */
export const IconButton = forwardRef<
  HTMLButtonElement,
  {
    label: string;
    icon: IconName;
    size?: ControlSize;
    variant?: 'ghost' | 'surface' | 'primary' | 'danger';
    pressed?: boolean;
  } & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'>
>(function IconButton({ label, icon, size = 'md', variant = 'ghost', pressed, className, type = 'button', ...rest }, ref) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      aria-pressed={pressed === undefined ? undefined : pressed}
      className={cn(
        'inline-grid shrink-0 place-items-center text-shell-muted transition-colors hover:bg-shell-raised hover:text-shell-ink disabled:cursor-not-allowed disabled:opacity-40',
        focusRing,
        ICON_SIZE[size],
        variant === 'surface' && 'bg-shell-panel shadow-shell-card hover:bg-shell-panel',
        variant === 'primary' && 'bg-shell-accent text-shell-on-accent hover:bg-shell-accent hover:text-shell-on-accent hover:brightness-110',
        variant === 'danger' && 'text-shell-danger hover:bg-shell-danger-soft hover:text-shell-danger',
        pressed && 'bg-shell-panel text-shell-accent shadow-shell-card hover:bg-shell-panel hover:text-shell-accent',
        className,
      )}
      {...rest}
    >
      <Icon name={icon} size={size === 'sm' ? 16 : size === 'lg' ? 20 : 18} />
    </button>
  );
});

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('size-4 shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent', className)}
    />
  );
}
