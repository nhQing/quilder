# Vận hành

## Bản nháp, Publish và lùi bản

- Mọi chỉnh sửa trong builder (và của Claude) là **bản nháp**. Site công khai chỉ đổi khi bấm
  **Publish**.
- Mỗi lần Publish tạo một **release**: ảnh chụp trọn vẹn nội dung trang, component, bản dịch,
  token tự tạo, biến site (`globals`) và CSS. Release cũ không bao giờ bị sửa.
- **Lùi bản** ở *Lịch sử publish*: "Lùi một bước", hoặc "Đưa site về bản này" ở một release
  cũ — site quay về đúng trạng thái đó ngay (chỉ đổi con trỏ), không build, không deploy lại.
  Khôi phục trọn vẹn được bảo đảm cho 30 release gần nhất và mọi release trong 90 ngày.
- Có hiệu lực **ngay**, không chờ Publish: favicon, ảnh chia sẻ mặc định, logo builder, URL site,
  SEO mặc định, robots.txt, sitemap, giao diện sáng/tối, bật/tắt ngôn ngữ. Màn Cài đặt ghi rõ khối
  nào thuộc loại nào.

## Tài khoản và quyền

Ba vai trò, quản ở *Tài khoản* (chỉ admin):

| Vai trò | Làm được |
|---|---|
| Xem (`viewer`) | chỉ xem bản nháp; không có đường vào Kết nối Claude |
| Sửa (`editor`) | sửa và publish trang, nội dung, component, ảnh; tự kết nối Claude cho mình |
| Quản trị (`admin`) | sửa, publish, quản lý tài khoản (thêm, đổi vai trò, đổi mật khẩu, khoá), Cài đặt site, nhập trang, xoá hẳn ảnh; xem và thu hồi token Claude của mọi người |

Không có đăng nhập Google — chỉ email và mật khẩu.

## Ngôn ngữ

*Cài đặt → Ngôn ngữ*: thêm ngôn ngữ (gõ mã như `ja`, `ko`, tên tự điền), bật/tắt, xoá. Ngôn ngữ
mặc định không có tiền tố URL và không đổi được. Ngôn ngữ mới thêm vào ở trạng thái **tắt**: dịch
xong ở *Văn bản* rồi bật — bật thì `/<mã>/…` có ngay, chữ dịch lên site sau lần Publish kế tiếp.

## Biến môi trường thường gặp

| Biến | Ý nghĩa |
|---|---|
| `SITE_URL` | khoá URL site (canonical, sitemap). Trống = đặt trong Cài đặt |
| `COOKIE_SECURE=false` | bắt buộc nếu mở builder bằng `http://` (không phải localhost), nếu không đăng nhập xong sẽ quay lại form trống |
| `SITE_NOINDEX=true` | bản staging: robots.txt chặn tất, sitemap rỗng, mọi trang noindex — thắng mọi cấu hình robots trong Cài đặt |
| `PUBLIC_URL` | gốc URL của builder mà hướng dẫn "Kết nối Claude" in ra, khi builder nằm sau proxy |
| `PUBLIC_API_ORIGINS` | các origin được gọi API công khai từ trình duyệt (CORS) |

Xem đủ trong `.env.example`.

## Lệnh hữu ích

| Lệnh | Làm gì |
|---|---|
| `pnpm user:create <email> <mật-khẩu> [role]` | tạo tài khoản từ dòng lệnh |
| `pnpm tokens:import` | đồng bộ bảng Token từ `src/styles/tokens.css` (bootstrap tự chạy) |
| `pnpm effects:sync` | đồng bộ danh mục effect (bootstrap tự chạy) |
| `pnpm check:tokens` | tìm `{$token}` sai tên trong trang và component |
| `pnpm assets:sweep [--dry-run]` | xoá file S3 của ảnh đã xoá hẳn mà không còn release nào trong cửa sổ lùi bản (90 ngày) giữ — builder tự chạy sau mỗi lần publish; lệnh này cho site lâu không publish hoặc cron |
| `pnpm mcp:token <email>` | cấp token service cho Claude/script (token service không publish, không lùi bản, không quản trị được) |

## Kiểm tra trước khi phát hành

```bash
pnpm verify      # prisma generate + typecheck + unit test + check:tokens
pnpm lint
pnpm e2e         # stack e2e dùng một lần (Postgres + MinIO riêng), seed bằng script
```

## Sao lưu

Dữ liệu nằm ở hai chỗ: **Postgres** (trang, nội dung, release, tài khoản) và **bucket S3** (ảnh,
file). Sao lưu cả hai; release tham chiếu ảnh theo khoá bất biến nên khôi phục DB cũ vẫn đúng
ảnh, miễn bucket còn file.

```bash
docker exec quilder-db pg_dump -U quilder quilder > quilder-$(date +%F).sql
```

---

[← Mục lục](README.md)
