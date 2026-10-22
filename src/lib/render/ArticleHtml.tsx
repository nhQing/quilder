/**
 * Render thân bài kiểu `html`. Đây là chỗ DUY NHẤT trong repo gọi
 * `dangerouslySetInnerHTML` với chữ do người dùng nhập.
 *
 * ## Điều kiện để component này an toàn
 *
 * Nó KHÔNG tự làm sạch. Chuỗi đưa vào đây phải đã đi qua `sanitizeArticleHtml` —
 * `entryBodies()` làm việc đó ở đường đọc, và `entry-data.ts` đã làm ở đường ghi.
 * Đó là lý do prop tên `safeHtml` chứ không tên `html`: một chỗ gọi mới phải tự
 * hỏi "chuỗi này sạch chưa" trước khi gõ xong tên prop.
 *
 * Đặt phép làm sạch bên trong component thì gọn hơn nhưng sai: component này render
 * trong cả cây server (trang site) lẫn cây client (canvas builder), còn danh sách
 * host được phép nằm trong database — một component async không dùng được ở cây
 * client, và một lời gọi `fetch` trong client là một lượt mạng cho mỗi lần gõ.
 *
 * ## Vì sao không mang class
 *
 * Cùng nguyên tắc với `richdoc.tsx`: renderer không mang kiểu dáng. Node bố cục chứa
 * ô `part="entry:<field>"` đã được `common()` trong `NodeRenderer` gắn
 * `data-mm-article`, và `ARTICLE_CSS` nhắm vào đó. Gắn class Tailwind ở đây thì
 * không sinh ra được: `builder.css` khoá `@source` vào hai thư mục builder, và file
 * này ở `src/lib/render`.
 *
 * `data-article` KHÔNG phải một móc kiểu dáng thứ hai — nó có mặt vì
 * `dangerouslySetInnerHTML` cần một thẻ chủ, nên các khối của bài nằm sâu hơn một
 * tầng so với `richdoc`, và đúng một luật trong `ARTICLE_CSS` phải với xuống tầng đó.
 */

export function ArticleHtml({ safeHtml, id }: { safeHtml: string; id?: string }) {
  // `safeHtml` đã qua `sanitizeArticleHtml` (collections/html-sanitize.ts) ở cả đường ghi
  // lẫn đường đọc — tên prop là lời hứa đó; nơi gọi phải giữ nó.
  // eslint-disable-next-line react/no-danger
  return <div data-article="" data-node-id={id} dangerouslySetInnerHTML={{ __html: safeHtml }} />;
}
