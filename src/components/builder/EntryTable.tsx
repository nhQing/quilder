'use client';

/**
 * Màn 3 — bảng entry.
 *
 * ## Vì sao bộ lọc đi qua URL, không phải `useState`
 *
 * Số đếm trên mỗi bộ lọc do server tính (một `count` cho mỗi trạng thái). Lọc ở
 * client nghĩa là chỉ lọc được TRANG HIỆN TẠI, và "Nháp 3" sẽ hiện 1 vì hai bài
 * kia ở trang sau. Lọc qua URL cũng làm mọi bộ lọc chia sẻ được bằng link, và
 * quay lại từ form entry giữ nguyên chỗ đang xem.
 *
 * ## Vì sao mỗi nhãn đếm là một bộ lọc
 *
 * Một con số không dẫn tới hành động nào thì chỉ dạy người ta bỏ qua nó — cùng lý
 * do các cờ cảnh báo trong bảng chữ đều bấm lọc được.
 */

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';

import type { AdminEntryRow } from '@/lib/collections/admin-queries';
import { bulkTargets } from '@/lib/collections/bulk-status';
import {
  columnsCookie,
  defaultColumnIds,
  formatCell,
  serializeColumnIds,
  type EntryColumn,
} from '@/lib/collections/entry-columns';
import { cn } from '@/lib/builder/cn';
import { focusRing, ui, type Tone } from '@/lib/builder/ui';

import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import { Checkbox, SearchField, SelectField } from './ui/Field';
import { ConfirmDialog, Popover } from './ui/Overlay';
import { EmptyState } from './ui/Page';
import { Tabs, type TabItem } from './ui/Tabs';

/**
 * Ba trạng thái của một ngôn ngữ, và nhãn của chúng.
 *
 * `stale` (bản gốc đã đổi sau khi dịch) là trạng thái vô hình nếu không hiện: bản
 * tiếng Anh nói một đằng, tiếng Việt nói một nẻo, và không ai biết cái nào mới.
 */
export function localeState(cov: { translated: number; total: number }): 'none' | 'stale' | 'done' {
  if (cov.translated === 0) return 'none';
  return cov.translated < cov.total ? 'stale' : 'done';
}

const LOCALE_LOOK: Record<'none' | 'stale' | 'done', { mark: string; cls: string; title: string }> = {
  done: { mark: '●', cls: 'text-shell-ok', title: 'đã dịch đủ' },
  stale: { mark: '◐', cls: 'text-shell-warn', title: 'lệch bản gốc — cần dịch lại' },
  none: { mark: '○', cls: 'text-shell-muted', title: 'chưa dịch' },
};

/** Nhãn trạng thái hàng. 'scheduled' là suy ra, không phải giá trị của cột. */
function rowStatus(r: AdminEntryRow, now: number): { label: string; tone: Tone } {
  if (r.status !== 'published') return { label: 'nháp', tone: 'neutral' };
  if (r.publishedAt && r.publishedAt.getTime() > now) {
    return { label: 'hẹn giờ', tone: 'warn' };
  }
  return { label: 'đã đăng', tone: 'ok' };
}

const DATE = new Intl.DateTimeFormat('vi-VN', {
  day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
});

/** Bề rộng / căn lề của tiêu đề cột theo loại cột. */
const HEAD_CLASS: Record<EntryColumn['kind'], string> = {
  taxonomy: 'w-40',
  field: 'w-36',
  status: 'w-32',
  locale: 'w-14 text-center',
  updated: 'w-40 text-right',
};

/** Một ô của bảng theo loại cột. */
function Cell({
  col,
  row,
  now,
  firstTaxonomyField,
}: {
  col: EntryColumn;
  row: AdminEntryRow;
  now: number;
  firstTaxonomyField: string | null;
}) {
  switch (col.kind) {
    case 'taxonomy': {
      const names = row.taxonomies
        .filter((t) => (t.fieldKey ?? firstTaxonomyField) === col.fieldKey)
        .map((t) => t.name);
      return <td className={cn(ui.td, 'text-shell-muted')}>{names.length ? names.join(', ') : '—'}</td>;
    }
    case 'field':
      return (
        <td className={cn(ui.td, 'text-shell-muted', col.field.t === 'number' && 'tabular-nums')}>
          <span className="line-clamp-2 break-words">{formatCell(col.field, row.fields[col.field.key])}</span>
        </td>
      );
    case 'status': {
      const st = rowStatus(row, now);
      return (
        <td className={ui.td}>
          <Badge tone={st.tone} dot={st.tone === 'ok'}>
            {st.label}
          </Badge>
          {st.label === 'hẹn giờ' && row.publishedAt && (
            <div className="mt-1 text-mini text-shell-muted tabular-nums">{DATE.format(row.publishedAt)}</div>
          )}
        </td>
      );
    }
    case 'locale': {
      const look = LOCALE_LOOK[localeState(row.locales[col.code] ?? { translated: 0, total: 0 })];
      return (
        <td className={cn(ui.td, 'text-center', look.cls)} title={look.title}>
          <span aria-hidden>{look.mark}</span>
          <span className="sr-only">{look.title}</span>
        </td>
      );
    }
    case 'updated':
      return (
        <td className={cn(ui.td, 'text-right text-shell-muted tabular-nums')}>
          {DATE.format(row.updatedAt)}
          <div className="font-shell-mono text-mini">{row.updatedBy}</div>
        </td>
      );
  }
}

export function EntryTable(props: {
  typeKey: string;
  typeName: string;
  rows: AdminEntryRow[];
  total: number;
  counts: { all: number; published: number; draft: number; scheduled: number; archived: number };
  taxonomies: { id: string; key: string; name: string; parentId: string | null }[];
  /** Mọi cột chọn được và cột đang hiện — xem `entry-columns.ts`. */
  columns: EntryColumn[];
  visibleColumns: string[];
  /** Field taxonomy đầu tiên: mục có `fieldKey` null thuộc về nó. */
  firstTaxonomyField: string | null;
  page: number;
  pageSize: number;
  filter: { status: string; taxonomy: string; q: string };
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const [pending, start] = useTransition();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [q, setQ] = useState(props.filter.q);
  const [busy, setBusy] = useState(false);
  /** Bài đang chờ xác nhận xoá hẳn. */
  const [purging, setPurging] = useState<{ id: string; title: string } | null>(null);

  const [shown, setShown] = useState<string[]>(props.visibleColumns);

  const now = Date.now();
  const cols = props.columns.filter((c) => shown.includes(c.id));

  /**
   * Bật/tắt một cột. Ghi cookie để lần sau server render đúng ngay; không tải lại
   * trang — dữ liệu của mọi cột chọn được đã có sẵn trong hàng.
   */
  function setColumns(ids: string[]) {
    const ordered = props.columns.filter((c) => ids.includes(c.id)).map((c) => c.id);
    setShown(ordered);
    document.cookie =
      `${columnsCookie(props.typeKey)}=${serializeColumnIds(ordered)}; path=/builder; max-age=31536000; samesite=lax`;
  }
  const pageCount = Math.max(1, Math.ceil(props.total / props.pageSize));
  const archivedView = props.filter.status === 'archived';

  function go(patch: Record<string, string | undefined>) {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === '' || v === 'all') next.delete(k);
      else next.set(k, v);
    }
    // Đổi bộ lọc thì về trang 1: giữ `page=3` khi vừa lọc còn 2 kết quả cho một
    // bảng trống mà không có lý do nhìn thấy được.
    if (!('page' in patch)) next.delete('page');
    start(() => router.push(`/builder/content/${props.typeKey}?${next.toString()}`));
  }

  function toggle(id: string) {
    setPicked((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** Dòng nào mỗi hành động thật sự đổi được — xem `bulk-status.ts`. */
  const targets = bulkTargets(props.rows, picked);

  async function bulk(action: 'publish' | 'draft' | 'archive') {
    setBusy(true);
    // Tuần tự, không `Promise.all`: mỗi lần đổi trạng thái gọi `revalidateTag`,
    // và bắn 50 lượt cùng lúc là 50 lượt invalidate cho cùng một tag.
    for (const id of targets[action]) {
      if (action === 'archive') {
        // DELETE ở đây là LƯU TRỮ, không xoá hẳn — bài rời site và rời bảng này,
        // dữ liệu còn nguyên. Xoá hẳn là một hành động riêng (`?purge=1`) và cố ý
        // không có mặt trong một thao tác hàng loạt.
        await fetch(`/api/collections/entries/${id}`, { method: 'DELETE' });
        continue;
      }
      await fetch(`/api/collections/entries/${id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: action === 'publish' ? 'published' : 'draft' }),
      });
    }
    setPicked(new Set());
    setBusy(false);
    router.refresh();
  }

  /**
   * Khôi phục, hoặc xoá hẳn, MỘT bài đã ở trong lưu trữ.
   *
   * Xoá hẳn cố ý KHÔNG có mặt trong thao tác hàng loạt: một lần bấm không lùi được
   * làm mất 50 bài là hình dạng tệ nhất mà màn này có thể có. Từng hàng, từng câu hỏi
   * — câu hỏi là `ConfirmDialog` ở cuối bảng, mở bằng nút "Xoá hẳn" của hàng.
   */
  async function restoreOrPurge(id: string, purge: boolean) {
    setBusy(true);
    await fetch(`/api/collections/entries/${id}?${purge ? 'purge=1' : 'restore=1'}`, {
      method: 'DELETE',
    });
    setBusy(false);
    setPurging(null);
    router.refresh();
  }

  const PILLS: TabItem[] = [
    { id: 'all', label: 'Tất cả', count: props.counts.all },
    { id: 'published', label: 'Đã đăng', count: props.counts.published },
    { id: 'draft', label: 'Nháp', count: props.counts.draft },
    { id: 'scheduled', label: 'Hẹn giờ', count: props.counts.scheduled },
    // Chỉ hiện KHI CÓ. Một tab "Đã xoá 0" đứng thường trực là một tab người dùng học
    // cách lờ đi, và lúc nó có nội dung thật thì họ đã lờ nó rồi.
    ...(props.counts.archived > 0 || archivedView
      ? [{ id: 'archived', label: 'Đã xoá', count: props.counts.archived }]
      : []),
  ];

  const allPicked = props.rows.length > 0 && picked.size === props.rows.length;

  return (
    <div className={cn('flex flex-col gap-4 transition-opacity', pending && 'opacity-60')}>
      {/* ── Thanh lọc ─────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2.5">
        <Tabs
          label="Lọc theo trạng thái"
          items={PILLS}
          value={props.filter.status}
          onChange={(id) => go({ status: id })}
        />

        <div className="ml-auto flex flex-wrap items-center gap-2.5">
          <form
            role="search"
            onSubmit={(e) => {
              e.preventDefault();
              go({ q });
            }}
            className="flex min-w-0 items-center gap-2"
          >
            <SearchField
              label="Tìm trong nội dung"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Tìm trong nội dung…"
              wrapperClassName="w-[17.5rem] min-w-0 shrink"
            />
            <Button type="submit">Tìm</Button>
            {props.filter.q && (
              <Button
                variant="ghost"
                onClick={() => {
                  setQ('');
                  go({ q: '' });
                }}
              >
                bỏ tìm
              </Button>
            )}
          </form>

          {props.taxonomies.length > 0 && (
            <SelectField
              label="Danh mục"
              hideLabel
              value={props.filter.taxonomy}
              onChange={(e) => go({ taxonomy: e.target.value })}
              className="w-auto"
            >
              <option value="">Mọi danh mục</option>
              {props.taxonomies.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.parentId ? `— ${t.name}` : t.name}
                </option>
              ))}
            </SelectField>
          )}

          <Popover
            label="Chọn cột hiển thị"
            panelClassName="w-64 p-3"
            trigger={(p) => (
              <Button {...p} icon="sliders" title="Chọn cột hiển thị">
                Cột
              </Button>
            )}
          >
            <div className="flex flex-col gap-0.5">
              <span className={cn(ui.eyebrow, 'pb-1')}>Cột hiển thị</span>
              <span className="text-mini text-shell-muted">Tiêu đề luôn hiện.</span>
              {props.columns.map((c) => (
                <Checkbox
                  key={c.id}
                  label={c.label}
                  checked={shown.includes(c.id)}
                  onChange={(e) =>
                    setColumns(e.target.checked ? [...shown, c.id] : shown.filter((x) => x !== c.id))
                  }
                />
              ))}
              <Button
                variant="ghost"
                size="sm"
                className="mt-1.5 self-start"
                onClick={() => setColumns(defaultColumnIds(props.columns))}
              >
                Về mặc định
              </Button>
            </div>
          </Popover>
        </div>
      </div>

      {/* ── Thao tác hàng loạt: chỉ hiện khi có dòng được chọn ─────── */}
      {picked.size > 0 && !archivedView && (
        <div className="flex flex-wrap items-center gap-2.5 rounded-lg bg-shell-accent-soft py-2.5 pr-3 pl-4.5">
          <span className="text-ui font-semibold tabular-nums">Đã chọn {picked.size}</span>
          <span className="ml-auto flex flex-wrap gap-2">
            {/* Mỗi nút chỉ hiện khi có dòng nó đổi được; chọn lẫn lộn thì nút ghi
                số dòng nó sẽ đụng tới, để "Đăng" không nghe như "đăng cả 12". */}
            {targets.publish.length > 0 && (
              <Button variant="primary" size="md" icon="send" disabled={busy} onClick={() => void bulk('publish')}>
                {targets.publish.length < picked.size ? `Đăng ${targets.publish.length}` : 'Đăng'}
              </Button>
            )}
            {targets.draft.length > 0 && (
              <Button size="md" disabled={busy} onClick={() => void bulk('draft')}>
                {targets.draft.length < picked.size
                  ? `Chuyển ${targets.draft.length} về nháp`
                  : 'Chuyển về nháp'}
              </Button>
            )}
            <Button
              variant="danger"
              size="md"
              disabled={busy}
              onClick={() => void bulk('archive')}
              title="Bài rời site và rời bảng này. Dữ liệu còn nguyên."
            >
              Lưu trữ
            </Button>
            <Button variant="ghost" size="md" onClick={() => setPicked(new Set())}>
              bỏ chọn
            </Button>
          </span>
        </div>
      )}

      {/* ── Bảng ──────────────────────────────────────────────────── */}
      {props.rows.length === 0 ? (
        <EmptyState
          compact
          icon={archivedView ? 'trash' : 'search'}
          title={archivedView ? 'Lưu trữ trống.' : 'Không có mục nào khớp bộ lọc.'}
        />
      ) : (
        <div className={ui.tableWrap}>
          <table className={cn(ui.table, 'min-w-[56rem]')}>
            <caption className="sr-only">Mục {props.typeName}</caption>
            <thead>
              <tr>
                <th scope="col" className={cn(ui.th, 'w-11')}>
                  <Checkbox
                    label="Chọn cả trang"
                    hideLabel
                    checked={allPicked}
                    onChange={(e) =>
                      setPicked(e.target.checked ? new Set(props.rows.map((r) => r.id)) : new Set())
                    }
                  />
                </th>
                <th scope="col" className={ui.th}>Tiêu đề</th>
                {cols.map((c) => (
                  <th key={c.id} scope="col" className={cn(ui.th, HEAD_CLASS[c.kind])}>
                    {c.label}
                  </th>
                ))}
                {archivedView && (
                  <th scope="col" className={cn(ui.th, 'text-right')}>
                    Lưu trữ
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {props.rows.map((r) => {
                const on = picked.has(r.id);
                return (
                  <tr key={r.id} className={cn(ui.tr, on && 'bg-shell-accent-soft hover:bg-shell-accent-soft')}>
                    <td className={ui.td}>
                      <Checkbox label={`Chọn ${r.title}`} hideLabel checked={on} onChange={() => toggle(r.id)} />
                    </td>
                    <td className={ui.td}>
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <Link
                          href={`/builder/content/${props.typeKey}/${r.id}`}
                          className={cn(
                            'self-start rounded-sm text-ui font-semibold text-shell-ink underline-offset-4 hover:text-shell-accent hover:underline',
                            focusRing,
                          )}
                        >
                          {r.title}
                        </Link>
                        <span className="font-shell-mono text-mini break-all text-shell-muted">/{r.slug}</span>
                      </div>
                    </td>
                    {cols.map((c) => (
                      <Cell key={c.id} col={c} row={r} now={now} firstTaxonomyField={props.firstTaxonomyField} />
                    ))}
                    {archivedView && (
                      <td className={cn(ui.td, 'text-right whitespace-nowrap')}>
                        <span className="inline-flex gap-2">
                          <Button
                            size="sm"
                            icon="undo"
                            disabled={busy}
                            onClick={() => void restoreOrPurge(r.id, false)}
                          >
                            Khôi phục
                          </Button>
                          <Button
                            size="sm"
                            variant="danger"
                            disabled={busy}
                            onClick={() => setPurging({ id: r.id, title: r.title })}
                          >
                            Xoá hẳn
                          </Button>
                        </span>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Phân trang: giữ nguyên mọi bộ lọc đang có ──────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-small text-shell-muted tabular-nums">
          {props.total} mục · trang {props.page}/{pageCount}
        </span>
        <span className="ml-auto flex flex-wrap items-center gap-2">
          <Button
            size="md"
            icon="chevron-left"
            disabled={props.page <= 1}
            onClick={() => go({ page: String(props.page - 1) })}
          >
            Trước
          </Button>
          <Button
            size="md"
            iconRight="chevron-right"
            disabled={props.page >= pageCount}
            onClick={() => go({ page: String(props.page + 1) })}
          >
            Sau
          </Button>
          <SelectField
            label="Số mục mỗi trang"
            hideLabel
            size="md"
            value={String(props.pageSize)}
            onChange={(e) => go({ size: e.target.value })}
            className="w-auto"
            options={[20, 50, 100].map((n) => ({ value: String(n), label: `${n} / trang` }))}
          />
        </span>
      </div>

      <ConfirmDialog
        open={purging !== null}
        onClose={() => setPurging(null)}
        onConfirm={() => {
          if (purging) void restoreOrPurge(purging.id, true);
        }}
        title={`Xoá hẳn "${purging?.title ?? ''}"?`}
        consequence="Bài và toàn bộ bản dịch của nó mất vĩnh viễn. Không có đường lùi."
        confirmLabel="Xoá hẳn"
        busy={busy}
      />
    </div>
  );
}
