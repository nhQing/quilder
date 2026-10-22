'use client';

/**
 * Lớp nổi của design system: Dialog, ConfirmDialog, Menu, Toast, Popover.
 *
 * Dialog dựng trên `<dialog>` + `showModal()` — KHÔNG tự dựng overlay bằng `div fixed`
 * (xem `dialog:modal` trong builder.css). Esc, nút X và "Huỷ"/"Đóng" đều gọi `onClose`.
 * Hàng nút căn phải, nút chính ngoài cùng bên phải.
 */

import { useEffect, useId, useRef, useState } from 'react';

import { cn } from '@/lib/builder/cn';
import { ui } from '@/lib/builder/ui';

import { Button, IconButton } from './Button';
import { TextField } from './Field';
import { Icon, type IconName } from './Icon';
import { Kbd } from './Badge';

const DIALOG_SIZE = { sm: 'w-[min(26rem,92vw)]', md: 'w-[min(35rem,92vw)]', lg: 'w-[min(51rem,94vw)]' } as const;

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  actions,
  size = 'md',
  dismissable = true,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  actions?: React.ReactNode;
  size?: keyof typeof DIALOG_SIZE;
  /** `false` khi đang chạy một việc không được ngắt (đang xoá…): Esc và X bị chặn. */
  dismissable?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const base = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={`${base}-t`}
      aria-describedby={description ? `${base}-d` : undefined}
      onClose={onClose}
      onCancel={(e) => {
        if (!dismissable) e.preventDefault();
      }}
      className={cn(ui.dialog, DIALOG_SIZE[size], className)}
    >
      <div className="relative flex flex-col gap-5 p-6">
        <div className="flex flex-col gap-1.5 pr-10">
          <h2 id={`${base}-t`} className="text-section font-semibold text-balance">
            {title}
          </h2>
          {description && (
            <div id={`${base}-d`} className="text-ui leading-relaxed text-shell-muted">
              {description}
            </div>
          )}
        </div>
        {children && <div className="flex min-w-0 flex-col gap-4">{children}</div>}
        {actions && <div className="flex flex-wrap justify-end gap-2">{actions}</div>}
        {/* Nút X đứng CUỐI trong DOM (dù hiện ở góc trên): `showModal()` đưa focus vào
            phần tử bấm được đầu tiên, và đó phải là ô nhập đầu tiên chứ không phải nút đóng. */}
        {dismissable && <IconButton icon="x" label="Đóng" onClick={onClose} className="absolute top-4 right-4" />}
      </div>
    </dialog>
  );
}

/**
 * Xác nhận hành động không lùi được. `consequence` nói điều sẽ xảy ra bằng con số
 * thật; `typeToConfirm` bắt gõ lại tên/khoá trước khi nút bật.
 */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  consequence,
  confirmLabel,
  cancelLabel = 'Huỷ',
  typeToConfirm,
  busy,
  children,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  consequence?: React.ReactNode;
  confirmLabel: React.ReactNode;
  cancelLabel?: string;
  typeToConfirm?: string;
  busy?: boolean;
  children?: React.ReactNode;
}) {
  const [typed, setTyped] = useState('');
  useEffect(() => {
    if (!open) setTyped('');
  }, [open]);
  // NFC hai phía: bộ gõ tiếng Việt có thể gửi "xoá" dạng tổ hợp (o + dấu rời), trông y
  // hệt nhưng khác byte — so thô thì nút không bao giờ bật và người dùng không hiểu vì sao.
  const ok = !typeToConfirm || typed.normalize('NFC').trim() === typeToConfirm.normalize('NFC');
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size="sm"
      dismissable={!busy}
      actions={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button variant="danger-solid" onClick={onConfirm} disabled={!ok} loading={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {consequence && <Consequence>{consequence}</Consequence>}
      {children}
      {typeToConfirm && (
        <TextField
          label={
            <>
              Gõ <span className="font-shell-mono">{typeToConfirm}</span> để xác nhận
            </>
          }
          mono
          autoComplete="off"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder={typeToConfirm}
        />
      )}
    </Dialog>
  );
}

/** Khối hậu quả nền `shell-danger-soft` cho dialog phá huỷ. */
export function Consequence({ children, tone = 'danger' }: { children: React.ReactNode; tone?: 'danger' | 'warn' }) {
  return (
    <div
      className={cn(
        'flex gap-3 rounded-lg px-4 py-3.5 text-small leading-relaxed text-shell-ink',
        tone === 'danger' ? 'bg-shell-danger-soft' : 'bg-shell-warn-soft',
      )}
    >
      <Icon
        name="alert"
        size={18}
        className={cn('mt-px', tone === 'danger' ? 'text-shell-danger' : 'text-shell-warn')}
      />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export type MenuEntry =
  | {
      label: React.ReactNode;
      icon?: IconName;
      shortcut?: string;
      danger?: boolean;
      disabled?: boolean;
      checked?: boolean;
      onSelect?: () => void;
      href?: string;
    }
  | { separator: true }
  | { group: React.ReactNode };

/** Danh sách hành động bật lên; mục phá huỷ đứng cuối, sau một vạch ngăn. */
export function MenuList({
  label,
  items,
  className,
  onDone,
}: {
  label: string;
  items: readonly MenuEntry[];
  className?: string;
  /** Gọi sau khi chọn một mục — chỗ đóng menu. */
  onDone?: () => void;
}) {
  return (
    <div role="menu" aria-label={label} className={cn(ui.pop, 'flex min-w-56 flex-col p-1.5', className)}>
      {items.map((it, i) => {
        if ('separator' in it) return <div key={i} role="separator" className="mx-1 my-1.5 h-px bg-shell-line" />;
        if ('group' in it)
          return (
            <div key={i} aria-hidden className={cn(ui.eyebrow, 'px-2.5 pt-2 pb-1')}>
              {it.group}
            </div>
          );
        const cls = cn(
          ui.menuItem,
          it.danger && 'text-shell-danger hover:bg-shell-danger-soft [&_svg]:text-shell-danger',
          '[&_svg]:text-shell-muted',
        );
        const body = (
          <>
            {it.icon && <Icon name={it.icon} size={17} />}
            <span className="min-w-0 flex-1 truncate">{it.label}</span>
            {it.shortcut && <Kbd>{it.shortcut}</Kbd>}
            {it.checked && <Icon name="check" size={16} className="text-shell-accent" />}
          </>
        );
        return it.href ? (
          <a key={i} role="menuitem" href={it.href} className={cls} onClick={onDone}>
            {body}
          </a>
        ) : (
          <button
            key={i}
            type="button"
            role={it.checked === undefined ? 'menuitem' : 'menuitemradio'}
            aria-checked={it.checked === undefined ? undefined : it.checked}
            disabled={it.disabled}
            className={cls}
            onClick={() => {
              it.onSelect?.();
              onDone?.();
            }}
          >
            {body}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Nút "…" mở `MenuList`. Đóng khi bấm ra ngoài hoặc Esc; focus trả về nút.
 * Menu căn theo mép phải của nút (`align="end"`) khi nút ở cạnh phải thẻ.
 */
export function MenuButton({
  label,
  items,
  icon = 'more',
  align = 'end',
  size = 'md',
  className,
  triggerClassName,
}: {
  label: string;
  items: readonly MenuEntry[];
  icon?: IconName;
  align?: 'start' | 'end';
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  /** Class cho nút mở menu — vd. nền đặc khi nút nằm đè lên ảnh thu nhỏ. */
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  return (
    <div ref={root} className={cn('relative inline-flex', className)}>
      <IconButton
        ref={trigger}
        icon={icon}
        label={label}
        size={size}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={triggerClassName}
      />
      {open && (
        <div className={cn('absolute top-full z-30 mt-1', align === 'end' ? 'right-0' : 'left-0')}>
          <MenuList label={label} items={items} onDone={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}

const TOAST_ICON = { ok: 'check-circle', warn: 'alert', danger: 'alert', neutral: 'info' } as const;

/** Thông báo ngắn sau một hành động. Đặt trong `ToastRegion` ở góc dưới phải. */
export function Toast({
  tone = 'neutral',
  title,
  description,
  action,
  onClose,
}: {
  tone?: keyof typeof TOAST_ICON;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: { label: string; onClick: () => void };
  onClose?: () => void;
}) {
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn(ui.pop, 'flex w-[min(22.5rem,calc(100vw-2rem))] items-start gap-3 py-3.5 pr-3.5 pl-4')}
    >
      <Icon
        name={TOAST_ICON[tone]}
        size={20}
        className={cn(
          'mt-px',
          tone === 'ok' && 'text-shell-ok',
          tone === 'warn' && 'text-shell-warn',
          tone === 'danger' && 'text-shell-danger',
          tone === 'neutral' && 'text-shell-accent',
        )}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-ui font-semibold">{title}</span>
        {description && <span className="text-small text-shell-muted">{description}</span>}
        {action && (
          <Button variant="ghost" size="sm" className="mt-1.5 self-start" onClick={action.onClick}>
            {action.label}
          </Button>
        )}
      </div>
      {onClose && <IconButton icon="x" label="Đóng thông báo" size="sm" onClick={onClose} />}
    </div>
  );
}

/** Góc dưới phải, chồng tối đa vài toast; cái mới nhất ở dưới cùng. */
export function ToastRegion({ children }: { children: React.ReactNode }) {
  return (
    <div aria-live="polite" className="fixed right-4 bottom-4 z-50 flex flex-col items-end gap-2">
      {children}
    </div>
  );
}

/**
 * Bảng nổi KHÔNG modal, neo dưới một nút: nội dung tự do (link, form nhỏ), không phải
 * danh sách hành động — thứ đó là `MenuButton`.
 *
 * Đóng khi bấm ra ngoài hoặc Esc; Esc trả focus về nút mở. Mở ra thì focus nhảy vào
 * bảng, để người dùng bàn phím Tab tới ngay nội dung bên trong thay vì phải đi qua
 * cả phần còn lại của thanh công cụ.
 *
 * `trigger` là render-prop chứ không phải một nút dựng sẵn: chỗ dùng chọn kiểu nút
 * (`Button` có chữ, `IconButton`…), Popover chỉ cấp `ref` và các thuộc tính ARIA.
 */
export function Popover({
  label,
  align = 'end',
  className,
  panelClassName,
  trigger,
  children,
}: {
  /** Tên trợ năng của bảng. */
  label: string;
  align?: 'start' | 'end';
  className?: string;
  panelClassName?: string;
  trigger: (p: {
    ref: React.RefObject<HTMLButtonElement | null>;
    onClick: () => void;
    'aria-expanded': boolean;
    'aria-haspopup': 'dialog';
    'aria-controls': string;
  }) => React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    panel.current?.focus();
    const away = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  return (
    <div ref={root} className={cn('relative inline-flex', className)}>
      {trigger({
        ref: button,
        onClick: () => setOpen((o) => !o),
        'aria-expanded': open,
        'aria-haspopup': 'dialog',
        'aria-controls': id,
      })}
      {open && (
        <div
          ref={panel}
          id={id}
          role="dialog"
          aria-label={label}
          tabIndex={-1}
          className={cn(
            ui.pop,
            'absolute top-full z-30 mt-1.5 focus-visible:outline-none',
            align === 'end' ? 'right-0' : 'left-0',
            panelClassName,
          )}
        >
          {children}
        </div>
      )}
    </div>
  );
}
