'use client';

/**
 * Chip trạng thái lưu — ba trạng thái, ba vẻ ngoài phân biệt được.
 *
 * ## Vì sao nhận `state` qua prop, không đọc store
 *
 * Hai lý do, và cả hai đều cụ thể. Một: `vitest.config.ts` chạy
 * `environment: 'node'` nên component đọc store không render được trong test, mà
 * đây là chỗ **phải** có test — nó là hiện thân của luật "thành công và thất bại
 * không dùng chung một biến". Hai: `EditorTopbar` vốn đã đọc store cho undo/redo,
 * nên thêm một lượt đọc nữa ở đây là hai chỗ đăng ký cho cùng một thay đổi.
 *
 * ## Vì sao câu lỗi ở `title`, không ở nhãn
 *
 * Câu lỗi của validator dài (`"Image cần alt, hoặc đặt decorative: true nếu là
 * ảnh trang trí."`). Đưa nó vào nhãn thì chip bị cắt, và thứ bị cắt mất là chữ
 * "thử lại" ở cuối — tức nút biến mất khỏi mắt người dùng đúng lúc họ cần nó.
 *
 * ## Hình
 *
 * Theo `SaveChip` của design system: chấm nhấp nháy khi đang lưu, dấu tích khi đã lưu,
 * icon cảnh báo kèm nút "thử lại" khi lỗi. Màu đi kèm chữ, không bao giờ đứng một mình.
 */

import { cn } from '@/lib/builder/cn';
import { describeSave, type SaveState } from '@/lib/builder/save-state';

import { Button } from './ui/Button';
import { Icon } from './ui/Icon';

const TONE = {
  muted: 'text-shell-muted',
  ok: 'text-shell-ok',
  danger: 'text-shell-danger',
} as const;

export function SaveChip({
  state,
  onRetry,
}: {
  state: SaveState;
  onRetry: () => void;
}) {
  const look = describeSave(state);

  return (
    <span
      className={cn('flex items-center gap-1.5 whitespace-nowrap text-mini font-medium', TONE[look.tone])}
      title={look.title}
      // Trạng thái lưu đổi mà không có ai bấm gì, nên screen reader phải được báo.
      // `polite`: nó không được cắt lời người dùng đang gõ.
      aria-live="polite"
    >
      {look.tone === 'muted' ? (
        <span aria-hidden className="size-[7px] shrink-0 animate-pulse rounded-full bg-current motion-reduce:animate-none" />
      ) : (
        <Icon name={look.tone === 'ok' ? 'check' : 'alert'} size={15} />
      )}
      {look.text}
      {look.retryable && (
        <Button variant="ghost" size="sm" onClick={onRetry} className="text-shell-danger">
          thử lại
        </Button>
      )}
    </span>
  );
}
