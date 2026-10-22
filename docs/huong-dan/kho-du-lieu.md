# Kho dữ liệu — tin tức, FAQ, sản phẩm…

Nội dung nhiều bài cùng một khuôn (tin tức, câu hỏi thường gặp, sự kiện, sản phẩm…) sống trong
**Kho dữ liệu** (`/builder/content`), không dựng tay từng trang. Một trang mẫu hiển thị danh sách,
một trang mẫu hiển thị chi tiết — mọi bài dùng chung.

## 1. Loại nội dung

**Tạo loại nội dung**: Tên, Tên số nhiều, và "Loại này chỉ có một entry" (cho nội dung đơn lẻ như
"Thông tin công ty"). Khoá của loại không đổi được về sau — nó là một phần của URL API.

Mỗi loại có **Cấu trúc** (danh sách field) và bảng bài. Loại chỉ xoá được khi không còn bài nào.
**Nhóm field dùng lại** là bộ field đóng gói sẵn (ví dụ khối CTA) để thêm vào nhiều loại.

### Kiểu field

| Nhóm | Kiểu |
|---|---|
| Chữ | `text` (một/nhiều dòng), `richtext`, `html`, `slug` (đường dẫn, tự sinh từ tiêu đề) |
| Số, ngày, chọn | `number` (có định dạng Tiền VNĐ), `boolean`, `date`, `enum` |
| Tệp | `image`, `file` |
| Liên kết | `relation` (trỏ tới bài khác), `taxonomy` (danh mục), `link` |
| Tìm kiếm & chia sẻ | `seo` — tiêu đề, mô tả, ảnh chia sẻ… riêng cho từng bài, từng ngôn ngữ |
| Có cấu trúc (lồng tối đa 3) | `group` (nhóm, có thể lặp), `blocks` (khối tự do nhiều loại, đổi thứ tự được) |
| Lối thoát | `json` |

Tuỳ chọn mỗi field: Bắt buộc, Không cho trùng, Nhiều dòng, trần độ dài…

### Danh mục

`/builder/content/<loại>/taxonomies` — cây **Danh mục** của loại đó (lồng được). Gán danh mục cho
bài ở thẻ Danh mục bên phải màn sửa bài.

## 2. Bài viết

Bảng bài: lọc Tất cả / Đã đăng / Nháp / Hẹn giờ / Đã xoá, ô tìm theo tiêu đề và đường dẫn, **Thêm
mục**.

Màn sửa bài:

- **Lưu nháp**; **Đăng**, hoặc **Hẹn đăng** khi đặt "Đăng lúc" ở tương lai — bài tự lên đúng giờ,
  không cần ai bấm. **Gỡ khỏi site** đưa bài về nháp; **Xoá bài** đưa vào mục Đã xoá.
- **Xem** bật khung xem trước ngay bên cạnh.
- Cột phải: Trạng thái, Danh mục, **Liên quan** (bài liên quan cùng loại), **Liên kết** (bài của
  loại khác), SEO, Tác giả, Nhật ký.
  - Ô chọn bài liên quan chỉ gợi ý vài bài sửa gần nhất; **gõ để tìm** bài khác. Bỏ trống thì
    trang tự xếp bài cùng danh mục.
- **Ngôn ngữ**: tab "Bản gốc" và một tab cho mỗi ngôn ngữ đã thêm. Mỗi bản dịch có trạng thái riêng
  (chưa có / nháp / hẹn giờ / đang trên site), đường dẫn riêng và mốc lên sóng riêng.

Khác trang: **bài lên site ngay khi bấm Đăng**, không qua Publish của site. Trang mẫu hiển thị
bài thì vẫn theo Publish như mọi trang.

## 3. Hiển thị bài lên site

### Trang danh sách và trang chi tiết

Tạo một trang, rồi ở menu thẻ trang → **Đổi tên**: chọn **Loại nội dung** và **Vai của trang**:

| Vai | Đường dẫn ví dụ | Hiện gì |
|---|---|---|
| Danh sách | `tin-tuc` | danh sách bài |
| Chi tiết | `tin-tuc/[slug]` | một bài — `[slug]` là đoạn động, thay bằng đường dẫn của bài |
| Danh mục | `tin-tuc/[danh-muc]` | bài của một danh mục |
| Theo quan hệ | | bài gắn với một bài khác |

Trong trang chi tiết, chữ, ảnh, link của phần tử lấy từ field của bài qua **binding** (liên kết dữ
liệu) — cách nhanh nhất là nhờ Claude dựng trang mẫu từ cấu trúc của loại nội dung, rồi chỉnh giao
diện bằng tay. Sitemap tự có mọi bài đã đăng; field `seo` của bài đi thẳng vào thẻ `<title>`, mô tả, ảnh chia sẻ
và JSON-LD.

### Khối lặp

Chọn một phần tử (thẻ bài) → **Lặp theo: Bật**, chọn nguồn:

- Truy vấn một loại nội dung (lọc, sắp xếp, giới hạn)
- Liên quan tới bài đang mở
- Một khối mỗi danh mục / Bài trong danh mục của khối cha
- Quan hệ của bài đang mở / Một field của bài đang mở

Rồi nối field → phần tử con (tiêu đề → chữ, ảnh → ảnh…) và chọn hiện gì **khi không có bài nào**.

## 4. API công khai

Mọi bài đã đăng đọc được qua `/api/public/v1` (chỉ đọc, không cần token) — cho app mobile hay site
khác. Hợp đồng đầy đủ: [docs/API-PUBLIC.md](../API-PUBLIC.md). Sinh sẵn kiểu TypeScript:
`pnpm api:types`.

---

[← Dùng builder](dung-builder.md) · [Mục lục](README.md)
