/**
 * Dải thông báo nền nhạt có icon: cảnh báo, lỗi, xác nhận.
 *
 * ## Vì sao nằm ở `ui/`, không ở `FieldInput`
 *
 * Nó từng được khai trong `FieldInput.tsx`, và `SchemaEditor` import nó từ đó. Một dải
 * chữ có icon kéo theo cả `FieldInput` — ô bài viết, ô chọn ảnh và mọi thứ chúng
 * import — vào màn Cấu trúc: route `/builder/content/types/[key]` phình lên 3281
 * module, biên dịch lần đầu mất 12.5s và làm `collection-admin.spec.ts` quá giờ chờ.
 * Component dùng chung phải sống ở chỗ không import gì nặng.
 */

import { cn } from '@/lib/builder/cn';

import { Icon, type IconName } from './Icon';

const NOTE: Record<'warn' | 'danger' | 'ok' | 'info', { box: string; icon: IconName; tint: string }> = {
  warn: { box: 'bg-shell-warn-soft', icon: 'info', tint: 'text-shell-warn' },
  danger: { box: 'bg-shell-danger-soft', icon: 'alert', tint: 'text-shell-danger' },
  ok: { box: 'bg-shell-ok-soft', icon: 'check-circle', tint: 'text-shell-ok' },
  info: { box: 'bg-shell-accent-soft', icon: 'info', tint: 'text-shell-accent' },
};

/**
 * Chữ luôn `shell-ink` — màu trạng thái chỉ nằm ở icon và nền, nên đoạn dài vẫn đọc
 * được ở cả hai theme.
 */
export function Note({
  tone = 'warn',
  icon,
  role,
  className,
  children,
}: {
  tone?: keyof typeof NOTE;
  icon?: IconName;
  role?: 'note' | 'alert' | 'status';
  className?: string;
  children: React.ReactNode;
}) {
  const t = NOTE[tone];
  return (
    <div
      role={role}
      className={cn('flex items-start gap-3 rounded-lg px-4 py-3 text-small leading-relaxed text-shell-ink', t.box, className)}
    >
      <Icon name={icon ?? t.icon} size={18} className={cn('mt-px', t.tint)} />
      <div className="flex min-w-0 flex-1 flex-col gap-2">{children}</div>
    </div>
  );
}
