'use client';

/**
 * Thẻ thư mục con trong lưới Thư viện (FolderCard của design system).
 *
 * Bấm icon hoặc tên để mở (một nút riêng); "⋮" ở góc phải mở menu thư mục. Thẻ cũng
 * là BÃI THẢ như node cùng tên ở cây bên trái: kéo ảnh trong lưới thả lên thẻ là dời
 * ảnh, kéo file từ máy là tải thẳng vào đó — người dùng đang nhìn vào lưới, và bắt
 * họ đưa chuột sang cây để làm đúng việc đó là bắt họ đi đường vòng.
 *
 * Không có ô chọn như bản vẽ: thanh chọn nhiều chỉ thao tác trên FILE, và một ô chọn
 * không dẫn tới hành động nào là lời hứa sai.
 */

import { cn } from '@/lib/builder/cn';
import { focusRing, ui } from '@/lib/builder/ui';

import { MenuButton, type MenuEntry } from '../ui/Overlay';
import { FOLDER_TEXT, folderTone, type FolderItem } from './types';
import type { FolderDropProps } from './AssetFolderTree';

/** Icon thư mục tô đặc (`folder-*`) — ngoại lệ duy nhất của bộ icon nét. */
export function FolderGlyph({
  width = 64,
  height = 52,
  band = true,
  className,
}: {
  width?: number;
  height?: number;
  /** Vạch sáng ngang miệng thư mục; bỏ ở cỡ nhỏ (cây thư mục). */
  band?: boolean;
  className?: string;
}) {
  return (
    <svg width={width} height={height} viewBox="0 0 24 20" aria-hidden focusable="false" className={cn('shrink-0', className)}>
      <path
        fill="currentColor"
        d="M1 3.5A2.5 2.5 0 0 1 3.5 1H8l2 2.2h10.5A2.5 2.5 0 0 1 23 5.7v11.8A2.5 2.5 0 0 1 20.5 20h-17A2.5 2.5 0 0 1 1 17.5z"
      />
      {band && <path className="fill-shell-panel" opacity={0.3} d="M1 7h22v1.4H1z" />}
    </svg>
  );
}

export function AssetFolderCard({
  folder,
  subfolders,
  onOpen,
  drop,
  menu,
}: {
  folder: FolderItem;
  /** Số thư mục con trực tiếp. */
  subfolders: number;
  onOpen: () => void;
  drop: FolderDropProps;
  menu: readonly MenuEntry[];
}) {
  return (
    <li
      {...drop}
      className={cn(
        ui.card,
        ui.cardHover,
        'group relative flex min-w-0 flex-col border-2 border-transparent',
        'data-[drop-active]:border-shell-accent data-[drop-active]:bg-shell-accent-soft',
        // Menu đang mở phải nổi trên thẻ hàng dưới (hover `translate` tạo stacking context).
        'has-[[aria-expanded=true]]:z-30',
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Mở thư mục ${folder.name}`}
        title={folder.path}
        className={cn('flex w-full flex-col items-center gap-3 rounded-lg px-3.5 pt-8.5 pb-3 text-center', focusRing)}
      >
        <FolderGlyph className={FOLDER_TEXT[folderTone(folder.path)]} />
        <b className="max-w-full truncate text-ui font-semibold">{folder.name}</b>
      </button>
      <div className="flex justify-between gap-2 px-4 pb-3.5 text-mini text-shell-muted tabular-nums">
        <span>{folder.total === 0 ? 'trống' : `${folder.total} file`}</span>
        {subfolders > 0 && <span>{subfolders} thư mục con</span>}
      </div>
      {menu.length > 0 && (
        <MenuButton
          label={`Tuỳ chọn cho ${folder.name}`}
          icon="more-v"
          size="sm"
          items={menu}
          className="absolute top-2 right-2"
        />
      )}
    </li>
  );
}
