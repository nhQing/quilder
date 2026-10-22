/**
 * Chuẩn hoá mã hex. File THUẦN, không React.
 *
 * ## Vì sao cần một chỗ riêng cho việc tưởng như hiển nhiên này
 *
 * Bánh xe màu (`react-colorful`) chỉ nhận đúng `#rrggbb`, hoặc `#rrggbbaa` với
 * bản có kênh alpha. Đưa cho nó `#abc`, `abc`, hay `var(--color-ink)` thì nó
 * KHÔNG báo lỗi — nó nhảy về đen. Trên màn hình, "đen" trông y như một đề nghị
 * đổi màu thành đen, và người dùng nhả chuột là đổi thật.
 *
 * Cả hai validator của dự án đều nhận hex 3/4/6/8 chữ số (`HEX_RE` trong
 * `value-io.ts`, `COLOR_RE` trong `design/foundations.ts`), nên "giá trị hợp lệ"
 * và "giá trị bánh xe hiểu được" là HAI tập khác nhau. File này là chỗ dịch giữa
 * chúng, và là chỗ duy nhất — trước đó mỗi component tự viết một regex riêng.
 */

const HEX = /^#?(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/**
 * `#ABC` → `#aabbcc`, `ABCD` → `#aabbccdd`, rác → `null`.
 *
 * Trả `null` chứ không ném và cũng không trả một màu mặc định: người gọi mới biết
 * "không đọc được" nghĩa là gì ở chỗ của họ — ô nhập thì báo lỗi, bánh xe thì lấy
 * hạt giống. Trả sẵn một màu ở đây là quyết định thay cho cả hai.
 */
export function normalizeHex(input: string): string | null {
  const raw = input.trim();
  if (!HEX.test(raw)) return null;

  const body = (raw.startsWith('#') ? raw.slice(1) : raw).toLowerCase();
  // 3 và 4 chữ số là dạng viết tắt: mỗi chữ nhân đôi. `#f0c8` → `#ff00cc88`.
  const full = body.length <= 4 ? [...body].map((c) => c + c).join('') : body;
  return `#${full}`;
}

/** Hex có kênh alpha và alpha KHÁC đục hoàn toàn. `#0d132180` → true. */
export function hasAlpha(input: string): boolean {
  const hex = normalizeHex(input);
  return hex !== null && hex.length === 9 && hex.slice(7) !== 'ff';
}

/** Bỏ kênh alpha. Bánh xe bản không-alpha coi `#rrggbbaa` là giá trị lạ. */
export function dropAlpha(input: string): string | null {
  const hex = normalizeHex(input);
  return hex === null ? null : hex.slice(0, 7);
}

/**
 * Giá trị nạp vào bánh xe: luôn là một hex bánh xe hiểu được.
 *
 * `fallback` dùng khi giá trị hiện tại không phải hex — `var(--x)`, tên token,
 * chuỗi rỗng. Người gọi nên truyền màu ĐANG HIỂN THỊ (đã resolve) làm fallback,
 * không phải một màu tuỳ ý: bánh xe mở ra ở đúng chỗ mắt đang nhìn thì người dùng
 * chỉnh tiếp được, còn mở ra ở một màu khác là mời họ đổi nhầm.
 */
export function toPickerHex(input: string, fallback: string, alpha = false): string {
  const hex = normalizeHex(input) ?? normalizeHex(fallback) ?? '#000000';
  if (alpha) return hex.length === 9 ? hex : `${hex}ff`;
  return hex.slice(0, 7);
}
