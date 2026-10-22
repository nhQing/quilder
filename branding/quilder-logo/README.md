# Quilder — bộ nhận diện

Chữ **Q** ghép từ bốn mảnh puzzle (builder = ghép các khối thành trang), đuôi Q là một
ngôi sao lấp lánh — Claude/AI cùng dựng trang. Mảnh ráp nhau bằng núm tròn, đường ráp là
khe hở thật (mask), nên logo đặt trên nền nào cũng đúng.

## File

| File | Dùng khi |
|---|---|
| `quilder-symbol.svg` | Biểu tượng màu — mặc định, nền sáng hoặc tối |
| `quilder-symbol-white.svg` | Biểu tượng một màu trắng — trên nền màu thương hiệu, ảnh |
| `quilder-symbol-ink.svg` | Biểu tượng một màu tối — in đen trắng, nền sáng |
| `quilder-wordmark.svg` | Biểu tượng + chữ, nền sáng |
| `quilder-wordmark-on-dark.svg` | Biểu tượng màu + chữ sáng, nền tối |
| `quilder-wordmark-white.svg` | Toàn trắng, nền màu thương hiệu |
| `png/quilder-symbol-{32…1024}.png` | Favicon, avatar, ảnh mạng xã hội |
| `png/quilder-app-icon-512.png`, `png/apple-touch-icon-180.png` | Icon ứng dụng (nền trắng) |
| `png/quilder-wordmark-*-1284.png` | Ảnh ngang cho slide, tài liệu |

Chữ "Quilder" trong file wordmark SVG là `<text>` dùng font **Be Vietnam Pro** (rơi về
Inter / Segoe UI). Cần file không phụ thuộc font (in ấn, gửi đối tác) thì dùng bản PNG.

## Màu

| Vai | Mã |
|---|---|
| Mảnh 1 — indigo | `#4F46E5` |
| Mảnh 2 — sky | `#0EA5E9` |
| Mảnh 3 — teal | `#14B8A6` |
| Mảnh 4 — violet | `#8B5CF6` |
| Sao AI (gradient) | `#FBBF24` → `#F97316` |
| Chữ trên nền sáng | `#111827` |

## Khoảng trống và cỡ tối thiểu

- Chừa quanh logo tối thiểu bằng 1/4 chiều cao biểu tượng.
- Biểu tượng nhỏ nhất 16px (favicon); wordmark nhỏ nhất cao 20px.
- Không xoay, không đổi màu từng mảnh, không bỏ ngôi sao.

Sinh lại toàn bộ: `node branding/quilder-logo/gen-logo.mjs branding/quilder-logo` — các file được vẽ bằng script (toạ độ đường ráp tính bằng lượng giác),
không vẽ tay — sửa ở script rồi xuất lại, đừng sửa SVG trực tiếp.
