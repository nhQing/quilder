'use client';

/**
 * Lưới thẻ trang của màn "Trang": lọc theo trạng thái, menu "…" của từng thẻ, và
 * toast sau khi lưu trữ / khôi phục / lùi bản.
 *
 * ## Vì sao dữ liệu đến đây đã là CHUỖI
 *
 * Ngày, nhãn vai định tuyến và trạng thái đều dựng ở `builder/page.tsx` (server).
 * Dựng ngày lại ở client là dựng nó hai lần ở hai múi giờ (xem `lib/when.ts`), và
 * `ROLE_LABEL` đọc ở server là đúng chỗ đã ghi trong docblock của nó.
 *
 * ## Vì sao link của thẻ chứa CẢ tiêu đề lẫn slug
 *
 * Link phủ cả thẻ (`after:inset-0`), nên tên trợ năng của nó là tên của thẻ. Hơn chục
 * spec e2e vào trình sửa bằng `getByRole('link', { name: /gioi-thieu/ })` — tức bằng
 * slug — và trình đọc màn hình cũng cần slug để phân biệt hai trang trùng tên.
 *
 * ## Vì sao tiêu đề thẻ KHÔNG phải heading
 *
 * Màn này có đúng một heading chứa chữ "Trang" — tiêu đề màn — và `auth.setup.ts`
 * chờ nó bằng `getByRole('heading', { name: 'Trang' })`, khớp theo chuỗi con. Trang
 * chủ tên "Trang chủ"; một `<h3>` trên thẻ là hai heading khớp và bước đăng nhập của
 * cả bộ e2e đỏ.
 *
 * ## Vì sao toast nằm ở lưới, không ở thẻ
 *
 * Lưu trữ xong thì thẻ biến mất ngay ở lượt `router.refresh()` kế tiếp — toast đặt
 * trong thẻ sẽ biến mất cùng nó, trước khi ai kịp đọc.
 *
 * ## Thẻ vừa bấm báo "đang mở"
 *
 * Mở editor là màn nặng nhất builder (doc, mọi component, token, bản dịch), nên khoảng chờ
 * server ở đây dài nhất — và đây đúng là chỗ người dùng từng bấm thẻ liên tục vì không thấy gì
 * đổi. Thẻ vừa bấm viền accent ngay, ô chữ cái đầu thành spinner sau một nhịp (`CardPending`,
 * đọc `useLinkStatus`); nút "Mở editor" của thẻ hero cũng vậy (`LinkIcon`).
 *
 * Bấm lại KHÔNG sinh lượt mở thứ hai: `NavProgress` chặn cú bấm lặp vào đúng đích đang mở. Ở
 * đây không khoá link (không `aria-disabled`, không `pointer-events-none`): khoá là phải tự mở
 * lại khi lượt điều hướng hỏng, còn trạng thái của `useLinkStatus` tự hết.
 */

import Link, { useLinkStatus } from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/builder/cn';
import type { PageCollection } from '@/lib/builder/page-collection';
import { ui } from '@/lib/builder/ui';
import { UNDO_IMPORT_CONSEQUENCE } from '@/lib/transfer/guides';

import { PageArchiveDialog, PageDelete } from './PageDelete';
import { PageHistory } from './PageHistory';
import { PageRename } from './PageRename';
import { ExportPageDialog } from './transfer/ExportPageDialog';
import { Badge, Tile } from './ui/Badge';
import { Button, Spinner } from './ui/Button';
import { LinkIcon } from './ui/LinkPending';
import { ConfirmDialog, MenuButton, Toast, ToastRegion, type MenuEntry } from './ui/Overlay';
import { EmptyState } from './ui/Page';
import { Tabs } from './ui/Tabs';

export type PageStatus = 'live' | 'changed' | 'draft';

export interface PageCardData {
  id: string;
  slug: string;
  title: string;
  status: PageStatus;
  hasDescription: boolean;
  /** "dd/mm/yyyy" của lần sửa cuối, và bản đủ giờ cho `title`. */
  updated: string;
  updatedFull: string;
  collection: PageCollection | null;
  /** "Tin tức · danh sách" — vai định tuyến, `null` với trang thường. */
  roleLabel: string | null;
  roleTitle: string | null;
  /** Lần nhập còn hoàn tác được (chỉ admin). */
  importId: string | null;
  /** Trang hệ thống (404): không lưu trữ được — menu bỏ mục "Lưu trữ". */
  system: string | null;
}

export interface ArchivedCardData {
  id: string;
  slug: string;
  title: string;
  archived: string;
  archivedFull: string;
  /** Số release có chứa trang. 0 = chưa từng publish. */
  releaseCount: number;
}

type Filter = 'all' | PageStatus | 'archived';

const STATUS: Record<PageStatus, { tone: 'ok' | 'warn' | 'neutral'; label: string; title: string }> = {
  live: { tone: 'ok', label: 'đang chạy', title: 'Bản đang chạy trùng với bản nháp' },
  changed: {
    tone: 'warn',
    label: 'có thay đổi',
    title: 'Bản nháp khác bản đang chạy — Publish để đưa lên site',
  },
  draft: { tone: 'neutral', label: 'chưa publish', title: 'Trang chưa từng lên site' },
};

/** Lọc ra rỗng: câu nói điều đang đúng, và câu nói vì sao. */
const EMPTY: Record<PageStatus, { title: string; description: string }> = {
  live: {
    title: 'Không có trang nào đang chạy trùng với bản nháp',
    description: 'Mọi trang hoặc có thay đổi chưa publish, hoặc chưa từng lên site.',
  },
  changed: {
    title: 'Không có trang nào có thay đổi chưa publish',
    description: 'Mọi trang đã lên site đều đang chạy đúng bản nháp của nó.',
  },
  draft: {
    title: 'Không có trang nào chưa từng publish',
    description: 'Mọi trang đều đã lên site ít nhất một lần.',
  },
};

interface ToastItem {
  id: number;
  title: string;
  description?: string;
}

export function PageGrid({
  pages,
  archived,
  types,
}: {
  pages: PageCardData[];
  archived: ArchivedCardData[];
  types: { key: string; name: string }[];
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextToast = useRef(0);

  const notify = useCallback((title: string, description?: string) => {
    const id = ++nextToast.current;
    // Tối đa ba toast chồng nhau; cái mới nhất ở dưới cùng.
    setToasts((all) => [...all.slice(-2), { id, title, description }]);
  }, []);
  const dismiss = useCallback((id: number) => setToasts((all) => all.filter((t) => t.id !== id)), []);

  const count = (s: PageStatus) => pages.filter((p) => p.status === s).length;
  const tabs = [
    { id: 'all' as const, label: 'Tất cả', count: pages.length },
    { id: 'live' as const, label: 'Đang chạy', count: count('live') },
    { id: 'changed' as const, label: 'Có thay đổi', count: count('changed') },
    { id: 'draft' as const, label: 'Chưa publish', count: count('draft') },
    // Lưu trữ chỉ có khi khác rỗng: một mục "0" thường trực là một mục người ta học
    // cách lờ đi — và khi nó có nội dung thật thì họ đã lờ nó rồi.
    ...(archived.length ? [{ id: 'archived' as const, label: 'Lưu trữ', count: archived.length }] : []),
  ];
  // Khôi phục trang cuối cùng thì tab Lưu trữ biến mất; đừng để lưới đứng ở một tab
  // không còn nút nào chọn được.
  const active: Filter = tabs.some((t) => t.id === filter) ? filter : 'all';

  const shown = active === 'all' || active === 'archived' ? pages : pages.filter((p) => p.status === active);
  // Trang chủ (slug rỗng) là thẻ hero, luôn đứng đầu lưới.
  const hero = shown.find((p) => p.slug === '');
  const rest = shown.filter((p) => p !== hero);

  return (
    <div className="flex min-w-0 flex-col gap-5">
      {(pages.length > 0 || archived.length > 0) && (
        <Tabs label="Lọc theo trạng thái" items={tabs} value={active} onChange={setFilter} className="self-start" />
      )}

      {active === 'archived' ? (
        <>
          <p className="max-w-[78ch] text-small leading-relaxed text-shell-muted">
            Những trang này đã rời khỏi builder và khỏi bảng định tuyến, nhưng vẫn còn nguyên
            trong cơ sở dữ liệu. Khôi phục để dùng lại, hoặc xoá hẳn để dọn cả trang lẫn lịch sử
            phiên bản của nó. Trang đã từng publish cũng bị gỡ khỏi các release cũ.
          </p>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-5">
            {archived.map((p, i) => (
              <ArchivedCard
                key={p.id}
                page={p}
                index={i}
                onRestored={() => notify(`Đã khôi phục /${p.slug}`, 'Trang đã về lại danh sách và bảng định tuyến.')}
              />
            ))}
          </div>
        </>
      ) : shown.length > 0 ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-5">
          {hero && <PageCard page={hero} index={0} hero types={types} notify={notify} />}
          {rest.map((p, i) => (
            <PageCard key={p.id} page={p} index={i} types={types} notify={notify} />
          ))}
        </div>
      ) : active === 'all' ? (
        /*
          Bản trước chỉ người dùng chạy `pnpm db:seed`. Lệnh đó cần mã nguồn, nên
          trên bản đã deploy nó không chạy được — và đây đúng là màn hình một bản
          triển khai mới hiện ra đầu tiên.
        */
        <EmptyState
          icon="grid"
          title="Chưa có trang nào"
          description={
            <>
              Bấm <strong className="font-semibold text-shell-ink">Trang mới</strong> ở trên, hoặc nhờ
              AI dựng qua MCP bằng tool <code className="font-shell-mono">create_page</code>.
            </>
          }
        />
      ) : (
        <EmptyState
          title={EMPTY[active].title}
          description={EMPTY[active].description}
          action={
            <Button variant="secondary" onClick={() => setFilter('all')}>
              Bỏ lọc
            </Button>
          }
        />
      )}

      <ToastRegion>
        {toasts.map((t) => (
          <AutoToast key={t.id} item={t} onClose={() => dismiss(t.id)} />
        ))}
      </ToastRegion>
    </div>
  );
}

/** Toast thành công tự tắt sau 5 giây. */
function AutoToast({ item, onClose }: { item: ToastItem; onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, 5000);
    return () => clearTimeout(t);
  }, [onClose]);
  return <Toast tone="ok" title={item.title} description={item.description} onClose={onClose} />;
}

type DialogKind = 'rename' | 'history' | 'archive' | 'export' | 'undo';

function PageCard({
  page,
  index,
  hero,
  types,
  notify,
}: {
  page: PageCardData;
  index: number;
  hero?: boolean;
  types: { key: string; name: string }[];
  notify: (title: string, description?: string) => void;
}) {
  const [dialog, setDialog] = useState<DialogKind | null>(null);
  const menu = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const href = `/builder/${page.id}`;
  const status = STATUS[page.status];
  // Tên trên thẻ hero là "Trang chủ"; tiêu đề thật của trang đứng ngay dưới.
  const name = hero ? 'Trang chủ' : page.title;

  // Dialog mở từ một mục menu đã biến mất, nên `<dialog>` không có chỗ trả focus về.
  // Trả về nút "…" của thẻ, đúng chỗ người dùng vừa đứng.
  const closeDialog = () => {
    setDialog(null);
    menu.current?.querySelector('button')?.focus();
  };

  const [undoBusy, setUndoBusy] = useState(false);
  const [undoError, setUndoError] = useState('');
  const undoImport = async () => {
    setUndoBusy(true);
    setUndoError('');
    try {
      const res = await fetch('/api/transfer/undo', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ importId: page.importId }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      // Lỗi ở lại trong hộp xác nhận: lý do (đã sửa sau lần nhập…) cần đọc, toast tự tắt.
      if (!res.ok) { setUndoError(data.error ?? `Lỗi ${res.status}`); return; }
      closeDialog();
      notify(`Đã hoàn tác lần nhập vào /${page.slug}`);
      router.refresh();
    } catch {
      setUndoError('Mất kết nối. Thử lại.');
    } finally {
      setUndoBusy(false);
    }
  };

  const items: MenuEntry[] = [
    { label: 'Mở editor', icon: 'edit', href },
    {
      label: 'Xem nháp',
      icon: 'eye',
      onSelect: () => window.open(`/preview/${page.id}`, '_blank', 'noreferrer'),
    },
    { label: 'Đổi tên', icon: 'type', onSelect: () => setDialog('rename') },
    { label: 'Lịch sử', icon: 'history', onSelect: () => setDialog('history') },
    { label: 'Xuất trang (.zip)', icon: 'download', onSelect: () => setDialog('export') },
    ...(page.importId ? [{ label: 'Hoàn tác lần nhập', icon: 'undo' as const, onSelect: () => { setUndoError(''); setDialog('undo'); } }] : []),
    // Trang hệ thống: server cũng từ chối (`archivePage`), nhưng một mục bấm vào chỉ để
    // nhận lỗi là một mục không nên có.
    ...(page.system
      ? []
      : [
          { separator: true as const },
          { label: 'Lưu trữ', icon: 'trash' as const, danger: true, onSelect: () => setDialog('archive') },
        ]),
  ];

  const bullets = [
    page.roleLabel && { text: page.roleLabel, title: page.roleTitle ?? undefined },
    { text: page.hasDescription ? 'Có mô tả SEO' : 'Chưa có mô tả SEO' },
  ].filter((b): b is { text: string; title: string | undefined } => Boolean(b));

  return (
    <article
      className={cn(
        'relative flex min-w-0 flex-col gap-3.5 rounded-lg p-5 shadow-shell-card',
        ui.cardHover,
        hero ? 'bg-shell-hero text-shell-on-hero' : 'bg-shell-panel text-shell-ink',
        // Thẻ nhấc lên khi hover tạo stacking context riêng, nên menu "…" của nó sẽ
        // chui dưới thẻ hàng dưới. Thẻ đang mở menu phải đứng trên mọi thẻ khác.
        'has-[[aria-expanded=true]]:z-20',
        // Đang mở editor của thẻ này (xem docblock đầu file). Viền cách thẻ một khe nền,
        // để thấy được cả trên thẻ hero nền tối.
        'has-[[data-link-pending]]:cursor-progress has-[[data-link-pending]]:ring-2 has-[[data-link-pending]]:ring-shell-accent has-[[data-link-pending]]:ring-offset-2 has-[[data-link-pending]]:ring-offset-shell-bg',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        {hero ? (
          <Tile icon="home" className="bg-shell-on-hero/12 text-shell-on-hero" />
        ) : (
          <Tile index={index}>{page.title.trim().charAt(0).toUpperCase() || '?'}</Tile>
        )}
        {/*
          `z-20`, không `z-10`: khối này tạo stacking context, nên `z-30` của danh sách menu
          chỉ có nghĩa BÊN TRONG nó. Ngang z với nút "Mở editor" của thẻ hero (z-10, đứng
          sau trong DOM) thì nút đó vẽ đè lên mục cuối của menu ("Lưu trữ").
        */}
        <div ref={menu} className="relative z-20 -mt-1 -mr-1">
          <MenuButton
            label={`Tuỳ chọn cho ${name}`}
            items={items}
            className={cn(
              hero &&
                '[&>button]:text-shell-hero-muted [&>button:hover]:bg-shell-on-hero/10 [&>button:hover]:text-shell-on-hero',
            )}
          />
        </div>
      </div>

      <Link
        href={href}
        className={cn(
          'flex min-w-0 flex-col gap-1 rounded-sm outline-none',
          'after:absolute after:inset-0 after:rounded-[inherit]',
          'focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-shell-accent',
        )}
      >
        <CardPending hero={hero} />
        <span className="text-card font-semibold [overflow-wrap:anywhere]">{name}</span>
        {hero && page.title !== name && (
          <span className="text-small text-shell-hero-muted">{page.title}</span>
        )}
        <span
          className={cn(
            'font-shell-mono text-small [overflow-wrap:anywhere]',
            hero ? 'text-shell-hero-muted' : 'text-shell-muted',
          )}
        >
          /{page.slug}
        </span>
      </Link>

      <ul className={cn('flex flex-col gap-1.5 text-small', hero ? 'text-shell-hero-muted' : 'text-shell-muted')}>
        {bullets.map((b) => (
          <li key={b.text} title={b.title} className="flex items-baseline gap-2">
            <span aria-hidden className="size-1.25 shrink-0 translate-y-[-0.1em] rounded-full bg-current opacity-55" />
            <span className="min-w-0">{b.text}</span>
          </li>
        ))}
      </ul>

      <div
        className={cn(
          'mt-auto flex flex-wrap items-center justify-between gap-2.5 border-t pt-3',
          hero ? 'border-shell-on-hero/15' : 'border-shell-line',
        )}
      >
        {hero ? (
          <Link
            href={href}
            className="relative z-10 inline-flex min-h-control-md items-center gap-1.5 rounded px-3.5 text-small font-semibold bg-shell-on-hero text-shell-hero hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-shell-on-hero"
          >
            Mở editor
            <LinkIcon name="arrow-right" size={15} />
          </Link>
        ) : (
          <span className="text-mini text-shell-muted" title={`Sửa lần cuối ${page.updatedFull}`}>
            Sửa {page.updated}
          </span>
        )}
        <Badge tone={status.tone} dot title={status.title}>
          {status.label}
        </Badge>
      </div>

      <PageRename
        open={dialog === 'rename'}
        onClose={closeDialog}
        pageId={page.id}
        slug={page.slug}
        title={page.title}
        isPublished={page.status !== 'draft'}
        collection={page.collection}
        types={types}
        system={page.system}
      />
      <PageHistory
        open={dialog === 'history'}
        onClose={closeDialog}
        onReverted={({ seq, draftSeq }) =>
          notify(
            `Đã lùi bản nháp về v${seq}`,
            draftSeq ? `Bản nháp mới là v${draftSeq}. Publish để đưa lên site.` : 'Publish để đưa lên site.',
          )
        }
        pageId={page.id}
        slug={page.slug}
        title={page.title}
      />
      <PageArchiveDialog
        open={dialog === 'archive'}
        onClose={closeDialog}
        onArchived={() => notify(`Đã lưu trữ /${page.slug}`, 'Khôi phục được ở tab Lưu trữ.')}
        pageId={page.id}
        slug={page.slug}
        title={page.title}
      />
      <ExportPageDialog pageId={page.id} slug={page.slug} open={dialog === 'export'} onClose={closeDialog} />
      <ConfirmDialog
        open={dialog === 'undo'}
        onClose={closeDialog}
        onConfirm={() => void undoImport()}
        busy={undoBusy}
        title={`Hoàn tác lần nhập vào /${page.slug}?`}
        consequence={UNDO_IMPORT_CONSEQUENCE}
        confirmLabel="Hoàn tác"
      >
        {undoError && <p role="alert" className="text-small text-shell-danger">{undoError}</p>}
      </ConfirmDialog>
    </article>
  );
}

/**
 * Đặt TRONG link phủ thẻ (`useLinkStatus` chỉ chạy trong con của `<Link>`). Khi link đó đang
 * chờ: gắn `data-link-pending` để thẻ tự viền accent, và phủ spinner lên ô chữ cái đầu — đúng
 * chỗ và đúng cỡ `Tile` md (`size-11`, cách mép thẻ `p-5`), nên không dòng nào xê dịch.
 *
 * Link không có `position`, nên khối `absolute` này đo theo `<article>` (`relative`).
 */
function CardPending({ hero }: { hero?: boolean }) {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return (
    <span
      data-link-pending=""
      aria-hidden
      className={cn(
        'shell-pending-show absolute top-5 left-5 z-10 grid size-11 place-items-center rounded-md',
        hero ? 'bg-shell-hero text-shell-on-hero' : 'bg-shell-accent-soft text-shell-accent',
      )}
    >
      <Spinner className="size-5 motion-reduce:animate-none" />
    </span>
  );
}

function ArchivedCard({
  page,
  index,
  onRestored,
}: {
  page: ArchivedCardData;
  index: number;
  onRestored: () => void;
}) {
  return (
    <article className={cn(ui.card, 'flex min-w-0 flex-col gap-3.5 p-5')}>
      <div className="flex items-start justify-between gap-3">
        <Tile index={index} className="bg-shell-raised text-shell-muted">
          {page.title.trim().charAt(0).toUpperCase() || '?'}
        </Tile>
        <Badge>lưu trữ</Badge>
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-card font-semibold [overflow-wrap:anywhere]">{page.title}</span>
        <span className="font-shell-mono text-small text-shell-muted [overflow-wrap:anywhere]">
          /{page.slug}
        </span>
      </div>
      <span className="text-mini text-shell-muted" title={`Lưu trữ lúc ${page.archivedFull}`}>
        Lưu trữ {page.archived}
      </span>
      <div className="mt-auto border-t border-shell-line pt-3">
        <PageDelete
          pageId={page.id}
          slug={page.slug}
          title={page.title}
          releaseCount={page.releaseCount}
          onRestored={onRestored}
        />
      </div>
    </article>
  );
}
