'use client';

/**
 * Ô nhập của design system: nhãn ở TRÊN ô, chú thích và lỗi ở DƯỚI, nối bằng
 * `aria-describedby`. Placeholder là ví dụ, không thay nhãn.
 *
 * Ba cỡ theo mật độ như nút: `lg` (dashboard, dialog), `md` (thanh công cụ), `sm`
 * (Inspector). `mono` cho slug, key, đường dẫn, email, URL.
 */

import { forwardRef, useId } from 'react';

import { cn } from '@/lib/builder/cn';
import { focusRing, ui } from '@/lib/builder/ui';

import { Icon, type IconName } from './Icon';
import { Kbd } from './Badge';

type Size = 'sm' | 'md' | 'lg';

const BOX: Record<Size, string> = { lg: ui.field, md: ui.fieldMd, sm: ui.fieldSm };

interface FieldShellProps {
  id: string;
  label?: React.ReactNode;
  hideLabel?: boolean;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}

/** Nhãn + ô + chú thích/lỗi, cho ô tự dựng (picker, ô màu) muốn cùng khuôn. */
export function FieldShell({ id, label, hideLabel, hint, error, className, children }: FieldShellProps) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      {label && (
        <label htmlFor={id} className={cn(ui.label, hideLabel && 'sr-only')}>
          {label}
        </label>
      )}
      {children}
      {hint && (
        <p id={`${id}-hint`} className={ui.hint}>
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-err`} className={ui.error}>
          {error}
        </p>
      )}
    </div>
  );
}

function describedBy(id: string, hint: unknown, error: unknown): string | undefined {
  return [hint ? `${id}-hint` : '', error ? `${id}-err` : ''].filter(Boolean).join(' ') || undefined;
}

type TextFieldProps = {
  label?: React.ReactNode;
  hideLabel?: boolean;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  mono?: boolean;
  size?: Size;
  icon?: IconName;
  /** Phần tử đứng cuối ô: nút hiện mật khẩu, phím tắt. */
  suffix?: React.ReactNode;
  wrapperClassName?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'>;

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, hideLabel, hint, error, mono, size = 'lg', icon, suffix, wrapperClassName, className, id: idProp, ...rest },
  ref,
) {
  const auto = useId();
  const id = idProp ?? auto;
  const input = (
    <input
      ref={ref}
      id={id}
      aria-invalid={error ? true : undefined}
      aria-describedby={describedBy(id, hint, error)}
      className={cn(
        BOX[size],
        mono && 'font-shell-mono',
        icon && (size === 'sm' ? 'pl-7' : 'pl-10'),
        suffix && 'pr-11',
        className,
      )}
      {...rest}
    />
  );
  return (
    <FieldShell id={id} label={label} hideLabel={hideLabel} hint={hint} error={error} className={wrapperClassName}>
      {icon || suffix ? (
        <div className="relative flex items-center">
          {icon && (
            <Icon
              name={icon}
              size={size === 'sm' ? 15 : 18}
              className={cn('pointer-events-none absolute text-shell-muted', size === 'sm' ? 'left-2' : 'left-3.5')}
            />
          )}
          {input}
          {suffix && <span className="absolute right-1.5 flex items-center">{suffix}</span>}
        </div>
      ) : (
        input
      )}
    </FieldShell>
  );
});

type TextAreaProps = {
  label?: React.ReactNode;
  hideLabel?: boolean;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  mono?: boolean;
  size?: Size;
  wrapperClassName?: string;
} & React.TextareaHTMLAttributes<HTMLTextAreaElement>;

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
  { label, hideLabel, hint, error, mono, size = 'lg', wrapperClassName, className, id: idProp, ...rest },
  ref,
) {
  const auto = useId();
  const id = idProp ?? auto;
  return (
    <FieldShell id={id} label={label} hideLabel={hideLabel} hint={hint} error={error} className={wrapperClassName}>
      <textarea
        ref={ref}
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        className={cn(BOX[size], ui.textarea, mono && 'font-shell-mono', className)}
        {...rest}
      />
    </FieldShell>
  );
});

/** Ô tìm kiếm: icon kính lúp, nhãn ẩn, phím tắt tuỳ chọn. `soft` cho ô tìm toàn cục. */
export const SearchField = forwardRef<
  HTMLInputElement,
  Omit<TextFieldProps, 'icon' | 'type'> & { shortcut?: string; soft?: boolean }
>(function SearchField({ label = 'Tìm kiếm', shortcut, soft, className, ...rest }, ref) {
  return (
    <TextField
      ref={ref}
      type="search"
      icon="search"
      label={label}
      hideLabel
      suffix={shortcut ? <Kbd className="mr-1.5">{shortcut}</Kbd> : undefined}
      className={cn(soft && 'border-transparent shadow-shell-card hover:border-transparent', className)}
      {...rest}
    />
  );
});

type SelectProps = {
  label?: React.ReactNode;
  hideLabel?: boolean;
  hint?: React.ReactNode;
  size?: Size;
  options?: readonly (string | { value: string; label: string })[];
  wrapperClassName?: string;
} & Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'size'>;

/** `<select>` gốc, cho danh sách ngắn đã biết. Danh sách dài cần tìm thì dùng popover. */
export const SelectField = forwardRef<HTMLSelectElement, SelectProps>(function SelectField(
  { label, hideLabel, hint, size = 'lg', options, wrapperClassName, className, id: idProp, children, ...rest },
  ref,
) {
  const auto = useId();
  const id = idProp ?? auto;
  return (
    <FieldShell id={id} label={label} hideLabel={hideLabel} hint={hint} className={wrapperClassName}>
      <div className="relative flex items-center">
        <select
          ref={ref}
          id={id}
          aria-describedby={describedBy(id, hint, undefined)}
          className={cn(BOX[size], 'cursor-pointer appearance-none', size === 'sm' ? 'pr-7' : 'pr-10', className)}
          {...rest}
        >
          {options
            ? options.map((o) =>
                typeof o === 'string' ? (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ) : (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ),
              )
            : children}
        </select>
        <Icon
          name="chevron-down"
          size={16}
          className={cn('pointer-events-none absolute text-shell-muted', size === 'sm' ? 'right-2' : 'right-3')}
        />
      </div>
    </FieldShell>
  );
});

/** Ô đánh dấu thật; `round` khi chọn thẻ để thao tác hàng loạt. */
export const Checkbox = forwardRef<
  HTMLInputElement,
  { label?: React.ReactNode; hideLabel?: boolean; round?: boolean; wrapperClassName?: string } & Omit<
    React.InputHTMLAttributes<HTMLInputElement>,
    'type'
  >
>(function Checkbox({ label, hideLabel, round, wrapperClassName, className, ...rest }, ref) {
  return (
    <label className={cn('inline-flex min-h-control-sm cursor-pointer items-center gap-2.5 text-ui', wrapperClassName)}>
      <input
        ref={ref}
        type="checkbox"
        className={cn(
          'grid size-4.5 shrink-0 cursor-pointer appearance-none place-content-center border-[1.8px] border-shell-line-strong bg-shell-panel transition-colors',
          'checked:border-shell-accent checked:bg-shell-accent',
          "after:h-1.5 after:w-2.5 after:-translate-y-px after:-rotate-45 after:border-b-[2.4px] after:border-l-[2.4px] after:border-shell-on-accent after:opacity-0 after:content-[''] checked:after:opacity-100",
          'disabled:cursor-not-allowed disabled:opacity-40',
          focusRing,
          round ? 'rounded-full' : 'rounded-[5px]',
          className,
        )}
        {...rest}
      />
      {label && <span className={cn(hideLabel && 'sr-only')}>{label}</span>}
    </label>
  );
});

/** Công tắc có hiệu lực ngay (không có nút Lưu đi sau). */
export function Switch({
  label,
  checked,
  onChange,
  disabled,
  className,
}: {
  label: React.ReactNode;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  className?: string;
}) {
  const id = useId();
  return (
    <span className={cn('inline-flex items-center gap-2.5 text-ui', className)}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={`${id}-l`}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative h-6 w-10 shrink-0 rounded-full border-[1.8px] transition-colors disabled:cursor-not-allowed disabled:opacity-40',
          focusRing,
          checked ? 'border-shell-accent bg-shell-accent' : 'border-shell-line-strong bg-shell-raised',
        )}
      >
        <span
          aria-hidden
          className={cn(
            'absolute top-0.5 left-0.5 size-4 rounded-full transition-transform',
            checked ? 'translate-x-4 bg-shell-on-accent' : 'bg-shell-line-strong',
          )}
        />
      </button>
      <span id={`${id}-l`}>{label}</span>
    </span>
  );
}
