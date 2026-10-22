/**
 * Trạng thái lưu của editor — một union, không phải hai boolean.
 *
 * ## Vì sao union
 *
 * Luật 1 của bàn giao giao diện v2: *"Ba trạng thái, ba chip. Không dùng chung một
 * biến state cho thành công và thất bại."* Bản trước có `saving: boolean` và
 * `lastError: string | null` là hai biến RỜI trong cùng một store, nên
 * `saving && lastError` biểu diễn được — và ba chỗ dispatch phải giữ chúng đồng bộ
 * bằng tay. `EditorShell.tsx` ghi lại hậu quả của đúng lỗi này ở đường publish:
 * thất bại vẫn render bằng class thành công, nên người dùng thấy chữ xanh và tưởng
 * đã xong.
 *
 * Union làm trạng thái đó **không compile được**. Đó là toàn bộ giá trị của file này.
 *
 * ## Vì sao `describeSave` là hàm thuần, tách khỏi component
 *
 * Phép quyết định nhãn và màu là thứ có thể SAI, nên nó phải test được — và
 * `vitest.config.ts` chạy `environment: 'node'`, không có DOM. Component chỉ vẽ
 * `SaveLook`; mọi nhánh nằm ở đây.
 */

import type { Op } from '@/lib/doc/ops';

export type SaveState =
  /** Không có gì đang bay. `seq` là bản đã lưu; `null` ở chế độ sửa component. */
  /**
   * `rebased`: lần lưu này trúng 409 (bản nháp vừa đổi ở nơi khác — người khác hoặc AI)
   * và đã được áp lại lên bản mới nhất. Nói ra, vì canvas lúc này hiện CẢ thay đổi của
   * người kia — không nói thì người dùng tưởng thao tác của mình làm ra thứ họ không làm.
   */
  | { k: 'clean'; seq: number | null; rebased?: boolean }
  | { k: 'saving' }
  /** `retry` là chính batch op vừa trượt — không có nó thì nút "thử lại" không có gì để gửi. */
  | { k: 'error'; message: string; retry: Op[] };

export interface SaveLook {
  text: string;
  tone: 'muted' | 'ok' | 'danger';
  retryable: boolean;
  /** Câu lỗi đầy đủ. `text` bị cắt nên câu dài không được vào đó. */
  title?: string;
}

export function describeSave(s: SaveState): SaveLook {
  switch (s.k) {
    case 'saving':
      return { text: 'đang lưu…', tone: 'muted', retryable: false };
    case 'clean':
      if (s.rebased) {
        return {
          text: s.seq === null ? 'đã lưu · gộp bản mới' : `đã lưu · v${s.seq} · gộp bản mới`,
          tone: 'ok',
          retryable: false,
          title:
            'Trang vừa được sửa ở nơi khác (người khác hoặc AI). Thao tác của bạn đã được ' +
            'áp lên bản mới nhất — canvas đang hiện cả hai thay đổi.',
        };
      }
      return {
        text: s.seq === null ? 'đã lưu' : `đã lưu · v${s.seq}`,
        tone: 'ok',
        retryable: false,
      };
    case 'error':
      return {
        // KHÔNG kèm chữ "thử lại" ở đây: nó là một NÚT trong `SaveChip` (Task 6),
        // và cùng một chữ hai lần cạnh nhau đọc như một lỗi hiển thị.
        text: 'lỗi lưu',
        tone: 'danger',
        retryable: true,
        title: s.message,
      };
  }
}
