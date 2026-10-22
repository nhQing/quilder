'use client';

/**
 * Hộp "Xem diff": bản đang chạy và bản nháp CẠNH NHAU, kèm danh sách thay đổi đọc được.
 *
 * ## Vì sao phải NHÌN, không chỉ đọc danh sách
 *
 * Bản đầu của hộp này chỉ có danh sách id node. Chủ dự án mở một trang clone ra và nói:
 * *"không hiểu khác ở đâu, khác thế nào, không thấy được UI trực quan"*. Và
 * `diffDocs` cố ý không so style (xem `doc-diff.ts`), nên một trang chỉ đổi màu ra
 * danh sách rỗng — trong khi publish vẫn đổi site thật. Hai khung cạnh nhau trả lời
 * được cả hai: phần danh sách không liệt kê, mắt thấy.
 *
 * ## Hai nguồn, cùng một đường render với thứ khách thấy
 *
 *  - Trái: `/<slug>` — CHÍNH site thật, phục vụ từ release đang chạy. Không dựng một
 *    bản "giả live" thứ hai: bản sao sẽ trôi khỏi bản gốc, và thứ trôi mất là điều
 *    màn này tồn tại để trả lời.
 *  - Phải: `/preview/<id>?embed=1` — bản nháp đầy đủ (giải khối lặp, có motion),
 *    không dải công cụ. Không dùng `/render/<id>` của canvas: route đó không giải
 *    khối lặp, nên thẻ blog của bản nháp sẽ trống còn bản live có dữ liệu — một khác
 *    biệt giả do chính công cụ so tạo ra.
 *
 * Cả hai có motion. Đó là cái giá của việc hai bên cùng trung thực; cuộn đồng bộ làm
 * hai bên chạy cùng một hiệu ứng ở cùng một vị trí, nên chúng vẫn so được với nhau.
 *
 * Cùng origin với vỏ builder nên iframe mang cookie phiên (bản nháp đòi đăng nhập),
 * và trang cha đọc được `contentDocument` để đồng bộ cuộn và tìm `[data-n]`.
 *
 * ## Cuộn đồng bộ theo PIXEL, không theo tỉ lệ
 *
 * Theo tỉ lệ thì một section mới cao 800px ở giữa trang làm lệch MỌI thứ phía trên nó
 * lẫn phía dưới. Theo pixel thì phần trên chỗ đổi khớp tuyệt đối, và chỗ hai bên bắt
 * đầu lệch nhau chính là chỗ trang đổi — lệch là tín hiệu, không phải lỗi.
 *
 * Chỉ khung đang được trỏ chuột vào mới "dẫn". Không có luật này thì A đẩy B, B phát
 * sự kiện cuộn, B đẩy lại A — một vòng lặp mà Lenis (có trong cả hai) làm rung lên.
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { cn } from '@/lib/builder/cn';
import { focusRing, ui } from '@/lib/builder/ui';
import { capList, type ChangeGroup, type ChangeItem, type DiffView } from '@/lib/builder/diff-view';

import { Badge } from './ui/Badge';
import { buttonClass, IconButton } from './ui/Button';
import { Checkbox } from './ui/Field';
import { Icon } from './ui/Icon';
import { Tabs } from './ui/Tabs';

export interface DiffDetail {
  pageId: string;
  slug: string;
  title: string;
  status: string;
  view: DiffView;
  liveHref: string | null;
}

/** Khổ màn so. Chiều cao là một màn thật — `100svh` bên trong khung nghĩa là nó. */
const SCREENS = {
  desktop: { label: 'Desktop', width: 1440, height: 900 },
  mobile: { label: 'Mobile', width: 390, height: 844 },
} as const;
type ScreenKey = keyof typeof SCREENS;

/** Mỗi nhóm hiện tối đa bấy nhiêu dòng trước khi gập thành "và N node khác". */
const PER_GROUP = 8;

type Side = 'live' | 'draft';

export function DiffDialog({ pageId, onClose }: { pageId: string | null; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [detail, setDetail] = useState<DiffDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [screen, setScreen] = useState<ScreenKey>('desktop');
  const [sync, setSync] = useState(true);
  const [focusMsg, setFocusMsg] = useState<string | null>(null);

  const frames = useRef<Record<Side, HTMLIFrameElement | null>>({ live: null, draft: null });
  const [loaded, setLoaded] = useState(0);
  /** Khung đang dẫn cuộn — khung chuột đang nằm trên. */
  const lead = useRef<Side>('draft');
  const syncRef = useRef(sync);
  syncRef.current = sync;

  useEffect(() => {
    if (!pageId) return;
    setDetail(null);
    setError(null);
    setFocusMsg(null);
    if (!dialog.current?.open) dialog.current?.showModal();
    let stale = false;
    void (async () => {
      try {
        const res = await fetch(`/api/pages/pending?pageId=${encodeURIComponent(pageId)}`);
        const json = (await res.json()) as { page?: DiffDetail; error?: string };
        if (stale) return;
        if (res.ok && json.page) setDetail(json.page);
        else setError(`${json.error ?? `Lỗi ${res.status}`} — đóng hộp rồi mở lại để thử lần nữa.`);
      } catch (e) {
        if (!stale) setError(`Không đọc được diff (${String(e)}). Kiểm tra mạng rồi mở lại.`);
      }
    })();
    return () => { stale = true; };
  }, [pageId]);

  /* ── Đồng bộ cuộn + chặn điều hướng trong khung ─────────────────────── */

  useEffect(() => {
    const cleanups: (() => void)[] = [];
    for (const side of ['live', 'draft'] as const) {
      const win = frames.current[side]?.contentWindow;
      const doc = frames.current[side]?.contentDocument;
      if (!win || !doc) continue;
      const other: Side = side === 'live' ? 'draft' : 'live';

      const onScroll = () => {
        if (!syncRef.current || lead.current !== side) return;
        frames.current[other]?.contentWindow?.scrollTo(0, win.scrollY);
      };
      // Bấm một link trong khung là đưa khung sang trang khác — mất chỗ đang so, và
      // bên live còn có thể ra khỏi site. Chặn ở pha capture, trước handler của trang.
      const onClick = (e: MouseEvent) => {
        if ((e.target as Element | null)?.closest?.('a[href], form, button[type="submit"]')) e.preventDefault();
      };
      win.addEventListener('scroll', onScroll, { passive: true });
      doc.addEventListener('click', onClick, true);
      cleanups.push(() => {
        win.removeEventListener('scroll', onScroll);
        doc.removeEventListener('click', onClick, true);
      });
    }
    return () => cleanups.forEach((f) => f());
  }, [loaded, detail, screen]);

  /* ── Bấm một dòng → cuộn khung tới node và viền nó ─────────────────── */

  const focusNode = useCallback((item: ChangeItem) => {
    const sides: Side[] = item.kind === 'removed' ? ['live'] : item.kind === 'text' ? ['draft', 'live'] : ['draft'];
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--color-shell-accent').trim() || 'currentColor';
    let found = false;
    for (const side of sides) {
      const doc = frames.current[side]?.contentDocument;
      if (!doc) continue;
      if (!doc.querySelector('style[data-mm-diff]')) {
        const st = doc.createElement('style');
        st.setAttribute('data-mm-diff', '');
        st.textContent = `[data-mm-diff-focus]{outline:4px solid ${accent} !important;outline-offset:2px !important;}`;
        doc.head.appendChild(st);
      }
      doc.querySelectorAll('[data-mm-diff-focus]').forEach((el) => el.removeAttribute('data-mm-diff-focus'));
      const el = doc.querySelector(`[data-n="${CSS.escape(item.nodeId)}"]`);
      if (!el) continue;
      found = true;
      el.setAttribute('data-mm-diff-focus', '');
      // Khung được cuộn chủ động là khung dẫn: bên kia đi theo nếu đang đồng bộ, và
      // với "đổi chữ" thì bên kia tự cuộn tới node của nó ngay sau đó.
      lead.current = side;
      el.scrollIntoView({ block: 'center' });
    }
    setFocusMsg(
      found
        ? null
        : 'Không thấy node này trên khung — có thể nó bị ẩn ở khổ đang xem, hoặc khung chưa tải xong.',
    );
  }, []);

  const hasLive = Boolean(detail?.liveHref);
  const s = SCREENS[screen];

  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      onClose={() => {
        // Bỏ `detail` để hai iframe THÁO khỏi DOM: để nguyên thì hai trang có motion
        // vẫn chạy vòng lặp animation sau một hộp thoại đã đóng.
        setDetail(null);
        onClose();
      }}
      className={cn(ui.dialog, 'h-[calc(100dvh-4rem)] w-[calc(100vw-2rem)]')}
    >
      <div className="flex h-full flex-col">
        {/* ── Hàng đầu ── */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-shell-line py-3 pr-3 pl-6">
          <div className="flex min-w-0 flex-col">
            <h2 id={titleId} className="text-section font-semibold">
              {detail ? (
                <>
                  Diff <span className="font-shell-mono">/{detail.slug}</span>
                </>
              ) : (
                'Đang đọc diff…'
              )}
            </h2>
            {detail && <span className="text-small text-shell-muted">{detail.view.summary}</span>}
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-3">
            <Tabs
              label="Khổ màn so"
              size="sm"
              value={screen}
              onChange={setScreen}
              items={(Object.keys(SCREENS) as ScreenKey[]).map((k) => ({
                id: k,
                label: (
                  <>
                    {SCREENS[k].label}
                    <span className="font-shell-mono text-micro text-shell-muted tabular-nums">
                      {SCREENS[k].width}
                    </span>
                  </>
                ),
              }))}
            />

            {hasLive && (
              <Checkbox
                label="Cuộn cùng nhau"
                checked={sync}
                onChange={(e) => setSync(e.target.checked)}
                wrapperClassName="text-small text-shell-muted"
              />
            )}

            <IconButton icon="x" label="Đóng" onClick={() => dialog.current?.close()} />
          </div>
        </div>

        {error && (
          <p role="alert" className="flex items-center gap-2 px-6 py-2 text-small text-shell-danger">
            <Icon name="alert" size={16} />
            {error}
          </p>
        )}

        {/* ── Thân: danh sách bên trái, hai khung bên phải ── */}
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(16rem,22rem)_1fr]">
          <aside className="flex min-h-0 flex-col gap-3 overflow-auto border-r border-shell-line p-4">
            <p className={cn(ui.inset, 'px-3 py-2.5 text-mini leading-relaxed text-shell-muted')}>
              Danh sách chỉ liệt kê <strong className="text-shell-ink">node và chữ</strong> — không liệt kê
              style.{' '}
              {hasLive || !detail
                ? 'Đổi màu, khoảng cách hay cỡ chữ thì so bằng mắt ở hai khung bên cạnh: cùng khổ màn, cuộn cùng nhau.'
                : 'Màu, khoảng cách, cỡ chữ thì xem ở khung bản nháp bên cạnh.'}{' '}
              Publish đưa lên site cả hai loại.
            </p>
            {detail && <ChangeList view={detail.view} onPick={focusNode} />}
            {focusMsg && <p className="text-mini text-shell-warn">{focusMsg}</p>}
          </aside>

          <div className={cn('grid min-h-0 min-w-0 gap-4 bg-shell-bg p-4', hasLive ? 'grid-cols-2' : 'grid-cols-1')}>
            {detail && (
              <>
                {hasLive ? (
                  <FramePane
                    key={`live-${screen}`}
                    heading="Bản đang chạy"
                    openHref={detail.liveHref!}
                    src={detail.liveHref!}
                    width={s.width}
                    height={s.height}
                    frameRef={(el) => { frames.current.live = el; }}
                    onLoad={() => setLoaded((n) => n + 1)}
                    onEnter={() => { lead.current = 'live'; }}
                  />
                ) : null}
                <FramePane
                  key={`draft-${screen}`}
                  heading="Bản nháp"
                  openHref={`/preview/${detail.pageId}`}
                  src={`/preview/${detail.pageId}?embed=1`}
                  width={s.width}
                  height={s.height}
                  frameRef={(el) => { frames.current.draft = el; }}
                  onLoad={() => setLoaded((n) => n + 1)}
                  onEnter={() => { lead.current = 'draft'; }}
                  notice={hasLive ? undefined : noLiveNotice(detail)}
                />
              </>
            )}
          </div>
        </div>
      </div>
    </dialog>
  );
}

/** Câu giải thích vì sao không có khung bên trái. */
function noLiveNotice(d: DiffDetail): string {
  if (d.status === 'moi') {
    return `Chưa publish lần nào — khách chưa thấy trang này ở /${d.slug}. Không có bản đang chạy để so; dưới đây là toàn bộ bản nháp.`;
  }
  return 'Trang mẫu (có đoạn động) không tự mở được trên site — muốn so bản đang chạy, mở một bản ghi cụ thể của nó.';
}

/**
 * Một khung, thu cho vừa ô của nó — cả bề ngang LẪN bề cao, và không phóng to quá
 * 100%. Cùng phép tính với canvas (`Canvas.tsx`): khung giữ đúng kích thước thiết bị
 * bên trong, chỉ `scale` bên ngoài, nên bố cục trong khung là bố cục thật ở khổ đó.
 */
function FramePane({
  heading,
  openHref,
  src,
  width,
  height,
  frameRef,
  onLoad,
  onEnter,
  notice,
}: {
  heading: string;
  openHref: string;
  src: string;
  width: number;
  height: number;
  frameRef: (el: HTMLIFrameElement | null) => void;
  onLoad: () => void;
  onEnter: () => void;
  notice?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setRoom({ w: e!.contentRect.width, h: e!.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const scale = room ? Math.max(0.1, Math.min(1, room.w / width, room.h / height)) : 0;

  return (
    <section className="flex min-h-0 min-w-0 flex-col gap-2">
      <div className="flex items-center gap-2">
        <h3 className="text-small font-semibold">{heading}</h3>
        {scale > 0 && (
          <span className="font-shell-mono text-micro text-shell-muted tabular-nums">
            {width}px · {Math.round(scale * 100)}%
          </span>
        )}
        <a
          href={openHref}
          target="_blank"
          rel="noreferrer"
          className={buttonClass('ghost', 'sm', 'ml-auto text-shell-muted hover:text-shell-ink')}
        >
          Mở tab riêng
          <Icon name="external" size={15} />
        </a>
      </div>
      {notice && (
        <p className="rounded-md bg-shell-accent-soft px-3 py-2 text-small text-shell-ink">{notice}</p>
      )}
      <div ref={box} className="relative min-h-0 flex-1" onMouseEnter={onEnter}>
        {scale > 0 && (
          <div className="mx-auto" style={{ width: width * scale, height: height * scale }}>
            <div
              className="overflow-hidden bg-shell-paper shadow-shell-card ring-1 ring-shell-line"
              style={{ width, height, transform: `scale(${scale})`, transformOrigin: 'top left' }}
            >
              <iframe
                ref={frameRef}
                src={src}
                title={`${heading} ở ${width}px`}
                onLoad={onLoad}
                className="h-full w-full border-0"
              />
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function ChangeList({ view, onPick }: { view: DiffView; onPick: (i: ChangeItem) => void }) {
  if (!view.groups.length) {
    return (
      <p className="text-small text-shell-muted">
        Không thấy node hay chữ nào đổi. Nếu trang vẫn có lần sửa chưa publish thì phần đổi nằm ở{' '}
        <strong className="text-shell-ink">style</strong> — so bằng mắt ở hai khung.
      </p>
    );
  }

  const groups = view.groups.map((g) => <Group key={g.sectionId ?? '∅'} group={g} onPick={onPick} />);

  // Trang chưa publish: mọi node đều "thêm", nên danh sách không nói thêm được gì
  // ngoài "đây là cả trang". Gập lại — khung bản nháp bên cạnh đã cho thấy trang.
  if (view.isNew) {
    return (
      <details>
        <summary className="cursor-pointer rounded-sm text-small font-medium text-shell-muted hover:text-shell-ink">
          Xem {view.groups.length} khối của trang
        </summary>
        <div className="mt-2 flex flex-col gap-4">{groups}</div>
      </details>
    );
  }

  return <div className="flex flex-col gap-4">{groups}</div>;
}

const KIND: Record<ChangeItem['kind'], { text: string; tone: 'ok' | 'danger' | 'warn' }> = {
  added: { text: 'thêm', tone: 'ok' },
  removed: { text: 'xoá', tone: 'danger' },
  text: { text: 'đổi chữ', tone: 'warn' },
};

function Group({ group, onPick }: { group: ChangeGroup; onPick: (i: ChangeItem) => void }) {
  const [all, setAll] = useState(false);
  const { shown, more } = all ? { shown: group.items, more: 0 } : capList(group.items, PER_GROUP);

  return (
    <div className="flex flex-col gap-1">
      <p className={cn(ui.eyebrow, 'truncate px-2')} title={group.sectionLabel}>
        {group.sectionLabel}
      </p>
      <ul className="flex flex-col gap-0.5">
        {shown.map((it) => (
          <li key={`${it.kind}-${it.nodeId}`}>
            <button
              type="button"
              onClick={() => onPick(it)}
              title={`Cuộn tới node ${it.nodeId} trên khung`}
              className={cn('w-full rounded px-2 py-1.5 text-left transition-colors hover:bg-shell-raised', focusRing)}
            >
              <span className="flex items-center gap-2">
                <Badge tone={KIND[it.kind].tone} size="sm">
                  {KIND[it.kind].text}
                </Badge>
                <span className="min-w-0 flex-1 truncate text-small">{it.label}</span>
                <span className="font-shell-mono shrink-0 text-micro text-shell-muted">{it.type}</span>
              </span>
              {it.hint && (
                <span className="mt-0.5 block truncate text-mini text-shell-muted">“{it.hint}”</span>
              )}
              {it.descendants > 0 && (
                <span className="mt-0.5 block text-mini text-shell-muted">kèm {it.descendants} node con</span>
              )}
              {it.kind === 'text' && (
                <span className="mt-1 block text-mini">
                  <span className="block text-shell-muted line-through">{it.before || '(trống)'}</span>
                  <span className="block text-shell-ink">→ {it.after || '(trống)'}</span>
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
      {more > 0 && (
        <button
          type="button"
          onClick={() => setAll(true)}
          className={buttonClass('ghost', 'sm', 'self-start text-shell-muted hover:text-shell-ink')}
        >
          và {more} node khác
        </button>
      )}
    </div>
  );
}
