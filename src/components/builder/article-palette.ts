/**
 * Bảng màu cho ô soạn thân bài (`html`). CHỈ màu của site, không phải bánh xe màu.
 *
 * ## Vì sao giới hạn bảng màu thay vì cho chọn tự do
 *
 * CKEditor mặc định bày một bánh xe màu 16 triệu giá trị. Kết quả đo được ở mọi CMS
 * cho làm thế: sau nửa năm, thân bài có mười hai sắc cam khác nhau, không sắc nào
 * trùng `--color-accent`, và đổi màu thương hiệu không còn đổi được gì vì màu đã bị
 * đóng băng trong HTML của từng bài. Một bảng màu đóng làm việc đổi token quay lại
 * có tác dụng — với những bài dùng đúng token.
 *
 * `html-sanitize.ts` chỉ nhận hex và `rgb()` cho `color`/`background-color`, nên một
 * giá trị `var(--color-accent)` gõ tay vào chế độ sửa HTML sẽ bị lọc mất. Đó là lý do
 * bảng này phải là màu ĐÃ GIẢI, không phải tên biến.
 *
 * ## Vì sao đọc lúc chạy chứ không viết hằng số
 *
 * `--color-accent` có thể bị đè lúc render (giá trị đóng băng của mục Nền tảng cũ —
 * xem `lib/design/foundations.ts`) hoặc đổi trong `tokens.css`. Một hằng số hex ở
 * file này sẽ trôi lệch ngay lần đổi đầu tiên, và không có gì phát hiện — bảng màu
 * vẫn hiện, chỉ là hiện màu cũ.
 * `getComputedStyle` đọc đúng giá trị đang có hiệu lực trong trình duyệt.
 *
 * `FALLBACK` là mạng an toàn cho trường hợp vỏ builder không nạp `tokens.css` (biến
 * trả về chuỗi rỗng). Nó KHÔNG phải bản sao thứ hai của bảng màu: nó chỉ giữ cho ô
 * soạn có gì đó dùng được thay vì một bảng trống.
 */

export interface PaletteEntry {
  /** Giá trị đi vào `style` của HTML. Phải là hex hoặc `rgb()` — xem docblock. */
  color: string;
  label: string;
}

/**
 * Token → nhãn tiếng Việt. Thứ tự ở đây là thứ tự hiện trong ô chọn màu.
 *
 * Chỉ những token mà một tác giả có lý do dùng cho CHỮ trong bài. `--color-bg` và
 * `--color-line` không có ở đây: màu nền của trang làm chữ vô hình, và màu đường kẻ
 * làm chữ gần như không đọc được.
 */
const SOURCE: readonly { token: string; label: string; fallback: string }[] = [
  { token: '--color-fg', label: 'Chữ mặc định', fallback: '#f4f1ea' },
  { token: '--color-muted', label: 'Chữ mờ', fallback: '#a5a198' },
  { token: '--color-accent', label: 'Màu nhấn', fallback: '#ff4d2e' },
  { token: '--color-accent-warm', label: 'Vàng cam', fallback: '#ffb03b' },
  { token: '--color-accent-cool', label: 'Xanh ngọc', fallback: '#2bd6bf' },
  { token: '--color-accent-violet', label: 'Tím', fallback: '#8a74ff' },
  { token: '--color-ink', label: 'Đen', fallback: '#0b0b0f' },
  { token: '--color-bone', label: 'Trắng ngà', fallback: '#f4f1ea' },
];

/**
 * Chỉ nhận hex. `getComputedStyle` có thể trả `rgb(…)`, `oklch(…)`, hay một chuỗi
 * rỗng — hai cái sau thì `html-sanitize` sẽ lọc mất, nên lấy `fallback` còn tốt hơn
 * là bày một màu mà lưu xong sẽ biến mất.
 */
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const RGB = /^rgba?\(\s*[\d.\s,%/]+\)$/i;

export function articlePalette(): PaletteEntry[] {
  // SSR và lúc dựng thumbnail: không có `document`. Trả bản dự phòng, đừng ném.
  const root = typeof document === 'undefined' ? null : document.documentElement;
  const cs = root ? getComputedStyle(root) : null;

  return SOURCE.map(({ token, label, fallback }) => {
    const live = cs?.getPropertyValue(token).trim() ?? '';
    const ok = HEX.test(live) || RGB.test(live);
    return { color: ok ? live : fallback, label };
  });
}
