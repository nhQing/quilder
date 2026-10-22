# Cài đặt site kiểu WordPress — từ DB trống tới site chạy được, cấu hình trong builder — thiết kế

Ngày 20/10/2026 · nhánh đề xuất `feat/cai-dat-site` (tách từ `ui/v2`) · trạng thái: **chờ duyệt**

## 1. Mục tiêu

Một website chưa có gì. Người dùng dựng nó lên và quản lý hoàn toàn bằng builder, giống
WordPress:

1. **Cài đặt:** kiểm database, đặt tên site + domain, tạo tài khoản admin.
2. **Đăng nhập.**
3. **Tạo trang và bài viết.** Mặc định có sẵn trang chủ và trang 404.
4. **Cài favicon, SEO** (gồm SEO mặc định cho cả site).
5. **robots.txt, sitemap.xml:** tự sinh, sửa được ngay trong builder khi cần.

Hôm nay bước 2 đã có, bước 3–4 gần như đã có. Cái thiếu là một **luồng cài đặt liền mạch**,
và nhiều thứ đang nằm ở env hay script thay vì trong builder.

Thành công nghĩa là:

- **Dev:**
  1. `pnpm db:up`, `pnpm db:migrate`, `pnpm dev -p 3001`.
  2. Mở `/builder`, được đưa tới màn cài đặt.
  3. Điền tên site, domain, email + mật khẩu, bấm một nút.
  4. Vào builder, có sẵn trang chủ và trang 404. Không chạy `db:seed`, `tokens:import`,
     `effects:sync` bằng tay. Không đi lấy mã cài đặt trong log.
- **Prod:** y như hôm nay (bootstrap chạy migrate + khởi tạo), cộng thêm hai bước site +
  domain trong cùng màn cài đặt. Mã cài đặt vẫn bắt buộc.
- **Domain đổi được trong Cài đặt** mà không phải sửa env và restart container.
- **robots.txt sửa được trong builder**, có nút về mặc định. Staging (`SITE_NOINDEX=true`)
  vẫn chặn tất, bất kể nội dung tự soạn.

## 2. Các quyết định (đã chọn, kèm lý do)

| # | Câu hỏi | Chọn | Vì sao |
|---|---|---|---|
| D1 | Wizard có nhập `DATABASE_URL` không? | **Không. Chỉ kiểm và hướng dẫn.** | App cần DB mới chạy được wizard. WordPress phải ghi `wp-config.php` rồi mới chạy tiếp. Ở đây prod chạy Docker, env không ghi được từ app. Một wizard ghi `.env` chỉ chạy ở dev, mà ở dev `.env.example` đã đúng sẵn. |
| D2 | Domain lưu ở đâu? | **DB (`Site.siteUrl`) là nguồn chính. Env `SITE_URL` nếu đặt thì GHI ĐÈ.** | stg/prod đang đặt `SITE_URL`. Bỏ nó là đổi hành vi của deploy đang chạy. Ghi đè giữ nguyên chúng, còn site mới không cần env. Màn Cài đặt nói rõ khi env đang ghi đè. |
| D3 | Mã cài đặt ở dev | **Bỏ khi `NODE_ENV !== 'production'`.** | `next dev` không bao giờ là bản public. Image prod luôn build với `NODE_ENV=production` nên không lỡ tay tắt được. |
| D4 | Dữ liệu khởi tạo | **Hàm `ensureSiteDefaults()` idempotent, chỉ tạo phần còn thiếu.** | `prisma/seed.ts` hôm nay `site.deleteMany()` trước khi tạo. Gọi nó từ một nút bấm là mời xoá sạch site. |
| D5 | Trang 404 | **Trang hệ thống trong DB** (`Page.system = 'not-found'`), sửa được bằng builder, đi qua nháp → Publish như mọi trang. Không xoá, không đổi slug. Bảng "địa chỉ đã đổi" vẫn hiện bên dưới. | Đúng lời hứa trong `not-found.tsx` ("trở thành một Page bình thường"). |
| D6 | Trang 500 | **Vẫn trong code, nhưng thêm `error.tsx` + `global-error.tsx` dùng token màu/chữ của site.** Không sửa được trong builder. | Trang 500 hiện đúng lúc DB hoặc render hỏng, tức là lúc dữ liệu trong DB không tin được. `error.tsx` bắt buộc là client component, không đọc được DB. WordPress cũng không cho sửa trang lỗi 500. |
| D7 | robots.txt | **`Site.robotsTxt` (null = tự sinh).** Có ô soạn, nút "Về mặc định", cảnh báo khi chặn cả site hoặc thiếu dòng `Sitemap:`. | Nhu cầu thật là thêm vài dòng (chặn bot AI, chặn một thư mục). Thay toàn bộ bằng text là cách đơn giản nhất mà vẫn đủ. |
| D8 | sitemap.xml | **Vẫn tự sinh, cộng `Site.sitemapRules` = `{ include: string[], exclude: string[] }`.** Không cho sửa tay toàn bộ XML. | Sửa tay XML thì sitemap không còn cập nhật theo bài mới, đúng lúc bài mới cần được crawl nhất. Loại trừ theo trang đã có `noindex`; cái thiếu là loại theo tiền tố đường dẫn và thêm URL ngoài builder. |
| D9 | robots/sitemap/domain có niêm phong vào Release không? | **Không. Sống ở bảng live.** | Cùng lý lẽ với favicon và `Redirect`: đây là cấu hình, không phải nội dung trang. |
| D10 | SEO mặc định cho cả site | **`Site.seoTitleTemplate` (vd. `%s · Tên site`) và `Site.seoDescription`, cả hai null = hành vi hôm nay.** | Comment ở `(site)/layout.tsx` đã cảnh báo: bật template là đổi SEO toàn site. Vì vậy mặc định tắt, người dùng tự bật. |

## 3. Ngoài phạm vi

- **Wizard ghi `.env` hay nhập `DATABASE_URL`** (D1).
- **Chạy migration từ trình duyệt.** Màn cài đặt chỉ hiện lệnh cần chạy.
- **Kho asset trên đĩa local khi dev không có S3.** `pnpm db:up` đã dựng sẵn MinIO.
- **Trang 500 sửa được trong builder** (D6).
- **Nhiều site trên một builder.** Vẫn một hàng `Site`.
- **Đăng nhập Google — KHÔNG làm** (user chốt 21/10/2026). Đăng nhập chỉ bằng email + mật khẩu.
- **Sitemap chia nhiều file (sitemap index).**

## 4. Hiện trạng — những chỗ thiết kế phải bám vào

| Chỗ | Hiện tại | Hệ quả |
|---|---|---|
| `src/app/(builder)/builder/setup/` + `api/auth/setup/route.ts` | Chỉ tạo admin, ba lớp chặn (User rỗng, mã, mật khẩu ≥ 12 ký tự) | Mở rộng thành nhiều bước. Giữ nguyên lớp 1 và 3; lớp 2 theo D3 |
| `src/middleware.ts:79-80` | Cho `/builder/setup` và `/api/auth/setup` qua mà không cần phiên | Thêm `/api/setup/status` |
| `prisma/seed.ts` | `site.deleteMany()` rồi tạo Site + trang chủ + Release | Tách phần tạo ra `ensureSiteDefaults()`. `db:seed` vẫn dùng để reset dev |
| `scripts/import-tokens.ts`, `scripts/sync-effects.ts` | Logic nằm trong `main()` của script | Tách ra `src/lib/setup/` để wizard và script cùng gọi |
| `process.env.SITE_URL ?? 'http://localhost:3001'` | Lặp ở `robots.ts`, `sitemap.ts`, `(site)/layout.tsx`, `[pageId]/page.tsx`, `settings/page.tsx`, `transfer/export.ts`; `metadata-routes.test.ts` khẳng định cả hai file đọc giống nhau | Thay bằng một hàm `siteOrigin()` duy nhất |
| `Site.primaryDomain` | Chỉ để hiển thị, `@unique`, không có scheme | Giữ lại; khi lưu `siteUrl` thì đồng bộ host vào đây |
| `src/app/robots.ts` | `MetadataRoute.Robots`, không biểu diễn được text tự do | Đổi thành route handler `src/app/robots.txt/route.ts` |
| `src/app/(site)/not-found.tsx` | 404 viết cứng + bảng redirect gần đây | Render trang hệ thống nếu đã publish; nếu chưa thì về bản code |
| Không có `error.tsx` / `global-error.tsx` | Lỗi render ra trang lỗi mặc định của Next | Thêm (D6) |
| `PublishedPage` (`src/lib/render/page.ts:21`) | Không có `system` | Thêm để catch-all chặn truy cập thẳng `/404` |
| `src/lib/builder/delete-page.ts` | Xoá mọi trang | Từ chối trang có `system` |

## 5. Thiết kế

### 5.1 Dữ liệu (một migration)

```prisma
model Site {
  // ...
  /// Gốc URL công khai, có scheme, không có `/` cuối. null = chưa đặt.
  /// Env SITE_URL nếu có thì ghi đè (D2).
  siteUrl          String?
  seoTitleTemplate String?   // phải chứa đúng một `%s`
  seoDescription   String?
  robotsTxt        String?   // null = tự sinh (D7)
  sitemapRules     Json      @default("{}") // { include?: string[], exclude?: string[] }
}

model Page {
  // ...
  /// 'not-found' | null. Trang hệ thống: không xoá, không đổi slug, không mở thẳng bằng URL.
  system String?
  @@unique([siteId, system])
}
```

Postgres coi các giá trị `NULL` là khác nhau, nên `@@unique([siteId, system])` chỉ chặn trùng
khi `system` có giá trị. Migration điền `siteUrl` cho site đang có từ `primaryDomain`: dùng
`http://` nếu host là `localhost` hoặc `127.*`, còn lại dùng `https://`. Đây là lần duy nhất
scheme được đoán; sau đó người dùng sửa được.

### 5.2 `siteOrigin()` — một gốc duy nhất

`src/lib/site/origin.ts`:

```ts
export async function siteOrigin(): Promise<string>        // env > DB > 'http://localhost:3001'
export async function siteOriginSource(): Promise<'env' | 'db' | 'fallback'>
```

Đọc DB qua `unstable_cache` với tag `site-settings`; PATCH `/api/settings` gọi
`revalidateTag` cho tag này. Mọi chỗ ở §4 chuyển sang dùng hàm này. Component client
(`PageSeoPanel`, `PageShare`) nhận giá trị qua props như hôm nay, chỉ đổi nguồn ở server.

### 5.3 Màn cài đặt `/builder/setup`

Một trang, ba bước, chỉ **một lần gửi** ở cuối:

1. **Kiểm tra hệ thống.** Màn gọi `GET /api/setup/status` (công khai, chỉ trả trạng thái,
   không lộ chi tiết kết nối):
   ```json
   { "db": "ok" | "unreachable" | "needs-migration",
     "installed": false,
     "tokenRequired": true,
     "env": { "authSecret": true, "s3": false, "siteUrlEnv": null } }
   ```
   - `unreachable` hoặc `needs-migration`: hiện lệnh cần chạy, kèm nút copy (`pnpm db:up`,
     `pnpm db:migrate`; ở prod là `docker logs quilder-bootstrap`). Không cho sang bước 2.
   - `installed: true` (đã có User): chuyển thẳng sang `/builder/login`.
   - `s3: false` chỉ là cảnh báo vàng ("tải ảnh sẽ lỗi cho tới khi đặt S3_*"), không chặn.
2. **Site:** tên site; URL site, mặc định là `location.origin`. Nếu env `SITE_URL` đã đặt thì
   ô này khoá và hiện giá trị env (D2).
3. **Tài khoản admin:** email, mật khẩu (≥ 12 ký tự); mã cài đặt chỉ hiện khi `tokenRequired`.

#### Bố cục (user chốt 20/10/2026)

```
 ┌──┐ ┌─────────────────────────────────┐
 │①│ │ 1. Kiểm tra hệ thống        ✓    │   box đã xong: thu gọn, có dấu ✓, bấm để mở lại
 ┃  ┃ └─────────────────────────────────┘
 ┃  ┃ ┌─────────────────────────────────┐
 │②│ │ 2. Thông tin site                │   box đang làm: viền nhấn, mở đầy đủ
 ┃  ┃ │   Tên site [__________]          │
 ┃  ┃ │   URL site [__________] [Tiếp →] │
 ┆  ┆ └─────────────────────────────────┘
 ┆  ┆ ┌─────────────────────────────────┐
 │③│ │ 3. Tài khoản admin               │   box chưa tới: mờ, không nhập được
 └──┘ └─────────────────────────────────┘
  ↑ cột progress (sticky)
```

- **Các box xếp thành một cột từ trên xuống**, cả ba luôn hiện; không làm wizard kiểu ẩn/hiện
  từng bước.
- **Bên trái là cột progress:**
  - Mỗi box có một vòng tròn số step, căn với tiêu đề box.
  - Trạng thái vòng tròn: chưa tới (viền xám), đang làm (viền màu nhấn), xong (nền màu nhấn
    + dấu ✓).
  - Giữa các vòng tròn có một thanh dọc. Đoạn của mỗi step **cao bằng box của step đó**: đo
    bằng `ResizeObserver` trên từng box, nên vẫn khớp khi box thu gọn hay mở ra.
  - Phần đã xong tô màu nhấn, phần còn lại màu xám.
- **Cột progress `position: sticky`** (`top` = khoảng đệm trên của màn), nên luôn nằm trong
  khung khi cuộn. Thanh đã tô thể hiện tiến độ thật: tô hết đoạn của các step đã xong, còn
  step đang làm thì tô tới vòng tròn của nó.
- *(Bổ sung khi làm, 20/10/2026)* Cột dính thì đứng yên còn box trôi, nên vị trí vòng tròn
  tính theo vị trí THẬT của box trong khung nhìn (`getBoundingClientRect`, cập nhật mỗi khung
  hình cuộn), không theo `offsetTop`. Đo trên 1280×900: lệch 0px với mọi box đang thấy. Box
  trôi khỏi khung nhìn thì vòng của nó dồn ở mép trên/dưới cột, xếp chồng theo thứ tự.
- **Xong một step thì cuộn mượt** (`scrollIntoView({ behavior: 'smooth', block: 'start' })`)
  tới box kế tiếp và focus ô nhập đầu tiên của nó. Nếu người dùng bật
  `prefers-reduced-motion` thì cuộn không có hiệu ứng.
- Step 1 tự chạy khi mở màn. Nếu `db: ok` thì tự đánh dấu xong rồi cuộn sang step 2. Nếu hỏng
  thì dừng ở step 1, hiện lệnh cần chạy kèm nút "Kiểm tra lại".
- "Tiếp" ở step 2 chỉ kiểm trên client (URL hợp lệ, tên không rỗng). Request duy nhất được gửi
  ở nút "Cài đặt" của step 3. Nếu server trả lỗi thuộc field step 2 (vd. `siteUrl`) thì mở lại
  box đó và cuộn tới.
- Màn hẹp (< 640px): cột progress thu thành vòng tròn nhỏ cạnh tiêu đề box, bỏ thanh dọc.
- Không dùng `AuthScreen` (thẻ hẹp của màn đăng nhập) nữa: màn rộng tối đa ~720px, chỉ dùng
  token của shell builder.

Kiểm `db` bằng chung logic với `scripts/check-schema.mjs`. Tách phần lõi ra
`src/lib/setup/schema-check.ts`, script import lại phần đó.

### 5.4 `POST /api/auth/setup` (mở rộng)

Body: `{ siteName, siteUrl, email, password, token? }`.

1. Lớp 1 (User rỗng) và lớp 3 (email, mật khẩu) giữ nguyên.
2. Lớp 2: chỉ đòi mã khi `setupTokenRequired()` (`NODE_ENV === 'production'`).
3. `siteUrl` phải là URL `http:` hoặc `https:`, chỉ có origin (không path, query, hash).
   Chuẩn hoá bỏ `/` cuối. Bỏ qua nếu env `SITE_URL` đã đặt.
4. Trong **một transaction**:
   1. Đếm lại User.
   2. `ensureSiteDefaults(tx, { name, siteUrl })`.
   3. Tạo admin.
5. Token và effect: gọi `ensureDesignTokens()` và `ensureEffects()` **sau** transaction.
   Cả hai idempotent, và lỗi ở đây không làm hỏng việc cài đặt; nếu lỗi thì trả kèm
   `warnings[]` và hiện trên màn.
6. Audit log, đặt cookie và trả kết quả như hôm nay.

### 5.5 `ensureSiteDefaults()` — khởi tạo không phá

`src/lib/setup/defaults.ts`. Mỗi bước kiểm trước rồi mới tạo:

| Bước | Điều kiện tạo |
|---|---|
| Locale `vi` (+ các locale của seed) | `upsert`, như seed |
| Site | Chưa có hàng nào. Nếu đã có thì chỉ cập nhật `name`/`siteUrl` khi tham số được truyền |
| Trang chủ (slug `''`) | Chưa có trang slug `''` |
| Trang 404 (slug `404`, `system: 'not-found'`, `noindex: true`) | Chưa có trang `system = 'not-found'` |
| Release đầu tiên chứa các trang trên | Site chưa có `activeReleaseId` |

Doc của trang chủ chuyển từ `seed.ts` sang `src/lib/setup/default-docs.ts`. `seed.ts` giữ
nguyên hành vi xoá-rồi-tạo cho dev, nhưng phần tạo gọi lại `ensureSiteDefaults`. Bootstrap
prod thay lệnh "seed nếu Site rỗng" bằng `ensureSiteDefaults()` không tham số, nên **site prod
đang chạy sẽ được bổ sung trang 404 trong DB** (chưa publish thì vẫn dùng bản code, xem §5.6).

Doc trang 404 mặc định: tiêu đề "Không tìm thấy trang", một đoạn mô tả, nút "Về trang chủ".
Chỉ dùng `$token`, không màu hay px cứng.

### 5.6 Render trang 404

`not-found.tsx`:

1. `getPublishedSystemPage('not-found')`: tìm `ReleaseEntry` của release đang active có
   `page.system = 'not-found'`.
2. Có thì render như catch-all (tách hàm render dùng chung `renderPublishedPage(page)` ra khỏi
   `[[...slug]]/page.tsx`), rồi nối bảng "địa chỉ đã đổi" ở dưới.
3. Không có (chưa publish, release cũ) hoặc lỗi thì dùng **bản code hiện tại**, giữ nguyên.

Catch-all: nếu `PublishedPage.system` có giá trị thì `notFound()`. Mở `/404` sẽ ra chính trang
404 với status 404, không phải 200.

Builder: trang hệ thống có nhãn "Trang hệ thống" trong danh sách trang. Ô slug khoá, nút
xoá ẩn. API (`delete-page.ts`, PATCH slug) từ chối với lỗi tiếng Việt, để MCP cũng bị chặn.
Sitemap đã loại trang `noindex`, và trang 404 luôn `noindex`.

### 5.7 Trang 500

- `src/app/(site)/error.tsx` (client): tiêu đề "Đã có lỗi xảy ra", nút "Thử lại" (`reset()`)
  và "Về trang chủ". Style chỉ dùng biến CSS token, vì `tokens.css` đã nạp ở layout.
- `src/app/global-error.tsx`: tự có `<html><body>` và style inline với màu dự phòng, vì
  layout có thể chính là thứ đã hỏng.
- Không gọi API, không đọc DB (D6).

### 5.8 SEO mặc định

- `(site)/layout.tsx` `generateMetadata`:
  - Có `seoTitleTemplate` thì đặt `title: { template, default: site.name }`.
  - Có `seoDescription` thì đặt `description`.
  - Page vẫn thắng mọi field nó khai.
- Kiểm template: trống hoặc chứa đúng một `%s`, tối đa 120 ký tự.
- `PageSeoPanel` xem trước tiêu đề đã áp template.

### 5.9 robots.txt

Xoá `src/app/robots.ts`, thêm `src/app/robots.txt/route.ts` (`force-dynamic`,
`Content-Type: text/plain; charset=utf-8`):

```
SITE_NOINDEX=true  → "User-agent: *\nDisallow: /\n"   (luôn thắng, giữ nguyên lý do ở comment cũ)
robotsTxt != null  → robotsTxt nguyên văn
còn lại            → defaultRobotsTxt(origin)           (đúng nội dung tự sinh hôm nay)
```

`defaultRobotsTxt()` nằm ở `src/lib/site/robots.ts`, là hàm thuần. Màn Cài đặt dùng nó để
điền ô soạn khi bấm "Về mặc định".

Kiểm khi lưu (`src/lib/site/robots.ts` → `lintRobotsTxt()`):
- **Lỗi:** dài quá 32 KB, hoặc có dòng không rỗng, không phải comment mà không có dạng
  `Field: value`.
- **Cảnh báo, phải bấm xác nhận mới lưu:** có `Disallow: /` dưới `User-agent: *` (chặn cả
  site); không có dòng `Sitemap:`; có dòng `Sitemap:` trỏ host khác `siteOrigin()`.

### 5.10 sitemap.xml

`sitemap.ts` giữ cấu trúc, đổi hai chỗ:
- `BASE` thành `await siteOrigin()`.
- Cuối hàm áp `sitemapRules`:
  - `exclude`: bỏ URL có đường dẫn **bắt đầu bằng** một tiền tố trong danh sách. Tiền tố
    phải bắt đầu bằng `/`.
  - `include`: thêm URL tuyệt đối cùng origin, hoặc đường dẫn bắt đầu bằng `/`, với
    `priority: 0.5`. Bỏ trùng.
  - Tối đa 200 dòng mỗi danh sách.
- `SITE_NOINDEX` vẫn trả rỗng.

### 5.11 Màn Cài đặt

Thêm hai khối vào `settings/page.tsx` / `SiteSettingsForm.tsx`:

1. **Tên miền.** Ô `siteUrl` thay cho dòng `primaryDomain` chỉ đọc. Nếu nguồn là `env` thì
   khoá ô và ghi "Đang bị biến môi trường SITE_URL ghi đè". Cảnh báo `SITE_URL` chưa đặt ở
   `settings/page.tsx:210` đổi thành: chỉ cảnh báo khi cả env lẫn DB đều trống.
2. **SEO & thu thập**, gồm:
   - Template tiêu đề và mô tả mặc định.
   - robots.txt: công tắc "Tự sinh / Tự soạn", ô soạn monospace, "Về mặc định", link "Xem
     /robots.txt".
   - Sitemap: hai ô nhiều dòng (Thêm URL / Loại tiền tố), link "Xem /sitemap.xml".

*(Đổi khi làm, 20/10/2026)* Lưu qua một route RIÊNG, `PATCH /api/settings/seo` (admin),
kiểm ở `src/lib/site/update-seo.ts`, không nhồi vào `updateSiteSettings`. Lý do: khối này có
luồng xác nhận mà khối kia không có. robots.txt có cảnh báo thì lần gửi đầu trả 409 kèm
`warnings`; gửi lại với `confirmWarnings: true` mới ghi. Lưu xong gọi
`revalidateTag('site-settings')`, và thêm `'release'` khi đổi URL site.

### 5.12 MCP

`list_site_globals` không đổi. Không thêm tool ghi robots/sitemap: đó là cấu hình của admin,
còn MCP chỉ chạm bản nháp. Tool xoá hay đổi slug trang bị chặn trên trang hệ thống qua lớp lib
(§5.6).

## 6. Rủi ro

| Rủi ro | Chặn bằng |
|---|---|
| Đổi `siteUrl` sai làm canonical toàn site trỏ sai | Kiểm URL hợp lệ; màn hiện "canonical sẽ thành …" trước khi lưu; env vẫn ghi đè được |
| Bootstrap prod gọi `ensureSiteDefaults()` làm hỏng site đang chạy | Hàm chỉ tạo khi thiếu; test với DB đã có Site + trang chủ + release; không bao giờ tạo release mới khi đã có `activeReleaseId` |
| Bỏ mã cài đặt ở dev mà ai đó chạy `next start` không đặt `NODE_ENV` | `next start` luôn ép `NODE_ENV=production` |
| Đổi `robots.ts` thành route làm hỏng staging | Test: `SITE_NOINDEX=true` + `robotsTxt` tự soạn vẫn ra `Disallow: /` |
| Trang 404 trong DB render lỗi thành vòng lặp | `not-found.tsx` bọc try/catch, lỗi thì về bản code |
| e2e đang dựa vào `/builder/setup` hoặc seed | Rà `e2e/` ở task cuối; chạy toàn bộ e2e (verify không gồm e2e) |
