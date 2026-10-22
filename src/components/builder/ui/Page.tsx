/**
 * Khung của một màn dashboard: tiêu đề, đường dẫn, mô tả, hành động; cùng
 * `Section` và `EmptyState`.
 *
 * `page-title` dùng đúng một lần mỗi màn, số đếm đặt trong ngoặc màu `shell-muted`.
 * Mọi màn không có canvas dùng `PageShell` để có cùng lề và cùng nhịp khoảng cách.
 */

import Link from 'next/link';

import { cn } from '@/lib/builder/cn';
import { ui } from '@/lib/builder/ui';

import { Icon, type IconName } from './Icon';

export function PageShell({
  children,
  width = 'default',
  className,
}: {
  children: React.ReactNode;
  width?: 'default' | 'wide' | 'narrow';
  className?: string;
}) {
  return (
    <main
      className={cn(
        width === 'wide' ? 'shell-page-wide' : width === 'narrow' ? 'shell-page-narrow' : 'shell-page',
        'flex min-w-0 flex-col gap-6 px-2 py-3 sm:px-4',
        className,
      )}
    >
      {children}
    </main>
  );
}

export interface Crumb {
  label: React.ReactNode;
  href?: string;
}

export function Breadcrumb({ items, home }: { items: readonly Crumb[]; home?: boolean }) {
  return (
    <nav aria-label="Đường dẫn">
      <ol className="flex flex-wrap items-center gap-1 text-small text-shell-muted">
        {home && (
          <li className="inline-flex">
            <Icon name="home" size={15} />
          </li>
        )}
        {items.map((c, i) => {
          const last = i === items.length - 1;
          return (
            <li key={i} className="inline-flex items-center gap-1">
              {(i > 0 || home) && <Icon name="chevron-right" size={14} />}
              {/* Mục có `href` luôn là link, kể cả mục cuối: `PageHead` chỉ liệt kê
                  khu CHA (tiêu đề trang đứng riêng), nên mục cuối thường là đường về. */}
              {!c.href ? (
                <span aria-current={last ? 'page' : undefined} className={cn(last && 'font-semibold text-shell-ink')}>
                  {c.label}
                </span>
              ) : (
                <Link href={c.href} className="rounded-sm px-0.5 hover:text-shell-ink">
                  {c.label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function PageHeader({
  title,
  count,
  description,
  crumbs,
  actions,
  className,
}: {
  title: React.ReactNode;
  count?: React.ReactNode;
  description?: React.ReactNode;
  crumbs?: readonly Crumb[];
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn('flex flex-wrap items-end gap-4', className)}>
      {/* Basis 20rem chứ không lớn hơn: ở khổ ~1024 phần nội dung còn ~720px, basis lớn
          đẩy cụm nút xuống dòng dưới dù vẫn còn chỗ cạnh tiêu đề. */}
      <div className="flex min-w-0 flex-[1_1_20rem] flex-col gap-2">
        {crumbs && crumbs.length > 0 && <Breadcrumb items={crumbs} />}
        <h1 className="text-page font-bold text-balance">
          {title}
          {count !== undefined && <span className="font-medium text-shell-muted"> ({count})</span>}
        </h1>
        {description && <div className="max-w-[78ch] text-ui leading-relaxed text-shell-muted">{description}</div>}
      </div>
      {actions && <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/** Một nhóm trong màn: tiêu đề `section-title` + số đếm, tuỳ chọn mô tả và hành động. */
export function Section({
  title,
  count,
  description,
  actions,
  children,
  className,
  id,
}: {
  title: React.ReactNode;
  count?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section aria-labelledby={id} className={cn('flex min-w-0 flex-col gap-3.5', className)}>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 id={id} className="text-section font-semibold">
            {title}
            {count !== undefined && <span className="ml-2 font-medium text-shell-muted">{count}</span>}
          </h2>
          {description && <p className="text-small text-shell-muted">{description}</p>}
        </div>
        {actions && <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

/** Thay cho danh sách rỗng: nói vì sao rỗng và bước tiếp theo nếu có. */
export function EmptyState({
  icon = 'check',
  title,
  description,
  action,
  className,
  compact,
}: {
  icon?: IconName;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        ui.card,
        'flex flex-col items-center gap-2.5 text-center',
        compact ? 'px-5 py-8' : 'px-6 py-14',
        className,
      )}
    >
      <span className="grid size-14 place-items-center rounded-md bg-shell-accent-soft text-shell-accent">
        <Icon name={icon} size={26} />
      </span>
      <h2 className="text-section font-semibold text-balance">{title}</h2>
      {description && <p className="max-w-[46ch] text-ui text-shell-muted">{description}</p>}
      {action}
    </div>
  );
}
