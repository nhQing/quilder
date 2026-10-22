/**
 * Nối biến CSS của CKEditor vào token của vỏ builder.
 *
 * ## Vì sao cần
 *
 * `ckeditor5.css` là một theme SÁNG cố định: nền trắng, viền xám, chữ đen. Vỏ builder
 * có sáng và tối, nên không có khối này thì ở chế độ tối ô soạn là một hình chữ nhật
 * trắng chói giữa trang — và thanh công cụ của nó thì trắng trên trắng.
 *
 * CKEditor khai gần như toàn bộ màu qua biến `--ck-*`, nên ánh xạ lại biến là cách
 * đúng: nó theo được mọi component của ô soạn (menu, hộp thoại, tooltip) mà không
 * phải săn từng selector, và nó tự đổi khi vỏ đổi chế độ vì token bên phải đổi.
 *
 * ## Chỉ CHROME, không đụng tới bài
 *
 * Khối này vẽ KHUNG của ô soạn theo design system: một ô nhập như mọi ô nhập khác
 * (viền `shell-line-strong`, bo `radius-md`, vòng focus accent), thanh công cụ nền
 * panel có vạch dưới, nút 32px. Giấy bên trong (`shell-paper`) và cách bài viết hiện
 * ra thì không thuộc vỏ — chúng nói về site, xem `richdoc-prose.ts` và
 * `article-palette.ts` — nên ở đây chỉ có nền, màu chữ và chiều cao của giấy.
 *
 * ## Vì sao là một chuỗi trong `<style>`, không phải class Tailwind
 *
 * Selector phải nhắm vào class do CKEditor tự sinh (`.ck-editor__editable`,
 * `.ck-toolbar`) — không có chỗ nào để gắn class Tailwind vào. Cùng khuôn với
 * `ARTICLE_CSS`.
 *
 * Token bên phải LUÔN là `--color-shell-*` (xem `@theme` trong `builder.css`), không
 * phải `--color-*` của site: đây là chrome của công cụ, và trộn hai bảng màu là đúng
 * thứ mà bảng màu riêng của builder tồn tại để tránh. Bóng cũng trộn từ token
 * (`shell-backdrop`), không viết mã màu: ở theme tối bóng phải đậm hơn, không sáng lên.
 *
 * `--ck-z-*` bị đặt lại vì thanh công cụ nổi và menu của CKEditor mặc định ở
 * `z-index: 100`, cao hơn thanh điều hướng builder — nên menu màu sẽ đè lên nav.
 *
 * ## Vì sao khung KHÔNG `overflow: hidden`
 *
 * Bo góc một khung có hai mảnh (thanh công cụ + giấy) bằng cách cắt khung là cách
 * nhanh nhất — và nó cắt luôn menu thả xuống của thanh công cụ (chọn bậc tiêu đề,
 * bảng màu), vì các menu đó nằm TRONG thanh, định vị tuyệt đối. Nên từng mảnh tự bo
 * góc của nó.
 */

export const CKEDITOR_THEME = `
.mm-ck {
  --ck-border-radius: var(--radius-sm, 6px);
  --ck-font-face: var(--font-shell);
  --ck-z-default: 20;
  --ck-z-panel: 40;
  --ck-z-modal: 60;

  --ck-color-base-background: var(--color-shell-paper);
  --ck-color-base-foreground: var(--color-shell-paper);
  --ck-color-base-text: var(--color-shell-paper-ink);
  --ck-color-base-border: var(--color-shell-line);
  --ck-color-base-active: var(--color-shell-accent);
  --ck-color-base-active-focus: var(--color-shell-accent);
  --ck-color-focus-border: var(--color-shell-accent);
  --ck-color-focus-outer-shadow: var(--color-shell-accent-soft);
  --ck-color-text: var(--color-shell-paper-ink);
  --ck-color-shadow-drop: color-mix(in oklab, var(--color-shell-backdrop) 45%, transparent);
  --ck-color-shadow-inner: transparent;

  --ck-color-toolbar-background: var(--color-shell-panel);
  --ck-color-toolbar-border: var(--color-shell-line);
  --ck-color-button-default-background: transparent;
  --ck-color-button-default-hover-background: var(--color-shell-raised);
  --ck-color-button-default-active-background: var(--color-shell-raised);
  --ck-color-button-default-disabled-background: transparent;
  --ck-color-button-on-background: var(--color-shell-accent-soft);
  --ck-color-button-on-hover-background: var(--color-shell-accent-soft);
  --ck-color-button-on-active-background: var(--color-shell-accent-soft);
  --ck-color-button-on-color: var(--color-shell-accent);
  --ck-color-button-save: var(--color-shell-ok);
  --ck-color-button-cancel: var(--color-shell-danger);

  --ck-color-dropdown-panel-background: var(--color-shell-panel);
  --ck-color-dropdown-panel-border: var(--color-shell-line);
  --ck-color-panel-background: var(--color-shell-panel);
  --ck-color-panel-border: var(--color-shell-line);
  --ck-color-input-background: var(--color-shell-panel);
  --ck-color-input-border: var(--color-shell-line-strong);
  --ck-color-input-text: var(--color-shell-ink);
  --ck-color-input-disabled-background: var(--color-shell-raised);
  --ck-color-labeled-field-label-background: var(--color-shell-panel);
  --ck-color-list-background: var(--color-shell-panel);
  --ck-color-list-button-hover-background: var(--color-shell-raised);
  --ck-color-list-button-on-background: var(--color-shell-accent-soft);
  --ck-color-list-button-on-background-focus: var(--color-shell-accent-soft);
  --ck-color-list-button-on-text: var(--color-shell-accent);
  /* Tooltip đảo màu, như tooltip của design system: nền chữ, chữ nền. */
  --ck-color-tooltip-background: var(--color-shell-ink);
  --ck-color-tooltip-text: var(--color-shell-panel);
  --ck-color-split-button-hover-background: var(--color-shell-raised);
  --ck-color-split-button-hover-border: var(--color-shell-line);

  /* Thanh công cụ và menu là CHROME của công cụ, nên chữ ở đó dùng
     \`--color-shell-ink\`, không dùng màu chữ của giấy. Không tách hai vai này thì ở
     nền tối cả thanh công cụ là chữ đen trên nền tối. */
  --ck-color-toolbar-text: var(--color-shell-ink);
}
.mm-ck .ck.ck-toolbar,
.mm-ck .ck.ck-toolbar .ck-button,
.mm-ck .ck.ck-list,
.mm-ck .ck.ck-list .ck-button,
.mm-ck .ck.ck-dropdown__panel { color: var(--color-shell-ink); }

/* Khung: một ô nhập của design system — viền control, hover đậm viền, focus accent
   kèm quầng accent nhạt. \`:focus-within\` vì thứ nhận focus là giấy hoặc một nút
   trên thanh, không phải chính khung. */
.mm-ck .ck.ck-editor {
  border: 1px solid var(--color-shell-line-strong);
  border-radius: var(--radius-md, 12px);
  background: var(--color-shell-panel);
  transition: border-color 0.12s, box-shadow 0.12s;
}
.mm-ck .ck.ck-editor:hover { border-color: var(--color-shell-muted); }
.mm-ck .ck.ck-editor:focus-within {
  border-color: var(--color-shell-accent);
  box-shadow: 0 0 0 3px var(--color-shell-accent-soft);
}

/* Thanh công cụ: nền panel, vạch dưới, bo theo hai góc trên của khung. */
.mm-ck .ck.ck-editor .ck-editor__top .ck-sticky-panel .ck-toolbar {
  border: 0;
  border-bottom: 1px solid var(--color-shell-line);
  border-radius: var(--radius-md, 12px) var(--radius-md, 12px) 0 0;
  background: var(--color-shell-panel);
  padding: 0.25rem 0.375rem;
}
/* Khi thanh dính lên đầu màn (cuộn bài dài) nó tách khỏi khung: vẽ lại nó như một lớp nổi. */
.mm-ck .ck.ck-editor .ck-sticky-panel__content_sticky .ck-toolbar {
  border-radius: 0 0 var(--radius-md, 12px) var(--radius-md, 12px);
  box-shadow: var(--shadow-shell-pop);
}
.mm-ck .ck.ck-toolbar .ck.ck-button,
.mm-ck .ck.ck-toolbar .ck.ck-dropdown__button {
  min-height: 2rem;
  min-width: 2rem;
  border-radius: var(--radius-sm, 6px);
  color: var(--color-shell-muted);
}
.mm-ck .ck.ck-toolbar .ck.ck-button:not(.ck-disabled):hover,
.mm-ck .ck.ck-toolbar .ck.ck-dropdown__button:not(.ck-disabled):hover { color: var(--color-shell-ink); }
.mm-ck .ck.ck-toolbar .ck.ck-button.ck-on { color: var(--color-shell-accent); }
.mm-ck .ck.ck-toolbar .ck.ck-button:focus-visible {
  outline: 2px solid var(--color-shell-accent);
  outline-offset: 2px;
  box-shadow: none;
}
.mm-ck .ck.ck-toolbar .ck.ck-toolbar__separator { background: var(--color-shell-line); }

/* Menu thả xuống và balloon: khung lớp nổi của design system. */
.mm-ck .ck.ck-dropdown__panel,
.ck.ck-balloon-panel {
  border-color: var(--color-shell-line);
  border-radius: var(--radius-md, 12px);
  box-shadow: var(--shadow-shell-pop);
}

/* Giấy của ô soạn. \`min-height\` chứ không \`height\`: ô soạn cao lên theo bài, và một
   chiều cao cố định làm bài dài phải cuộn trong một cửa sổ nhỏ giữa trang.
   \`max-height\` thì có, để thanh công cụ không trôi khỏi màn hình ở bài rất dài.
   Giấy không có viền riêng (khung đã vẽ viền) và bo theo hai góc dưới của khung. */
.mm-ck .ck-editor__editable {
  min-height: 24rem;
  max-height: 42rem;
  overflow-y: auto;
}
.mm-ck .ck.ck-editor .ck-editor__main > .ck-editor__editable,
.mm-ck .ck.ck-editor .ck-editor__main > .ck-editor__editable.ck-focused {
  background: var(--color-shell-paper);
  color: var(--color-shell-paper-ink);
  border: 0;
  border-radius: 0 0 var(--radius-md, 12px) var(--radius-md, 12px);
  box-shadow: none;
}
.mm-ck .ck-editor__editable_inline { padding: 0.75rem 1rem; }

/* Chế độ sửa HTML: chữ đơn cách. Đây là chỗ tác giả dán HTML từ nơi khác vào, nên
   nó phải đọc như code, không như văn bản. */
.mm-ck .ck-source-editing-area textarea {
  font-family: var(--font-shell-mono);
  font-size: 0.8125rem;
  line-height: 1.6;
  background: var(--color-shell-panel);
  color: var(--color-shell-ink);
  border: 0;
  border-radius: 0 0 var(--radius-md, 12px) var(--radius-md, 12px);
}
`;
