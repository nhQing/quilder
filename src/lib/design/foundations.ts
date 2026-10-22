/**
 * Phần còn lại của mục "Nền tảng" ở màn Cài đặt — đã GỠ ngày 13/10/2026.
 *
 * File THUẦN: không prisma, không `server-only`.
 *
 * ## Vì sao gỡ
 *
 * Mục Nền tảng cho sửa 12 biến (màu nhấn, màu nền, font…) và hứa "đổi ở đây là đổi
 * trên mọi trang". Đo trên site thật thì lời hứa đó sai: các trang dựng theo Figma
 * bằng bộ biến riêng (`mm-*`, `lv-*`) và mã màu viết cứng, còn 12 biến kia là bộ
 * màu của một theme demo cũ (màu nhấn gốc là cam `#ff4d2e`, không phải tím
 * `#6937ff` của dự án đầu). Đổi Màu nhấn chạm đúng một nút trên trang chủ, trang sản phẩm
 * không đổi gì. Chủ dự án chọn gỡ hẳn thay vì nối lại bộ biến.
 *
 * ## Vì sao file này VẪN còn
 *
 * Lúc gỡ, bảng `Token` đang giữ 7 giá trị đã sửa (`baseValue != null`), và đó là
 * đường DUY NHẤT đưa chúng ra site — CSS tĩnh niêm phong theo release
 * (`Release.cssHash`), còn bản đè thì không. Nền trắng của site chính là
 * `color-bg: #ffffff` đè lên nền gốc `--color-ink`. Ngừng phát là site lật sang nền
 * gần đen, ngay lập tức và ở MỌI release kể cả khi rollback; ghi giá trị vào
 * `tokens.css` không cứu được vì nó chỉ tới site ở lần Publish sau.
 *
 * Nên giá trị cũ tiếp tục được phát, nhưng ĐÓNG BĂNG: không còn API, màn hình hay
 * tool MCP nào sửa được nó.
 */

/** Tên token hợp lệ. Hẹp vì nó đi thẳng vào chuỗi CSS. */
export const TOKEN_NAME_RE = /^[a-z][a-z0-9-]{1,48}$/;

/**
 * Màu hợp lệ: hex 3/4/6/8 chữ số.
 *
 * Không nhận `var()`, `color-mix()` hay hàm nào khác. Token trỏ token là một
 * chuỗi phụ thuộc có thể tự vòng lại (`--a: var(--b); --b: var(--a)`), và CSS xử
 * lý vòng đó bằng cách âm thầm bỏ cả hai — một cách rất khó chẩn đoán để mất màu.
 */
export const TOKEN_COLOR_RE = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** Số kèm đơn vị CSS, ví dụ `1.5rem`, `10px`, `62ch`. */
const LENGTH_RE = /^-?(?:\d+\.?\d*|\.\d+)(?:px|rem|em|ch|ex|vw|vh|vmin|vmax|%)$/i;

/** Số trần, ví dụ `1.62` cho giãn dòng. */
const NUMBER_RE = /^\d+\.?\d*$/;

/**
 * Font stack — luật LOẠI TRỪ: cấm mọi ký tự có thể đóng một khai báo hoặc mở một
 * khai báo mới. Thiếu nó thì một giá trị font là một đường tiêm CSS.
 */
const FONT_FORBIDDEN_RE = /[;{}<>\\]|\/\*|url\(|expression\(/i;

type Kind = 'color' | 'font' | 'length' | 'number';

/** 12 biến của mục cũ và kiểu của chúng — chỉ chúng từng có đường ghi đè. */
const FROZEN: ReadonlyMap<string, Kind> = new Map<string, Kind>([
  ['color-bg', 'color'],
  ['color-fg', 'color'],
  ['color-accent', 'color'],
  ['color-accent-cool', 'color'],
  ['color-muted', 'color'],
  ['font-body', 'font'],
  ['font-display', 'font'],
  ['step-0', 'length'],
  ['leading-body', 'number'],
  ['measure', 'length'],
  ['radius-m', 'length'],
  ['space-m', 'length'],
]);

/**
 * Ba preset cỡ chữ của mục cũ — giá trị `clamp()` duy nhất từng ghi được, vì
 * `LENGTH_RE` cố ý không đọc hàm CSS. So CHÍNH XÁC, không nới regex.
 */
const STEP_0_PRESETS = new Set([
  'clamp(0.88rem, 0.84rem + 0.2vw, 1rem)',
  'clamp(0.95rem, 0.9rem + 0.22vw, 1.08rem)',
  'clamp(1.05rem, 0.98rem + 0.28vw, 1.2rem)',
]);

/**
 * Giá trị đè trong bảng `Token` có được phát ra stylesheet không.
 *
 * Chỉ `render/custom-tokens.ts` gọi. Kiểm lại theo kiểu dù không còn đường ghi:
 * dữ liệu vẫn có thể vào bảng qua `prisma studio` hay một script, và chỗ DUY NHẤT
 * chắc chắn nằm giữa database và stylesheet là chỗ này.
 */
export function isEmittableOverride(name: string, raw: string): boolean {
  const kind = FROZEN.get(name);
  const value = raw.trim();
  if (!kind || !value || value.length > 200) return false;

  switch (kind) {
    case 'color':
      return TOKEN_COLOR_RE.test(value);
    case 'length':
      return LENGTH_RE.test(value) || (name === 'step-0' && STEP_0_PRESETS.has(value));
    case 'number':
      return NUMBER_RE.test(value);
    case 'font':
      return !FONT_FORBIDDEN_RE.test(value);
  }
}
