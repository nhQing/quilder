/**
 * Bậc nút của vỏ builder — nguồn sự thật duy nhất cho hình dáng nút.
 *
 * Hình theo design system "Quilder UI": bo `rounded-md`, chữ đậm 600, vòng
 * focus 2px. Chuỗi ở đây là cỡ VỪA (36px), dùng cho chỗ viết markup tay; component
 * `Button` ở `components/builder/ui/Button.tsx` có đủ ba cỡ (28 / 36 / 44px).
 *
 * ## Vì sao là BẬC, không phải màu riêng cho từng nút
 *
 * Cho mỗi nút một màu "để dễ phân biệt" là cách chắc chắn để KHÔNG nút nào nổi:
 * sáu màu ngang quyền thì mắt không có chỗ bám, và người dùng phải đọc chữ trên
 * từng nút mới đoán ra đâu là việc chính. Màu ở đây mã hoá THỨ HẠNG, không mã hoá
 * danh tính của nút.
 *
 * ## Luật dùng
 *
 * - `primary`  — ĐÚNG MỘT cái trên mỗi màn / mỗi dialog. Hai cái là không có cái nào.
 * - `secondary`— việc hợp lệ nhưng không phải việc chính (Lưu nháp, Mở bảng).
 * - `quiet`    — lối thoát và việc phụ (Huỷ, Xem cạnh, Cấu trúc). Không viền.
 * - `danger`   — mở một bước xác nhận cho thao tác mất dữ liệu hoặc gỡ khỏi site.
 * - `dangerSolid` — CHỈ nút xác nhận phá huỷ bên trong dialog; nhãn nói hậu quả.
 *
 * ## Chip và công tắc KHÔNG nằm trong bảng này
 *
 * Chip chọn danh mục, chip preset, ô màu là CÔNG TẮC: chúng hiện trạng thái bật/tắt,
 * đứng thành hàng chục cái. Đừng "sửa cho nhất quán" bằng các bậc nút ở đây.
 *
 * ## Không dùng `font-shell-mono` cho nút
 *
 * Mono trong vỏ này là dấu hiệu "giá trị máy đọc" — slug, khoá field, đường dẫn.
 * Nhãn nút là một câu tiếng Việt nói với người.
 */

import { focusRing } from './ui';

const BASE = `inline-flex h-control-md items-center justify-center gap-2 whitespace-nowrap rounded-md px-3.5 text-small font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${focusRing}`;

export const btn = {
  primary: `${BASE} bg-shell-accent text-shell-on-accent hover:brightness-110`,
  secondary: `${BASE} border border-shell-line-strong bg-shell-panel text-shell-ink hover:bg-shell-raised`,
  quiet: `${BASE} text-shell-muted hover:bg-shell-raised hover:text-shell-ink`,
  danger: `${BASE} border border-shell-danger bg-shell-panel text-shell-danger hover:bg-shell-danger-soft`,
  dangerSolid: `${BASE} bg-shell-danger text-shell-on-danger hover:brightness-110`,
} as const;
