'use client';

/**
 * Hộp thông báo kết quả cho thao tác thùng rác (xoá mềm / khôi phục / xoá hoàn toàn).
 *
 * KHÔNG tự tắt: người dùng phải đọc được "bỏ qua 2 ảnh đang dùng" và danh sách nơi dùng
 * mà không chạy đua với đồng hồ. Tông là icon đầu dòng (như Toast của design system);
 * luôn có chữ nói cùng ý.
 *
 * Hành động trong note: "Hoàn tác" (khôi phục đúng các id vừa xoá mềm), "Xem ảnh nào dùng
 * ở đâu" (bung danh sách ảnh bị bỏ qua), "Thử xoá lại" + "Xem danh sách" (file S3 chưa xoá).
 */

import { useState } from 'react';

import type { RestoreResult, SkippedAsset, TrashResult } from '@/lib/assets/trash-types';
import { cn } from '@/lib/builder/cn';
import { ui } from '@/lib/builder/ui';

import { Button, IconButton } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { BlockedAssetList } from './AssetUsageList';

export type AssetNoteTone = 'ok' | 'warn' | 'error';

/** Nội dung một note. `text` là dòng chính đã dựng sẵn. */
export interface AssetNoteData {
  tone: AssetNoteTone;
  text: string;
  /** Ảnh bị bỏ qua kèm nơi dùng — bật nút "Xem ảnh nào dùng ở đâu". */
  blocked?: SkippedAsset[];
  /** Id vừa chuyển vào thùng rác — bật nút "Hoàn tác". */
  undoIds?: string[];
  /** Key S3 chưa xoá được — bật "Thử xoá lại" + "Xem danh sách". */
  s3Failed?: string[];
}

const plural = (n: number) => `${n} ảnh`;

/** Dựng note từ kết quả chuyển vào thùng rác. */
export function noteFromTrash(r: TrashResult): AssetNoteData {
  const done = r.trashed.length;
  const skipped = r.skipped.length;
  if (done === 0) {
    return {
      tone: 'warn',
      text: `Không chuyển ảnh nào vào thùng rác · ${plural(skipped)} đang dùng`,
      blocked: r.skipped,
    };
  }
  return {
    tone: skipped > 0 ? 'warn' : 'ok',
    text:
      `Đã chuyển ${plural(done)} vào thùng rác` +
      (skipped > 0 ? ` · bỏ qua ${plural(skipped)} đang dùng` : ''),
    blocked: skipped > 0 ? r.skipped : undefined,
    undoIds: r.trashed,
  };
}

/** Dựng note từ kết quả khôi phục. `movedToRoot` = số ảnh về Chưa phân loại vì thư mục cũ mất. */
export function noteFromRestore(r: RestoreResult, movedToRoot = 0): AssetNoteData {
  const done = r.restored.length;
  const skipped = r.skipped.length;
  let text = done > 0 ? `Đã khôi phục ${plural(done)}` : 'Không khôi phục ảnh nào';
  if (movedToRoot > 0) {
    text += ` · ${plural(movedToRoot)} về Chưa phân loại vì thư mục cũ không còn`;
  }
  if (skipped > 0) text += ` · bỏ qua ${plural(skipped)}`;
  return {
    tone: skipped > 0 ? 'warn' : 'ok',
    text,
    blocked: skipped > 0 ? r.skipped : undefined,
  };
}

const TONE_ICON = {
  ok: { name: 'check-circle', cls: 'text-shell-ok' },
  warn: { name: 'alert', cls: 'text-shell-warn' },
  error: { name: 'alert', cls: 'text-shell-danger' },
} as const;

export function AssetNote({
  note,
  busy = false,
  onClose,
  onUndo,
  onRetryS3,
}: {
  note: AssetNoteData;
  /** Đang chạy Hoàn tác / Thử xoá lại — khoá các nút trong note. */
  busy?: boolean;
  onClose: () => void;
  /** Khôi phục đúng các id vừa xoá mềm. */
  onUndo?: (ids: string[]) => void;
  /** Thử xoá lại các key S3 chưa xoá được (chỉ admin). */
  onRetryS3?: (keys: string[]) => void;
}) {
  const [showBlocked, setShowBlocked] = useState(false);
  const [showS3, setShowS3] = useState(false);

  const canUndo = !!onUndo && !!note.undoIds && note.undoIds.length > 0;
  const hasBlocked = !!note.blocked && note.blocked.length > 0;
  const hasS3 = !!note.s3Failed && note.s3Failed.length > 0;
  const icon = TONE_ICON[note.tone];

  return (
    <div
      role={note.tone === 'error' ? 'alert' : 'status'}
      className={cn(ui.card, 'flex min-w-0 items-start gap-3 py-3 pr-3 pl-4')}
    >
      <Icon name={icon.name} size={20} className={cn('mt-0.5', icon.cls)} />
      <div className="min-w-0 flex-1">
        <p className="min-w-0 py-0.5 text-ui leading-relaxed break-words text-shell-ink">{note.text}</p>

        {(canUndo || hasS3 || hasBlocked) && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {canUndo && (
              <Button variant="secondary" size="sm" icon="undo" disabled={busy} onClick={() => onUndo?.(note.undoIds ?? [])}>
                Hoàn tác
              </Button>
            )}
            {hasS3 && onRetryS3 && (
              <Button variant="secondary" size="sm" disabled={busy} onClick={() => onRetryS3(note.s3Failed ?? [])}>
                {busy ? 'Đang xoá…' : 'Thử xoá lại'}
              </Button>
            )}
            {hasS3 && (
              <Button variant="ghost" size="sm" onClick={() => setShowS3((v) => !v)}>
                {showS3 ? 'Ẩn danh sách' : 'Xem danh sách'}
              </Button>
            )}
            {hasBlocked && (
              <Button variant="ghost" size="sm" onClick={() => setShowBlocked((v) => !v)}>
                {showBlocked ? 'Ẩn danh sách' : 'Xem ảnh nào dùng ở đâu'}
              </Button>
            )}
          </div>
        )}

        {showS3 && hasS3 && (
          <ul className="mt-2.5 flex max-h-56 flex-col gap-1 overflow-y-auto border-t border-shell-line pt-2.5">
            {note.s3Failed?.map((k) => (
              <li key={k} title={k} className="font-shell-mono min-w-0 truncate text-mini text-shell-ink">
                {k}
              </li>
            ))}
          </ul>
        )}

        {showBlocked && hasBlocked && (
          <div className="mt-2.5 border-t border-shell-line pt-2.5">
            <BlockedAssetList items={note.blocked ?? []} />
          </div>
        )}
      </div>
      <IconButton icon="x" label="Đóng thông báo" size="sm" onClick={onClose} />
    </div>
  );
}
