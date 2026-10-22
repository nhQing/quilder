'use client';

import * as Tooltip from '@radix-ui/react-tooltip';

/**
 * Tooltip của builder — Radix Tooltip, style bằng token shell.
 *
 * ## Vì sao không dùng `title`
 *
 * `title` hiện sau ~1 giây, không style được, và bị cắt theo hệ điều hành. Trong
 * Inspector nó là chỗ DUY NHẤT đọc được tên CSS đầy đủ của một nhãn đã bị `truncate`
 * và tên giá trị của một nút icon — thứ người dùng cần thấy ngay khi trỏ vào.
 *
 * Provider nằm trong từng `Tip` chứ không ở gốc shell: `controls.tsx` còn được dùng
 * ngoài hai shell editor (bảng Cài đặt component), và một Provider thiếu thì Radix ném.
 * Nhiều Provider lồng nhau là hợp lệ.
 *
 * Không có `content` thì trả nguyên `children` — chỗ gọi khỏi phải rẽ nhánh.
 */
export function Tip({
  content,
  children,
  side = 'top',
}: {
  content: React.ReactNode;
  /** Một phần tử DUY NHẤT nhận được ref (Radix `asChild`). */
  children: React.ReactElement;
  side?: 'top' | 'bottom' | 'left' | 'right';
}) {
  if (!content) return children;
  return (
    <Tooltip.Provider delayDuration={350} skipDelayDuration={150}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            side={side}
            sideOffset={6}
            collisionPadding={8}
            className="z-[100] max-w-72 rounded-sm bg-shell-ink px-2 py-1 font-shell-mono text-micro leading-snug text-shell-panel shadow-shell-pop"
          >
            {content}
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}
