'use client';

/**
 * Các thao tác thùng rác của kho ảnh, tách khỏi `AssetGrid` để file đó không phình.
 *
 * Hook KHÔNG sở hữu `note`/`busy`: hai thứ đó dùng chung với dời/tải lên/thư mục nên
 * thuộc `AssetGrid`; hook nhận setter và chỉ gọi API + dựng note.
 *
 * Không có hộp xác nhận cho Xoá thường và Khôi phục (lùi được). Xoá hoàn toàn mở
 * `AssetTrashDialog` — hook chỉ giữ "đang mở hộp nào"; việc gọi API purge nằm trong hộp.
 */

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type {
  AssetRef,
  RestoreResult,
  SkippedAsset,
  TrashResult,
} from '@/lib/assets/trash-types';

import { noteFromRestore, noteFromTrash, type AssetNoteData } from './AssetNote';
import type { AssetTrashDone } from './AssetTrashDialog';
import type { AssetItem } from './types';

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

const err = (text: string): AssetNoteData => ({ tone: 'error', text });

/**
 * Lấy danh sách chỗ đang dùng một ảnh từ phản hồi `/api/assets/references`. Chấp nhận
 * vài dạng (map theo id, hoặc bọc trong `references`) vì chỉ cần đọc `blocking`.
 */
function refsOf(json: unknown, id: string): AssetRef[] {
  const root = json as Record<string, unknown> | null;
  const map = (root?.references ?? root?.items ?? root) as Record<string, unknown> | unknown[] | undefined;
  let entry: unknown;
  if (Array.isArray(map)) entry = map.find((e) => (e as { id?: string })?.id === id);
  else entry = map?.[id];
  const e = entry as { blocking?: AssetRef[]; refs?: AssetRef[] } | AssetRef[] | undefined;
  if (Array.isArray(e)) return e;
  return e?.blocking ?? e?.refs ?? [];
}

export type PurgeDialogState = { mode: 'purge-selected'; ids: string[] } | { mode: 'empty-trash' };

export function useAssetTrash({
  assets,
  busy,
  setBusy,
  setNote,
  clearSelection,
}: {
  assets: AssetItem[];
  busy: boolean;
  setBusy: (b: boolean) => void;
  setNote: (n: AssetNoteData | null) => void;
  clearSelection: () => void;
}) {
  const router = useRouter();
  const [dialog, setDialog] = useState<PurgeDialogState | null>(null);

  /** Chuyển vào thùng rác. Không hỏi: lùi được bằng "Hoàn tác". */
  async function trash(ids: string[]) {
    if (!ids.length || busy) return;
    setBusy(true);
    const r = await post<TrashResult>('/api/assets/trash', { ids });
    setNote(
      r.ok
        ? noteFromTrash(r.data)
        : err(`Không chuyển được vào thùng rác: ${r.error}. Thử lại sau, ảnh vẫn nguyên chỗ cũ.`),
    );
    setBusy(false);
    clearSelection();
    router.refresh();
  }

  /** Khôi phục từ thùng rác; cũng là "Hoàn tác" của `trash`. */
  async function restore(ids: string[]) {
    if (!ids.length || busy) return;
    setBusy(true);
    const r = await post<RestoreResult & { movedToRoot?: number }>('/api/assets/restore', { ids });
    setNote(
      r.ok
        ? noteFromRestore(r.data, r.data.movedToRoot ?? 0)
        : err(`Không khôi phục được: ${r.error}. Ảnh vẫn nằm trong thùng rác.`),
    );
    setBusy(false);
    clearSelection();
    router.refresh();
  }

  /** Bấm nút xoá mờ của ảnh đang dùng: hỏi server rồi bung danh sách nơi dùng. */
  async function showUsage(id: string) {
    const a = assets.find((x) => x.id === id);
    if (!a || busy) return;
    setBusy(true);
    const r = await post<unknown>('/api/assets/references', { ids: [id] });
    setBusy(false);
    if (!r.ok) {
      setNote(err(`Không xem được nơi dùng: ${r.error}`));
      return;
    }
    const refs = refsOf(r.data, id);
    const skipped: SkippedAsset = {
      id,
      key: a.key,
      url: a.url,
      mime: a.mime,
      reason: 'in-use',
      refs,
    };
    setNote({
      tone: 'warn',
      text: `Ảnh đang dùng ở ${refs.length || a.useCount} nơi — không chuyển vào thùng rác được`,
      blocked: [skipped],
    });
  }

  /** "Thử xoá lại" các key S3 sót (admin). */
  async function retryS3(keys: string[]) {
    if (!keys.length || busy) return;
    setBusy(true);
    const r = await post<{ deleted?: string[]; failed?: string[] }>('/api/assets/purge/retry', {
      keys,
    });
    setBusy(false);
    if (!r.ok) {
      setNote({ tone: 'warn', text: `Chưa thử lại được: ${r.error}`, s3Failed: keys });
      return;
    }
    const failed = r.data.failed ?? [];
    const deleted = r.data.deleted?.length ?? keys.length - failed.length;
    setNote(
      failed.length > 0
        ? {
            tone: 'warn',
            text: `Đã xoá thêm ${deleted} file · ${failed.length} file vẫn chưa xoá được khỏi máy chủ lưu trữ`,
            s3Failed: failed,
          }
        : { tone: 'ok', text: `Đã xoá nốt ${deleted} file khỏi máy chủ lưu trữ` },
    );
  }

  /** Hộp Xoá hoàn toàn/Dọn sạch xong: hiện note, và nạp lại lưới khi đã có ảnh bị xoá thật. */
  function onDialogDone(done: AssetTrashDone) {
    setNote(done.note);
    setDialog(null);
    clearSelection();
    if (done.purged.length > 0) router.refresh();
  }

  return {
    trash,
    restore,
    showUsage,
    retryS3,
    dialog,
    openPurge: (ids: string[]) => setDialog({ mode: 'purge-selected', ids }),
    openEmpty: () => setDialog({ mode: 'empty-trash' }),
    closeDialog: () => setDialog(null),
    onDialogDone,
  };
}
