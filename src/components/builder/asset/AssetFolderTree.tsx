'use client';

/**
 * Cây thư mục — và là bãi thả của mọi thao tác sắp xếp.
 *
 * ## Một node nhận HAI loại thả, phân biệt trước khi thả
 *
 *  - kéo từ Explorer → `dataTransfer.types` có `Files` → **tải lên thẳng vào thư
 *    mục đó**, không cần mở nó trước;
 *  - kéo ảnh trong lưới → có `ASSET_DND_MIME` → **dời ảnh** (cả nhóm đang chọn).
 *
 * Phân biệt trong `onDragOver` chứ không đợi `onDrop`: viền sáng phải nói đúng
 * chuyện gì sắp xảy ra, và một node sáng lên rồi không làm gì cả là lời hứa sai.
 * Luật này nằm ở `useFolderDrop` để thẻ thư mục trong lưới dùng đúng cùng một bản.
 *
 * ## Vì sao "Tất cả file" không phải bãi thả, còn "Chưa phân loại" thì có
 *
 * Thả vào "Chưa phân loại" là một ý định rõ ràng: bỏ ảnh khỏi thư mục. Thả vào "Tất
 * cả" thì không có nghĩa nào — nó là một bộ lọc, không phải một chỗ chứa.
 *
 * ## "Thùng rác" là một PHẠM VI, không phải thư mục
 *
 * Nằm cuối cây, ngăn bằng đường kẻ, là link tới `trashHref()` (một URL riêng) chứ
 * không qua `onNavigate`. Không nhận thả. Khi `inTrash`, mọi mục khác bỏ trạng thái
 * active — thùng rác là phạm vi duy nhất đang chọn.
 */

import Link from 'next/link';
import { useState } from 'react';

import { cn } from '@/lib/builder/cn';
import { focusRing, ui } from '@/lib/builder/ui';

import { Icon } from '../ui/Icon';
import { MenuButton, type MenuEntry } from '../ui/Overlay';
import { FolderGlyph } from './AssetFolderCard';
import { ASSET_DND_MIME, FOLDER_TEXT, folderTone, trashHref, type FolderItem, type Scope } from './types';

/** Khoá của node "Chưa phân loại" trong state hover — `null` không dùng làm key được. */
const UNFILED_KEY = '<unfiled>';

type DropKind = 'files' | 'assets' | null;

/** Kéo cái gì tới đây: file từ máy, ảnh trong kho, hay thứ không liên quan. */
function dropKind(dt: DataTransfer): DropKind {
  if (dt.types.includes(ASSET_DND_MIME)) return 'assets';
  if (dt.types.includes('Files')) return 'files';
  return null;
}

export interface FolderDropProps {
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
  'data-drop-active': '' | undefined;
  /** Đánh dấu cho `AssetDropArea`: thả ở đây là việc của bãi này, không phải của vùng tải lên. */
  'data-drop-target': '';
}

/** Bộ xử lý thả cho một thư mục (`null` = Chưa phân loại), kèm cờ đang rê qua. */
export function useFolderDrop({
  onDropAssets,
  onDropFiles,
}: {
  onDropAssets: (ids: string[], folder: string | null) => void;
  onDropFiles: (files: FileList, folder: string | null) => void;
}): (folder: string | null) => FolderDropProps {
  const [hover, setHover] = useState<string | null>(null);
  return (folder) => {
    const key = folder ?? UNFILED_KEY;
    return {
      onDragOver: (e) => {
        const kind = dropKind(e.dataTransfer);
        if (!kind) return;
        e.preventDefault();
        // `move` cho ảnh, `copy` cho file: con trỏ chuột của hệ điều hành nói trước
        // cho người dùng biết thao tác nào sắp xảy ra.
        e.dataTransfer.dropEffect = kind === 'assets' ? 'move' : 'copy';
        setHover(key);
      },
      onDragLeave: () => setHover((h) => (h === key ? null : h)),
      onDrop: (e) => {
        const kind = dropKind(e.dataTransfer);
        setHover(null);
        if (!kind) return;
        e.preventDefault();
        e.stopPropagation();
        if (kind === 'files') {
          if (e.dataTransfer.files.length) onDropFiles(e.dataTransfer.files, folder);
          return;
        }
        const raw = e.dataTransfer.getData(ASSET_DND_MIME);
        const ids = raw ? (JSON.parse(raw) as string[]) : [];
        if (ids.length) onDropAssets(ids, folder);
      },
      'data-drop-active': hover === key ? '' : undefined,
      'data-drop-target': '',
    };
  };
}

/**
 * Menu của một thư mục — dùng chung cho node ở cây và thẻ thư mục trong lưới.
 * Mục phá huỷ đứng cuối sau vạch ngăn; bị khoá thì nói lý do ngay trong mục.
 */
export function folderMenu(
  f: FolderItem,
  opts: {
    canRename: boolean;
    busy: boolean;
    onNewFolder: (parent: string) => void;
    onRenameFolder: (folder: FolderItem) => void;
    onDelete: (folder: FolderItem) => void;
  },
): MenuEntry[] {
  return [
    { label: 'Thư mục con mới', icon: 'folder-plus', onSelect: () => opts.onNewFolder(f.path) },
    ...(opts.canRename ? [{ label: 'Đổi tên', icon: 'edit' as const, onSelect: () => opts.onRenameFolder(f) }] : []),
    { separator: true },
    {
      label: f.canDelete ? (
        'Xoá thư mục'
      ) : (
        <span className="flex flex-col py-1 leading-snug">
          Xoá thư mục
          <span className="text-mini font-normal text-shell-muted">Chỉ người tạo thư mục hoặc admin xoá được</span>
        </span>
      ),
      icon: 'trash',
      danger: true,
      disabled: !f.canDelete || opts.busy,
      onSelect: () => opts.onDelete(f),
    },
  ];
}

/*
 * Phản hồi lúc rê qua phải RÕ, không tinh tế.
 *
 * Bản đầu chỉ đổi màu viền một cấp; giữa một cột 6 dòng cách nhau 4px thì người
 * dùng không đọc ra mình đang nhắm vào dòng nào, và thả sai thư mục là một thao
 * tác phải hoàn tác bằng tay. Nền đặc cộng viền nhấn thì không đọc sai được.
 */
const DROP_CLASS =
  'data-[drop-active]:bg-shell-accent-soft data-[drop-active]:text-shell-ink data-[drop-active]:ring-2 data-[drop-active]:ring-shell-accent';

/** Một hàng của cây: 40px, bo `rounded-sm`, mục đang chọn nền `accent-soft`. */
const ROW =
  'flex min-h-10 w-full min-w-0 items-center gap-2.5 rounded-sm px-3 text-left text-ui font-medium text-shell-muted transition-colors hover:bg-shell-raised hover:text-shell-ink';
const ROW_ON = 'bg-shell-accent-soft font-semibold text-shell-ink hover:bg-shell-accent-soft';
/*
 * Số đếm căn phải thành một cột. Dính ngay sau tên thì mỗi dòng nó nằm một vị trí
 * khác, và mắt phải đi tìm từng con số thay vì quét dọc một lượt.
 */
const COUNT = 'ml-auto shrink-0 pl-2 text-mini font-medium text-shell-muted tabular-nums';

export function AssetFolderTree({
  folders,
  unfiled,
  all,
  scope,
  busy,
  onNavigate,
  onDropAssets,
  onDropFiles,
  onNewFolder,
  onRenameFolder,
  onDelete,
  canRename,
  trash,
  inTrash = false,
  header,
  footer,
}: {
  folders: FolderItem[];
  unfiled: number;
  all: number;
  scope: Scope;
  busy: boolean;
  onNavigate: (scope: Scope) => void;
  onDropAssets: (ids: string[], folder: string | null) => void;
  onDropFiles: (files: FileList, folder: string | null) => void;
  /** Mở hộp tạo thư mục con của `parent`. */
  onNewFolder: (parent: string) => void;
  onRenameFolder: (folder: FolderItem) => void;
  onDelete: (folder: FolderItem) => void;
  /** Đổi tên đòi quyền admin — ẩn mục thay vì để người dùng bấm rồi ăn 403. */
  canRename: boolean;
  /** Số ảnh trong thùng rác (0 → hiện "trống"). Không tính vào `all`/`unfiled`. */
  trash: number;
  /** Đang ở màn thùng rác: mục Thùng rác active, các mục khác không. */
  inTrash?: boolean;
  /** Đầu panel: nút tải lên. */
  header?: React.ReactNode;
  /** Chân panel: ghi chú. */
  footer?: React.ReactNode;
}) {
  const at = (s: Scope) => !inTrash && scope === s;
  const drop = useFolderDrop({ onDropAssets, onDropFiles });

  return (
    /*
     * Panel lớn của vỏ, `sticky` theo chiều cuộn.
     *
     * Trước đây cây là chữ trần trên nền trang, nên nó không đọc ra là một bảng điều
     * khiển. Tệ hơn: cuộn xuống hàng ảnh thứ ba là bãi thả biến khỏi màn hình, tức
     * kéo-thả chỉ dùng được ở đầu trang.
     */
    <div className={cn(ui.panel, 'h-full')}>
      <div
        className={cn(
          'flex flex-col gap-5 px-3.5 py-5',
          'md:sticky md:top-[var(--shell-gutter)] md:max-h-[calc(100svh-2*var(--shell-gutter))] md:overflow-y-auto',
        )}
      >
      {header}

      <nav aria-label="Cây thư mục" className="flex flex-col gap-0.5">
        <p className={cn(ui.eyebrow, 'mx-3 mb-1.5')}>Thư mục</p>

        <ul className="flex flex-col gap-0.5">
          <li>
            <button
              type="button"
              onClick={() => onNavigate(undefined)}
              aria-current={at(undefined) ? 'page' : undefined}
              className={cn(ROW, focusRing, at(undefined) && ROW_ON)}
            >
              <FolderGlyph width={18} height={16} band={false} className={FOLDER_TEXT.slate} />
              <span className="truncate">Tất cả file</span>
              <span className={COUNT}>{all}</span>
            </button>
          </li>

          <li>
            <div {...drop(null)} className={cn('rounded-sm', DROP_CLASS)}>
              <button
                type="button"
                onClick={() => onNavigate(null)}
                aria-current={at(null) ? 'page' : undefined}
                className={cn(ROW, focusRing, at(null) && ROW_ON)}
              >
                <Icon name="folder" size={18} className="text-shell-muted" />
                <span className="truncate">Chưa phân loại</span>
                <span className={COUNT}>{unfiled}</span>
              </button>
            </div>
          </li>

          {folders.map((f) => {
            const menu = folderMenu(f, { canRename, busy, onNewFolder, onRenameFolder, onDelete });
            const on = at(f.path);
            return (
              <li key={f.path}>
                <div
                  {...drop(f.path)}
                  className={cn(
                    'group relative flex items-center rounded-sm text-shell-muted transition-colors hover:bg-shell-raised hover:text-shell-ink',
                    // Menu đang mở phải nổi trên các hàng phía dưới.
                    'has-[[aria-expanded=true]]:z-30',
                    on && ROW_ON,
                    DROP_CLASS,
                  )}
                >
                  <button
                    type="button"
                    onClick={() => onNavigate(f.path)}
                    aria-current={on ? 'page' : undefined}
                    title={f.path}
                    style={{ paddingLeft: `${0.75 + f.depth * 1.125}rem` }}
                    className={cn(
                      'flex min-h-10 min-w-0 flex-1 items-center gap-2.5 rounded-sm pr-3 text-left text-ui font-medium',
                      focusRing,
                      on && 'font-semibold',
                    )}
                  >
                    <FolderGlyph width={18} height={16} band={false} className={FOLDER_TEXT[folderTone(f.path)]} />
                    <span className="truncate">{f.name}</span>
                    {/* Thư mục rỗng nói "trống" thay vì "0": số 0 trông như một lỗi tải
                        dữ liệu, còn chữ nói rõ đây là trạng thái bình thường của một
                        thư mục vừa tạo. Số đếm nhường chỗ cho nút "…" khi rê chuột. */}
                    <span
                      className={cn(
                        COUNT,
                        'transition-opacity group-hover:opacity-0 group-focus-within:opacity-0 group-has-[[aria-expanded=true]]:opacity-0 pointer-coarse:opacity-100',
                      )}
                    >
                      {f.total === 0 ? 'trống' : f.total}
                    </span>
                  </button>

                  <MenuButton
                    label={`Thao tác thư mục ${f.path}`}
                    size="sm"
                    items={menu}
                    className={cn(
                      'absolute top-1/2 right-1.5 -translate-y-1/2 opacity-0 transition-opacity',
                      'group-hover:opacity-100 group-focus-within:opacity-100 has-[[aria-expanded=true]]:opacity-100',
                      'pointer-coarse:static pointer-coarse:mr-1 pointer-coarse:translate-y-0 pointer-coarse:opacity-100',
                    )}
                  />
                </div>
              </li>
            );
          })}

          <li role="presentation" aria-hidden className="mx-2 my-2.5 h-px bg-shell-line" />

          <li>
            <Link
              href={trashHref()}
              title="Ảnh đã xoá — khôi phục được"
              aria-label={`Thùng rác, ${trash} ảnh`}
              aria-current={inTrash ? 'page' : undefined}
              className={cn(ROW, focusRing, inTrash && ROW_ON)}
            >
              <Icon name="trash" size={18} />
              <span className="truncate">Thùng rác</span>
              <span className={COUNT}>{trash === 0 ? 'trống' : trash}</span>
            </Link>
          </li>
        </ul>
      </nav>

      {footer}
      </div>
    </div>
  );
}
