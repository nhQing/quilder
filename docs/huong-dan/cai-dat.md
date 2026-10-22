# Cài đặt Quilder

Ba cách chạy, từ nhanh nhất tới production:

1. [Máy dev](#1-máy-dev) — sửa code, thử nhanh.
2. [Chạy thử bằng Docker trên máy mình](#2-chạy-thử-bằng-docker) — giống production, cổng 3002.
3. [Production](#3-production) — image dựng sẵn + `docker-compose.prod.yaml` trên server.

Cần: Node.js 22+, pnpm, Docker (Postgres 17 và MinIO chạy trong container).

---

## 1. Máy dev

```bash
git clone https://github.com/nhQing/quilder.git && cd quilder
pnpm install
cp .env.example .env
```

Điền `.env` — file có chú thích từng dòng, chia bốn nhóm. Tối thiểu cho máy dev:

| Biến | Giá trị ở máy dev |
|---|---|
| `DATABASE_URL` | để nguyên mẫu (`localhost:5433/quilder`) |
| `AUTH_SECRET` | một chuỗi ngẫu nhiên ≥ 32 ký tự (`openssl rand -base64 48`) |
| `S3_*` | để nguyên mẫu MinIO (`localhost:9000`) |
| `COOKIE_SECURE` | `false` nếu mở builder bằng `http://` không phải `localhost` |

```bash
pnpm db:up          # Postgres :5433 + MinIO :9000/:9001 (Docker)
pnpm db:migrate     # tạo bảng
pnpm tokens:import  # nạp design token từ src/styles/tokens.css
pnpm effects:sync   # nạp danh mục effect
pnpm dev            # http://localhost:3000
```

Mở `/builder`. Database chưa có tài khoản thì builder dẫn sang **màn cài đặt** `/builder/setup`:
tên site, URL site, email và mật khẩu quản trị. Ở máy dev không cần mã cài đặt. Bấm Cài đặt là có
site, trang chủ, trang 404 và tài khoản admin; màn cài đặt tự đóng vĩnh viễn.

### Dữ liệu mẫu (tuỳ chọn)

Muốn có sẵn một site đầy đủ để thử — trang chủ dài với component, khối mẫu, hai ngôn ngữ vi/en,
loại nội dung Tin tức và Câu hỏi thường gặp:

```bash
pnpm db:seed                                    # XOÁ site hiện có rồi dựng site mẫu
pnpm exec tsx scripts/seed-second-page.ts       # trang /gioi-thieu
pnpm exec tsx scripts/seed-demo-content.ts      # component + khối mẫu trên trang chủ
pnpm seed:collections                           # loại nội dung mẫu
pnpm user:create admin@example.com mat-khau-du-dai admin
```

Rồi đăng nhập và bấm **Publish** để site công khai có nội dung.

> `pnpm db:seed` xoá site đang có. Chỉ chạy trên máy dev.

---

## 2. Chạy thử bằng Docker

Build image ngay trên máy và chạy như production, dùng chung Postgres/MinIO với máy dev:

```bash
pnpm docker:up      # build + migrate + chạy, http://localhost:3002
pnpm docker:logs
pnpm docker:down
```

---

## 3. Production

### 3.1 Dựng và đẩy image

Trên máy build (cần `.env` có các biến nhóm 1):

```env
ASSET_HOSTS=cdn.ten-mien.vn            # host ảnh — BẮT BUỘC, đóng vào bản build
RELEASE_REGISTRY=registry.ten-mien.vn/quilder
# RELEASE_IMAGE=quilder                # đổi tên image nếu cần
# QUILDER_PROJECT=<gói>                # nếu site có gói dự án (projects/<gói>)
```

```bash
pnpm release v1.0.0     # build + push hai image: quilder và quilder-bootstrap
pnpm release            # đẩy lại đúng tag đã nhớ
pnpm release --show     # xem đang nhớ tag nào
```

Lệnh dừng nếu tag đã có trên registry (một tag luôn là MỘT image) hoặc CI của commit chưa xanh
(`--skip-ci` chỉ cho bản thử), và cảnh báo nếu cây làm việc còn thay đổi chưa commit — image đó sẽ
không dựng lại được từ lịch sử git.

### 3.2 Chạy trên server

Chép `docker-compose.prod.yaml` và `.env.production.example` (đổi tên thành `.env`) lên server,
điền:

| Biến | Ghi chú |
|---|---|
| `REGISTRY`, `TAG` | đúng registry và tag vừa đẩy |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | Postgres trong compose (hoặc `DATABASE_URL` trỏ DB ngoài) |
| `AUTH_SECRET` | chuỗi ngẫu nhiên ≥ 32 ký tự, **giữ cố định** — đổi là mọi phiên đăng nhập và token Claude mất hiệu lực |
| `S3_*` | bucket S3 thật; `S3_PUBLIC_BASE_URL` là URL công khai của bucket/CDN |
| `SITE_URL` | (tuỳ chọn) khoá URL site; để trống thì đặt trong màn Cài đặt |

```bash
docker compose -f docker-compose.prod.yaml up -d
docker compose -f docker-compose.prod.yaml logs bootstrap    # lấy MÃ CÀI ĐẶT
```

Container `bootstrap` chạy một lần trước app: áp migration, nạp token, bổ sung trang hệ thống,
đồng bộ effect, rồi in **mã cài đặt** nếu chưa có tài khoản nào. Mở `https://<tên miền>/builder`,
điền mã đó ở màn cài đặt.

App lắng nghe `127.0.0.1:3000` — đặt reverse proxy (nginx, Caddy…) phía trước để có HTTPS.

### 3.3 Nâng cấp

```bash
# máy build
pnpm release v1.1.0
# server: đổi TAG trong .env
docker compose -f docker-compose.prod.yaml up -d
```

`bootstrap` tự áp migration mới trước khi app mới lên. Site đang chạy KHÔNG đổi giao diện sau
nâng cấp: mỗi release niêm phong CSS của chính nó. Bấm Publish một lần để site dùng CSS của bản mới.

---

Tiếp theo: [Dùng builder](dung-builder.md) · [Vận hành](van-hanh.md)
