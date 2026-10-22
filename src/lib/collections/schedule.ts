/**
 * Cache phải hết hạn ĐÚNG LÚC bài hẹn giờ tới hạn.
 *
 * `revalidate: 3600` cố định nghĩa là một bài hẹn 9:00 chỉ xuất hiện khi có người tình
 * cờ làm cache miss — tức bài đã duyệt vẫn không lên đúng giờ, và không có gì để lần
 * vì mọi thứ trong DB đều đúng: `status` đúng, `publishedAt` đúng, chỉ có bản đang
 * phục vụ là bản chụp lúc 8:30.
 *
 * Ca tệ nhất không phải "lên muộn": `getEntryBySlug` cache cả `null`, nên URL của bài
 * hẹn 9:00 mà có ai mở lúc 8:59 sẽ trả 404 tới tận 9:59 — và nếu người mở lúc 8:59 là
 * Googlebot thì cái được ghi nhớ là một 404.
 *
 * THUẦN, không `server-only`: để test được, và nó không chạm gì.
 */

const DEFAULT_CAP = 3600;

/**
 * Không bao giờ 0: `revalidate: 0` trong Next nghĩa là KHÔNG cache, tức mỗi lượt xem
 * là một truy vấn. Một mốc hẹn giờ cách đây nửa giây không được biến cả trang thành
 * uncached.
 */
const FLOOR = 10;

export function nextRevalidateSeconds(
  publishedAts: (Date | null | undefined)[],
  now: Date,
  cap = DEFAULT_CAP,
): number {
  let best = cap;
  for (const at of publishedAts) {
    if (!at) continue;
    // `ceil` chứ không `floor`: làm tròn xuống thì cache hết hạn TRƯỚC mốc một chút,
    // lượt đọc kế vẫn thấy bài chưa tới hạn, và ta trả một lượt truy vấn cho không.
    const delta = Math.ceil((at.getTime() - now.getTime()) / 1000);
    if (delta > 0 && delta < best) best = delta;
  }
  return Math.max(FLOOR, best);
}
