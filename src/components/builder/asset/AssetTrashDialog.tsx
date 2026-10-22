'use client';

/**
 * Dialog "Xoá hoàn toàn" (ảnh đang chọn) và "Dọn sạch thùng rác" (cả rác). Chỉ admin.
 *
 * ## Luồng
 *
 * 1. Mở là gọi NGAY `purge` với `dryRun` — để biết ảnh nào bị chặn (còn dùng), bao
 *    nhiêu release cũ dùng ảnh. Trong lúc đó nút xác nhận khoá.
 * 2. Người dùng đọc, rồi GÕ cụm xác nhận. Cụm cố định (không theo tên file: nhiều ảnh,
 *    tên dài; không theo số: gõ máy móc).
 * 3. Xác nhận chạy THEO LÔ — đúng các lô `batches` mà dryRun trả, mỗi lô kèm token xác
 *    nhận của chính nó (C3). Hiện tiến độ x/N. Vì danh sách lấy từ dryRun nên "dọn
 *    sạch" không cần route xoá-tất-cả.
 * 4. Server tính lại danh sách lúc xoá; khác lúc xem (ảnh vừa được dùng, cửa sổ lùi vừa
 *    trôi, token quá 5 phút) thì trả 409. Chưa xoá lô nào thì hộp tự kiểm lại và bắt gõ
 *    lại cụm xác nhận — người bấm phải nhìn danh sách mới trước khi xoá.
 *
 * Hình theo ConfirmDialog của design system: `<dialog>` + `showModal()`, hậu quả có số
 * thật trong khối `Consequence`, nút xác nhận `danger-solid` nói hậu quả. Không dùng
 * thẳng `ConfirmDialog` của `ui/`: hộp này cần so cụm gõ theo NFC và không phân biệt
 * hoa/thường, xoá ô gõ sau 409, và hiện tiến độ theo lô.
 *
 * Release cũ dùng ảnh KHÔNG chặn xoá. Release trong cửa sổ lùi được giữ file (E2) — chỉ
 * thông báo; release ngoài cửa sổ sẽ vỡ ảnh — cảnh báo.
 */

import { useEffect, useId, useMemo, useRef, useState } from 'react';

import type {
  OldReleaseRef,
  PurgePreview,
  PurgeResult,
  SkippedAsset,
} from '@/lib/assets/trash-types';
import { cn } from '@/lib/builder/cn';
import { ui } from '@/lib/builder/ui';

import { Progress } from '../ui/Badge';
import { Button, IconButton, Spinner } from '../ui/Button';
import { TextField } from '../ui/Field';
import { Consequence } from '../ui/Overlay';
import { type AssetNoteData } from './AssetNote';
import { AssetThumb } from './AssetThumb';
import { BlockedAssetList } from './AssetUsageList';
import { displayName } from './types';

const THUMB_MAX = 40;
const RELEASE_MAX = 8;

const PHRASE = {
  'purge-selected': 'xoá hoàn toàn',
  'empty-trash': 'dọn sạch thùng rác',
} as const;

/** Kết quả trả lên cha khi dialog xong việc (hoặc dừng vì lỗi cần note). */
export interface AssetTrashDone {
  /** Id đã xoá hoàn toàn. */
  purged: string[];
  /** Ảnh bị bỏ qua (từ dryRun + từ lúc xoá). */
  skipped: SkippedAsset[];
  /** Key S3 chưa xoá được. */
  s3Failed: string[];
  /** Note dựng sẵn để cha hiện. Cha nên `router.refresh()` khi `purged.length > 0`. */
  note: AssetNoteData;
}

type Call<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

async function post<T>(url: string, body: unknown): Promise<Call<T>> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) return { ok: false, status: res.status, error: json.error ?? `Lỗi ${res.status}` };
    return { ok: true, data: json };
  } catch (e) {
    return { ok: false, status: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

const norm = (s: string) => s.normalize('NFC').trim().toLowerCase();
const imgs = (n: number) => `${n} ảnh`;

export function AssetTrashDialog({
  mode,
  ids,
  onClose,
  onDone,
}: {
  mode: 'purge-selected' | 'empty-trash';
  /** Bắt buộc với `purge-selected`: các ảnh (trong thùng rác) định xoá hoàn toàn. */
  ids?: string[];
  onClose: () => void;
  onDone: (result: AssetTrashDone) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const uid = useId();
  const [preview, setPreview] = useState<PurgePreview | null>(null);
  const [checking, setChecking] = useState(true);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [showReleases, setShowReleases] = useState(false);
  const [attempt, setAttempt] = useState(0);
  /** Lần xác nhận trước bị server từ chối vì danh sách đã đổi; hiện tới lần bấm sau. */
  const [stale, setStale] = useState<string | null>(null);

  const phrase = PHRASE[mode];

  useEffect(() => {
    const d = dialog.current;
    if (d && !d.open) d.showModal();
  }, []);

  useEffect(() => {
    let alive = true;
    setChecking(true);
    setError(null);
    const body = mode === 'empty-trash' ? { dryRun: true, all: true } : { dryRun: true, ids: ids ?? [] };
    void post<PurgePreview>('/api/assets/purge', body).then((r) => {
      if (!alive) return;
      setChecking(false);
      if (r.ok) setPreview(r.data);
      else if (r.status === 403) setError('Bạn không có quyền xoá hoàn toàn ảnh. Nhờ admin xử lý.');
      else setError(`Không kiểm tra được ảnh nào còn dùng: ${r.error}. Chưa có ảnh nào bị xoá.`);
    });
    return () => {
      alive = false;
    };
    // `ids` đổi tham chiếu mỗi render của cha; chỉ chạy lại khi bấm "Kiểm tra lại".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, attempt]);

  const deletable = useMemo(() => preview?.deletable ?? [], [preview]);
  const blocked = useMemo(() => preview?.blocked ?? [], [preview]);
  const releases: OldReleaseRef[] = preview?.oldReleases ?? [];
  const heldReleases = releases.filter((r) => r.inWindow);
  const brokenReleases = releases.filter((r) => !r.inWindow);
  const X = deletable.length;
  const Y = blocked.length;
  const matched = norm(typed) === phrase;
  const canConfirm = !busy && !checking && !!preview && X > 0 && matched;

  const single = mode === 'purge-selected' && (ids?.length ?? 0) === 1;
  const singleKey = single ? (deletable[0]?.key ?? blocked[0]?.key ?? null) : null;

  async function run() {
    if (!canConfirm || !preview) return;
    setBusy(true);
    setError(null);
    setStale(null);
    setProgress(0);

    const purged: string[] = [];
    const skipped = new Map<string, SkippedAsset>(blocked.map((b) => [b.id, b]));
    const s3Failed: string[] = [];
    const held: string[] = [];
    let fail: { status: number; error: string } | null = null;
    let sent = 0;

    for (const batch of preview.batches) {
      const r = await post<PurgeResult>('/api/assets/purge', {
        ids: batch.ids,
        confirmToken: batch.confirmToken,
      });
      if (!r.ok) {
        fail = r;
        break;
      }
      purged.push(...r.data.purged);
      for (const s of r.data.skipped) skipped.set(s.id, s);
      s3Failed.push(...r.data.s3Failed);
      held.push(...(r.data.held ?? []));
      sent += batch.ids.length;
      setProgress(Math.min(X, sent));
    }

    const skippedList = [...skipped.values()];

    // Danh sách đã đổi trước khi xoá được lô nào: kiểm lại ngay và bắt xác nhận lại trên
    // danh sách mới. Không đóng hộp — đóng là mất chỗ người dùng đang nhìn.
    if (fail && fail.status === 409 && purged.length === 0) {
      setBusy(false);
      setTyped('');
      setStale(`${fail.error} Hộp đã kiểm lại — xem danh sách mới rồi gõ xác nhận lần nữa.`);
      setAttempt((n) => n + 1);
      return;
    }

    // Chưa xoá được gì: lỗi hiện ngay trong dialog (hoặc note 403), không đóng.
    if (fail && purged.length === 0) {
      if (fail.status === 403) {
        onDone({
          purged,
          skipped: skippedList,
          s3Failed,
          note: { tone: 'error', text: 'Bạn không có quyền xoá hoàn toàn ảnh. Nhờ admin xử lý.' },
        });
        return;
      }
      setBusy(false);
      setError(`Không xoá hoàn toàn được: ${fail.error}. Chưa có ảnh nào bị xoá.`);
      return;
    }

    const parts = [
      purged.length > 0
        ? `Đã xoá hoàn toàn ${imgs(purged.length)}`
        : 'Không xoá hoàn toàn ảnh nào',
    ];
    if (skippedList.length > 0) parts.push(`bỏ qua ${imgs(skippedList.length)} đang dùng`);
    if (held.length > 0) {
      parts.push(`${held.length} file giữ lại trên máy chủ để lùi release cũ vẫn đúng`);
    }
    if (s3Failed.length > 0) {
      parts.push(
        `${s3Failed.length} file chưa xoá được khỏi máy chủ lưu trữ, sẽ thử lại sau`,
      );
    }
    if (fail) parts.push(`dừng giữa chừng: ${fail.error}`);

    onDone({
      purged,
      skipped: skippedList,
      s3Failed,
      note: {
        tone: skippedList.length > 0 || s3Failed.length > 0 || fail ? 'warn' : 'ok',
        text: parts.join(' · '),
        blocked: skippedList.length > 0 ? skippedList : undefined,
        s3Failed: s3Failed.length > 0 ? s3Failed : undefined,
      },
    });
  }

  const title =
    mode === 'empty-trash'
      ? `Dọn sạch thùng rác${preview ? ` (${imgs(X + Y)})` : ''}?`
      : null;

  const dangerText =
    mode === 'empty-trash'
      ? 'Mọi ảnh trong thùng rác sẽ rời thư viện và không khôi phục được. Không có đường lùi.'
      : 'Ảnh sẽ rời thư viện và không khôi phục được. Không có đường lùi.';

  const subject =
    mode === 'empty-trash'
      ? 'ít nhất một ảnh trong thùng rác'
      : (ids?.length ?? 0) > 1
        ? 'ít nhất một trong các ảnh này'
        : 'ảnh này';
  const windowText = preview?.rollbackWindow ?? 'cửa sổ lùi';
  const heldText =
    `${heldReleases.length} release cũ trong cửa sổ lùi (${windowText}) dùng ${subject}. ` +
    'File được giữ trên máy chủ để lùi về vẫn đúng, và tự xoá khi các release này ra khỏi cửa sổ.';
  const brokenText =
    `${brokenReleases.length} release cũ hơn cửa sổ lùi dùng ${subject} — lùi về các release này sẽ ra ảnh vỡ.`;

  const confirmLabel = busy
    ? 'Đang xoá…'
    : mode === 'empty-trash'
      ? `Dọn sạch ${imgs(X)}`
      : `Xoá hoàn toàn ${imgs(X)}`;

  return (
    <dialog
      ref={dialog}
      aria-labelledby={`${uid}-t`}
      aria-describedby={`${uid}-d`}
      onClose={onClose}
      onCancel={(e) => {
        if (busy) e.preventDefault();
      }}
      className={cn(ui.dialog, 'w-[min(35rem,92vw)]')}
    >
      <form
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
        className="relative flex min-w-0 flex-col gap-5 p-6"
      >
        <div className="flex min-w-0 flex-col gap-1.5 pr-10">
          <h2
            id={`${uid}-t`}
            className="min-w-0 truncate text-section font-semibold"
            title={singleKey ?? title ?? undefined}
          >
            {mode === 'empty-trash'
              ? title
              : singleKey
                ? `Xoá hoàn toàn “${displayName(singleKey)}”?`
                : `Xoá hoàn toàn ${imgs(ids?.length ?? 0)}?`}
          </h2>
          <p id={`${uid}-d`} className="max-w-[60ch] text-ui leading-relaxed text-shell-muted">
            {dangerText}
            {mode === 'purge-selected' && ' Nếu chỉ muốn ẩn, hãy để ảnh trong thùng rác.'}
          </p>
        </div>
        {!busy && (
          <IconButton
            icon="x"
            label="Đóng"
            onClick={() => dialog.current?.close()}
            className="absolute top-4 right-4"
          />
        )}

        <div className="flex max-h-[56svh] min-w-0 flex-col gap-4 overflow-y-auto">
          {checking && (
            <p className="flex items-center gap-2 text-small text-shell-muted">
              <Spinner />
              Đang kiểm tra ảnh nào còn dùng…
            </p>
          )}

          {stale && <Consequence tone="warn">{stale}</Consequence>}

          {/*
            Hậu quả có số đếm thật, trong khối `danger-soft` của ConfirmDialog. Release cũ
            hơn cửa sổ lùi là thứ VỠ thật; release trong cửa sổ chỉ là thông tin (file được
            giữ) — nên khi có cả hai, khối thứ hai hạ xuống tông cảnh báo.
          */}
          {brokenReleases.length > 0 && (
            <Consequence>
              {brokenText}{' '}
              <ReleaseToggle open={showReleases} onToggle={() => setShowReleases((v) => !v)} />
              {showReleases && <ReleaseLabels releases={brokenReleases} />}
            </Consequence>
          )}

          {heldReleases.length > 0 && (
            <Consequence tone={brokenReleases.length > 0 ? 'warn' : 'danger'}>
              {heldText}{' '}
              <ReleaseToggle open={showReleases} onToggle={() => setShowReleases((v) => !v)} />
              {showReleases && <ReleaseLabels releases={heldReleases} />}
            </Consequence>
          )}

          {preview && Y > 0 && X === 0 && <BlockedGroup items={blocked} />}

          {preview && X > 0 && mode === 'purge-selected' && (
            <div className="min-w-0">
              <p className={cn(ui.eyebrow, 'mb-2')}>Sẽ xoá hoàn toàn · {imgs(X)}</p>
              <ul className="grid max-h-44 grid-cols-[repeat(auto-fill,minmax(5.5rem,1fr))] gap-2.5 overflow-y-auto">
                {deletable.slice(0, THUMB_MAX).map((d) => (
                  <li key={d.id} className="min-w-0">
                    <span className="block aspect-square w-full overflow-hidden rounded-sm bg-shell-raised">
                      <AssetThumb mime={d.mime} assetKey={d.key} url={d.url} lazy sheet="sm" className="size-full" />
                    </span>
                    <p className="mt-1 truncate text-mini" title={d.key}>
                      {displayName(d.key)}
                    </p>
                  </li>
                ))}
                {X > THUMB_MAX && (
                  <li className="grid aspect-square place-items-center rounded-sm bg-shell-raised text-mini text-shell-muted">
                    + {X - THUMB_MAX} ảnh khác
                  </li>
                )}
              </ul>
            </div>
          )}

          {preview && mode === 'empty-trash' && (
            <p className="text-ui tabular-nums">
              Sẽ xoá {imgs(X)}
              {Y > 0 ? ` · bỏ qua ${imgs(Y)} đang dùng` : ''}
            </p>
          )}

          {preview && X === 0 && <p className="text-ui text-shell-muted">Không có ảnh nào xoá được.</p>}

          {preview && X > 0 && Y > 0 && <BlockedGroup items={blocked} divider />}

          {preview && X > 0 && (
            <TextField
              label={
                <>
                  Gõ “<span className="font-shell-mono">{phrase}</span>” để xác nhận
                </>
              }
              mono
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={phrase}
              disabled={busy}
              autoFocus
              autoComplete="off"
            />
          )}

          {busy && (
            <Progress value={progress} max={Math.max(1, X)} label="Đang xoá…" valueLabel={`${progress}/${X}`} />
          )}

          {error && (
            <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <p className="min-w-0 flex-1 text-small leading-relaxed break-words text-shell-danger">{error}</p>
              {!preview && !checking && (
                <Button variant="secondary" size="sm" onClick={() => setAttempt((n) => n + 1)}>
                  Kiểm tra lại
                </Button>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" disabled={busy} onClick={() => dialog.current?.close()}>
            Đóng
          </Button>
          {(checking || X > 0) && (
            <Button type="submit" variant="danger-solid" disabled={!canConfirm} loading={busy}>
              {confirmLabel}
            </Button>
          )}
        </div>
      </form>
    </dialog>
  );
}

function ReleaseToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="rounded-sm font-semibold whitespace-nowrap text-shell-ink underline underline-offset-2"
    >
      {open ? 'Ẩn release' : 'Xem release'}
    </button>
  );
}

function ReleaseLabels({ releases }: { releases: OldReleaseRef[] }) {
  return (
    <p className="font-shell-mono mt-1.5 flex flex-wrap gap-x-2.5 text-mini">
      {releases.slice(0, RELEASE_MAX).map((r) => (
        <span key={r.id} className="whitespace-nowrap">
          {r.label}
        </span>
      ))}
      {releases.length > RELEASE_MAX && (
        <span className="whitespace-nowrap">+ {releases.length - RELEASE_MAX} release khác</span>
      )}
    </p>
  );
}

/** Nhóm "Bỏ qua · Y ảnh đang dùng" kèm nơi dùng. */
function BlockedGroup({ items, divider = false }: { items: SkippedAsset[]; divider?: boolean }) {
  return (
    <div className={cn('min-w-0', divider && 'border-t border-shell-line pt-4')}>
      <p className="mb-2.5 text-small font-semibold text-shell-warn">
        Bỏ qua · {items.length} ảnh đang dùng, không xoá được
      </p>
      <BlockedAssetList items={items} />
      <p className="mt-2.5 text-mini text-shell-muted">Gỡ ảnh khỏi những nơi này (hoặc khôi phục ảnh) rồi xoá lại.</p>
    </div>
  );
}
