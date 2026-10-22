# Hướng dẫn sử dụng Quilder

Quilder là trình dựng website bằng cách ghép khối: trang là một cây phần tử trong Postgres, sửa
trực tiếp trên bản xem trước hoặc bằng lời qua Claude, có bản nháp, xem trước và Publish là một ảnh
chụp của cả site — lùi về bản cũ trong chưa tới một giây.

| Bài | Cho ai | Nội dung |
|---|---|---|
| [Cài đặt](cai-dat.md) | dev, người vận hành | máy dev, chạy thử Docker, triển khai production, nâng cấp |
| [Dùng builder](dung-builder.md) | người biên tập | trang, editor, breakpoint, component, văn bản và bản dịch, thư viện ảnh, lịch sử publish, cài đặt |
| [Kho dữ liệu](kho-du-lieu.md) | người biên tập | loại nội dung, field, danh mục, bài viết, trang danh sách/chi tiết, khối lặp |
| [Sửa site bằng Claude](ket-noi-claude.md) | mọi người | kết nối Claude Desktop, giới hạn của Claude, link phần tử cho AI |
| [Vận hành](van-hanh.md) | admin | Publish và lùi bản, vai trò, ngôn ngữ, biến môi trường, lệnh, sao lưu |
| [Gói dự án](../../projects/example/README.md) | dev | thêm khối, effect, font, ảnh riêng cho một website mà không sửa lõi |
| [API công khai](../API-PUBLIC.md) | dev app/mobile | đọc nội dung đã đăng qua `/api/public/v1` |
| [Tài liệu sinh tự động](../generated/README.md) | dev, AI | kiểu phần tử, thao tác, tool AI, effect |

## Bắt đầu nhanh

```bash
git clone https://github.com/nhQing/quilder.git && cd quilder
pnpm install && cp .env.example .env     # điền AUTH_SECRET
pnpm db:up && pnpm db:migrate && pnpm tokens:import && pnpm effects:sync
pnpm dev                                  # mở http://localhost:3000/builder
```

Màn cài đặt lần đầu hỏi tên site, URL và tài khoản quản trị — xong là có trang chủ, trang 404 và
một release đang chạy.
