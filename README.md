# Quilder

Trình dựng website bằng cách ghép khối. Trang là một **cây node có kiểu trong Postgres**,
sửa trực tiếp trên bản xem trước bằng inspector, hoặc bằng lời qua Claude (MCP). Có bản nháp,
xem trước và **Publish là một ảnh chụp** của cả site — lùi về bản cũ không cần build lại.

- Next.js 15 (App Router), Prisma 6 + Postgres, S3 (hoặc MinIO khi dev).
- Đa ngôn ngữ, collection (tin tức, FAQ…), component dùng lại, effect chuyển động.
- Phần riêng của từng website (khối tự dựng, effect, font, ảnh) nằm trong **gói dự án** —
  xem [projects/example/README.md](projects/example/README.md).

## Chạy ở máy dev

```bash
pnpm install
cp .env.example .env          # điền nhóm 1–2, xem chú thích trong file
pnpm db:up                    # Postgres :5433 + MinIO :9000 (Docker)
pnpm db:migrate
pnpm tokens:import && pnpm effects:sync
pnpm dev                      # http://localhost:3000/builder
```

Mở `/builder`. Database trống thì builder dẫn sang **màn cài đặt** (`/builder/setup`): tên
site, URL, tài khoản quản trị. Ở dev không cần mã cài đặt; trên production mã in ra log của
container bootstrap (`docker compose -f docker-compose.prod.yaml logs bootstrap`).

Muốn có sẵn dữ liệu mẫu (trang chủ giới thiệu Quilder, hai ngôn ngữ): `pnpm db:seed`, rồi tạo
tài khoản bằng `pnpm user:create <email> <mật-khẩu> admin`.

## Biến môi trường

`.env.example` chia bốn nhóm:

| Nhóm | Ví dụ | Ghi chú |
|---|---|---|
| 1. Bắt buộc lúc build | `ASSET_HOSTS`, `QUILDER_PROJECT` | Đóng vào bản build; đổi là build lại |
| 2. Bắt buộc lúc chạy | `DATABASE_URL`, `AUTH_SECRET`, `S3_*` | Thiếu là server không lên |
| 3. Tuỳ chọn | `SITE_URL`, `COOKIE_SECURE` | Có mặc định hợp lý |
| 4. Chỉ cho dev/script | `BUILDER_EMAIL`, `COMPOSE_PROJECT_NAME` | Server không đọc |

Tên site, logo, favicon, giao diện sáng/tối, SEO, robots.txt, sitemap, ngôn ngữ và tài khoản
đều đặt trong builder, không ở `.env`.

## Gói dự án

Một website có khối riêng (bộ tính lãi, biểu đồ…), effect riêng, font và ảnh riêng thì đặt
chúng trong `projects/<tên>/` — một repo git riêng — và build với `QUILDER_PROJECT=<tên>`.
Lõi Quilder không biết gì về gói ngoài hợp đồng `QuilderProject`
(`src/lib/project/types.ts`). Repo này chỉ commit gói mẫu `projects/example`.

## Docker và phát hành

```bash
pnpm docker:up                # build image và chạy như production, cổng 3002
pnpm release v1.0.0           # build + push hai image: <RELEASE_IMAGE> và <RELEASE_IMAGE>-bootstrap
```

`pnpm release` cần `RELEASE_REGISTRY` (và tuỳ chọn `RELEASE_IMAGE`, mặc định `quilder`), đọc
từ biến môi trường hoặc `.env`. Image `bootstrap` chạy migration, nạp token, sync effect — một
lần trước khi app lên. Mẫu compose cho server: `docker-compose.prod.yaml`.

## Claude (MCP)

Vào `/builder/claude` để cấp token và tải cấu hình cho Claude Desktop — xem
[mcp/README.md](mcp/README.md). Claude chỉ sửa **bản nháp**; Publish luôn là việc của người.

## Kiểm tra

```bash
pnpm verify                   # prisma generate + typecheck + unit test + check:tokens
pnpm lint
pnpm e2e                      # stack e2e dùng một lần: Postgres + MinIO riêng, seed bằng script
E2E_PROJECT=<gói> pnpm e2e    # kèm gói dự án và spec e2e của gói
```

## Tài liệu

- **[Hướng dẫn sử dụng](docs/huong-dan/README.md)** — cài đặt, dùng builder, kho dữ liệu, Claude, vận hành.
- `docs/generated/` — node type, op, tool AI, effect (sinh bằng `pnpm docs:gen`).
- `docs/API-PUBLIC.md` — API công khai cho collection.
- `docs/superpowers/` — spec và plan của các thay đổi lớn.
