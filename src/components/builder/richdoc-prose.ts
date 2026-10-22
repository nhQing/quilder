/**
 * Kiểu dáng cho một khối `RichDoc` đã render — dùng ở BA chỗ: giấy của ô soạn, cột
 * xem cạnh trong `EntryForm`, và bất cứ chỗ nào sau này bày một bài viết trong vỏ
 * builder.
 *
 * ## Vì sao là một chuỗi class, không phải một file CSS
 *
 * `builder.css` khoá `@source` vào `src/app/(builder)` và `src/components/builder`
 * (xem ghi chú đầu file đó), nên class Tailwind chỉ được SINH RA khi nó xuất hiện
 * dưới dạng chuỗi trong một trong hai thư mục ấy. File này nằm trong thư mục thứ
 * hai; `src/lib/render/richdoc.tsx` thì không, nên renderer ở đó cố ý không mang
 * class nào và mọi kiểu dáng phải áp từ ngoài vào.
 *
 * ## Vì sao dùng biến thể `[&_h2]:` chứ không viết một khối CSS
 *
 * Nội dung bài viết là thẻ HTML trần (`h2`, `ul`, `blockquote`…) do `BlockView` —
 * hoặc do ProseMirror — phát ra, nên không có chỗ nào gắn class vào từng thẻ. Biến
 * thể con của Tailwind nhắm đúng chúng mà vẫn đi qua bộ sinh class, tức vẫn nằm
 * trong đúng một đường sinh CSS. Thêm một file `.css` cho việc này là mở đường thứ
 * hai, và đường thứ hai không được `@source` canh.
 *
 * Mọi màu ở đây là TOKEN. Vỏ builder có sáng/tối, nên một mã màu cứng ở đây là một
 * ô chữ không đọc được ở một trong hai chế độ.
 *
 * ## Từ 04/09/2026: cũng dùng cho thân bài `html`
 *
 * Field `html` (CKEditor) phát ra một tập thẻ RỘNG HƠN — bảng, iframe, `h1`/`h5`/`h6`,
 * `<u>`, `<s>`, `<mark>`, `<sup>`, `<sub>` — và cột xem trước trong builder bày cả hai
 * loại thân bài. Phần thêm nằm ở cuối chuỗi.
 *
 * KHÔNG tách ra một hằng thứ hai: một bài `richdoc` không chứa thẻ nào trong phần
 * thêm, nên nó vô hại với bài đó; còn hai hằng là hai chỗ phải nhớ áp, và chỗ quên
 * là cột xem trước hiện một bảng không có đường kẻ.
 *
 * Đây là bản builder của cùng bộ luật mà `lib/render/article-css.ts` áp cho SITE.
 * Hai bản tồn tại vì hai nơi có hai bảng token khác nhau (`--color-shell-*` vs
 * `--color-*`) và hai cơ chế sinh CSS khác nhau — xem docblock "Vì sao là một chuỗi
 * class" bên trên.
 */
export const RICHDOC_PROSE =
  // KHÔNG có màu chữ gốc ở đây: giấy của ô soạn dùng `text-shell-paper-ink`, chỗ
  // khác có thể dùng `text-shell-ink`. Hai utility cùng thuộc tính thì thứ tự trong
  // stylesheet quyết định, không phải thứ tự trong `class` — nên để cả hai lẫn vào
  // một chuỗi là một màu chữ không đoán được.
  'text-small leading-relaxed ' +
  '[&>*+*]:mt-3 ' +
  '[&_h2]:mt-5 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:leading-snug ' +
  '[&_h3]:mt-4 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:leading-snug ' +
  '[&_h4]:mt-4 [&_h4]:text-small [&_h4]:font-semibold [&_h4]:uppercase [&_h4]:tracking-[0.06em] ' +
  '[&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-5 [&_ol]:pl-5 [&_li+li]:mt-1 ' +
  '[&_a]:text-shell-accent [&_a]:underline [&_a]:underline-offset-2 ' +
  '[&_strong]:font-semibold [&_em]:italic ' +
  '[&_blockquote]:border-shell-accent [&_blockquote]:text-shell-muted [&_blockquote]:border-l-2 [&_blockquote]:pl-3 ' +
  '[&_hr]:border-shell-line [&_hr]:my-5 ' +
  '[&_figure]:my-4 ' +
  '[&_figcaption]:text-shell-muted [&_figcaption]:mt-1.5 [&_figcaption]:text-micro ' +
  '[&_img]:max-w-full ' +
  /* ── Chỉ thân bài `html` phát ra ─────────────────────────────────── */
  '[&_h1]:mt-5 [&_h1]:text-xl [&_h1]:font-semibold [&_h1]:leading-tight ' +
  '[&_h5]:mt-4 [&_h5]:text-small [&_h5]:font-semibold ' +
  '[&_h6]:mt-4 [&_h6]:text-micro [&_h6]:font-semibold [&_h6]:uppercase [&_h6]:tracking-[0.06em] ' +
  '[&_u]:underline [&_u]:underline-offset-2 [&_s]:line-through ' +
  '[&_sup]:align-super [&_sup]:text-[0.75em] [&_sub]:align-sub [&_sub]:text-[0.75em] ' +
  '[&_code]:bg-shell-raised [&_code]:font-shell-mono [&_code]:rounded [&_code]:px-1 [&_code]:text-[0.9em] ' +
  // Bút dạ: nền màu cứng, chữ đen. Bốn màu của CKEditor đều sáng, nên để chữ theo
  // màu cha thì ở nền tối là chữ trắng trên nền vàng. Cùng giá trị với `ARTICLE_CSS`.
  '[&_mark]:bg-[#fdfd77] [&_mark]:text-black [&_mark]:px-0.5 ' +
  '[&_mark.marker-green]:bg-[#7ff29b] [&_mark.marker-pink]:bg-[#fc9dbf] [&_mark.marker-blue]:bg-[#86d5fc] ' +
  '[&_mark.pen-red]:bg-transparent [&_mark.pen-red]:text-[#e71313] ' +
  '[&_mark.pen-green]:bg-transparent [&_mark.pen-green]:text-[#128a00] ' +
  // `table-fixed` là điều kiện để `<col style="width:…">` có tác dụng — không có nó
  // thì thao tác kéo cột của tác giả không hiện ra ở cột xem trước.
  '[&_figure.table]:overflow-x-auto ' +
  '[&_table]:w-full [&_table]:table-fixed [&_table]:border-collapse [&_table]:text-micro ' +
  '[&_th]:border [&_td]:border [&_th]:border-shell-line [&_td]:border-shell-line ' +
  '[&_th]:px-2 [&_td]:px-2 [&_th]:py-1 [&_td]:py-1 [&_th]:text-left [&_td]:align-top ' +
  '[&_th]:bg-shell-raised [&_th]:font-semibold ' +
  '[&_caption]:caption-bottom [&_caption]:text-micro [&_caption]:text-shell-muted ' +
  // Khối nhúng: khung 16:9 và iframe phủ kín. Một `<iframe>` không khai chiều cao
  // mặc định là 150px, và YouTube trong 150px là một dải đen.
  '[&_figure.media>div]:relative [&_figure.media>div]:pb-[56.25%] ' +
  '[&_figure.media>div>iframe]:absolute [&_figure.media>div>iframe]:inset-0 ' +
  '[&_figure.media>div>iframe]:h-full [&_figure.media>div>iframe]:w-full [&_iframe]:border-0 ' +
  // Tailwind đổi `_` thành khoảng trắng, nên tên class `image_resized` phải escape
  // dấu gạch dưới của chính nó (`\\_`) — để trần thì selector ra `figure.image resized`.
  '[&_figure.image\\_resized_img]:w-full ' +
  '[&_figure.image-style-align-center]:mx-auto ' +
  '[&_figure.image-style-block-align-right]:ml-auto [&_figure.image-style-block-align-right]:mr-0';
