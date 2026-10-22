/**
 * Kiểu ảnh dùng được làm favicon — HẰNG SỐ THUẦN.
 *
 * ## Vì sao nó rời khỏi `render/site-icons.ts`
 *
 * File đó khai `import 'server-only'` và đọc prisma, nên một component client
 * import nó là một lỗi build. Nhưng bộ chọn favicon phía client cần đúng danh
 * sách này để lọc lưới ảnh — nếu không, người dùng chọn được một JPEG rồi mới ăn
 * lỗi lúc bấm Lưu, tức là bắt họ đi một vòng để biết một điều lẽ ra thấy ngay.
 *
 * Chép danh sách sang client là cách chắc chắn để hai bên trôi khỏi nhau: thêm
 * `image/webp` ở server mà quên bản chép thì lưới ảnh ẩn mất một kiểu đang hợp
 * lệ, và không có lỗi nào báo. Nên: một nguồn, ở file không có `server-only`.
 *
 * Đây là lần thứ sáu cùng một hình dạng trong dự án này — xem docblock của
 * `builder/slug.ts`. Luật vẫn thế: giá trị thuần ở file thuần.
 */

/** Kiểu ảnh dùng được làm favicon. */
export const FAVICON_MIMES: ReadonlySet<string> = new Set(['image/png', 'image/svg+xml']);

/**
 * Giá trị cho thuộc tính `accept` của `<input type="file">`.
 *
 * Chỉ là GỢI Ý cho hộp thoại chọn file của hệ điều hành, không phải một phép
 * kiểm: người dùng vẫn chọn được "tất cả tệp", và kéo-thả bỏ qua nó hoàn toàn.
 * Luật thật nằm ở `uploadAsset` (dò magic bytes) và ở `updateSiteSettings`.
 */
export const FAVICON_ACCEPT = 'image/png,image/svg+xml';

/** "PNG hoặc SVG" — để câu thông báo và câu lọc không nói hai chuyện khác nhau. */
export const FAVICON_MIME_LABEL = 'PNG hoặc SVG';
