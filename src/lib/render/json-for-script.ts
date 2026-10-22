/**
 * JSON an toàn để đặt bên trong thẻ `<script>`.
 *
 * `JSON.stringify` không escape `<`. JSON-LD của bài viết lấy tiêu đề entry làm
 * `headline`, và cả editor lẫn AI (`update_entry`) đều ghi được tiêu đề — nên một
 * tiêu đề chứa `</script>` đóng thẻ sớm, và phần còn lại thành HTML chạy trên site
 * công khai. Trình duyệt tìm `</script` bằng so chuỗi, không hiểu JSON.
 *
 * Escape thành `\uXXXX` chứ không thành thực thể HTML: nội dung `<script>` không
 * được giải mã thực thể, còn `<` thì `JSON.parse` (và Google) đọc lại đúng
 * thành `<`. U+2028/U+2029 hợp lệ trong JSON nhưng từng là ký tự xuống dòng trong
 * JavaScript, nên cũng escape để nội dung đọc được ở mọi trình phân tích.
 */
const LINE_SEPARATOR = String.fromCharCode(0x2028);
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029);

export function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replaceAll(LINE_SEPARATOR, '\\u2028')
    .replaceAll(PARAGRAPH_SEPARATOR, '\\u2029');
}
