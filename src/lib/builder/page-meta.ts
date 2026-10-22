/**
 * Metadata TRANG dịch theo ngôn ngữ — `<title>` và `<meta description>`.
 *
 * ## Vấn đề
 *
 * `generateMetadata` của route site lấy `title` và `description` từ cột `Page`,
 * không phụ thuộc ngôn ngữ. Nên `/en/trang-chu` có `<title>` tiếng Việt. Đó tệ
 * hơn hẳn một tấm ảnh sai ngôn ngữ: ảnh thì người đọc bỏ qua, còn `<title>` là
 * thứ Google index và là dòng đầu trong kết quả tìm kiếm.
 *
 * ## Vì sao dùng bảng `Translation` chứ không thêm cột
 *
 * Thêm `titleEn`, `descriptionEn` là fork theo ngôn ngữ ở tầng cột — thêm một
 * ngôn ngữ là một migration, và `Locale` vốn là một BẢNG người dùng thêm dòng
 * được. Bảng `Translation` thì đã khoá theo `(locale, pageId, nodeId, field)` và
 * cho không bốn thứ:
 *
 *  1. Ảnh chụp lúc publish (`Release.translations`) — metadata lùi được cùng
 *     release, y như nội dung.
 *  2. `sourceHash` báo "bản gốc đã đổi sau khi dịch".
 *  3. Bảng Văn bản đọc được nó mà không cần cột mới.
 *  4. Xoá hàng = quay về bản gốc, không cần một giá trị sentinel.
 *
 * ## Vì sao địa chỉ là `$meta`
 *
 * `Translation.nodeId` không có khoá ngoại (node sống trong JSONB), nên nó nhận
 * chuỗi gì cũng được — và đó là chỗ dễ đụng nhau. Ba ràng buộc:
 *
 *  - KHÔNG được là một `nodeId` hợp lệ, nếu không một node thật cùng tên sẽ tranh
 *    chỗ. `zNodeId` là `^[A-Za-z0-9_-]+$`, nên `$` loại `$meta` ra khỏi tập đó.
 *  - KHÔNG được chứa `:`. Khoá ảnh chụp release là `locale:nodeId:field` và
 *    `entriesFromSnapshot` tách đúng hai lần — một dấu hai chấm nữa là nó đọc sai
 *    cả hàng.
 *  - KHÔNG được chứa `/`. Đó là `INSTANCE_SEP`, và `parseInstanceAddress` sẽ hiểu
 *    địa chỉ này là "một node local trong một instance".
 *
 * `$meta` thoả cả ba.
 *
 * ## Hệ quả đúng-theo-thiết-kế
 *
 * `applyTranslations` sẽ tìm node `$meta` trong doc, không thấy, và BỎ QUA im
 * lặng — đúng nhánh "bản dịch mồ côi" đã có. Không cần thêm nhánh nào ở đó, và
 * hàng `$meta` không bao giờ lọt vào cây node.
 *
 * Không `server-only`: hằng và phép đọc ở đây phải dùng được ở cả pane phải.
 */

/** Địa chỉ dành riêng cho metadata trang. Xem docblock. */
export const META_ADDRESS = '$meta';

/** Trường metadata dịch được. KHÔNG phải trường của node. */
export const PAGE_META_FIELDS = ['title', 'description'] as const;

export type PageMetaField = (typeof PAGE_META_FIELDS)[number];

/**
 * Hàng bản dịch → metadata của một ngôn ngữ.
 *
 * Nhận hình dạng chung `{ nodeId, field, value }` để dùng được cho cả hai nguồn:
 * bảng `Translation` (bản nháp) và ảnh chụp trong `Release.translations`.
 *
 * Giá trị không phải chuỗi thì BỎ QUA. Cột `value` là JSON tự do, và một hàng ghi
 * bằng một bản schema cũ hơn không đáng làm `<title>` thành `[object Object]`.
 */
export function pageMetaFrom(
  rows: readonly { nodeId: string; field: string; value: unknown }[],
): { title?: string; description?: string } {
  const out: { title?: string; description?: string } = {};
  for (const r of rows) {
    if (r.nodeId !== META_ADDRESS) continue;
    if (typeof r.value !== 'string' || !r.value.trim()) continue;
    if (r.field === 'title') out.title = r.value.trim();
    else if (r.field === 'description') out.description = r.value.trim();
  }
  return out;
}
