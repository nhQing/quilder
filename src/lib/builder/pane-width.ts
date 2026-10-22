/**
 * Bề rộng Inspector (cột phải của editor) khi người dùng kéo tay.
 *
 * Hàm thuần để test được; `PaneResizer` và hai shell editor dùng.
 *
 * ## Vì sao trần là `min(560px, 45vw)`
 *
 * 560 là trần của `--shell-right` mặc định (`builder.css`). Vế 45vw để canvas không bao
 * giờ bị ép còn quá hẹp khi cửa sổ thu nhỏ SAU khi đã kéo rộng: giá trị đã lưu vẫn giữ
 * nguyên, chỉ bề rộng hiển thị bị kẹp lại — mở rộng cửa sổ ra thì nó về đúng chỗ.
 */

export const RIGHT_PANE_MIN = 280;
export const RIGHT_PANE_MAX = 560;
/** Bước phím mũi tên, và bước khi giữ Shift. */
export const RIGHT_PANE_STEP = 16;
export const RIGHT_PANE_STEP_BIG = 64;

export function rightPaneMax(viewportWidth: number): number {
  return Math.max(RIGHT_PANE_MIN, Math.min(RIGHT_PANE_MAX, Math.floor(viewportWidth * 0.45)));
}

export function clampRightPane(px: number, viewportWidth: number): number {
  return Math.round(Math.min(rightPaneMax(viewportWidth), Math.max(RIGHT_PANE_MIN, px)));
}
