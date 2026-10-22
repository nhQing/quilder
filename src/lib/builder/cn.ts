import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * `tailwind-merge` phải biết thang chữ RIÊNG của vỏ (`builder.css` → `--text-*`).
 *
 * Mặc định nó chỉ biết `text-xs`…`text-9xl` là cỡ chữ; mọi `text-<tên-lạ>` khác nó
 * coi là MÀU. Thế là `cn('text-micro', 'text-shell-muted')` bị gộp thành một nhóm màu
 * và `text-micro` — cỡ chữ — bị xoá im lặng. Lỗi không báo gì: chữ chỉ to ra.
 */
const twMerge = extendTailwindMerge({
  extend: {
    /* Cùng lý do cho thang chiều cao control (`--spacing-control-*`): không khai ở đây thì
     * `h-control-md` và `h-auto` không bị coi là cùng nhóm, cả hai ở lại, và CSS chọn
     * cái sinh sau — ô nhiều dòng kẹt ở 36px dù đã ghi `h-auto`. */
    theme: { spacing: ['control-sm', 'control-md', 'control-lg'] },
    classGroups: {
      'font-size': [{ text: ['micro', 'mini', 'small', 'ui', 'page', 'section', 'card'] }],
    },
  },
});

/** Gộp class, class sau thắng class trước khi cùng nhóm utility. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
