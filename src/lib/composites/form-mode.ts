/**
 * Chế độ "sau khi gửi" của `Form` — module KHÔNG phụ thuộc gì.
 *
 * ## Vì sao tách khỏi `registry.ts`
 *
 * `Form.tsx` là client component chạy trên site thật. Import GIÁ TRỊ từ `registry.ts`
 * kéo theo zod, `nav-series` và gói dự án vào bundle của mọi trang có form — chỉ để
 * đọc một hàm ba dòng. Kiểu thì import từ registry thoải mái (bị xoá lúc biên dịch);
 * giá trị thì lấy ở đây. `registry.ts` re-export cho các chỗ đã import từ đó.
 */

export type AfterSubmit = 'inline' | 'dialog' | 'panel';

/** Cách báo kết quả thật của một form — `afterSubmit` nếu có, không thì suy từ `successPanel`. */
export function resolveAfterSubmit(p: { afterSubmit?: string; successPanel?: string }): AfterSubmit {
  if (p.afterSubmit === 'inline' || p.afterSubmit === 'dialog' || p.afterSubmit === 'panel') {
    return p.afterSubmit;
  }
  return p.successPanel ? 'panel' : 'inline';
}
