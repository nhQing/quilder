'use client';

/**
 * Khung đang tải của từng MÀN builder — thứ MỌI file `loading.tsx` trả về.
 *
 * ## Vì sao có
 *
 * Gần như mọi màn builder là `force-dynamic`, nên mỗi cú bấm chuyển màn là một lượt render ở
 * server. Không có `loading.tsx`, router giữ nguyên màn cũ tới khi màn mới xong hẳn: bấm rồi
 * mà không thấy gì, và người dùng bấm lại (lý do đầy đủ: `lib/builder/nav-pending.ts`). Có nó,
 * router commit ngay khi server trả dòng đầu — đổi URL, sáng mục menu mới, và vẽ khung này
 * đúng chỗ trang thật sắp hiện.
 *
 * ## Một khung, chọn hình theo URL
 *
 * `RouteSkeleton` đọc `usePathname()` và vẽ hình của màn ĐÍCH (`lib/builder/route-shape.ts`),
 * vì ranh giới bắt được lượt chờ thường là của đoạn CHA — lý do và lần đo ở docblock file đó.
 * Đây là client component chỉ vì lý do ấy: server render `loading.tsx` một lần cho cả đoạn,
 * không biết lượt điều hướng sau sẽ đi đâu.
 *
 * ## Đúng HÌNH của màn đích, đúng CHỖ
 *
 * Mỗi màn một khung: lưới thẻ cho màn lưới, bảng cho màn bảng, ba pane cho editor. Khung dùng
 * cùng hộp với `PageShell`/`PageHeader` (`SkeletonPage`/`SkeletonHeader`) và cùng chuỗi lưới
 * với component thật, để lúc trang thật thay vào thì tiêu đề, cụm nút và hàng thẻ đứng yên —
 * chỉ nội dung đổi. Không cần khớp từng pixel bên trong thẻ: khớp KHUNG là đủ để mắt không
 * phải tìm lại chỗ.
 *
 * Không chữ nào: chữ "đang nạp…" là thứ `Design.md` §5 cấm, và một heading trong khung sẽ
 * khớp nhầm các phép tìm heading theo tên trong e2e. Không landmark, không `style` inline: xem
 * docblock `SkeletonPage`.
 *
 * Khung gắn `NavSkeletonHold`: còn khung là thanh tiến độ còn chạy (xem `NavProgress`).
 */

import { usePathname } from 'next/navigation';

import { cn } from '@/lib/builder/cn';
import { routeShape, type RouteShape } from '@/lib/builder/route-shape';
import { ui } from '@/lib/builder/ui';

import { NavSkeletonHold } from './NavProgress';
import { Skeleton, SkeletonHeader, SkeletonPage, SkeletonTabs, SkeletonText } from './ui/Skeleton';

const times = (n: number) => Array.from({ length: n }, (_, i) => i);

/** Vạch trên nền `shell-hero`: màu chữ hero mờ, đứng yên (xem `SkeletonText`). */
const ON_HERO = 'bg-shell-on-hero/15';

/** Bề rộng xoay vòng cho các dòng lặp, để danh sách không trông như kẻ ô. */
const ROW_WIDTHS = ['w-3/5', 'w-2/5', 'w-1/2', 'w-2/3', 'w-1/3', 'w-3/4'] as const;
const rowWidth = (i: number) => ROW_WIDTHS[i % ROW_WIDTHS.length];

/* ── Mảnh dùng chung ───────────────────────────────────────────────────── */

/** Cùng hộp với `Section` (`ui/Page.tsx`): tiêu đề `text-section`, mô tả `text-small`. */
function SectionSkeleton({
  title = 'w-40',
  description = 0,
  className,
  children,
}: {
  title?: string;
  description?: number;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-3.5', className)}>
      <div className="flex min-w-0 flex-col gap-1">
        <SkeletonText size="section" className={title} />
        {times(description).map((i) => (
          <SkeletonText key={i} size="small" className={i === description - 1 ? 'w-2/5' : 'w-3/4'} />
        ))}
      </div>
      {children}
    </div>
  );
}

/** Hàng lọc phía trên bảng/lưới: `Tabs` bên trái, ô tìm (44px) bên phải. */
function FilterRow({ tabs = true }: { tabs?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      {tabs && <SkeletonTabs />}
      <Skeleton className="ml-auto h-control-lg w-[min(100%,22rem)] rounded-md" />
    </div>
  );
}

/** Bảng trong khung thẻ: hàng tiêu đề viết hoa nhỏ + các hàng `text-small`. */
function TableBlock({ rows, cols = 4 }: { rows: number; cols?: number }) {
  return (
    <div className={cn(ui.card, 'min-w-0 overflow-hidden')}>
      <div className="flex gap-6 border-b border-shell-line px-5.5 py-3.5">
        {times(cols).map((c) => (
          <div key={c} className="min-w-0 flex-1">
            <SkeletonText size="micro" className="w-16" />
          </div>
        ))}
      </div>
      {times(rows).map((r) => (
        <div key={r} className="flex gap-6 border-b border-shell-line px-5.5 py-3 last:border-b-0">
          {times(cols).map((c) => (
            <div key={c} className="min-w-0 flex-1">
              <SkeletonText size="small" className={rowWidth(r + c * 2)} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** Thẻ chung của các lưới: ô chữ cái đầu, tên, mô tả, chân thẻ. */
function TileCard({ lines = 2 }: { lines?: number }) {
  return (
    <div className={cn(ui.card, 'flex min-w-0 flex-col gap-3.5 p-5')}>
      <Skeleton className="size-11 rounded-md" />
      <div className="flex flex-col gap-1">
        <SkeletonText size="card" className="w-3/5" />
        {times(lines).map((i) => (
          <SkeletonText key={i} size="small" className={i === lines - 1 ? 'w-1/2' : 'w-11/12'} />
        ))}
      </div>
      <div className="mt-auto flex items-center justify-between gap-2.5 border-t border-shell-line pt-3">
        <SkeletonText size="mini" className="w-20" />
        <Skeleton className="h-6 w-20 rounded-full" />
      </div>
    </div>
  );
}

/** Thẻ phụ ở cột phải (chi tiết component, form mục): nhãn nhóm + vài dòng. */
function SideCard({ lines = 3 }: { lines?: number }) {
  return (
    <div className={cn(ui.card, 'flex min-w-0 flex-col gap-3 p-5')}>
      <SkeletonText size="micro" className="w-24" />
      {times(lines).map((i) => (
        <SkeletonText key={i} size="small" className={rowWidth(i)} />
      ))}
    </div>
  );
}

/* ── Màn "Trang" (/builder) — cũng là khung mặc định của mọi route con ─── */

/** Thẻ trang của `PageGrid`. Thẻ đầu là thẻ hero (Trang chủ) nền tối, như lưới thật. */
function PageCard({ hero }: { hero?: boolean }) {
  const block = hero ? cn('rounded', ON_HERO) : 'shell-skeleton rounded';
  const bar = hero ? ON_HERO : undefined;
  return (
    <div
      className={cn(
        'flex min-w-0 flex-col gap-3.5 rounded-lg p-5 shadow-shell-card',
        hero ? 'bg-shell-hero' : 'bg-shell-panel',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <span className={cn('size-11 rounded-md', block)} />
        <span className={cn('size-8', block)} />
      </div>
      <div className="flex flex-col gap-1">
        <SkeletonText size="card" className="w-3/5" bar={bar} />
        <SkeletonText size="small" className="w-2/5" bar={bar} />
      </div>
      <div className="flex flex-col gap-1.5">
        <SkeletonText size="small" className="w-1/2" bar={bar} />
        <SkeletonText size="small" className="w-2/5" bar={bar} />
      </div>
      <div
        className={cn(
          'mt-auto flex items-center justify-between gap-2.5 border-t pt-3',
          hero ? 'border-shell-on-hero/15' : 'border-shell-line',
        )}
      >
        <SkeletonText size="mini" className="w-20" bar={bar} />
        <span className={cn('h-6 w-24 rounded-full', block)} />
      </div>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <SkeletonPage>
      <SkeletonHeader title="w-36" description={1} actions={1} />
      <div className="flex min-w-0 flex-col gap-5">
        <SkeletonTabs />
        <div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-5">
          <PageCard hero />
          {times(5).map((i) => (
            <PageCard key={i} />
          ))}
        </div>
      </div>
    </SkeletonPage>
  );
}

/* ── Lưới thẻ: Component, Kho dữ liệu ──────────────────────────────────── */

function ComponentsSkeleton() {
  return (
    <SkeletonPage>
      <SkeletonHeader title="w-52" description={2} actions={1} />
      <SkeletonTabs />
      <div className="grid grid-cols-[repeat(auto-fill,minmax(15.625rem,1fr))] gap-5">
        {/* Thẻ component: khung xem trước ở trên, rồi tên, khoá, hai dòng, chân thẻ. */}
        {times(8).map((i) => (
          <div key={i} className={cn(ui.card, 'flex min-w-0 flex-col gap-3.5 p-4')}>
            <Skeleton className="h-34 rounded-md" />
            <div className="flex flex-col gap-1 px-1.5">
              <SkeletonText size="card" className="w-3/5" />
              <SkeletonText size="small" className="w-2/5" />
            </div>
            <div className="flex flex-col gap-1.5 px-1.5">
              <SkeletonText size="small" className="w-1/2" />
              <SkeletonText size="small" className="w-2/5" />
            </div>
            <div className="mx-1.5 mt-auto flex items-center justify-between border-t border-shell-line pt-3">
              <SkeletonText size="mini" className="w-20" />
              <SkeletonText size="small" className="w-10" />
            </div>
          </div>
        ))}
      </div>
    </SkeletonPage>
  );
}

function ContentSkeleton() {
  return (
    <SkeletonPage width="wide">
      <SkeletonHeader title="w-52" description={1} actions={1} />
      <SectionSkeleton>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(18.75rem,1fr))] gap-5">
          {times(3).map((i) => (
            <TileCard key={i} />
          ))}
        </div>
      </SectionSkeleton>
      {/* Nhóm field: thẻ thấp, ô icon bên trái. */}
      <SectionSkeleton description={1}>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(13.75rem,1fr))] gap-4">
          {times(4).map((i) => (
            <div key={i} className={cn(ui.card, 'flex min-w-0 items-center gap-3 p-4')}>
              <Skeleton className="size-9 shrink-0 rounded" />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <SkeletonText size="ui" className="w-3/5" />
                <SkeletonText size="mini" className="w-4/5" />
              </div>
            </div>
          ))}
        </div>
      </SectionSkeleton>
    </SkeletonPage>
  );
}

/* ── Màn bảng: Văn bản, danh sách mục, Tài khoản, Kết nối Claude ──────── */

function TextSkeleton() {
  return (
    <SkeletonPage width="wide">
      <SkeletonHeader title="w-40" description={1} actions={1} />
      {/* Bộ chọn trang (`nav` "Chọn trang") — cùng hình nhóm Tabs. */}
      <SkeletonTabs className="w-[min(100%,34rem)]" />
      {/* `TextTable`: ô tìm một hàng riêng, rồi Tabs lọc + chọn cột dịch ở bên phải. */}
      <div className="flex flex-col gap-3">
        <Skeleton className="h-control-md w-[min(100%,26rem)] rounded" />
        <div className="flex flex-wrap items-center gap-2.5">
          <SkeletonTabs className="w-[min(100%,48rem)]" />
          <Skeleton className="ml-auto h-control-lg w-40 rounded-md" />
        </div>
      </div>
      <TableBlock rows={10} />
    </SkeletonPage>
  );
}

function EntriesSkeleton() {
  return (
    <SkeletonPage width="wide">
      <SkeletonHeader crumbs title="w-44" actions={2} />
      <FilterRow />
      <TableBlock rows={8} cols={5} />
    </SkeletonPage>
  );
}

function UsersSkeleton() {
  return (
    <SkeletonPage>
      <SkeletonHeader title="w-44" description={1} actions={1} />
      {/* `AccountTabs`: Người dùng · Kết nối Claude. */}
      <SkeletonTabs className="w-[min(100%,17rem)]" />
      {/* Ba ô đếm theo vai trò: ô icon + số + nhãn. */}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(13.75rem,1fr))] gap-4">
        {times(3).map((i) => (
          <div key={i} className={cn(ui.card, 'flex items-center gap-3.5 p-4')}>
            <Skeleton className="size-11 shrink-0 rounded-md" />
            <div className="flex min-w-0 flex-col">
              <SkeletonText size="section" className="w-8" />
              <SkeletonText size="small" className="w-24" />
            </div>
          </div>
        ))}
      </div>
      <FilterRow />
      <TableBlock rows={6} cols={5} />
    </SkeletonPage>
  );
}

function TokensSkeleton() {
  return (
    <SkeletonPage>
      <SkeletonHeader title="w-44" description={1} />
      <SkeletonTabs className="w-[min(100%,17rem)]" />
      <div className={cn(ui.card, 'flex flex-col gap-4 p-5')}>
        <SkeletonText size="section" className="w-48" />
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_11rem_auto] sm:items-end">
          <Skeleton className="h-control-lg rounded-md" />
          <Skeleton className="h-control-lg rounded-md" />
          <Skeleton className="h-control-lg w-36 rounded-md" />
        </div>
      </div>
      <SectionSkeleton>
        <TableBlock rows={4} cols={5} />
      </SectionSkeleton>
    </SkeletonPage>
  );
}

/* ── Màn chi tiết và form ──────────────────────────────────────────────── */

/** `/builder/components/<id>`: xem trước, hợp đồng ghi đè, cây node | cột thẻ phụ. */
function ComponentDetailSkeleton() {
  return (
    <SkeletonPage>
      <SkeletonHeader crumbs title="w-56" description={1} actions={2} />
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-5">
          <SectionSkeleton title="w-28" className={cn(ui.card, 'p-5')}>
            <Skeleton className="h-72 rounded-md" />
          </SectionSkeleton>
          <SectionSkeleton title="w-56" description={2} className={cn(ui.card, 'p-5')}>
            {times(4).map((i) => (
              <SkeletonText key={i} size="small" className={rowWidth(i)} />
            ))}
          </SectionSkeleton>
          <SectionSkeleton title="w-28" className={cn(ui.card, 'p-5')}>
            {times(8).map((i) => (
              <SkeletonText key={i} size="small" className={cn(rowWidth(i), i % 3 === 0 ? 'ml-0' : 'ml-6')} />
            ))}
          </SectionSkeleton>
        </div>
        <div className="flex min-w-0 flex-col gap-5">
          <SideCard lines={2} />
          <SideCard lines={4} />
          <SideCard lines={2} />
          <SideCard lines={4} />
        </div>
      </div>
    </SkeletonPage>
  );
}

/** `/builder/content/<loại>/<id>`: form soạn | cột đăng bài và danh mục. */
function EntryFormSkeleton() {
  return (
    <SkeletonPage>
      <SkeletonHeader crumbs title="w-40" />
      {/* `Note` cảnh báo "Đăng bài không cần publish release". */}
      <Skeleton className="h-12 rounded-lg" />
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className={cn(ui.card, 'flex min-w-0 flex-col gap-6 p-5 sm:p-6')}>
          {times(4).map((i) => (
            <div key={i} className="flex flex-col gap-1.5">
              <SkeletonText size="mini" className="w-24" />
              <Skeleton className={cn('rounded-md', i === 3 ? 'h-56' : 'h-control-lg')} />
            </div>
          ))}
        </div>
        <div className="flex min-w-0 flex-col gap-5">
          <div className={cn(ui.card, 'flex flex-col gap-3 p-5')}>
            <SkeletonText size="micro" className="w-24" />
            <Skeleton className="h-control-lg rounded-md" />
            <SkeletonText size="small" className="w-3/4" />
          </div>
          <SideCard lines={3} />
        </div>
      </div>
    </SkeletonPage>
  );
}

/** `/builder/content/<loại>/<id>/preview`: dải ghi chú dính đầu + thân bài. Không có `PageShell`. */
function EntryPreviewSkeleton() {
  return (
    <div aria-hidden className="flex min-w-0 flex-col">
      <div className="pb-3">
        <div className={cn(ui.card, 'flex flex-wrap items-center gap-x-4 gap-y-2.5 px-5 py-3.5')}>
          <Skeleton className="h-6 w-44 rounded-full" />
          <div className="flex min-w-0 flex-[1_1_24rem] flex-col gap-0.5">
            <SkeletonText size="small" className="w-11/12" />
            <SkeletonText size="small" className="w-3/5" />
          </div>
          <Skeleton className="ml-auto h-control-md w-28 rounded-md" />
        </div>
      </div>
      <div className="mx-auto flex w-full max-w-[72ch] flex-col gap-3 px-4 py-10">
        <SkeletonText size="page" className="w-4/5" />
        <SkeletonText size="page" className="mb-4 w-2/5" />
        {times(9).map((i) => (
          <SkeletonText key={i} size="card" relaxed className={i % 4 === 3 ? 'mb-3 w-1/2' : 'w-full'} />
        ))}
      </div>
    </div>
  );
}

/** Cấu trúc field (`content/types/<key>`, `content/groups/<key>`): danh sách field trong thẻ. */
function SchemaSkeleton() {
  return (
    <SkeletonPage>
      <SkeletonHeader crumbs title="w-56" description={1} actions={2} />
      <div className={cn(ui.card, 'flex flex-col p-2')}>
        {times(6).map((i) => (
          <div key={i} className="flex items-center gap-4 border-b border-shell-line px-3 py-3.5 last:border-b-0">
            <Skeleton className="size-8 shrink-0 rounded" />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <SkeletonText size="ui" className={rowWidth(i)} />
              <SkeletonText size="mini" className="w-24" />
            </div>
            <Skeleton className="h-6 w-20 shrink-0 rounded-full" />
          </div>
        ))}
      </div>
    </SkeletonPage>
  );
}

/** Danh mục của một loại (`content/<loại>/taxonomies`): một cột, đọc theo dòng. */
function TaxonomySkeleton() {
  return (
    <SkeletonPage width="narrow">
      <SkeletonHeader crumbs title="w-40" description={1} />
      <div className={cn(ui.card, 'flex flex-col p-2')}>
        {times(6).map((i) => (
          <div key={i} className="flex items-center gap-3 border-b border-shell-line px-3 py-3 last:border-b-0">
            <SkeletonText size="ui" className={cn('flex-none', rowWidth(i), 'max-w-48')} />
            <SkeletonText size="mini" className="w-16 flex-none" />
            <Skeleton className="ml-auto h-control-sm w-20 rounded" />
          </div>
        ))}
      </div>
    </SkeletonPage>
  );
}

/* ── Thư viện, Cài đặt, Lịch sử publish ────────────────────────────────── */

/** `/builder/assets`: cây thư mục | đầu màn, hàng lọc, lưới file — như `AssetGrid`. */
function AssetsSkeleton() {
  return (
    <SkeletonPage width="wide" className="gap-0">
      <div className="flex flex-wrap items-stretch gap-5">
        <div className="flex min-w-0 max-w-full flex-[1_1_16.5rem] flex-col">
          <div className={cn(ui.panel, 'flex h-full flex-col gap-1 p-3')}>
            <Skeleton className="mb-2 h-control-lg rounded-md" />
            {times(7).map((i) => (
              <div key={i} className={cn('flex h-9 items-center gap-2.5 px-2', i > 2 && i < 5 && 'pl-7')}>
                <Skeleton className="size-4.5 shrink-0 rounded-sm" />
                <SkeletonText size="ui" className={rowWidth(i)} />
              </div>
            ))}
          </div>
        </div>
        <div className="flex min-w-0 flex-[999_1_35rem] flex-col gap-6 py-1.5 md:px-2">
          {/* Không có đường dẫn: URL trơn `/builder/assets` (mặc định) không hiện breadcrumb. */}
          <SkeletonHeader title="w-64" actions={1} />
          <FilterRow />
          <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-4.5">
            {times(10).map((i) => (
              <div key={i} className={cn(ui.card, 'flex min-w-0 flex-col overflow-hidden')}>
                <Skeleton className="aspect-[4/3] w-full rounded-none" />
                <div className="flex flex-col gap-0.5 p-3.5">
                  <SkeletonText size="small" className="w-4/5" />
                  <SkeletonText size="mini" className="w-1/2" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </SkeletonPage>
  );
}

function SettingsSkeleton() {
  return (
    <SkeletonPage>
      <SkeletonHeader title="w-52" />
      {/* Hàng "hai chế độ lưu" sát dưới tiêu đề. */}
      <div className="-mt-3 flex flex-wrap items-center gap-2.5">
        <SkeletonText size="ui" className="w-44" />
        <Skeleton className="h-9 w-[min(100%,24rem)] rounded-md" />
        <Skeleton className="h-9 w-[min(100%,20rem)] rounded-md" />
      </div>
      <SectionSkeleton title="w-32" description={2}>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-4">
          {times(8).map((i) => (
            <div key={i} className={cn(ui.card, 'flex flex-col gap-3 p-4')}>
              <Skeleton className="h-12 rounded-md" />
              <SkeletonText size="small" className="w-3/5" />
              <SkeletonText size="mini" className="w-2/5" />
            </div>
          ))}
        </div>
      </SectionSkeleton>
      <SectionSkeleton title="w-44" description={1}>
        <TableBlock rows={3} cols={3} />
      </SectionSkeleton>
    </SkeletonPage>
  );
}

function ReleasesSkeleton() {
  return (
    <SkeletonPage>
      <SkeletonHeader title="w-64" description={3} />
      <div className="flex flex-col gap-6">
        {/* Release đang chạy: thẻ hero, như `ReleaseTimeline`. */}
        <div className="flex flex-wrap items-center gap-5 rounded-lg bg-shell-hero p-5 shadow-shell-card">
          <span className={cn('size-13 shrink-0 rounded-md', ON_HERO)} />
          <div className="flex min-w-0 flex-[1_1_18rem] flex-col gap-1.5">
            <SkeletonText size="section" className="w-56" bar={ON_HERO} />
            <SkeletonText size="small" className="w-2/3" bar={ON_HERO} />
          </div>
        </div>
        <div className={cn(ui.card, 'flex flex-col p-2')}>
          {times(6).map((i) => (
            <div key={i} className="flex items-center gap-4 border-b border-shell-line px-4 py-3.5 last:border-b-0">
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <SkeletonText size="ui" className={rowWidth(i)} />
                <SkeletonText size="mini" className="w-48" />
              </div>
              <Skeleton className="h-control-md w-32 shrink-0 rounded-md" />
            </div>
          ))}
        </div>
      </div>
    </SkeletonPage>
  );
}

/* ── Editor ba pane: trang và component ────────────────────────────────── */

/**
 * Cùng khung với `EditorShell` / `ComponentEditorShell`: cao `100svh − --shell-nav`, thanh
 * công cụ, rồi lưới `--shell-left · canvas · --shell-right`. Lưới viết bằng CLASS chứ không
 * bằng `style` như shell thật: xem docblock `SkeletonPage`.
 *
 * Pane trái luôn vẽ ở bề rộng đầy đủ: trạng thái thu gọn nằm trong `localStorage`, server
 * không đọc được. Người đã thu gọn pane thấy nó co lại khi editor tới — một bước, đúng chiều.
 */
function EditorSkeleton({ notice }: { notice?: boolean }) {
  return (
    <div aria-hidden className="flex h-[calc(100svh_-_var(--shell-nav,3rem))] flex-col gap-3">
      <div className={cn(ui.panel, 'flex shrink-0 items-center gap-2.5 py-2 pr-2.5 pl-2')}>
        <Skeleton className="h-control-md w-24 rounded-md" />
        <span className="h-6 w-px shrink-0 bg-shell-line" />
        <div className="flex min-w-0 flex-col">
          <SkeletonText size="ui" className="w-40" />
          <SkeletonText size="mini" className="w-24" />
        </div>
        <div className="ml-2 flex shrink-0 items-center gap-0.5">
          <Skeleton className="size-9 rounded" />
          <Skeleton className="size-9 rounded" />
        </div>
        <div className="ml-auto flex min-w-0 items-center gap-3">
          <Skeleton className="h-control-md w-24 rounded-md" />
          <Skeleton className="h-control-md w-28 rounded-md" />
          <Skeleton className="h-control-md w-32 rounded-md" />
        </div>
      </div>

      {/* Dải "đang sửa component" của màn sửa component. */}
      {notice && <div className="h-11 shrink-0 rounded-xl bg-shell-accent-soft" />}

      <div className="grid min-h-0 flex-1 grid-cols-[var(--shell-left)_1fr_var(--shell-right)] gap-3">
        <div className={cn(ui.panel, 'flex min-h-0 min-w-0 flex-col overflow-hidden')}>
          <div className="flex shrink-0 items-center gap-2 py-2.5 pr-3 pl-3.5">
            <Skeleton className="size-4 rounded-sm" />
            <SkeletonText size="small" className="w-12" />
            <Skeleton className="ml-auto size-7 rounded-sm" />
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-hidden px-2.5">
            {times(14).map((i) => (
              <div
                key={i}
                className={cn(
                  'flex h-7 shrink-0 items-center gap-2',
                  ['pl-1', 'pl-4', 'pl-7', 'pl-7', 'pl-4', 'pl-7', 'pl-10'][i % 7],
                )}
              >
                <Skeleton className="size-3.5 shrink-0 rounded-sm" />
                <SkeletonText size="small" className={rowWidth(i)} />
              </div>
            ))}
          </div>
          <div className="flex shrink-0 gap-2 border-t border-shell-line p-2.5">
            <Skeleton className="h-control-sm flex-1 rounded" />
            <Skeleton className="size-7 rounded" />
            <Skeleton className="size-7 rounded" />
          </div>
        </div>

        {/* Mặt bàn canvas (cùng nền lưới với `Canvas`) và tờ giấy. Khối bên trong tờ giấy là
            màu mực của giấy ở độ mờ thấp: giấy luôn trắng ở cả hai theme, nên dải sáng
            `shell-skeleton` (theo theme) sẽ thành mảng tối trên giấy trắng ở theme tối. */}
        <div
          className={cn(
            'flex min-h-0 min-w-0 flex-col rounded-xl bg-canvas-bg',
            'bg-[linear-gradient(var(--color-canvas-grid)_1px,transparent_1px),linear-gradient(90deg,var(--color-canvas-grid)_1px,transparent_1px)] bg-size-[24px_24px]',
          )}
        >
          <div className="flex h-12 shrink-0 items-center justify-center gap-2">
            <Skeleton className="h-control-sm w-56 rounded-md" />
          </div>
          <div className="mx-4 mb-4 flex min-h-0 flex-1 flex-col gap-4 overflow-hidden rounded-sm bg-shell-paper p-6 shadow-shell-card">
            <div className="flex items-center justify-between gap-6">
              <span className="h-5 w-28 rounded bg-shell-paper-ink/8" />
              <span className="h-3 w-2/5 rounded bg-shell-paper-ink/6" />
            </div>
            <span className="min-h-24 flex-[0_1_40%] rounded bg-shell-paper-ink/6" />
            <span className="h-4 w-3/5 rounded bg-shell-paper-ink/8" />
            <span className="h-3 w-4/5 rounded bg-shell-paper-ink/6" />
            <span className="h-3 w-2/3 rounded bg-shell-paper-ink/6" />
            <div className="grid grid-cols-3 gap-4">
              {times(3).map((i) => (
                <span key={i} className="h-24 rounded bg-shell-paper-ink/6" />
              ))}
            </div>
          </div>
        </div>

        <div className={cn(ui.panel, 'flex min-h-0 min-w-0 flex-col gap-5 overflow-hidden p-3.5')}>
          <Skeleton className="h-9 shrink-0 rounded-md" />
          {times(3).map((g) => (
            <div key={g} className="flex flex-col gap-2.5">
              <SkeletonText size="micro" className="w-20" />
              {times(g === 1 ? 4 : 3).map((i) => (
                <div key={i} className="grid grid-cols-[5rem_1fr] items-center gap-2">
                  <SkeletonText size="small" className="w-14" />
                  <Skeleton className="h-control-sm rounded-sm" />
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Route chưa có trong `route-shape.ts`: chỉ đầu màn — đúng chỗ, không đoán bố cục. */
function GenericSkeleton() {
  return (
    <SkeletonPage>
      <SkeletonHeader description={1} />
      <Skeleton className="h-64 rounded-lg" />
    </SkeletonPage>
  );
}

const SCREENS: Record<RouteShape, () => React.ReactNode> = {
  dashboard: () => <DashboardSkeleton />,
  editor: () => <EditorSkeleton />,
  text: () => <TextSkeleton />,
  content: () => <ContentSkeleton />,
  entries: () => <EntriesSkeleton />,
  'entry-form': () => <EntryFormSkeleton />,
  'entry-preview': () => <EntryPreviewSkeleton />,
  taxonomy: () => <TaxonomySkeleton />,
  schema: () => <SchemaSkeleton />,
  components: () => <ComponentsSkeleton />,
  'component-detail': () => <ComponentDetailSkeleton />,
  'component-editor': () => <EditorSkeleton notice />,
  assets: () => <AssetsSkeleton />,
  settings: () => <SettingsSkeleton />,
  releases: () => <ReleasesSkeleton />,
  users: () => <UsersSkeleton />,
  tokens: () => <TokensSkeleton />,
  // Đăng nhập / cài đặt lần đầu: không thanh menu, không đầu màn — để trống thay vì vẽ một
  // dashboard không tồn tại.
  blank: () => null,
  generic: () => <GenericSkeleton />,
};

/** Khung đang tải của màn ở URL hiện tại (URL ĐÍCH — router đã commit khi khung hiện). */
export function RouteSkeleton() {
  const pathname = usePathname() ?? '/builder';
  return (
    <>
      <NavSkeletonHold />
      {SCREENS[routeShape(pathname)]()}
    </>
  );
}
