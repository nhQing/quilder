/**
 * Máy trạng thái của ô đường dẫn: khi nào slug đi theo tiêu đề, khi nào không.
 *
 * Hàm THUẦN, không React — để test được mà không dựng component, và để bốn form
 * đang có ô slug (`NewPageForm`, `PageRename`, `EntryForm`, `EntryLocalePanel`)
 * dùng chung MỘT luật. Bốn bản chép của luật này sẽ trôi khỏi nhau, và bản trôi
 * là bản người dùng gặp ở form ít mở nhất.
 *
 * ## Ba trạng thái, không phải hai
 *
 *  - **auto** — ô slug đang trống và chưa ai gõ vào nó. Gõ tiêu đề thì slug chạy
 *    theo từng phím. Đây là ca "tạo mới", ca thường gặp nhất.
 *  - **manual, còn khớp** — người dùng đã gõ tay, hoặc đây là một trang/bài đã có
 *    slug. Slug hiện đang bằng đúng thứ tiêu đề sinh ra, nên không có gì để đề nghị.
 *  - **manual, tiêu đề vừa đổi** — slug đã cố định, rồi người dùng sửa tiêu đề.
 *    Đây là lúc hiện nút "Tạo lại", và CHỈ hiện nút.
 *
 * Điều kiện của trạng thái thứ ba là "tiêu đề ĐÃ ĐỔI trong phiên này", không phải
 * "slug khác tiêu đề". Hai câu đó nghe giống nhau và cho ra hai giao diện rất khác:
 * câu sau treo một nút "Tạo lại" vĩnh viễn lên mọi trang có slug đặt riêng — mà
 * "Về chúng tôi" ở `/about` là chuyện hoàn toàn bình thường.
 *
 * ## Vì sao lệch thì KHÔNG tự đổi
 *
 * Slug là địa chỉ. Với một trang đã publish, tự đổi nó theo một lần sửa lỗi chính
 * tả ở tiêu đề là làm chết link cũ vì một thao tác người dùng không hề yêu cầu.
 * Một cái nút thì họ thấy, đọc được cảnh báo, rồi tự quyết.
 *
 * ## Vì sao chuẩn hoá KHÔNG chạy khi đang gõ vào ô slug
 *
 * `toSlug` cắt dấu và cắt khoảng trắng, nên chạy nó theo từng phím sẽ làm con trỏ
 * nhảy: gõ "tin tức" thấy "tin-" → "tin" → "tin-t". Lập luận này đã có sẵn trong
 * `PageRename`, và nó vẫn đúng. Tự sinh chỉ ghi vào ô slug khi con trỏ đang ở ô
 * TIÊU ĐỀ; gõ thẳng vào ô slug thì không ai đụng vào giữa chừng.
 */

import { toSlug } from './slug';

export interface AutoSlugState {
  /** Slug mà tiêu đề hiện tại sinh ra. Rỗng khi tiêu đề không còn ký tự dùng được. */
  suggestion: string;
  /** Slug nên hiện trong ô ngay bây giờ. */
  value: string;
  /** Có nên hiện nút "Tạo lại" không. */
  canRegenerate: boolean;
}

export function autoSlugState(args: {
  title: string;
  slug: string;
  /** Người dùng đã gõ tay vào ô slug, hoặc đây là một bản ghi đã có đường dẫn. */
  manual: boolean;
  /**
   * Tiêu đề đã đổi so với lúc mở form.
   *
   * Đây là điều kiện chính, và nó đến từ đúng câu yêu cầu: "đã tự sinh mà tiêu đề
   * THAY ĐỔI thì nhấn tạo lại". So `slug` với `toSlug(title)` thay cho nó là một
   * luật khác hẳn — trang "Về chúng tôi" ở `/about` là một lựa chọn hoàn toàn bình
   * thường, và luật kia sẽ treo một nút "Tạo lại" vĩnh viễn trên nó. Nút lúc nào
   * cũng hiện là nút dạy người ta bỏ qua nút.
   */
  titleChanged: boolean;
  /**
   * Vẫn đề nghị khi ô slug đang TRỐNG, dù tiêu đề chưa đổi.
   *
   * Chỉ đúng ở ô "đường dẫn riêng theo ngôn ngữ": trống ở đó nghĩa là "chưa có",
   * và một nút điền hộ không đụng vào địa chỉ nào đang sống. Ở ô slug của TRANG
   * thì trống lại là một giá trị có nghĩa — đó là trang chủ — nên mặc định tắt.
   */
  offerWhenEmpty?: boolean;
}): AutoSlugState {
  const suggestion = toSlug(args.title);

  if (!args.manual) {
    // Chế độ auto: ô slug LÀ gợi ý, nên không bao giờ có gì để "tạo lại".
    return { suggestion, value: suggestion, canRegenerate: false };
  }

  /*
   * So sánh sau khi chuẩn hoá cả hai phía.
   *
   * Người dùng có thể đang gõ dở "Tin Tức" vào ô slug; so thô sẽ thấy nó khác
   * `tin-tuc` và hiện nút cho một thứ sẽ ra đúng như vậy sau khi lưu.
   */
  const differs = suggestion !== '' && suggestion !== toSlug(args.slug);
  const wanted = args.titleChanged || (args.offerWhenEmpty === true && args.slug.trim() === '');

  return { suggestion, value: args.slug, canRegenerate: differs && wanted };
}
