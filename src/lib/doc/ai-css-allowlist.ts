/**
 * Property mà AI được phép dùng trong `customCss`, và cách đọc property từ CSS thô.
 *
 * ## Vì sao tách khỏi `validate.ts`
 *
 * `validate.ts` khai `server-only` và import `prisma`. Hai hằng dưới đây thì
 * thuần — không chạm DB, không cần môi trường server — nhưng nằm cùng file nghĩa
 * là bất cứ ai muốn đọc allowlist cũng kéo theo cả Prisma client. Đúng cái đã xảy
 * ra: `get_node_schema` chỉ cần danh sách property mà test của nó đỏ vì
 * `.prisma/client/default` chưa được generate.
 *
 * Cùng lý do và cùng tiền lệ với việc `static-css.ts` (thuần) tách khỏi
 * `style-bundle.ts` (chạm DB).
 *
 * ## Vì sao có allowlist chứ không phải blocklist
 *
 * Danh sách này là lớp trang trí: mọi thứ AI được chạm đều KHÔNG ảnh hưởng dòng
 * bố cục. Thứ ảnh hưởng bố cục — position, display, width, height, margin,
 * background, border — phải đi qua `setStyle` để nó còn nằm trong schema có kiểu,
 * tức inspector còn sửa được bằng tay và diff còn đọc được.
 *
 * Blocklist thì mỗi property CSS mới ra đời là một lỗ hổng mặc định mở. Allowlist
 * thì mặc định đóng, và cái giá là đôi khi phải thêm một dòng vào đây — có review.
 *
 * Giới hạn này CHỈ áp cho `actor === 'ai'`. Người gõ trong Inspector không bị
 * chặn: họ chịu trách nhiệm cho thứ họ gõ, và `updatedBy` ghi lại là ai.
 */

export const AI_CSS_ALLOWLIST = new Set([
  'opacity', 'border-radius', 'box-shadow', 'letter-spacing', 'word-spacing',
  'text-shadow', 'filter', 'backdrop-filter', 'mix-blend-mode', 'transform',
  'transition', 'background-image', 'background-size', 'background-position',
  'outline', 'outline-offset', 'gap', 'aspect-ratio', 'object-position',
  /*
   * `clip-path` — thêm 07/09/2026, đúng ca mà docblock trên đã lường: một
   * property trang trí thuần, không ô có kiểu nào tương đương, và bản web thật
   * dùng nó để bung/thu thanh nav.
   *
   * Nó KHÔNG ảnh hưởng dòng bố cục: element vẫn chiếm đúng chỗ cũ, chỉ phần được
   * vẽ bị cắt. Đó là điều kiện để một property vào danh sách này.
   */
  'clip-path',
  /*
   * Bốn property dựng 3D bằng CSS — thêm 05/10/2026. `transform` ở trên chỉ đủ
   * nghiêng MỘT phần tử (`perspective()` viết trong hàm); thẻ lật hai mặt cần
   * `transform-style: preserve-3d` ở cha và `backface-visibility: hidden` ở mặt,
   * còn phối cảnh dùng chung cho cả nhóm con là `perspective` ở cha.
   *
   * Cùng điều kiện với clip-path: không đổi dòng bố cục, chỉ đổi cách vẽ. Tác
   * dụng phụ tạo containing block thì `transform` đã có từ trước, nên không mở
   * thêm gì. `transform-origin` cố ý KHÔNG ở đây — nó có ô có kiểu
   * `transform.origin`.
   */
  'perspective', 'perspective-origin', 'transform-style', 'backface-visibility',
]);

/**
 * Property mà AI hay với tới trong `customCss` nhưng có đường CÓ KIỂU tốt hơn.
 *
 * Không phải allowlist thứ hai và không chặn thêm gì — nó chỉ để câu từ chối nói
 * ĐI ĐÂU, thay vì "dùng thuộc tính có kiểu" chung chung mà người đọc vẫn phải tự
 * đi tìm. Ánh xạ thật lấy từ `stylePathsForProperty` (nghịch đảo của
 * `STYLE_CSS_PROPERTY`); bảng này chỉ liệt kê những ca đáng giải thích thêm.
 *
 * `color` đứng đầu danh sách có lý do: ca hỏng thật là màu chữ theo state của
 * effect ("nền tối đi nhưng chữ vẫn đen"), và đường đúng cho nó là
 * `setStyle { target: { state }, patch: { typography: { color } } }` — nó ăn
 * token nên theo được theme, còn hex gõ tay trong customCss thì không.
 */
export const CSS_ESCAPE_HINT: Record<string, string> = {
  color: 'typography.color',
  'background-color': 'fill.color',
  background: 'fill.color',
  display: 'layout.display',
  position: 'layout.position',
  width: 'size.width',
  height: 'size.height',
  padding: 'spacing.pt / pr / pb / pl',
  margin: 'spacing.mt / mr / mb / ml',
  'font-size': 'typography.size',
  'font-weight': 'typography.weight',
  'border-color': 'border.color',
  'z-index': 'layout.z',
};

/**
 * Tên property xuất hiện trong một chuỗi CSS.
 *
 * Regex chứ không phải postcss: đây là phép kiểm CHẶN, chạy trước khi CSS được
 * lưu, và nó phải bắt cả CSS cú pháp hỏng. Safe parser sẽ vá lỗi rồi trả về cây
 * "đã sửa" — tức một chuỗi lách được parser vẫn có thể lọt. Quét thô đúng chỗ này.
 */
export function cssPropertiesIn(css: string): string[] {
  return [...css.matchAll(/(^|[;{])\s*([a-zA-Z-]+)\s*:/g)].map((m) => m[2]!.toLowerCase());
}
