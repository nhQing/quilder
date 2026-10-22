/**
 * Khung đang tải: đúng hình dạng của thứ sắp hiện, một dải sáng chạy qua.
 *
 * Dùng THAY cho chữ "đang nạp…" ở chỗ nào hình dạng của nội dung biết trước — khung
 * ảnh, ô lưới, một dòng tên file. Bên gọi đặt kích thước và bo góc qua `className`;
 * hiệu ứng nằm ở utility `shell-skeleton` (`builder.css`).
 *
 * `aria-hidden`: khung không nói gì với screen reader. Vùng chứa nó tự khai
 * `aria-busy` khi cần báo "đang tải".
 *
 * Phần dưới (`SkeletonPage`, `SkeletonHeader`, `SkeletonText`) là khung của CẢ MỘT MÀN,
 * dùng ở các file `loading.tsx` qua `RouteSkeleton.tsx`.
 */

import { cn } from '@/lib/builder/cn';

export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden className={cn('shell-skeleton block rounded', className)} />;
}

const TEXT = {
  page: 'text-page',
  section: 'text-section',
  card: 'text-card',
  ui: 'text-ui',
  small: 'text-small',
  mini: 'text-mini',
  micro: 'text-micro',
} as const;

/**
 * Một dòng chữ sắp hiện: CAO ĐÚNG một dòng của cỡ chữ đó, vạch sáng bằng ~¾ chiều cao chữ.
 *
 * Chiều cao lấy từ chính token chữ (`text-page` mang sẵn line-height của nó), không từ một
 * con số `h-*` đoán bằng mắt — nên khi chữ thật thay vào, dòng không nhảy. Bề rộng đặt qua
 * `className`.
 */
export function SkeletonText({
  size = 'ui',
  relaxed,
  className,
  bar = 'shell-skeleton',
}: {
  size?: keyof typeof TEXT;
  /** Khớp `leading-relaxed` của đoạn mô tả. */
  relaxed?: boolean;
  className?: string;
  /**
   * Nền của vạch. Mặc định là dải sáng; trên nền `shell-hero` dải đó thành mảng sáng chói
   * trên nền tối, nên ở đó bên gọi truyền một màu chữ hero mờ, đứng yên.
   */
  bar?: string;
}) {
  return (
    <span aria-hidden className={cn('block', TEXT[size], relaxed && 'leading-relaxed', className)}>
      <span className={cn('inline-block h-[0.72em] w-full rounded align-middle', bar)} />
    </span>
  );
}

/**
 * Khung một màn dashboard — cùng hộp với `PageShell` (`ui/Page.tsx`): cùng mức bề rộng, cùng
 * lề, cùng nhịp `gap-6`. Đổi một bên thì đổi cả bên kia; `Skeleton.test.tsx` so hai chuỗi class.
 *
 * ## Vì sao là `<div>`, không dùng thẳng `PageShell`
 *
 * `PageShell` là `<main>`. Ở lần tải trang đầu, React 19.2 GOM các lượt hiện nội dung đã
 * stream (inline script `$RC` chờ tới ~300ms sau lần vẽ đầu) — nên ngay sau sự kiện `load`
 * DOM có thể chứa CẢ khung đang tải lẫn trang thật nằm trong một `<div hidden>` chờ đổi chỗ.
 * Hai `<main>` cùng lúc là hai landmark chính, và `page.locator('main')` của
 * `builder-scale.spec.ts` gặp lỗi strict mode. Khung không cần landmark: nó `aria-hidden`.
 * Cùng lý do, khung không dùng `<aside>`, `<h1>`, `<table>` hay `style` inline (các spec
 * editor tìm lưới ba pane theo `[style*="grid-template-columns"]`).
 */
export function SkeletonPage({
  width = 'default',
  className,
  children,
}: {
  width?: 'default' | 'wide' | 'narrow';
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      aria-hidden
      className={cn(
        width === 'wide' ? 'shell-page-wide' : width === 'narrow' ? 'shell-page-narrow' : 'shell-page',
        'flex min-w-0 flex-col gap-6 px-2 py-3 sm:px-4',
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * Đầu màn đang tải — cùng hộp với `PageHeader`: đường dẫn (tuỳ), tiêu đề `text-page`, mô tả
 * `text-ui leading-relaxed`, cụm nút căn phải cao `h-control-lg`.
 */
export function SkeletonHeader({
  crumbs,
  title = 'w-48',
  description = 0,
  actions = 0,
}: {
  crumbs?: boolean;
  /** Bề rộng vạch tiêu đề. */
  title?: string;
  /** Số dòng mô tả. */
  description?: number;
  /** Số nút ở cụm hành động. */
  actions?: number;
}) {
  return (
    <div className="flex flex-wrap items-end gap-4">
      <div className="flex min-w-0 flex-[1_1_20rem] flex-col gap-2">
        {crumbs && <SkeletonText size="small" className="w-44" />}
        <SkeletonText size="page" className={cn('max-w-full', title)} />
        {description > 0 && (
          <div className="max-w-[78ch]">
            {Array.from({ length: description }, (_, i) => (
              <SkeletonText
                key={i}
                relaxed
                className={i === description - 1 ? (description === 1 ? 'w-[min(100%,34rem)]' : 'w-3/5') : 'w-full'}
              />
            ))}
          </div>
        )}
      </div>
      {actions > 0 && (
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {Array.from({ length: actions }, (_, i) => (
            <Skeleton key={i} className={cn('h-control-lg rounded-md', i === actions - 1 ? 'w-36' : 'w-32')} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Nhóm `Tabs` (cao 48px: nút `min-h-10` + `p-1`). */
export function SkeletonTabs({ className }: { className?: string }) {
  return <Skeleton className={cn('h-12 w-[min(100%,26rem)] shrink-0 rounded-lg', className)} />;
}
