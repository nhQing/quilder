'use client';

/**
 * Phần client của thư viện component: lưới thẻ lọc theo nhóm, và thao tác trên một
 * component — tạo, nhân bản, đổi thông tin, xoá.
 *
 * Mọi thao tác đi qua `/api/presets*` — cùng đường mà tool AI dùng, nên hai bên
 * không thể trôi khỏi nhau về mặt kiểm tra.
 */

import Link from 'next/link';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import { cn } from '@/lib/builder/cn';
import { ui } from '@/lib/builder/ui';

import { ComponentThumb } from './ComponentPreview';
import { Badge } from './ui/Badge';
import { Button, ButtonLink } from './ui/Button';
import { TextArea, TextField } from './ui/Field';
import { ConfirmDialog, Dialog, MenuButton, Toast, ToastRegion } from './ui/Overlay';
import { Tabs } from './ui/Tabs';

function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const run = async (
    fn: () => Promise<Response>,
    onOk: (data: Record<string, unknown>) => void,
  ) => {
    setBusy(true);
    setNote(null);
    try {
      const res = await fn();
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        // Hiện đúng thông điệp của server. Nó nói được vì sao — ví dụ component
        // builtin sẽ bị trích xuất tạo lại — còn "Lỗi 409" thì không.
        setNote({ ok: false, text: String(data.error ?? `Không thực hiện được (${res.status})`) });
        return;
      }
      onOk(data);
    } catch {
      setNote({ ok: false, text: 'Mất kết nối' });
    } finally {
      setBusy(false);
    }
  };

  return { busy, note, setNote, run, router };
}

function Note({ note }: { note: { ok: boolean; text: string } | null }) {
  if (!note) return null;
  return (
    <p
      role="status"
      className={cn('text-small font-medium', note.ok ? 'text-shell-ok' : 'text-shell-danger')}
    >
      {note.text}
    </p>
  );
}

/** Nhân bản qua API rồi mở bản sao — dùng chung cho thẻ ở thư viện và trang chi tiết. */
function duplicateRequest(id: string) {
  return fetch('/api/presets', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ from: id }),
  });
}

/* ── Lưới thư viện ────────────────────────────────────────────────────── */

export interface ComponentCardData {
  id: string;
  key: string;
  name: string;
  category: string;
  about: string;
  builtin: boolean;
  /** Ngày sửa cuối, đã định dạng ở server (`when`) để hai phía vẽ cùng một chuỗi. */
  edited: string;
  versions: number;
}

/** Id của tab "Tất cả" — không trùng được với một nhóm thật. */
const ALL = '*';

export function ComponentLibrary({ items }: { items: readonly ComponentCardData[] }) {
  const { busy, note, setNote, run, router } = useAction();
  const [group, setGroup] = useState(ALL);

  // Thứ tự nhóm theo thứ tự server đã sắp (nhóm, rồi tên), nên tab và lưới cùng nhịp.
  const groups = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of items) counts.set(c.category, (counts.get(c.category) ?? 0) + 1);
    return [...counts];
  }, [items]);

  const duplicate = (id: string) =>
    void run(
      () => duplicateRequest(id),
      (data) => {
        const preset = data.preset as { id: string };
        router.push(`/builder/components/${preset.id}`);
      },
    );

  return (
    <>
      <Tabs
        label="Lọc theo nhóm"
        value={group}
        onChange={setGroup}
        className="self-start"
        items={[
          { id: ALL, label: 'Tất cả', count: items.length },
          ...groups.map(([category, count]) => ({ id: category, label: category, count })),
        ]}
      />

      {/* Lọc bằng `hidden`, không bỏ thẻ khỏi cây: bỏ ra rồi gắn lại thì mỗi lần
          đổi tab mọi hình thu nhỏ nạp lại iframe từ đầu. */}
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(15.625rem,1fr))] gap-5">
        {items.map((c) => (
          <ComponentCard
            key={c.id}
            c={c}
            hidden={group !== ALL && c.category !== group}
            busy={busy}
            onDuplicate={() => duplicate(c.id)}
          />
        ))}
      </ul>

      {note && !note.ok && (
        <ToastRegion>
          <Toast
            tone="danger"
            title="Không nhân bản được"
            description={note.text}
            onClose={() => setNote(null)}
          />
        </ToastRegion>
      )}
    </>
  );
}

const BULLET =
  'relative pl-3.5 before:absolute before:top-[0.6em] before:left-0.5 before:size-1.25 before:rounded-full before:bg-current before:opacity-55';

function ComponentCard({
  c,
  hidden,
  busy,
  onDuplicate,
}: {
  c: ComponentCardData;
  hidden: boolean;
  busy: boolean;
  onDuplicate: () => void;
}) {
  const href = `/builder/components/${c.id}`;

  return (
    // `has-[…]:z-20`: thẻ đang mở menu phải nổi trên thẻ bên cạnh, vì hover nhấc
    // thẻ (transform) tạo một lớp xếp chồng riêng và menu bị kẹt trong lớp đó.
    <li
      hidden={hidden}
      className={cn(
        ui.card,
        ui.cardHover,
        'relative flex min-w-0 flex-col gap-3.5 p-4 has-[[aria-expanded=true]]:z-20',
      )}
    >
      <div className="relative h-34 overflow-hidden rounded-md bg-shell-raised p-3">
        <ComponentThumb componentId={c.id} name={c.name} />
        <Badge size="sm" tone={c.builtin ? 'neutral' : 'accent'} className="absolute top-2.5 left-2.5">
          {c.builtin ? 'Có sẵn' : 'Tự tạo'}
        </Badge>
      </div>

      {/* Nằm NGOÀI khung hình: khung có `overflow-hidden`, menu đặt trong đó sẽ bị cắt. */}
      <MenuButton
        label={`Tuỳ chọn cho ${c.name}`}
        className="absolute top-5.5 right-5.5 z-10 rounded bg-shell-panel"
        items={[
          { label: 'Mở canvas', icon: 'edit', href: `${href}/edit` },
          { label: 'Xem chi tiết', icon: 'info', href },
          { label: 'Nhân bản', icon: 'copy', onSelect: onDuplicate, disabled: busy },
        ]}
      />

      <div className="flex min-w-0 flex-col gap-1 px-1.5">
        <h3 className="truncate text-card font-semibold">
          {/* Link phủ cả thẻ qua `::after`; nút "…" và "Mở" nổi trên nó bằng `z-10`. */}
          <Link
            href={href}
            title={c.about || undefined}
            className="outline-none after:absolute after:inset-0 after:rounded-lg focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-shell-accent"
          >
            {c.name}
          </Link>
        </h3>
        <p className="truncate font-shell-mono text-small text-shell-muted">{c.key}</p>
      </div>

      <ul className="flex flex-col gap-1.5 px-1.5 text-small text-shell-muted">
        <li className={BULLET}>Nhóm: {c.category}</li>
        <li className={BULLET}>{c.versions ? `${c.versions} phiên bản` : 'Chưa sửa lần nào'}</li>
      </ul>

      <div className="mt-auto flex items-center justify-between gap-2.5 border-t border-shell-line px-1.5 pt-3">
        <span className="text-mini text-shell-muted">Sửa {c.edited}</span>
        <ButtonLink
          href={`${href}/edit`}
          variant="ghost"
          size="sm"
          iconRight="arrow-right"
          aria-label={`Mở canvas của ${c.name}`}
          className="relative z-10"
        >
          Mở
        </ButtonLink>
      </div>
    </li>
  );
}

/* ── Tạo mới ──────────────────────────────────────────────────────────── */

export function NewComponentButton() {
  const { busy, note, setNote, run, router } = useAction();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const formId = useId();
  const input = useRef<HTMLInputElement>(null);

  // Sau `showModal()` của Dialog (effect của con chạy trước): `showModal` tự dời
  // focus về phần tử bấm được đầu tiên — nút đóng — nên `autoFocus` không giữ được.
  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  const close = () => {
    if (busy) return;
    setOpen(false);
    setNote(null);
  };

  const create = () => {
    if (!name.trim()) return;
    void run(
      () =>
        fetch('/api/presets', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name }),
        }),
      (data) => {
        const preset = data.preset as { id: string };
        router.push(`/builder/components/${preset.id}`);
      },
    );
  };

  return (
    <>
      <Button variant="primary" icon="plus" onClick={() => setOpen(true)}>
        Component mới
      </Button>

      {open && (
        <Dialog
          open
          onClose={close}
          dismissable={!busy}
          title="Component mới"
          description="Bắt đầu từ một Section trống. Đặt tên rồi dựng nội dung trong canvas."
          actions={
            <>
              <Button variant="secondary" onClick={close} disabled={busy}>
                Huỷ
              </Button>
              <Button variant="primary" type="submit" form={formId} loading={busy} disabled={!name.trim()}>
                Tạo component
              </Button>
            </>
          }
        >
          <form
            id={formId}
            onSubmit={(e) => {
              e.preventDefault();
              create();
            }}
          >
            <TextField
              ref={input}
              label="Tên component mới"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ví dụ: Thẻ tin"
              autoComplete="off"
            />
          </form>
          <Note note={note} />
        </Dialog>
      )}
    </>
  );
}

/* ── Thao tác trên một component ──────────────────────────────────────── */

export function ComponentActions({
  id,
  name,
  builtin,
}: {
  id: string;
  name: string;
  builtin: boolean;
}) {
  const { busy, note, run, router } = useAction();
  const [confirming, setConfirming] = useState(false);

  const duplicate = () =>
    void run(
      () => duplicateRequest(id),
      (data) => {
        const preset = data.preset as { id: string };
        router.push(`/builder/components/${preset.id}`);
      },
    );

  // Xoá là thao tác duy nhất ở đây không lùi được bằng version, nên nó hỏi.
  const remove = () =>
    void run(
      () => fetch(`/api/presets/${id}`, { method: 'DELETE' }),
      () => router.push('/builder/components'),
    ).finally(() => setConfirming(false));

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-col gap-2">
        <Button variant="secondary" icon="copy" full disabled={busy} onClick={duplicate}>
          Nhân bản
        </Button>
        {/* Builtin: server từ chối xoá (409). Khoá sẵn ở đây và nói lý do ngay dưới,
            thay vì để người dùng xác nhận xong mới biết là không được. */}
        <Button
          variant="danger"
          icon="trash"
          full
          disabled={busy || builtin}
          onClick={() => setConfirming(true)}
        >
          Xoá component
        </Button>
      </div>
      {builtin && (
        <p className={ui.hint}>
          Component có sẵn không xoá được: lần chạy{' '}
          <code className="font-shell-mono">extract-presets.ts</code> sau sẽ tạo lại nó. Nhân bản
          rồi sửa bản sao.
        </p>
      )}
      <Note note={note} />

      {confirming && (
        <ConfirmDialog
          open
          onClose={() => setConfirming(false)}
          onConfirm={remove}
          busy={busy}
          title={`Xoá component “${name}”?`}
          consequence="Component và cả lịch sử sửa của nó bị xoá hẳn, không lùi lại được. Trang đã chèn bản sao của nó thì không đổi."
          confirmLabel="Xoá vĩnh viễn"
        />
      )}
    </div>
  );
}

/* ── Sửa thông tin ────────────────────────────────────────────────────── */

export function ComponentMetaForm({
  id,
  name: initialName,
  category: initialCategory,
  about: initialAbout,
}: {
  id: string;
  name: string;
  category: string;
  about: string;
}) {
  const { busy, note, run, router } = useAction();
  const [name, setName] = useState(initialName);
  const [category, setCategory] = useState(initialCategory);
  const [about, setAbout] = useState(initialAbout);

  const dirty =
    name !== initialName || category !== initialCategory || about !== initialAbout;

  const save = () =>
    void run(
      () =>
        fetch(`/api/presets/${id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name, category, aiDescription: about }),
        }),
      () => router.refresh(),
    );

  return (
    <div className="flex flex-col gap-4">
      <TextField label="Tên" value={name} onChange={(e) => setName(e.target.value)} />
      <TextField label="Nhóm" mono value={category} onChange={(e) => setCategory(e.target.value)} />

      {/* Đây không phải ghi chú nội bộ: chính chuỗi này là thứ AI đọc để quyết
          định có dùng component hay không. */}
      <TextArea
        label="Mô tả cho AI"
        rows={3}
        value={about}
        onChange={(e) => setAbout(e.target.value)}
        className="resize-y"
        hint="AI đọc chuỗi này để biết khi nào nên chèn component. Viết như mô tả cho người mới: dùng ở đâu, chứa gì."
      />

      <div className="flex flex-wrap items-center gap-2.5">
        <Button variant="secondary" disabled={!dirty} loading={busy} onClick={save}>
          {busy ? 'Đang lưu…' : 'Lưu'}
        </Button>
        {dirty && <Badge tone="warn">chưa lưu</Badge>}
      </div>
      <Note note={note} />
    </div>
  );
}
