/**
 * Hình dạng, font và CSS của thanh nổi trên các màn xem trước (`/preview/<id>`,
 * `/preview/release/<id>`). Component nằm ở `PreviewPill.tsx`; file này giữ những thứ
 * CẢ server lẫn client đều cần đọc.
 *
 * ## Vì sao file này KHÔNG có `'use client'`
 *
 * Trang xem nháp (server component) cần một CON SỐ — thanh chiếm bao nhiêu px ở đáy —
 * để chừa chỗ cho khung iframe ở chế độ giả lập bề rộng. Một hằng xuất ra từ file
 * `'use client'` tới server dưới dạng client reference, không phải giá trị: đo ngày
 * 09/10/2026, `PREVIEW_BAR_HEIGHT` cũ (xuất từ `PreviewChrome.tsx`) đi vào style thành
 * `calc(100svh - function() { throw new Error(...) }px)`. Trình duyệt bỏ cả khai báo
 * không hợp lệ đó, và iframe của `?w=768` cao đúng **150px** — kích thước mặc định của
 * iframe — trên một màn 900px. Không lỗi nào hiện ra; chỉ là màn giả lập gần như trống.
 * Cùng bẫy mà `(builder)/layout.tsx` đã ghi về `THEMES`.
 *
 * ## Vì sao font đi qua `next/font/local`, không import `@fontsource` như builder
 *
 * Route group `(site)` không nạp `builder.css` hay font của vỏ. Import CSS của
 * `@fontsource` ở đây sẽ khai một họ font TOÀN CỤC tên `'Be Vietnam Pro'` trên chính
 * trang đang soát — và site nào đặt `font-family: 'Be Vietnam Pro'` mà không tự nạp file
 * (thứ `foundations.ts` cảnh báo là rơi lặng lẽ về font kế tiếp) sẽ trông ĐÚNG ở bản
 * nháp và sai ở site thật. Màn xem trước nói dối đúng chỗ người ta mở ra để nghiệm thu.
 *
 * `next/font/local` đặt tên họ theo tên biến, và ở bản build thì có băm
 * (`'__mmPreviewSans_ab12cd'`), nên không trang nào vô tình dùng trúng. `preload: false`: thanh công cụ không được tranh băng thông với ảnh
 * hero của trang đang soát. Hai họ cho hai bộ ký tự (latin, vietnamese) vì file của
 * `@fontsource` đã tách sẵn theo bộ: trình duyệt lấy chữ từ họ đầu, thiếu glyph ("ả",
 * "ế") thì sang họ thứ hai. `adjustFontFallback: false` là bắt buộc cho việc đó — bật
 * nó thì Next chèn một họ dự phòng (dựa trên Arial, CÓ đủ dấu tiếng Việt) vào giữa hai
 * họ, và mọi chữ có dấu sẽ rơi vào Arial thay vì sang bộ vietnamese.
 *
 * ## Vì sao CSS là một chuỗi gắn vào thuộc tính `data-*`, không phải class
 *
 * Trang này render NỘI DUNG SITE, với CSS của site. Class Tailwind của builder không có
 * định nghĩa ở đây (bundle builder không được nạp), còn một tên class tự đặt có thể đụng
 * class của site. Mọi selector bắt đầu bằng `[data-preview-pill]`, nên CSS này không
 * chạm được thứ gì nằm ngoài thanh.
 *
 * Chiều ngược lại — CSS của site lọt VÀO thanh — chặn bằng `all: revert` trong `:where()`:
 * rule cấp element của site (`a { … }`, `button { … }`, `body { letter-spacing }`) nằm
 * trong `@layer base`, và một rule không thuộc layer nào luôn thắng rule trong layer, bất
 * kể độ đặc hiệu. `:where()` giữ độ đặc hiệu bằng 0 để mọi rule bên dưới đè được nó. SVG
 * được chừa ra: `all` đè cả thuộc tính trình bày (`fill`, `stroke`, `d`) và icon biến mất.
 *
 * Đơn vị là `px`, không `rem` như vỏ builder: `rem` ở đây là `font-size` gốc CỦA SITE, và
 * thanh không được phình theo một trang đặt `html { font-size: 62.5% }`.
 *
 * Màu là giá trị theme SÁNG của "Quilder UI" (`builder.css`) viết thẳng: biến
 * `--color-shell-*` không tồn tại trên site. Đổi token bên đó thì đổi theo ở đây.
 */

import localFont from 'next/font/local';
import type { CSSProperties } from 'react';

const mmPreviewSans = localFont({
  src: [
    { path: '../../../node_modules/@fontsource/be-vietnam-pro/files/be-vietnam-pro-latin-500-normal.woff2', weight: '500', style: 'normal' },
    { path: '../../../node_modules/@fontsource/be-vietnam-pro/files/be-vietnam-pro-latin-600-normal.woff2', weight: '600', style: 'normal' },
  ],
  display: 'swap',
  preload: false,
  adjustFontFallback: false,
});

const mmPreviewSansVi = localFont({
  src: [
    { path: '../../../node_modules/@fontsource/be-vietnam-pro/files/be-vietnam-pro-vietnamese-500-normal.woff2', weight: '500', style: 'normal' },
    { path: '../../../node_modules/@fontsource/be-vietnam-pro/files/be-vietnam-pro-vietnamese-600-normal.woff2', weight: '600', style: 'normal' },
  ],
  display: 'swap',
  preload: false,
  adjustFontFallback: false,
});

/** Mono cho con số đo và slug — cùng vai `font-shell-mono` của vỏ. Chỉ chữ số và ký tự latin. */
const mmPreviewMono = localFont({
  src: [
    { path: '../../../node_modules/@fontsource/jetbrains-mono/files/jetbrains-mono-latin-500-normal.woff2', weight: '500', style: 'normal' },
  ],
  display: 'swap',
  preload: false,
  adjustFontFallback: false,
});

/** Biến font gắn lên gốc thanh (style inline) — tên họ có băm nên phải đọc lúc chạy. */
export const PILL_FONT_VARS = {
  '--pill-sans': `${mmPreviewSans.style.fontFamily}, ${mmPreviewSansVi.style.fontFamily}, system-ui, -apple-system, 'Segoe UI', sans-serif`,
  '--pill-mono': `${mmPreviewMono.style.fontFamily}, ui-monospace, 'SF Mono', 'Cascadia Mono', Consolas, monospace`,
} as CSSProperties;

/** Khoảng cách từ mép dưới màn tới thanh. */
const OFFSET = 16;
/** Chiều cao thanh: nút 28px (vùng bấm tối thiểu, Design.md §9) + đệm 4px + viền 1px, hai phía. */
const HEIGHT = 28 + 4 * 2 + 1 * 2;

/**
 * Dải ở đáy khung nhìn mà thanh nổi chiếm, kể cả khe hở trên và dưới nó.
 *
 * Chỉ VỎ giả lập (`?w=`) dùng số này: ở đó trang là của mình, nên khung iframe ngắn lại
 * đúng bằng dải này và không gì của trang bị che. Bản trần (`/preview/<id>`) thì KHÔNG
 * chừa — xem "Vì sao nổi ở đáy" trong `PreviewChrome.tsx`.
 */
export const PREVIEW_PILL_SPACE = OFFSET + HEIGHT + OFFSET;

const INK = '#0f1a2e';
const MUTED = '#536176';
const ACCENT = '#2a62d9';
const ACCENT_SOFT = '#e7effd';
const RAISED = '#f5f8fc';
const LINE = '#e1e7f0';
/** Hover trên nền trong suốt: `shell-raised` đặc sẽ thành một mảng trắng trên site tối. */
const HOVER = 'rgba(15, 26, 46, 0.06)';

const R = '[data-preview-pill]';

export const PILL_CSS = `
:where(${R}, ${R} *:not(svg, svg *)) { all: revert; box-sizing: border-box; }

${R} {
  position: fixed; z-index: 2147483000;
  left: 50%; bottom: calc(${OFFSET}px + env(safe-area-inset-bottom, 0px));
  transform: translateX(-50%);
  display: flex; align-items: center; gap: 4px;
  width: max-content; max-width: calc(100% - 24px);
  height: ${HEIGHT}px; margin: 0; padding: 4px;
  border: 1px solid rgba(15, 26, 46, 0.1); border-radius: 999px;
  /* 0.85, không thấp hơn: trên nền tối (site tối, dải đáy của vỏ giả lập) nền trong mờ
     xám đi, và ở 0.72 chữ muted chỉ còn ~3.5:1. 0.85 giữ được ~4.5:1 cả trên nền gần đen. */
  background: rgba(255, 255, 255, 0.85);
  -webkit-backdrop-filter: saturate(1.8) blur(16px);
  backdrop-filter: saturate(1.8) blur(16px);
  box-shadow: 0 1px 2px rgba(15, 26, 46, 0.06), 0 8px 24px rgba(15, 26, 46, 0.14);
  color: ${INK};
  font-family: var(--pill-sans); font-size: 13px; font-weight: 500; font-style: normal;
  line-height: 1; letter-spacing: normal; word-spacing: normal; text-transform: none;
  text-align: left; text-shadow: none; white-space: nowrap;
  -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale;
  -webkit-text-size-adjust: 100%; text-size-adjust: 100%;
  -webkit-tap-highlight-color: transparent;
}
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  ${R} { background: rgba(255, 255, 255, 0.96); }
}

${R} [data-pill-body] { display: flex; align-items: center; gap: 4px; flex: 0 1 auto; min-width: 0; }

${R} [data-pill-status] {
  display: inline-flex; align-items: center; gap: 6px; flex-shrink: 0;
  height: 28px; padding: 0 12px 0 10px; border-radius: 999px;
  font-size: 12px; font-weight: 600;
  background: ${RAISED}; color: ${MUTED}; box-shadow: inset 0 0 0 1px ${LINE};
}
${R} [data-pill-status][data-tone=warn] { background: #fdf1dc; color: #995a00; box-shadow: none; }
${R} [data-pill-status][data-tone=ok] { background: #e1f4e7; color: #147a3b; box-shadow: none; }
${R} [data-pill-dot] { display: block; flex-shrink: 0; width: 6px; height: 6px; border-radius: 999px; background: currentColor; }

${R} [data-pill-sep] { display: block; flex-shrink: 0; width: 1px; height: 16px; margin: 0 2px; background: rgba(15, 26, 46, 0.12); }

${R} [data-pill-group] { display: flex; align-items: center; gap: 2px; flex-shrink: 0; min-width: 0; }
${R} [data-pill-scroll] {
  flex: 0 1 auto; overflow-x: auto; overflow-y: hidden; border-radius: 999px;
  overscroll-behavior-x: contain; scrollbar-width: none;
}
${R} [data-pill-scroll]::-webkit-scrollbar { display: none; }

${R} [data-pill-seg] {
  display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0;
  height: 28px; padding: 0 10px; border-radius: 999px;
  color: ${MUTED}; font-size: 13px; font-weight: 500; text-decoration: none; cursor: pointer;
  transition: background-color 0.15s, color 0.15s;
}
${R} [data-pill-seg]:hover { background: ${HOVER}; color: ${INK}; }
${R} [data-pill-seg][aria-current] { background: ${ACCENT_SOFT}; color: ${ACCENT}; font-weight: 600; }
/* Mono chỉ nạp nét 500: để 600 thì trình duyệt tự tô đậm giả, nét nhoè. Nút đang chọn
   đã khác bằng nền và màu chữ. */
${R} [data-pill-mono] { font-family: var(--pill-mono); font-size: 12px; font-weight: 500; font-variant-numeric: tabular-nums; }
${R} [data-pill-seg][data-pill-mono][aria-current] { font-weight: 500; }

${R} [data-pill-chip], ${R} [data-pill-meta] {
  display: block; flex: 0 1 auto; min-width: 4em;
  overflow: hidden; text-overflow: ellipsis; font-size: 12px; line-height: 28px;
}
${R} [data-pill-chip] {
  max-width: 40ch; height: 28px; padding: 0 10px; border-radius: 999px;
  background: ${RAISED}; color: ${INK}; box-shadow: inset 0 0 0 1px ${LINE};
}
${R} [data-pill-meta] { padding: 0 6px; color: ${MUTED}; }

${R} [data-pill-toggle] {
  display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0;
  width: 28px; height: 28px; margin: 0; padding: 0; border: 0; border-radius: 999px;
  background: transparent; color: ${MUTED}; cursor: pointer;
  transition: background-color 0.15s, color 0.15s;
}
${R} [data-pill-toggle]:hover { background: ${HOVER}; color: ${INK}; }

/* Trong vùng cuộn, viền focus lệch ra ngoài sẽ bị cắt mất — nên vẽ vào trong. */
${R} :focus-visible { outline: 2px solid ${ACCENT}; outline-offset: -2px; }

${R} [data-pill-short] { display: none; }
@media (max-width: 560px) {
  ${R} { bottom: calc(12px + env(safe-area-inset-bottom, 0px)); max-width: calc(100% - 16px); }
  ${R} [data-pill-long] { display: none; }
  ${R} [data-pill-short] { display: inline; }
  ${R} [data-pill-seg] { padding: 0 8px; }
  /* Dòng phụ (nhãn release, giờ, người bấm) chỉ còn chỗ cho "Publ…" — vô dụng, mà vẫn
     lấy chỗ của bộ chuyển trang. Câu đầy đủ đi theo \`title\` của chip trạng thái. */
  ${R} [data-pill-meta] { display: none; }
  /* Màn hẹp thì dải cuộn gần như chắc chắn tràn: mép phải mờ dần để báo "còn nữa".
     Đệm cuối bằng đúng vùng mờ, nên cuộn hết thì nút cuối hiện rõ, không bị mờ. */
  ${R} [data-pill-scroll] {
    padding-inline-end: 16px;
    -webkit-mask-image: linear-gradient(to left, transparent, #000 16px);
    mask-image: linear-gradient(to left, transparent, #000 16px);
  }
}
@media (prefers-reduced-motion: reduce) {
  ${R} [data-pill-seg], ${R} [data-pill-toggle] { transition: none; }
}
`;
