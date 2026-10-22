# Sửa site bằng Claude

Quilder có một máy chủ MCP: Claude Desktop (hoặc Claude Code) đọc cấu trúc trang, tìm phần tử theo
lời mô tả, tra design token và **sửa bản nháp** bằng các thao tác có kiểm — không viết code, không
sinh HTML tự do. Suy luận chạy trong gói Claude của bạn, builder không cần API key.

## Kết nối

1. Đăng nhập builder → **Kết nối Claude** (thanh menu trái; vai trò Biên tập trở lên).
2. Đặt tên thiết bị (ví dụ "Máy ở nhà"), chọn hạn, bấm **Cấp token**.
3. Màn hướng dẫn hiện cấu hình đã điền sẵn URL và token, có đường dẫn file cấu hình cho
   Windows và macOS. Tải `server.mjs`, chép cấu hình vào Claude Desktop, khởi động lại Claude.
4. Thu hồi bất cứ lúc nào ở cùng màn đó. Admin thấy và thu hồi được token của mọi người
   (*Tài khoản → Kết nối Claude*).

Máy chạy Claude chỉ cần Node.js. Chi tiết và danh sách tool: [mcp/README.md](../../mcp/README.md).

## Claude làm được gì — và không làm được gì

- Sửa chữ, style theo từng breakpoint, gắn effect, chèn/xoá/dời phần tử, sửa component, dịch chữ,
  nhập bài viết trong Kho dữ liệu, clone một trang web thành trang nháp mới.
- **Không publish, không lùi bản, không quản trị.** Công cụ đó không tồn tại với Claude, và máy
  chủ chặn cả ở tầng HTTP. Đưa thay đổi ra site thật luôn là việc của người, sau khi xem nháp.
- Không sửa được phần tử bị **khoá** (nội dung pháp lý), không ghi vào trang đồ gá của test.

## Chỉ đúng phần tử cần sửa

Trong editor, chọn một phần tử rồi bấm **Copy link cho AI**: được một dòng dạng

```
[Quilder] Trang chủ › Hero › Nút CTA — https://<builder>/builder/<pageId>?node=<nodeId>
```

Dán vào Claude kèm yêu cầu ("đổi nhãn nút này thành …"). Claude mở đúng phần tử đó trước, không
phải đoán, và nói rõ thay đổi chỉ ở trang này hay ở mọi trang dùng chung component.

## Ví dụ

- *"Mở dàn ý trang chủ, rồi chụp ảnh cho tôi xem trên tablet."*
- *"Trên mobile chữ ở chân trang sát mép quá, tăng khoảng cách hai bên."*
- *"Dịch toàn bộ trang Giới thiệu sang tiếng Anh."*
- *"Tạo 5 bài Tin tức nháp từ danh sách này."*
- *"Clone trang https://… thành một trang nháp mới, ảnh để trong thư mục `clone`."*

## Luật riêng của từng site

Gói dự án có thể thêm luật riêng cho Claude (`guideNotes`) — ví dụ "không hứa lợi nhuận" cho site
tài chính. Xem [projects/example/README.md](../../projects/example/README.md).

---

[← Mục lục](README.md)
