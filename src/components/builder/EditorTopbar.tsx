'use client';

/**
 * Thanh trên của hai màn editor toàn màn (`EditorShell`, `ComponentEditorShell`).
 *
 * ## Vì sao rút ra
 *
 * Hai bản trước là hai lần chép-dán của cùng bốn thứ: backlink, tiêu đề + khoá
 * mono, cặp undo/redo, khu trạng thái phải. Chúng đã lệch ở `gap-4/px-4` so với
 * `gap-3/px-3` — vô hại — và ở một chỗ KHÔNG vô hại: bản component thiếu
 * `aria-label` trên hai nút `↶`/`↷`, nên screen reader đọc đúng ký hiệu đó. Đây là
 * loại lệch mà một component dùng chung xoá vĩnh viễn, còn một lần sửa tay thì chỉ
 * xoá đến lần chép-dán tiếp theo.
 *
 * ## Vì sao Publish là `children`, không phải một cờ
 *
 * `ComponentEditorShell` cố ý KHÔNG có nút Publish. `publish()` của `EditorShell`
 * giờ chỉ đẩy ĐÚNG trang đang mở (`pageIds: [pageId]`), nhưng màn component thì
 * không có "trang đang mở" nào để đẩy — một component nằm trong bao nhiêu trang là
 * chuyện của từng trang, nên nút Publish ở đây sẽ phải chọn giữa "đẩy tất cả" và
 * "đẩy cái gì?", và cả hai đều sai. Một prop `showPublish={false}` biến quyết định
 * đó thành một mặc định người sau bật lên được bằng một chữ `true` — trong khi lý
 * do nó không có thì nằm ở một docblock mà người đó không đọc. `children` thì không
 * có gì để bật: chỗ nào cần nút Publish thì chỗ đó tự mang nút, cùng `publish()`
 * của nó. Publish cả site sống ở trang Lịch sử publish.
 *
 * Undo/redo đọc thẳng store thay vì nhận qua prop: cả hai màn đều dùng đúng
 * `useEditor`, và một cặp prop `onUndo/canUndo/…` chỉ là chuyển đúng thông tin đó
 * qua bốn tham số để hai bên gọi lại phải giữ cho khớp nhau.
 */

import { useId } from 'react';

import { cn } from '@/lib/builder/cn';
import { selectSaving, useEditor } from '@/lib/builder/store';
import { ui } from '@/lib/builder/ui';
import { SaveChip } from './SaveChip';
import { Button, ButtonLink, IconButton } from './ui/Button';
import { Icon } from './ui/Icon';

export function EditorTopbar({
  backHref,
  backLabel,
  onBack,
  title,
  mono,
  children,
}: {
  backHref: string;
  backLabel: string;
  /**
   * Nút quay lại là một HÀNH ĐỘNG thay vì link — dùng khi đang sửa component từ một
   * trang: "quay lại" phải về trang đó, không phải nhảy ra trang chủ builder.
   */
  onBack?: () => void;
  title: string;
  /** Khoá kỹ thuật cạnh tiêu đề: `/slug` của trang, hoặc `key` của component. */
  mono?: string;
  /** Khu phải: nút Xem nháp / Publish, hoặc câu giải thích thay cho chúng. */
  children?: React.ReactNode;
}) {
  const save = useEditor((s) => s.save);
  const saving = useEditor(selectSaving);
  const retrySave = useEditor((s) => s.retrySave);
  const undoStack = useEditor((s) => s.undoStack);
  const redoStack = useEditor((s) => s.redoStack);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);

  return (
    // `relative z-40`: bảng nổi của header (Chia sẻ…) là `z-30`, ngang hàng thanh khổ màn
    // `z-30` của canvas đứng sau trong DOM — không nâng cả header thì thanh đó vẽ đè lên bảng.
    <header className={cn(ui.panel, 'relative z-40 flex shrink-0 flex-wrap items-center gap-2.5 py-2 pr-2.5 pl-2')}>
      {onBack ? (
        <Button variant="ghost" size="md" icon="arrow-left" onClick={onBack}>
          {backLabel}
        </Button>
      ) : (
        <ButtonLink href={backHref} variant="ghost" size="md" icon="arrow-left">
          {backLabel}
        </ButtonLink>
      )}

      <span aria-hidden className="h-6 w-px shrink-0 bg-shell-line" />

      <div className="flex min-w-0 flex-col leading-tight">
        <span className="truncate text-ui font-semibold" title={title}>
          {title}
        </span>
        {mono && <span className="font-shell-mono truncate text-mini text-shell-muted">{mono}</span>}
      </div>

      {/*
        Tên trợ năng của hai nút là ĐÚNG "Hoàn tác" / "Làm lại", không kèm phím tắt: test
        và trình đọc màn hình gọi nút bằng đúng tên đó (`exact: true`), vì mỗi hàng layer
        có một nút xoá mang chữ "Hoàn tác" trong title. Phím tắt nằm ở tooltip — thứ bổ
        sung cho nút icon, không thay nhãn của nó.
      */}
      <div className="ml-2 flex shrink-0 items-center gap-0.5">
        <Tip text="Hoàn tác (Ctrl+Z)">
          {(tipId) => (
            <IconButton
              icon="undo"
              label="Hoàn tác"
              title={undefined}
              aria-describedby={tipId}
              onClick={() => void undo()}
              disabled={!undoStack.length || saving}
            />
          )}
        </Tip>
        <Tip text="Làm lại (Ctrl+Shift+Z)">
          {(tipId) => (
            <IconButton
              icon="redo"
              label="Làm lại"
              title={undefined}
              aria-describedby={tipId}
              onClick={() => void redo()}
              disabled={!redoStack.length || saving}
            />
          )}
        </Tip>
      </div>

      <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-3">
        <SaveChip state={save} onRetry={() => void retrySave()} />
        {children}
      </div>
    </header>
  );
}

/**
 * Tooltip một dòng cho nút icon: nền đảo màu, hiện khi hover hoặc focus vào nút.
 *
 * Nút nằm sát mép trên màn nên bong bóng mở XUỐNG. `title` của nút bị tắt ở chỗ gọi:
 * để cả hai thì trình duyệt hiện thêm một tooltip hệ thống chồng lên cái này. Nút bị
 * khoá không nhận hover, nên hover bắt ở lớp bọc ngoài — tooltip vẫn nói nút làm gì.
 */
function Tip({ text, children }: { text: string; children: (id: string) => React.ReactNode }) {
  const id = useId();
  return (
    <span className="group/tip relative inline-flex">
      {children(id)}
      <span
        id={id}
        role="tooltip"
        className="pointer-events-none absolute top-full left-1/2 z-40 mt-2 -translate-x-1/2 rounded-xs bg-shell-ink px-2.5 py-1.5 text-mini font-medium whitespace-nowrap text-shell-panel opacity-0 shadow-shell-pop transition-opacity group-focus-within/tip:opacity-100 group-hover/tip:opacity-100"
      >
        {text}
      </span>
    </span>
  );
}

/**
 * Thanh báo "đang sửa component", dùng ở cả hai đường vào chế độ này.
 *
 * Phải RÕ và phải chiếm chỗ: không có nó thì canvas trông y hệt lúc sửa trang, và
 * người dùng sẽ sửa component tưởng đang sửa trang — rồi thấy chín trang khác đổi
 * theo. `children` là phần riêng của từng đường: nút quay lại, cảnh báo builtin.
 */
export function ComponentNotice({ name, children }: { name?: string; children?: React.ReactNode }) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl bg-shell-accent-soft py-2 pr-2 pl-4 text-small">
      <span className="flex shrink-0 items-center gap-2 font-semibold text-shell-accent">
        <Icon name="cube" size={16} />
        Đang sửa component
      </span>
      {name && (
        <span className="min-w-0 truncate font-semibold" title={name}>
          {name}
        </span>
      )}
      <span className="text-shell-muted">
        Thay đổi ở đây áp cho <strong className="font-semibold text-shell-ink">MỌI trang</strong> đang dùng
        component này.
      </span>
      {children}
    </div>
  );
}
