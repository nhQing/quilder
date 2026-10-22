'use client';

/**
 * Chuyển sáng / tối / theo hệ thống.
 *
 * ## Vì sao BA trạng thái, không phải một công tắc
 *
 * Công tắc bật/tắt buộc người dùng chọn một bên, và lựa chọn đó không theo họ nữa
 * khi máy đổi chế độ buổi tối. "Theo hệ thống" là mặc định vì nó là câu trả lời
 * đúng cho phần lớn người dùng phần lớn thời gian, và nó là trạng thái duy nhất
 * KHÔNG phải một lời hứa mà builder phải tự nhớ giùm.
 *
 * ## Vì sao ghi thuộc tính bằng tay thay vì `router.refresh()`
 *
 * Giá trị đọc ở server (`(builder)/layout.tsx` đọc cookie `mm-theme`), nên phản xạ
 * đầu tiên là refresh để server render lại `<html data-theme>`. Nhưng một vòng RSC
 * cho một phép đổi màu là ~200ms nhìn thấy được: bấm rồi chờ, và trong lúc chờ thì
 * cả trang vẫn màu cũ. Đặt thẳng thuộc tính trên `documentElement` là tức thì, và
 * cookie chỉ có việc làm cho LẦN TẢI SAU đúng ngay từ byte đầu (không nháy màu).
 *
 * Hai đường ghi cùng một giá trị nên chúng không lệch được: cookie và thuộc tính
 * luôn đặt cạnh nhau trong đúng hàm này.
 *
 * ## Vì sao không dùng `next-themes`
 *
 * Cơ chế là một thuộc tính trên `<html>` và một cookie. Một dependency cho việc đó
 * là một dependency phải nâng cấp mãi về sau, và nó mặc định dùng `localStorage` —
 * thứ chỉ đọc được sau khi JS chạy, tức đúng cái nháy màu ta đang tránh.
 */

import { useState } from 'react';

import { cn } from '@/lib/builder/cn';
import { focusRing } from '@/lib/builder/ui';

import { Icon, type IconName } from './ui/Icon';

/**
 * Ba lựa chọn. Chỉ là KIỂU, không phải một mảng export ra ngoài — file này có
 * `'use client'`, nên mọi export RUNTIME của nó mà server component import về sẽ
 * là một "client reference" (một proxy), không phải giá trị thật: `.find()` trên
 * nó ném lỗi lúc chạy, không lúc build. Kiểu thì bị xoá khi biên dịch nên đi qua
 * biên đó an toàn — danh sách để kiểm cookie sống ở `(builder)/layout.tsx`.
 */
export type ThemeChoice = 'dark' | 'light' | 'system';

/** Ký hiệu và nhãn chép từ `docs/BUILDER-UI-PROTO.html`. */
const OPTIONS: { value: ThemeChoice; icon: IconName; label: string }[] = [
  { value: 'light', icon: 'sun', label: 'Sáng' },
  { value: 'dark', icon: 'moon', label: 'Tối' },
  { value: 'system', icon: 'monitor', label: 'Theo hệ thống' },
];

/** Một năm: đủ dài để "một lần chọn" đúng nghĩa là một lần. */
const MAX_AGE = 31536000;

export function ThemeToggle({ value, vertical }: { value: ThemeChoice; vertical?: boolean }) {
  // State cục bộ chứ không đọc lại `document`: sau khi bấm, server chưa render
  // lại nên prop `value` còn là giá trị cũ cho tới lần tải sau.
  const [choice, setChoice] = useState<ThemeChoice>(value);

  const pick = (next: ThemeChoice) => {
    setChoice(next);
    document.documentElement.setAttribute('data-theme', next);
    document.cookie = `mm-theme=${next};path=/;max-age=${MAX_AGE};samesite=lax`;
  };

  return (
    <div
      role="group"
      aria-label="Giao diện"
      className={cn('inline-flex gap-0.5 rounded-md bg-shell-raised p-1', vertical ? 'flex-col' : 'flex-row self-start')}
    >
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          // `aria-pressed` chứ không phải một class: đây là ba nút hai trạng thái,
          // và trạng thái đó phải đọc được bằng screen reader và bằng test.
          aria-pressed={choice === o.value}
          aria-label={o.label}
          title={o.label}
          onClick={() => pick(o.value)}
          className={cn(
            'grid size-8 place-items-center rounded text-shell-muted transition-colors hover:text-shell-ink',
            focusRing,
            choice === o.value && 'bg-shell-panel text-shell-accent shadow-shell-card hover:text-shell-accent',
          )}
        >
          <Icon name={o.icon} size={16} />
        </button>
      ))}
    </div>
  );
}
