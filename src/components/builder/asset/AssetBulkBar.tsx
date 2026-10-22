'use client';

/**
 * Thanh thao tác cho nhiều file đang chọn: "N file đã chọn" + hành động hàng loạt.
 *
 * Đứng ngay trên lưới và DÍNH đầu khung nhìn khi cuộn: người dùng chọn ảnh bằng cách
 * cuộn xuống, và một thanh nằm yên ở đầu trang sẽ khuất đúng lúc họ chọn xong.
 *
 * ## "Chọn tất cả" ở đây, không ở đầu lưới
 *
 * Nó chỉ có nghĩa sau khi người dùng đã chọn ít nhất một ảnh — trước đó nó là một
 * nút thường trực cho một việc hiếm. Đặt cạnh số đếm cũng làm rõ phạm vi: tất cả của
 * TRANG ĐANG XEM, không phải cả thư mục và càng không phải cả kho — nên con số nó hiện
 * luôn khớp với số ô người dùng đang nhìn thấy.
 *
 * ## Hai chế độ
 *
 *  - `library`: "Chuyển thư mục" và "Vào thùng rác" (lùi được nên không hỏi xác
 *    nhận). Xoá khỏi máy chủ không nằm ở đây.
 *  - `trash`: "Khôi phục", rồi (chỉ khi `canPurge`, tức admin) "Xoá hoàn toàn" — nút
 *    an toàn đứng trước, nút nguy hiểm đứng sau và cách xa "Bỏ chọn". Ẩn "Chuyển thư mục".
 */

import { Button } from '../ui/Button';
import { Kbd } from '../ui/Badge';
import { FolderSelect } from './FolderSelect';
import type { BulkMode, FolderItem } from './types';

export function AssetBulkBar({
  count,
  total,
  folders,
  busy,
  mode = 'library',
  canPurge = false,
  onMove,
  onTrash,
  onRestore,
  onPurge,
  onSelectAll,
  onClear,
}: {
  count: number;
  /** Số ảnh đang hiện trong lưới, để "Chọn tất cả" nói đúng con số. */
  total: number;
  folders: FolderItem[];
  busy: boolean;
  /** `library` (mặc định) hoặc `trash`. */
  mode?: BulkMode;
  /** Chỉ admin: hiện "Xoá hoàn toàn" ở chế độ thùng rác. */
  canPurge?: boolean;
  /** Chỉ dùng ở `library`. */
  onMove?: (folder: string | null) => void;
  /** `library`: chuyển vào thùng rác. Không truyền = không hiện nút. */
  onTrash?: () => void;
  /** `trash`: khôi phục. */
  onRestore?: () => void;
  /** `trash` + `canPurge`: mở hộp xác nhận xoá hoàn toàn. */
  onPurge?: () => void;
  onSelectAll: () => void;
  onClear: () => void;
}) {
  if (count === 0) return null;

  const inTrash = mode === 'trash';

  return (
    <div
      role="status"
      className="sticky top-[var(--shell-gutter)] z-20 flex flex-wrap items-center gap-2.5 rounded-lg bg-shell-accent-soft py-2.5 pr-3 pl-4.5 shadow-shell-card"
    >
      <b className="text-ui font-semibold whitespace-nowrap tabular-nums">
        {count} file đã chọn
        <span className="font-medium text-shell-muted"> / {total}</span>
      </b>

      {count < total && (
        <Button variant="ghost" size="md" onClick={onSelectAll}>
          Chọn tất cả {total}
        </Button>
      )}

      <span className="ml-auto flex flex-wrap items-center gap-2">
        {inTrash ? (
          <>
            {onRestore && (
              <Button
                variant="secondary"
                size="md"
                icon="undo"
                disabled={busy}
                onClick={onRestore}
                title={`Khôi phục ${count} ảnh về thư mục cũ`}
              >
                Khôi phục
              </Button>
            )}
            {canPurge && onPurge && (
              <Button
                variant="danger"
                size="md"
                icon="trash"
                disabled={busy}
                onClick={onPurge}
                title={`Xoá hoàn toàn ${count} ảnh khỏi máy chủ — không hoàn tác`}
              >
                Xoá hoàn toàn
              </Button>
            )}
          </>
        ) : (
          <>
            {onMove && (
              <div className="w-48">
                <FolderSelect
                  folders={folders}
                  value={undefined}
                  placeholder="Chuyển thư mục"
                  disabled={busy}
                  onPick={(folder) => onMove(folder)}
                />
              </div>
            )}
            {onTrash && (
              <Button
                variant="danger"
                size="md"
                icon="trash"
                disabled={busy}
                onClick={onTrash}
                title={`Chuyển ${count} ảnh vào thùng rác — lấy lại được`}
              >
                Vào thùng rác
              </Button>
            )}
          </>
        )}

        <Button variant="ghost" size="md" onClick={onClear}>
          Bỏ chọn <Kbd>Esc</Kbd>
        </Button>
      </span>
    </div>
  );
}
