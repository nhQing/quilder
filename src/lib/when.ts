/**
 * Mốc thời gian hiển thị cho người dùng builder.
 *
 * ## Vì sao phải ghim múi giờ
 *
 * `toLocaleString('vi-VN', …)` không ghim `timeZone` thì nó lấy múi giờ của MÁY
 * đang chạy. Trong một component client, chuỗi đó được dựng hai lần — một lần ở
 * server, một lần ở trình duyệt. Server chạy trong container (`TZ=UTC`), máy khách
 * ở `Asia/Bangkok`: hai chuỗi khác nhau, React báo hydration mismatch (error #418)
 * rồi vẽ lại đoạn đó.
 *
 * Đo được ngày 10/09/2026 trên chính image `v1.4.0`, màn
 * `/builder/releases`. Cùng một mốc `2026-09-09T20:02:00Z`:
 *
 *     trong container   UTC             → "20:02 9/9/26"
 *     trên trình duyệt  Asia/Bangkok    → "03:02 10/9/26"
 *
 * ## Vì sao 275 test e2e không bắt được
 *
 * Bộ e2e chạy trên `pnpm dev`, tức trên chính máy dev — server và trình duyệt cùng
 * một múi giờ, hai chuỗi trùng nhau, không có mismatch nào để thấy. Lỗi này chỉ tồn
 * tại khi server ở múi giờ khác máy khách, nghĩa là ĐÚNG VÀ CHỈ ở bản đóng gói. Nó
 * vô hình trên máy dev theo cấu tạo, nên nó thuộc loại phải chặn bằng một hằng số
 * đúng chứ không phải bằng một lần ai đó nhớ ra.
 *
 * ## Vì sao giờ Việt Nam, không phải giờ máy khách
 *
 * Ghim vào MỘT múi giờ cố định là điều kiện để hai phía cho ra cùng một chuỗi —
 * "giờ của máy khách" theo định nghĩa không làm được điều đó ở lần vẽ đầu tiên.
 * Và mốc thời gian ở đây trả lời "ai publish lúc nào", câu hỏi của một đội ngũ
 * ngồi ở Việt Nam; nên VN là câu trả lời đúng, không chỉ là câu trả lời tiện.
 *
 * Cùng lập luận đã ghi ở `PageHistory.tsx` cho việc ghim `vi-VN`: hai người trong
 * một team phải thấy cùng một chuỗi thì việc chỉ nhau "dòng 14:32" mới có nghĩa.
 * Múi giờ là nửa còn lại của chính câu đó, và nửa đó đã bị bỏ quên.
 *
 * `TokenHistory.tsx` (gỡ 13/10/2026) từng giải cùng bài toán bằng cách cắt thẳng
 * chuỗi ISO. Cách đó cũng tất định, nhưng nó hiện giờ UTC — đúng về kỹ thuật và
 * lệch bảy tiếng so với thứ người đọc đang nghĩ trong đầu.
 */

/** Múi giờ hiển thị. Một hằng số, vì hai chỗ ghim lệch nhau thì lỗi quay lại. */
export const DISPLAY_TZ = 'Asia/Ho_Chi_Minh';

const SHORT: Intl.DateTimeFormatOptions = { dateStyle: 'short', timeStyle: 'short' };

/**
 * Định dạng một mốc thời gian, tất định ở cả server lẫn trình duyệt.
 *
 * `timeZone` đặt SAU `opts` một cách cố ý: chỗ gọi chọn được hình thức hiển thị,
 * nhưng không vô tình bỏ được thứ khiến hàm này tồn tại.
 */
export function when(at: string | Date, opts: Intl.DateTimeFormatOptions = SHORT): string {
  return new Date(at).toLocaleString('vi-VN', { ...opts, timeZone: DISPLAY_TZ });
}
