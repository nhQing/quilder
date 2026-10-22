'use client';

/**
 * Class Tailwind tương đương — CHỈ ĐỌC.
 *
 * ## Vì sao chỉ đọc
 *
 * Trang sinh ra từ database không dùng Tailwind: JIT quét source lúc build, còn
 * cây node đổi SAU KHI image đã build, nên một class sinh từ DB row không bao
 * giờ được compile. Site dùng stylesheet sinh từ `render/css.ts`.
 *
 * Khối này là một CÁCH ĐỌC khác của cùng dữ liệu — quen mắt với người viết
 * Tailwind hằng ngày. Nó không phải nguồn sự thật, và ô có kiểu phía trên vẫn là
 * đường ghi duy nhất. Cho sửa ở đây sẽ tạo đường mutation thứ hai, đúng thứ cả
 * kiến trúc này tránh.
 *
 * ## Vì sao vẫn hiện thứ không map được
 *
 * Site dùng nhiều thứ Tailwind không có utility: token riêng, đơn vị container
 * query, `clamp()`. Ẩn chúng đi thì danh sách trông sạch nhưng NÓI DỐI — người
 * đọc tưởng node chỉ có bấy nhiêu style. Nên chúng vẫn hiện, gạch nét đứt.
 */

import { useState } from 'react';

import { copyText } from '@/lib/builder/clipboard';
import { cn } from '@/lib/builder/cn';
import { ui } from '@/lib/builder/ui';
import { tailwindGroups } from '@/lib/builder/tailwind-map';
import type { StyleProps } from '@/lib/doc/types';
import { Button } from './ui/Button';

export function TailwindPanel({ style }: { style: Partial<StyleProps> }) {
  const groups = tailwindGroups(style);
  const [copied, setCopied] = useState(false);

  if (!groups.length) return null;

  const all = groups.flatMap((g) => g.classes.map((c) => c.cls)).join(' ');

  const copy = async () => {
    try {
      await copyText(all);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard bị từ chối quyền (non-secure context). Không đổi nhãn là đủ —
      // ném lỗi vào mặt người dùng cho một tiện ích phụ thì không đáng.
      setCopied(false);
    }
  };

  return (
    <section className="border-shell-line mx-3.5 flex flex-col gap-2 border-t pt-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-small font-semibold">Class Tailwind</h3>
        <Button variant="ghost" size="sm" icon={copied ? 'check' : 'copy'} onClick={() => void copy()}>
          {copied ? 'Đã chép' : 'Chép hết'}
        </Button>
      </div>

      {groups.map((group) => (
        <div key={group.label}>
          <p className="text-shell-muted mb-1 text-micro">{group.label}</p>
          <div className="flex flex-wrap gap-1">
            {group.classes.map((c) => (
              <code
                key={c.cls}
                title={
                  c.real
                    ? c.prop
                    : `${c.prop} — không có class Tailwind tương đương, đây chỉ là cách viết lại giá trị`
                }
                className={cn(
                  'bg-shell-raised font-shell-mono rounded-xs px-1.5 py-0.5 text-micro',
                  c.real
                    ? 'text-shell-ink'
                    : 'text-shell-warn underline decoration-dotted underline-offset-2',
                )}
              >
                {c.cls}
              </code>
            ))}
          </div>
        </div>
      ))}

      <p className={cn(ui.hint, 'leading-snug')}>
        Chỉ để đọc — site không dùng Tailwind, sửa ở các ô phía trên.{' '}
        <span className="text-shell-warn">Gạch nét đứt</span> = không có class Tailwind
        tương đương.
      </p>
    </section>
  );
}
