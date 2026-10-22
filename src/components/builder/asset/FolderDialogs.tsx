'use client';

/**
 * Hộp tạo / đổi tên thư mục, và hộp xác nhận xoá thư mục.
 *
 * Một hộp cho cả nút "Thư mục mới" ở đầu trang, mục "Thư mục con mới" và "Đổi tên"
 * trong menu của cây lẫn của thẻ thư mục — năm lối vào, một chỗ gõ tên. Tên gõ vào
 * được server chuẩn hoá (`Trang chủ` → `trang-chu`), nên hộp nói trước điều đó thay
 * vì để người dùng ngạc nhiên ở cây.
 */

import { useEffect, useId, useRef, useState } from 'react';

import { Button } from '../ui/Button';
import { TextField } from '../ui/Field';
import { ConfirmDialog, Dialog } from '../ui/Overlay';
import type { FolderItem } from './types';

export type FolderEdit = { mode: 'create'; parent: string } | { mode: 'rename'; folder: FolderItem };

export function FolderNameDialog({
  edit,
  busy,
  onClose,
  onCreate,
  onRename,
}: {
  /** `null` = đóng. */
  edit: FolderEdit | null;
  busy: boolean;
  onClose: () => void;
  onCreate: (path: string) => void;
  onRename: (from: string, to: string) => void;
}) {
  const formId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');

  /*
   * Focus ô tên SAU khi hộp mở. `autoFocus` của React chạy lúc ô được gắn vào DOM —
   * khi `<dialog>` còn đóng — nên `showModal()` sau đó đặt focus vào nút đóng.
   */
  useEffect(() => {
    if (!edit) return;
    setName(edit.mode === 'rename' ? edit.folder.name : '');
    const raf = requestAnimationFrame(() => input.current?.select());
    return () => cancelAnimationFrame(raf);
  }, [edit]);

  const renameOf = edit?.mode === 'rename' ? edit.folder : null;
  const parent = edit?.mode === 'create' ? edit.parent : '';

  function submit() {
    const value = name.trim();
    if (!edit || !value) return;
    if (edit.mode === 'create') {
      onCreate(edit.parent ? `${edit.parent}/${value}` : value);
    } else {
      // Chỉ đoạn CUỐI đổi; cấp cha giữ nguyên. Đổi cả đường dẫn ở ô này sẽ biến
      // "đổi tên" thành "di chuyển" mà không báo trước. `lastIndexOf` trả -1 với thư
      // mục cấp gốc, và `slice(0, -1)` sẽ cắt mất ký tự cuối của chính nó — đổi tên
      // `hero` thành `her/ten-moi`. Cắt tường minh thay vì tin vào số âm.
      const from = edit.folder.path;
      const cut = from.lastIndexOf('/');
      const dir = cut === -1 ? '' : from.slice(0, cut);
      onRename(from, dir ? `${dir}/${value}` : value);
    }
    onClose();
  }

  return (
    <Dialog
      open={edit !== null}
      onClose={onClose}
      size="sm"
      title={renameOf ? `Đổi tên thư mục “${renameOf.name}”` : 'Thư mục mới'}
      description={
        renameOf ? (
          'Chỉ đổi tên thư mục này; thư mục cha giữ nguyên, file bên trong đi theo.'
        ) : parent ? (
          <>
            Tạo trong <span className="font-shell-mono text-shell-ink">{parent}</span>.
          </>
        ) : (
          'Tạo ở cấp gốc của Thư viện.'
        )
      }
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            Huỷ
          </Button>
          <Button variant="primary" type="submit" form={formId} disabled={busy || !name.trim()}>
            {renameOf ? 'Đổi tên' : 'Tạo thư mục'}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <TextField
          ref={input}
          label="Tên thư mục"
          mono
          autoComplete="off"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={renameOf ? undefined : 'trang-chu'}
          hint="Chữ có dấu và khoảng trắng được đổi thành chữ thường không dấu, nối bằng gạch ngang."
        />
      </form>
    </Dialog>
  );
}

/**
 * Xác nhận xoá thư mục.
 *
 * Nói rõ ảnh đi đâu. "Xoá thư mục" một mình sẽ được đọc là "xoá 12 ảnh", trong khi
 * xoá thư mục không xoá (kể cả vào thùng rác) ảnh nào.
 */
export function FolderDeleteDialog({
  folder,
  subfolders,
  busy,
  onClose,
  onConfirm,
}: {
  folder: FolderItem | null;
  /** Số thư mục con (mọi cấp) bị xoá theo. */
  subfolders: number;
  busy: boolean;
  onClose: () => void;
  onConfirm: (folder: FolderItem) => void;
}) {
  return (
    <ConfirmDialog
      open={folder !== null}
      onClose={onClose}
      onConfirm={() => folder && onConfirm(folder)}
      busy={busy}
      title={folder && folder.total === 0 ? `Xoá thư mục rỗng “${folder.path}”?` : `Xoá thư mục “${folder?.path ?? ''}”?`}
      description={subfolders > 0 ? `${subfolders} thư mục con bên trong cũng bị xoá.` : undefined}
      consequence={
        folder && folder.total > 0
          ? `${folder.total} file trong đó sẽ về “Chưa phân loại”. Không file nào bị xoá.`
          : undefined
      }
      confirmLabel="Xoá thư mục"
    />
  );
}
