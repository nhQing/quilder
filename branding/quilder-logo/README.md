# Quilder — bộ nhận diện

**"Đang được chọn"** — chữ **Q** nằm trong khung chọn của editor, đúng khoảnh khắc người dùng
bấm vào một phần tử để sửa. Q là một vòng tròn dày, đuôi là nét chéo ngắn cắt qua thân vòng;
khung chọn có ba tay nắm rỗng, tay nắm resize góc dưới-phải đặc và mang màu brand — nối
tiếp hướng đuôi Q, như đang được kéo. Bản một màu thì tay nắm cùng màu với phần còn lại.
Đuôi KHÔNG nối tới tay nắm: nối vào thì vòng + cán thành icon kính lúp (tìm kiếm).

Các phương án đã cân nhắc trước khi chọn bản này: `concepts/concepts.png`.

## File

| File | Dùng khi |
|---|---|
| `quilder-symbol.svg` | Biểu tượng màu — mặc định, nền sáng |
| `quilder-symbol-white.svg` | Biểu tượng một màu trắng — trên nền màu thương hiệu, ảnh, nền tối |
| `quilder-symbol-ink.svg` | Biểu tượng một màu tối — in đen trắng, nền sáng |
| `quilder-wordmark.svg` | Biểu tượng + chữ, nền sáng |
| `quilder-wordmark-on-dark.svg` | Biểu tượng + chữ sáng, tay nắm xanh sáng, nền tối |
| `quilder-wordmark-white.svg` | Toàn trắng, nền màu thương hiệu |
| `png/quilder-symbol-{32…1024}.png` | Favicon, avatar, ảnh mạng xã hội |
| `png/quilder-app-icon-512.png`, `png/apple-touch-icon-180.png` | Icon ứng dụng: logo trắng trên ô brand (apple-touch vuông tràn, iOS tự bo) |
| `png/quilder-wordmark-*-1284.png` | Ảnh ngang cho slide, tài liệu |

Chữ "Quilder" trong file wordmark SVG là `<text>` dùng font **Be Vietnam Pro** (rơi về
Inter / Segoe UI). Cần file không phụ thuộc font (in ấn, gửi đối tác) thì dùng bản PNG.

## Màu

Lấy thẳng từ token của vỏ builder (`src/styles/builder.css`) — đổi token thì đổi ở script.

| Vai | Mã | Token |
|---|---|---|
| Vòng, đuôi, khung, chữ trên nền sáng | `#0F1A2E` | `shell-ink` |
| Tay nắm đặc trên nền sáng | `#2A62D9` | `brand` |
| Vòng, đuôi, khung, chữ trên nền tối | `#E7ECF3` | `shell-ink` (tối) |
| Tay nắm đặc trên nền tối | `#6C9BFF` | `shell-accent` (tối) |

## Khoảng trống và cỡ tối thiểu

- Chừa quanh logo tối thiểu bằng 1/4 chiều cao biểu tượng.
- Biểu tượng nhỏ nhất 16px (favicon); wordmark nhỏ nhất cao 20px.
- Không xoay, không nối đuôi Q vào tay nắm, không tô màu brand cho vòng hay khung.
- Ở 16px các nét khung rất mảnh; vẫn đọc được nhờ vòng + đuôi + tay nắm đặc.
- Trong app, logo trắng chỉ đặt trên `shell-accent`/`brand` hoặc `shell-hero` (Design.md §7).

Sinh lại toàn bộ (SVG + PNG; PNG vẽ bằng Chromium của Playwright):
`node branding/quilder-logo/gen-logo.mjs branding/quilder-logo --png`, rồi chép các SVG sang
`public/brand/`. File được vẽ bằng script, không vẽ tay — sửa ở script rồi xuất lại, đừng
sửa SVG trực tiếp.
