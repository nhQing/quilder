/**
 * Kiểu dáng cho thân bài `RichDoc`/`RichText`, phạm vi `[data-mm-article]`.
 *
 * ## Vì sao thân bài cần một khối style riêng
 *
 * `reset.css` của site LÀM PHẲNG mọi khối: `h1…h6 { font-size: inherit; font-weight:
 * inherit }`, `ul, ol { list-style: none }`, `a { text-decoration: none }`. Điều đó
 * ĐÚNG cho site — mọi bậc chữ ở đó do CSS compiler phát ra theo từng node
 * (`[data-n]`). Nhưng một bài `RichDoc` không có node doc nào: nó là cây khối do
 * người biên tập gõ, không phải cây node do người dựng kéo. Không có khối này thì bài
 * viết là một khối chữ cùng cỡ, không bullet, không link nhìn ra được.
 *
 * ## Vì sao một hằng dùng chung, không phải hai bản
 *
 * Hai chỗ cần đúng bộ luật này: route xem trước trong builder và trang chi tiết công
 * khai. Hai bản của cùng một stylesheet sẽ trôi khỏi nhau, và cái trôi mất là "bản xem
 * trước khác trang thật" — tức đúng lời hứa mà màn xem trước tồn tại để giữ.
 *
 * ## Vì sao selector cấp element, không phải class Tailwind
 *
 * `builder.css` khoá `@source` vào `src/app/(builder)` và `src/components/builder`,
 * còn `richdoc.tsx` nằm ở `src/lib/render` — một class viết ở đó KHÔNG được sinh ra.
 * Nó chạy đúng ở dev nếu class đó tình cờ đã tồn tại chỗ khác, rồi biến mất im lặng.
 *
 * Giá trị đều là token của site (`--step-*`, `--space-*`, `--color-*`), nên đổi thang
 * chữ ở một chỗ là bài viết đổi theo.
 *
 * ## Hai hình dạng thân bài, một stylesheet
 *
 * Từ 04/09/2026 thân bài có thể là `RichDoc` (cây khối, render bằng JSX) HOẶC `html`
 * (chuỗi, render bằng `ArticleHtml`). Cả hai phát ra ĐÚNG những thẻ HTML như nhau
 * cho phần chung — `h2`, `ul`, `blockquote`, `figure` — nên phần trên áp cho cả hai
 * mà không cần biết đang render kiểu nào.
 *
 * Khác biệt: `html` phát thêm bảng, iframe, `h1`/`h5`/`h6`, `<u>`, `<s>`, `<mark>`,
 * `<sup>`, `<sub>`, và `figure.image` do CKEditor bọc quanh ảnh. Những thứ đó nằm ở
 * khối cuối file. Chúng KHÔNG bị tách ra một hằng riêng: một bài `richdoc` không có
 * thẻ nào khớp, nên phần thêm là vô hại với nó, còn hai hằng thì lại là hai chỗ phải
 * nhớ nạp.
 */
export const ARTICLE_CSS = `
[data-mm-article] { max-width: 72ch; margin-inline: auto; }
[data-mm-article] > * + * { margin-block-start: var(--space-s); }
[data-mm-article] h2,
[data-mm-article] h3,
[data-mm-article] h4 {
  font-family: var(--font-display);
  font-weight: var(--weight-bold);
  line-height: var(--leading-snug);
  margin-block-start: var(--space-l);
}
[data-mm-article] h2 { font-size: var(--step-2); }
[data-mm-article] h3 { font-size: var(--step-1); }
[data-mm-article] h4 { font-size: var(--step-0); text-transform: uppercase; letter-spacing: .06em; }
[data-mm-article] ul,
[data-mm-article] ol { padding-inline-start: 1.5rem; }
[data-mm-article] ul { list-style: disc; }
[data-mm-article] ol { list-style: decimal; }
[data-mm-article] li + li { margin-block-start: var(--space-3xs); }
[data-mm-article] a { text-decoration: underline; text-underline-offset: 2px; color: var(--color-accent); }
[data-mm-article] blockquote {
  border-inline-start: 2px solid var(--color-accent);
  padding-inline-start: var(--space-s);
  color: var(--color-muted);
  font-size: var(--step-1);
}
[data-mm-article] figure { margin-block: var(--space-l); }
[data-mm-article] figcaption {
  margin-block-start: var(--space-2xs);
  font-size: var(--step--1);
  color: var(--color-muted);
}
[data-mm-article] hr { border: 0; border-block-start: 1px solid var(--color-line); margin-block: var(--space-l); }
[data-mm-article] strong { font-weight: var(--weight-bold); }

/*
 * Từ đây xuống: chỉ thân bài 'html' (CKEditor) phát ra.
 *
 * 'ArticleHtml' phải bọc chuỗi trong một thẻ chủ để 'dangerouslySetInnerHTML' có chỗ
 * cắm, nên các khối của bài nằm SÂU một tầng so với 'richdoc'. Luật '> * + *' ở trên
 * nhắm con TRỰC TIẾP của ô cắm, nên nó không với tới — lặp lại đúng một dòng cho
 * '[data-article]' rẻ hơn việc đổi luật trên thành 'descendant', vốn sẽ cộng khoảng
 * cách cho cả 'li + li' và 'td' bên trong bảng.
 */
[data-mm-article] [data-article] > * + * { margin-block-start: var(--space-s); }

/* 'h1' trong thân bài: cùng thang với 'h2' nhưng to hơn một bậc. Trang chi tiết đã
   có 'h1' là tiêu đề bài, nên đây là lựa chọn có ý thức của tác giả — xem 'TAGS'
   trong 'html-sanitize.ts'. */
[data-mm-article] h1,
[data-mm-article] h5,
[data-mm-article] h6 {
  font-family: var(--font-display);
  font-weight: var(--weight-bold);
  line-height: var(--leading-snug);
  margin-block-start: var(--space-l);
}
[data-mm-article] h1 { font-size: var(--step-3); }
[data-mm-article] h5 { font-size: var(--step-0); font-weight: var(--weight-bold); }
[data-mm-article] h6 { font-size: var(--step--1); text-transform: uppercase; letter-spacing: .06em; }

/* 'reset.css' bỏ gạch chân và đường kẻ của 'u'/'s' cùng lúc với 'a' — trả lại. */
[data-mm-article] u { text-decoration: underline; text-underline-offset: 2px; }
[data-mm-article] s { text-decoration: line-through; }
[data-mm-article] em { font-style: italic; }
[data-mm-article] code {
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: .9em;
  padding: .1em .35em;
  border-radius: var(--radius-s, 3px);
  background: var(--color-glass);
}
[data-mm-article] sub,
[data-mm-article] sup { font-size: .75em; line-height: 0; position: relative; vertical-align: baseline; }
[data-mm-article] sup { top: -.5em; }
[data-mm-article] sub { bottom: -.25em; }

/*
 * Bút dạ. Màu NỀN cứng chứ không token: 'marker-yellow' phải ra vàng ở cả nền sáng
 * và nền tối, nên nó không thể là '--color-accent'. Chữ đặt '--color-ink' vì bốn màu
 * dưới đây đều sáng — để 'inherit' thì ở nền tối là chữ trắng trên nền vàng.
 */
[data-mm-article] mark { background: #fff3a3; color: var(--color-ink); padding: 0 .15em; }
[data-mm-article] mark.marker-yellow { background: #fdfd77; color: var(--color-ink); }
[data-mm-article] mark.marker-green  { background: #7ff29b; color: var(--color-ink); }
[data-mm-article] mark.marker-pink   { background: #fc9dbf; color: var(--color-ink); }
[data-mm-article] mark.marker-blue   { background: #86d5fc; color: var(--color-ink); }
/* Bút 'pen-*' tô CHỮ, không tô nền — đó là ý nghĩa của nó trong CKEditor. */
[data-mm-article] mark.pen-red   { background: transparent; color: #e71313; }
[data-mm-article] mark.pen-green { background: transparent; color: #128a00; }

/*
 * Bảng. 'table-layout: fixed' là điều kiện để '<col style="width:…">' có tác dụng —
 * không có nó thì trình duyệt tự chia cột theo nội dung và thao tác kéo cột của tác
 * giả biến mất khi bài lên site, tức bản xem trước khác trang thật.
 */
[data-mm-article] figure.table { margin-block: var(--space-l); overflow-x: auto; }
[data-mm-article] table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  font-size: var(--step--1);
}
[data-mm-article] th,
[data-mm-article] td {
  border: 1px solid var(--color-line-strong);
  padding: var(--space-2xs) var(--space-xs);
  text-align: start;
  vertical-align: top;
}
[data-mm-article] th { font-weight: var(--weight-bold); background: var(--color-glass); }
[data-mm-article] caption { caption-side: bottom; font-size: var(--step--1); color: var(--color-muted); }

/*
 * Nhúng. Khung 16:9 và 'iframe' phủ kín nó: một '<iframe>' không khai kích thước có
 * cao mặc định 150px, và YouTube trong 150px là một dải đen.
 */
[data-mm-article] figure.media { margin-block: var(--space-l); }
[data-mm-article] figure.media > div[data-oembed-url] {
  position: relative;
  padding-block-end: 56.25%;
}
[data-mm-article] figure.media > div[data-oembed-url] > iframe {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border: 0;
}
/* Một 'iframe' không nằm trong khối nhúng (bài cũ, hoặc gõ tay ở chế độ HTML). */
[data-mm-article] > iframe,
[data-mm-article] [data-article] > iframe { width: 100%; aspect-ratio: 16 / 9; border: 0; }

/*
 * Ảnh của CKEditor. 'figure.image_resized' mang 'style="width:…"', nên chiều rộng
 * do inline style quyết định — ở đây chỉ lo cho ảnh KHÔNG bị kéo cỡ, và lo cho căn lề.
 */
[data-mm-article] img { max-width: 100%; height: auto; display: block; }
[data-mm-article] figure.image { margin-block: var(--space-l); }
[data-mm-article] figure.image.image_resized img { width: 100%; }
[data-mm-article] figure.image-style-align-center { margin-inline: auto; }
[data-mm-article] figure.image-style-block-align-left { margin-inline-end: auto; margin-inline-start: 0; }
[data-mm-article] figure.image-style-block-align-right { margin-inline-start: auto; margin-inline-end: 0; }
`;
