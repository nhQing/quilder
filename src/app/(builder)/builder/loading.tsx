import { RouteSkeleton } from '@/components/builder/RouteSkeleton';

/**
 * Ranh giới đang tải ở cấp `/builder` — phủ màn "Trang" và mọi màn con trực tiếp (Văn bản, Thư
 * viện, Cài đặt, editor `/builder/<id>`…).
 *
 * ## Mọi `loading.tsx` của builder vẽ CÙNG một khung
 *
 * `RouteSkeleton` chọn hình theo URL đích, vì ranh giới bắt được lượt chờ thường là của đoạn
 * CHA chứ không phải của màn đích (đo được, xem `lib/builder/route-shape.ts`). Nên các file này
 * không quyết định HÌNH — chúng quyết định CHỖ có ranh giới.
 *
 * ## Vì sao có file ở những đoạn này, và chỉ ở đó
 *
 * `loading.tsx` của một đoạn bọc các đoạn CON của nó trong `<Suspense>`, khoá theo đoạn con.
 * Đổi sang đoạn con khác là một ranh giới MỚI, nên khung hiện ngay. Đổi trong cùng đoạn con thì
 * ranh giới đã hiện rồi, và trong một transition React giữ nguyên màn cũ thay vì hiện lại khung.
 * Vì thế mỗi đoạn CÓ ROUTE CON cần một file (`content`, `content/[typeKey]`, `components/[id]`,
 * `admin`…): không có nó thì Danh sách mục → Form mục không hiện gì. Màn lá (`text`, `assets`,
 * `[pageId]`…) không cần: ranh giới của đoạn cha đã phủ nó, và thêm một ranh giới thứ hai chỉ
 * làm khung bị thay bằng một bản y hệt giữa chừng (dải sáng chạy lại từ đầu).
 *
 * Đổi `?search` (`/builder/text?page=…`) không hiện khung — khoá của trang bỏ search params. Lượt
 * đó do thanh tiến độ của `NavProgress` báo.
 *
 * ## Cái giá phải biết
 *
 * Trang nằm trong Suspense thì được STREAM: phần vỏ (layout, thanh menu, khung) đi trước, nên mã
 * HTTP đã gửi là 200 trước khi trang kịp chạy. `notFound()` ở `/builder/<id-sai>` vẫn hiện màn
 * 404 và Next chèn `noindex`, nhưng mã trả về là 200; `redirect()` (màn admin với người không
 * phải admin) chạy ở client ngay sau khi hydrate thay vì 307. Builder không được index và mọi
 * lượt mở là người thật, nên đổi đó lấy phản hồi tức thì là đáng.
 */
export default function Loading() {
  return <RouteSkeleton />;
}
