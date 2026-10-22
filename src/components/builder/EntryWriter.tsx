'use client';

/**
 * Ô "Tác giả" của form bài — người đứng tên bài trên site (byline: tên + avatar).
 *
 * Mặc định là người tạo bài (`Entry.createdBy` được ghi lúc tạo). Đổi được sang một
 * tài khoản khác trong danh sách — ba ca có thật nằm trong docblock của route
 * `entries/[id]/author`: nhập bài cũ, soạn hộ, tác giả nghỉ việc.
 *
 * Chỉ ADMIN đổi được (route là `admin`). Không phải admin thì `options` rỗng và ô chỉ
 * hiện tác giả, kèm một câu nói ai đổi được — một nút tối không giải thích được gì.
 *
 * Danh sách hiện tên + avatar + email: hai tài khoản trùng tên vẫn phân biệt được.
 */

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import { cn } from '@/lib/builder/cn';
import { focusRing, ui } from '@/lib/builder/ui';
import { personLabel, type ActivityPerson, type WriterOption } from '@/lib/collections/entry-activity';
import { Avatar } from './ui/Badge';
import { Button } from './ui/Button';

export function PersonLine({ person, sub }: { person: ActivityPerson | null; sub?: React.ReactNode }) {
  const name = personLabel(person);
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <Avatar name={name} src={person?.avatarUrl} size="sm" />
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-small font-medium">{name}</span>
        {sub && <span className="truncate text-mini text-shell-muted">{sub}</span>}
      </span>
    </span>
  );
}

export function EntryWriter({
  entryId,
  writer,
  options,
}: {
  /** `null` với bài chưa lưu — tác giả sẽ là người bấm Lưu đầu tiên. */
  entryId: string | null;
  writer: ActivityPerson | null;
  /** Rỗng = không có quyền đổi (không phải admin). */
  options: WriterOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  async function pick(email: string) {
    if (!entryId || email === writer?.email) return setOpen(false);
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/collections/entries/${entryId}/author`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        setError(json.error ?? `Lỗi ${res.status}`);
        return;
      }
      setOpen(false);
      setQ('');
      router.refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  const term = q.trim().toLowerCase();
  const shown = term
    ? options.filter((o) => `${o.name ?? ''} ${o.email}`.toLowerCase().includes(term))
    : options;

  if (!entryId) {
    return <p className="text-small text-shell-muted">Bài mới — tác giả là bạn. Đổi được sau khi lưu.</p>;
  }

  return (
    <div ref={root} className="relative flex min-w-0 flex-col gap-2">
      {/* Email ở dòng phụ chỉ khi có tên — không thì `personLabel` đã in chính email đó. */}
      <PersonLine person={writer} sub={writer?.name?.trim() ? writer.email : undefined} />
      {options.length > 0 ? (
        <Button
          variant="secondary"
          size="sm"
          iconRight="chevron-down"
          aria-haspopup="listbox"
          aria-expanded={open}
          loading={busy}
          onClick={() => setOpen((v) => !v)}
          className="self-start"
        >
          Đổi tác giả
        </Button>
      ) : (
        <p className={ui.hint}>Chỉ quản trị viên đổi được tác giả.</p>
      )}

      {open && (
        <div className={cn(ui.pop, 'absolute top-full right-0 left-0 z-30 mt-1.5 flex flex-col gap-2 p-2')}>
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Tìm theo tên hoặc email"
            aria-label="Tìm tài khoản"
            className={ui.fieldSm}
          />
          <ul role="listbox" aria-label="Chọn tác giả" className="flex max-h-72 flex-col overflow-y-auto">
            {shown.map((o) => (
              <li key={o.email}>
                <button
                  type="button"
                  role="option"
                  aria-selected={o.email === writer?.email}
                  disabled={busy}
                  onClick={() => void pick(o.email)}
                  className={cn(
                    ui.menuItem,
                    focusRing,
                    'w-full',
                    o.email === writer?.email && 'bg-shell-accent-soft',
                  )}
                >
                  <PersonLine
                    person={o}
                    sub={[o.name?.trim() ? o.email : null, o.locked ? 'đã khoá' : null].filter(Boolean).join(' · ') || undefined}
                  />
                </button>
              </li>
            ))}
            {shown.length === 0 && <li className="px-2.5 py-2 text-small text-shell-muted">Không có tài khoản nào khớp.</li>}
          </ul>
        </div>
      )}

      {error && (
        <p role="alert" className={ui.error}>
          {error}
        </p>
      )}
    </div>
  );
}
