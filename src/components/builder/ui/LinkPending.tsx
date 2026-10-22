'use client';

/**
 * Icon đặt TRONG một `<Link>`: thành spinner khi chính link đó đang chờ điều hướng.
 *
 * ## Vì sao `useLinkStatus`, không phải state tự giữ
 *
 * `useLinkStatus` (Next 15.3+) đọc trạng thái mà router đặt cho đúng link vừa được bấm, và
 * trả về `false` ngay khi lượt điều hướng commit — kể cả khi người dùng bấm sang link khác
 * giữa chừng (router bỏ lượt cũ, link cũ tự hết "đang chờ"). Một `useState` bật ở `onClick`
 * phải tự đoán lúc tắt, và đoán sai ở đúng mấy trường hợp đó.
 *
 * Hook chỉ chạy được trong CON của `<Link>`, nên đây là một component, không phải một prop.
 *
 * ## Vì sao spinner hiện SAU một nhịp
 *
 * Link đã prefetch thì điều hướng xong trong vài chục ms; đổi icon ngay là mỗi cú bấm nhanh
 * thành một cái nháy. `shell-pending-show` giữ spinner vô hình trong `--shell-pending-delay`
 * (builder.css) — cùng nhịp với thanh tiến độ của `NavProgress`.
 *
 * ## `data-link-pending`
 *
 * Gắn lên khung khi đang chờ, để phần tử cha tự đổi dáng bằng CSS (`has-[[data-link-pending]]:`)
 * mà không phải nâng state lên — `BuilderNav` và thẻ trang dùng đúng cách đó.
 *
 * Spinner `aria-hidden` và không có chữ: tên trợ năng của link giữ nguyên (test tìm link theo
 * tên). Báo "đang tải" cho screen reader là việc của `NavProgress`.
 */

import { useLinkStatus } from 'next/link';

import { cn } from '@/lib/builder/cn';

import { Spinner } from './Button';
import { Icon, type IconName } from './Icon';

export function LinkIcon({
  name,
  size = 18,
  className,
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  const { pending } = useLinkStatus();
  return (
    <span
      data-link-pending={pending ? '' : undefined}
      className={cn('relative inline-grid shrink-0 place-items-center', className)}
    >
      <Icon name={name} size={size} className={cn(pending && 'shell-pending-hide')} />
      {pending && (
        // Hai lớp: lớp ngoài trễ rồi hiện, lớp trong quay. Gộp một lớp thì `animation` của
        // `animate-spin` và của `shell-pending-show` đè nhau, chỉ một cái chạy.
        <span className="shell-pending-show absolute inset-0 grid place-items-center">
          <Spinner className="size-[78%] motion-reduce:animate-none" />
        </span>
      )}
    </span>
  );
}
