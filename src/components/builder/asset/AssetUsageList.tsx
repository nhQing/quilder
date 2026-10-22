'use client';

/**
 * Danh sách "ảnh này đang dùng ở đâu" — MỘT component cho note kết quả, dialog xoá
 * hoàn toàn và popover, để ba chỗ không trôi khỏi nhau.
 *
 * Hiện tối đa `limit` dòng rồi nút "+ N nơi khác" bung hết; khối bung cuộn trong
 * `max-h-56`, không bao giờ làm giãn dialog/note. Nhãn loại `shrink-0` (không xuống
 * dòng), tên nơi dùng `truncate` + `title`.
 *
 * Kèm `BlockedAssetList`: danh sách ảnh bị bỏ qua (thumbnail + tên + số nơi dùng +
 * AssetUsageList) dùng chung cho note và dialog.
 */

import { useState } from 'react';

import type { AssetRef, AssetRefKind, SkippedAsset } from '@/lib/assets/trash-types';
import { cn } from '@/lib/builder/cn';

import { Badge } from '../ui/Badge';
import { ImageThumb } from './AssetThumb';
import { displayName } from './types';

const KIND_LABEL: Record<AssetRefKind, string> = {
  page: 'Trang',
  'archived-page': 'Trang lưu trữ',
  entry: 'Bài viết',
  component: 'Component',
  'effect-preset': 'Effect preset',
  favicon: 'Favicon',
  'site-og': 'Ảnh chia sẻ',
  'page-og': 'Ảnh chia sẻ',
  avatar: 'Ảnh đại diện',
  'live-release': 'Release đang chạy',
  token: 'Token',
  'site-globals': 'Cấu hình site',
};

/** Loại có nhãn là mã máy đọc (v41, slug) → chữ mono. */
const MONO_KINDS: ReadonlySet<AssetRefKind> = new Set(['live-release']);

/** Nền ô kẻ nhạt sau thumbnail (ảnh trong suốt không bị chìm). */
const CHECKER = {
  backgroundImage: 'repeating-conic-gradient(var(--color-shell-line-strong) 0% 25%, transparent 0% 50%)',
  backgroundSize: '8px 8px',
} as const;

function RefRow({ r }: { r: AssetRef }) {
  const text = r.label.trim() || '(không tên)';
  const mono = MONO_KINDS.has(r.kind);
  const nameCls = cn('min-w-0 flex-1 truncate text-small', mono && 'font-shell-mono');
  return (
    <li className="flex min-w-0 items-center gap-2">
      <Badge size="sm" className="shrink-0">
        {KIND_LABEL[r.kind]}
      </Badge>
      {r.href ? (
        <a
          href={r.href}
          target="_blank"
          rel="noreferrer"
          title={text}
          className={cn(nameCls, 'rounded-sm text-shell-accent underline-offset-2 hover:underline')}
        >
          {text}
        </a>
      ) : (
        <span title={text} className={cn(nameCls, 'text-shell-ink')}>
          {text}
        </span>
      )}
    </li>
  );
}

export function AssetUsageList({ refs, limit = 5 }: { refs: AssetRef[]; limit?: number }) {
  const [open, setOpen] = useState(false);
  const shown = open ? refs : refs.slice(0, limit);
  const rest = refs.length - limit;

  if (refs.length === 0) return null;

  return (
    <div className="min-w-[18rem]">
      <ul className={cn('flex flex-col gap-1', open && 'max-h-56 overflow-y-auto')}>
        {shown.map((r, i) => (
          <RefRow key={`${r.kind}:${r.label}:${i}`} r={r} />
        ))}
      </ul>
      {rest > 0 && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="mt-1 rounded-sm text-mini font-medium whitespace-nowrap text-shell-muted hover:text-shell-ink"
        >
          {open ? 'Thu gọn' : `+ ${rest} nơi khác`}
        </button>
      )}
    </div>
  );
}

/** Danh sách ảnh bị bỏ qua kèm nơi dùng. Khối cuộn `max-h-56`. */
export function BlockedAssetList({ items }: { items: SkippedAsset[] }) {
  return (
    <ul className="flex max-h-56 flex-col gap-3 overflow-y-auto">
      {items.map((a) => (
        <li key={a.id} className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <span
              className="relative size-8 shrink-0 overflow-hidden rounded-sm bg-shell-raised"
              style={CHECKER}
              aria-hidden
            >
              {a.mime.startsWith('image/') && <ImageThumb url={a.url} lazy className="size-8" />}
            </span>
            <span className="min-w-0 flex-1 truncate text-small font-medium text-shell-ink" title={a.key}>
              {displayName(a.key)}
            </span>
            <span className="shrink-0 text-mini whitespace-nowrap text-shell-muted">
              {a.refs.length > 0
                ? `Dùng ở ${a.refs.length} nơi`
                : a.reason === 'missing'
                  ? 'Không còn tồn tại'
                  : a.reason === 'not-trashed'
                    ? 'Không ở trong thùng rác'
                    : 'Đang dùng'}
            </span>
          </div>
          {a.refs.length > 0 && (
            <div className="mt-1 pl-10">
              <AssetUsageList refs={a.refs} />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
