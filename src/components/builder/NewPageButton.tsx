'use client';

/**
 * Nút "Trang mới" trên danh sách trang, mở `Dialog` chứa `NewPageForm`.
 *
 * ## Vì sao nút này phải tồn tại
 *
 * Đường tạo trang duy nhất trước đây nằm trong dock của trình sửa — chỉ dùng được
 * khi đang mở một trang. Site chưa có trang nào thì không mở được gì, nên giao diện
 * không có đường tạo trang đầu tiên, và trạng thái rỗng chỉ người dùng sang
 * `pnpm db:seed`: một lệnh cần mã nguồn, không chạy được trên bản đã deploy.
 *
 * `<dialog>` thật, cùng khuôn `PageHistory` và `PageRename` — Esc đóng, bẫy focus,
 * `aria-modal`. Xem docblock `PageHistory` cho lý do đầy đủ.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { NewPageForm } from './NewPageForm';
import { Button } from './ui/Button';
import { Dialog } from './ui/Overlay';

export function NewPageButton() {
  const [open, setOpen] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  // Điều hướng sau khi tạo xong xảy ra ở trong form, và form gọi `onDone` TRƯỚC khi
  // điều hướng: dialog phải đóng lúc đó, nếu không nó sẽ còn mở khi người dùng bấm Back.
  const close = useCallback(() => setOpen(false), []);

  // `showModal()` focus nút đóng đứng đầu DOM; ô tiêu đề mới là chỗ cần gõ.
  useEffect(() => {
    if (open) body.current?.querySelector('input')?.focus();
  }, [open]);

  return (
    <>
      <Button variant="primary" icon="plus" onClick={() => setOpen(true)}>
        Trang mới
      </Button>

      <Dialog open={open} onClose={close} title="Trang mới">
        <div ref={body}>
          <NewPageForm variant="dialog" onDone={close} onCancel={close} />
        </div>
      </Dialog>
    </>
  );
}
