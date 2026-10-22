# Cài đặt site kiểu WordPress — kế hoạch triển khai

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Đi từ DB trống tới site chạy được bằng một màn cài đặt dạng cột box có thanh
progress sticky. Domain, SEO mặc định, robots.txt và sitemap cấu hình được trong builder.
Trang 404 là trang hệ thống sửa bằng builder.

**Architecture:**
- **Dữ liệu:** thêm 5 cột vào `Site` (`siteUrl`, `seoTitleTemplate`, `seoDescription`,
  `robotsTxt`, `sitemapRules`) và cột `Page.system`. Không niêm phong vào Release.
- **Một gốc URL:** `siteOrigin()` đọc env `SITE_URL`, nếu không có thì đọc
  `Site.siteUrl`, cuối cùng mới rơi về `localhost`. Mọi chỗ đang đọc `process.env.SITE_URL`
  đổi sang hàm này.
- **Khởi tạo:** `ensureSiteDefaults()` idempotent. Wizard, `seed.ts` và `bootstrap.sh` cùng
  gọi hàm này.
- **robots.txt** chuyển từ metadata route sang route handler trả text.

**Tech Stack:** Next.js 15 (App Router), Prisma 6 / Postgres, vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-20-cai-dat-site-design.md`

## Global Constraints

- Mọi chữ hiện cho người dùng viết **tiếng Việt có dấu**.
- **Style:** chỉ dùng `$token` hoặc biến CSS token. Không có hex hay px cứng trong doc
  mặc định; trong UI builder thì theo token của shell.
- **Không đổi hành vi mặc định của site đang chạy:**
  - `seoTitleTemplate`, `seoDescription`, `robotsTxt` đều null nghĩa là output y hệt hôm nay.
  - Env `SITE_URL` luôn thắng DB.
- **`SITE_NOINDEX=true` luôn thắng** mọi cấu hình robots và sitemap.
- **Thứ tự kiểm:**
  - Mỗi task kết thúc bằng `pnpm typecheck` và `pnpm test`.
  - Task có migration chạy thêm `pnpm db:migrate` + `pnpm db:generate`. Tắt `next dev`
    trước, nếu không sẽ gặp EPERM trên DLL.
  - Task có e2e: dựng lại dev server (`-p 3001`) trước khi chạy, và đọc cả các dòng
    "did not run".
- **Prisma giữ ở 6.x.**
- **Commit:** chỉ commit khi user đồng ý trong phiên thực thi. Message theo kiểu repo (tiếng
  Việt không dấu, conventional), kết thúc bằng
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Nhánh:** `ui/v2` đang có file chưa track. Trước Task 1 phải hỏi user commit, stash hay
  dùng worktree, rồi mới tách `feat/cai-dat-site`.

## Review Focus

1. **`ensureSiteDefaults()` trên DB đã có dữ liệu** không được tạo Site thứ hai, không tạo
   release mới khi đã có `activeReleaseId`, và không đụng trang chủ đã có. *Test ở Task 3.*
2. **Env `SITE_URL` thắng DB** ở cả 6 chỗ đọc gốc URL. *Test ở Task 2, thêm một phép grep
   chặn `process.env.SITE_URL` ngoài `origin.ts`.*
3. **`SITE_NOINDEX=true` cộng `robotsTxt` tự soạn** vẫn ra `Disallow: /`. *Test ở Task 7.*
4. **Mở `/404` trực tiếp** phải trả status 404, không phải 200. *e2e ở Task 6.*
5. **Mã cài đặt vẫn bắt buộc ở production.** *Test ở Task 4: `NODE_ENV=production`, không
   gửi token thì nhận 403.*
6. **Thanh progress khớp chiều cao box** khi box thu gọn hay mở lại. *e2e ở Task 5 so sánh
   bounding box.*

## Bản đồ file

**Mới:**

```
prisma/migrations/<ts>_cai_dat_site/migration.sql
src/lib/site/origin.ts            siteOrigin(), siteOriginSource(), SITE_SETTINGS_TAG   (+ .test)
src/lib/site/robots.ts            defaultRobotsTxt(), lintRobotsTxt()                  (+ .test)
src/lib/site/sitemap-rules.ts     parseSitemapRules(), applySitemapRules()             (+ .test)
src/lib/site/seo-template.ts      checkTitleTemplate(), applyTitleTemplate()           (+ .test)
src/lib/setup/default-docs.ts     doc trang chủ (chuyển từ seed.ts) + doc trang 404
src/lib/setup/defaults.ts         ensureSiteDefaults(tx, opts?)                        (+ .test, cần DB)
src/lib/setup/design-tokens.ts    ensureDesignTokens()  (lõi của scripts/import-tokens.ts)
src/lib/setup/effects.ts          ensureEffects()       (lõi của scripts/sync-effects.ts)
src/lib/setup/schema-check.ts     checkSchema()         (lõi của scripts/check-schema.mjs)
src/lib/setup/status.ts           setupStatus()                                        (+ .test)
src/lib/auth/setup-policy.ts      setupTokenRequired()                                 (+ .test)
src/app/api/setup/status/route.ts
src/app/robots.txt/route.ts
src/app/(site)/error.tsx
src/app/global-error.tsx
src/lib/render/render-published.tsx   renderPublishedPage() tách từ catch-all
src/app/(builder)/builder/setup/SetupSteps.tsx      cột box + rail progress
src/app/(builder)/builder/setup/ProgressRail.tsx
src/app/(builder)/builder/setup/steps/{SystemCheck,SiteInfo,AdminAccount}.tsx
e2e/setup.spec.ts
e2e/system-pages.spec.ts
e2e/seo-crawl-settings.spec.ts
```

**Sửa:**

```
prisma/schema.prisma, prisma/seed.ts
scripts/import-tokens.ts, scripts/sync-effects.ts, scripts/check-schema.mjs, scripts/bootstrap.sh
src/middleware.ts
src/app/api/auth/setup/route.ts
src/app/(builder)/builder/setup/page.tsx, SetupForm.tsx (xoá, thay bằng SetupSteps)
src/app/sitemap.ts, src/app/robots.ts (xoá), src/app/metadata-routes.test.ts, src/app/sitemap.test.ts
src/app/(site)/layout.tsx, src/app/(site)/not-found.tsx, src/app/(site)/[[...slug]]/page.tsx
src/lib/render/page.ts (PublishedPage.system, getPublishedSystemPage)
src/lib/builder/delete-page.ts, route PATCH trang (chặn đổi slug trang hệ thống)
src/lib/builder/site-settings.ts, src/app/api/settings/route.ts
src/app/(builder)/builder/settings/page.tsx, src/components/builder/SiteSettingsForm.tsx
src/app/(builder)/builder/[pageId]/page.tsx, src/lib/transfer/export.ts
danh sách trang trong builder (nhãn "Trang hệ thống")
.env.example (ghi chú SITE_URL giờ là tuỳ chọn)
```

---

## Task 1 — Migration và kiểu dữ liệu

**Files:** `prisma/schema.prisma`, migration mới.

- [ ] Thêm vào `Site`: `siteUrl String?`, `seoTitleTemplate String?`,
      `seoDescription String?`, `robotsTxt String?`, `sitemapRules Json @default("{}")`.
      Mỗi cột có doc comment theo kiểu file, nêu lý do không niêm phong vào Release (spec D9).
- [ ] Thêm vào `Page`: `system String?` và `@@unique([siteId, system])`.
- [ ] `pnpm prisma migrate dev --create-only --name cai_dat_site`. Thêm SQL điền `siteUrl`
      từ `primaryDomain`: `http://` nếu host là `localhost` hoặc `127.%`, còn lại `https://`.
- [ ] Tắt dev server, chạy `pnpm db:migrate` và `pnpm db:generate`.
- [ ] `pnpm typecheck`, `pnpm test`.

## Task 2 — `siteOrigin()` thay mọi chỗ đọc `SITE_URL`

**Files:** `src/lib/site/origin.ts` (+test), 6 chỗ ở spec §4, `metadata-routes.test.ts`, `sitemap.test.ts`.

- [ ] Viết test trước cho `resolveOrigin(env, dbValue)` (hàm thuần):
  - env thắng DB;
  - env rỗng hoặc chỉ khoảng trắng coi như không đặt;
  - bỏ `/` cuối;
  - không có cả hai thì trả `http://localhost:3001` với nguồn `'fallback'`.
- [ ] Viết `siteOrigin()` / `siteOriginSource()`. Đọc DB qua `unstable_cache`
      `['site-origin']`, tag `SITE_SETTINGS_TAG = 'site-settings'`.
- [ ] Thay ở `robots.ts`, `sitemap.ts`, `(site)/layout.tsx` (`metadataBase`),
      `builder/[pageId]/page.tsx`, `settings/page.tsx`, `transfer/export.ts`.
- [ ] Sửa `metadata-routes.test.ts`: đổi phép khẳng định "hai file cùng một dòng `BASE`"
      thành "không file nào trong `src/` đọc `process.env.SITE_URL` ngoài `origin.ts`" (grep).
- [ ] `pnpm typecheck`, `pnpm test`.

## Task 3 — `ensureSiteDefaults()` và tách lõi các script

**Files:** `src/lib/setup/{default-docs,defaults,design-tokens,effects,schema-check}.ts`,
`prisma/seed.ts`, 3 script, `scripts/bootstrap.sh`.

- [ ] Chuyển `doc` trang chủ từ `seed.ts` sang `default-docs.ts` nguyên văn. Thêm
      `notFoundDoc` (tiêu đề, đoạn mô tả, nút "Về trang chủ"; chỉ dùng `$token`). Kiểm doc
      bằng validator node đang có.
- [ ] Viết `ensureSiteDefaults(tx, { name?, siteUrl? } = {})` theo bảng ở spec §5.5. Trả
      `{ created: string[] }` để log.
- [ ] Test có DB (theo cách các test DB khác trong repo đang làm):
  - DB trống: tạo đủ Site, trang chủ, trang 404, release; release chứa cả hai trang.
  - Gọi hai lần: lần hai `created = []`.
  - DB đã có Site + trang chủ + release (không có 404): chỉ tạo trang 404, **không** tạo
    release mới, `activeReleaseId` không đổi.
- [ ] `seed.ts`: giữ `deleteMany` (reset dev), phần tạo gọi `ensureSiteDefaults`.
- [ ] Tách `main()` của `import-tokens.ts` thành `ensureDesignTokens(prisma)`, và của
      `sync-effects.ts` thành `ensureEffects(prisma)`. Hai script chỉ còn gọi hàm. Chạy hai
      lệnh `pnpm tokens:import` và `pnpm effects:sync`, so số dòng DB trước/sau để chắc hành
      vi không đổi.
- [ ] Tách lõi `check-schema.mjs` thành `checkSchema(prisma)` →
      `'ok' | 'needs-migration'`. Nếu `.mjs` không import được TS ở runtime prod thì giữ bản
      `.mjs` và để `schema-check.ts` cài lại cùng truy vấn, kèm test so hai bản trên cùng
      danh sách bảng.
- [ ] `bootstrap.sh`: thay "seed nếu Site rỗng" bằng một script nhỏ `scripts/ensure-defaults.ts`
      gọi `ensureSiteDefaults(prisma)`.
- [ ] `pnpm typecheck`, `pnpm test`.

## Task 4 — API cài đặt

**Files:** `src/lib/auth/setup-policy.ts`, `src/lib/setup/status.ts`,
`src/app/api/setup/status/route.ts`, `src/app/api/auth/setup/route.ts`, `src/middleware.ts`.

- [ ] `setupTokenRequired()` trả `process.env.NODE_ENV === 'production'`. Test cả hai nhánh.
- [ ] `setupStatus()` trả đúng hình dạng ở spec §5.3:
  - `db`: bắt lỗi kết nối thì là `unreachable`, ngược lại theo `checkSchema()`;
  - `installed`: `user.count() > 0`;
  - `env`: chỉ trả boolean, không bao giờ trả giá trị bí mật; riêng `siteUrlEnv` trả URL
    vì nó vốn công khai.
- [ ] `GET /api/setup/status` (`force-dynamic`, `Cache-Control: no-store`). Thêm vào danh
      sách cho qua ở `middleware.ts`.
- [ ] Mở rộng `POST /api/auth/setup` theo spec §5.4. Test (mock prisma như các route test khác):
  - prod không token: 403;
  - dev không token: 200;
  - `siteUrl` có path: 400 với thông điệp tiếng Việt;
  - env `SITE_URL` đặt: bỏ qua `siteUrl` trong body;
  - `ensureEffects` ném lỗi: vẫn 200, kèm `warnings`.
- [ ] Khi tạo xong gọi `revalidateTag(SITE_SETTINGS_TAG)`.
- [ ] `pnpm typecheck`, `pnpm test`.

## Task 5 — Màn cài đặt: cột box + rail progress sticky

**Files:** `setup/page.tsx`, `SetupSteps.tsx`, `ProgressRail.tsx`, `steps/*.tsx`; xoá `SetupForm.tsx`.

- [ ] `page.tsx` (server):
  - gọi `setupStatus()`; nếu `installed` thì `redirect('/builder/login')`;
  - truyền `status` ban đầu vào `SetupSteps`;
  - bỏ `AuthScreen`.
- [ ] `SetupSteps` (client):
  - state `{ current: 0|1|2, done: Set<number>, values, errors }`;
  - ba box xếp dọc, ref từng box;
  - xong một step thì `scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth',
    block: 'start' })` tới box kế tiếp và focus ô đầu tiên của nó;
  - box đã xong thu gọn kèm ✓ và bấm mở lại được; box chưa tới `inert` + mờ.
- [ ] `ProgressRail`:
  - nhận mảng chiều cao box từ `ResizeObserver`;
  - vẽ vòng tròn số ở đỉnh mỗi đoạn, đoạn cao bằng box tương ứng cộng khoảng cách giữa các box;
  - phần tô màu nhấn = tổng chiều cao các step đã xong cộng vị trí vòng tròn của step đang làm;
  - `position: sticky; top: <token khoảng đệm>`;
  - màn < 640px ẩn thanh dọc, vòng tròn nhỏ vào cạnh tiêu đề box.
- [ ] `SystemCheck`:
  - tự chạy lúc mount;
  - `ok` thì đánh dấu xong rồi cuộn tiếp;
  - hỏng thì hiện lệnh tương ứng (`unreachable` → `pnpm db:up`; `needs-migration` →
    `pnpm db:migrate`, ở prod là `docker logs quilder-bootstrap`), có nút copy (dùng lại
    `copyText`) và nút "Kiểm tra lại";
  - cảnh báo vàng nếu thiếu S3.
- [ ] `SiteInfo`:
  - tên site; URL mặc định `location.origin`;
  - khoá ô URL khi `siteUrlEnv`;
  - kiểm trên client rồi bấm "Tiếp".
- [ ] `AdminAccount`:
  - email, mật khẩu, nhập lại mật khẩu;
  - ô mã chỉ hiện khi `tokenRequired`;
  - nút "Cài đặt" gửi một request;
  - lỗi thuộc field step 2 thì mở lại box 2 và cuộn tới;
  - thành công thì hiện `warnings` (nếu có) rồi chuyển tới `/builder`.
- [ ] e2e `e2e/setup.spec.ts` (DB trống riêng; xem cách `scripts/e2e-stack.mjs` dựng DB):
  1. Mở `/builder` thì được đưa tới `/builder/setup`.
  2. Step 1 tự xong, box 2 vào khung nhìn.
  3. Chiều cao đoạn rail của mỗi step lệch box không quá 2px, trước và sau khi thu gọn box 1.
  4. Cuộn xuống cuối trang thì rail vẫn nằm trong viewport (sticky).
  5. Cài xong: vào builder, danh sách trang có "Trang chủ" và "404".
- [ ] Chụp màn ở 1280px và 375px, đối chiếu với sơ đồ ở spec §5.3.

## Task 6 — Trang 404 hệ thống và trang 500

**Files:** `render/page.ts`, `render-published.tsx`, `[[...slug]]/page.tsx`, `not-found.tsx`,
`error.tsx`, `global-error.tsx`, `delete-page.ts`, route PATCH trang, danh sách trang trong builder.

- [ ] `PublishedPage` thêm `system: string | null` (select trong `loadFromRelease`). Thêm
      `getPublishedSystemPage(kind)`, cache cùng tag `release` như `getPublishedPage`.
- [ ] Tách thân render của catch-all thành `renderPublishedPage(page, ctx)`, để catch-all và
      404 dùng chung. Không đổi output: chạy e2e render hiện có để chứng minh.
- [ ] Catch-all: nếu `page.system` thì `notFound()`.
- [ ] `not-found.tsx`: có trang hệ thống thì render nó, cộng bảng redirect; lỗi hoặc không có
      thì dùng bản code hiện tại. Sửa comment đầu file.
- [ ] `error.tsx` + `global-error.tsx` theo spec §5.7.
- [ ] `delete-page.ts` và PATCH slug: trang có `system` thì trả 409 "Trang hệ thống không
      xoá/đổi đường dẫn được". Test.
- [ ] Builder: danh sách trang có nhãn "Trang hệ thống"; ô slug khoá; menu ẩn "Xoá".
- [ ] e2e `e2e/system-pages.spec.ts`:
  - sửa nội dung trang 404 rồi Publish, sau đó mở `/khong-co-trang-nay`: thấy nội dung mới,
    status 404;
  - mở `/404`: status 404.
- [ ] `pnpm typecheck`, `pnpm test`.

## Task 7 — robots.txt route + sitemap rules

**Files:** `src/lib/site/robots.ts`, `src/lib/site/sitemap-rules.ts`, `src/app/robots.txt/route.ts`,
xoá `src/app/robots.ts`, `src/app/sitemap.ts`, các test.

- [ ] `defaultRobotsTxt(origin)` ra **đúng** nội dung Next đang sinh hôm nay. Lấy output
      thật của `/robots.txt` trên dev trước khi xoá file làm fixture, rồi so test với fixture.
- [ ] `lintRobotsTxt(text, origin)` → `{ errors: string[], warnings: string[] }` theo spec
      §5.9. Test từng luật.
- [ ] Route `robots.txt` theo bảng ở spec §5.9. Test:
  - noindex + tự soạn → chặn tất;
  - tự soạn → nguyên văn;
  - null → mặc định;
  - `Content-Type` là text/plain.
- [ ] Giữ comment dài về vụ stg 11/09/2026 (chuyển sang file route mới).
- [ ] `parseSitemapRules(json)` (bỏ phần tử sai dạng, trần 200) và
      `applySitemapRules(entries, rules, origin)`. Test:
  - loại theo tiền tố;
  - thêm đường dẫn tương đối và tuyệt đối cùng origin;
  - bỏ URL khác origin;
  - bỏ trùng.
- [ ] `sitemap.ts` áp rules ở cuối. `sitemap.test.ts` thêm ca có rules.
- [ ] `pnpm typecheck`, `pnpm test`.

## Task 8 — SEO mặc định

**Files:** `src/lib/site/seo-template.ts`, `(site)/layout.tsx`, `PageSeoPanel.tsx`.

- [ ] `checkTitleTemplate` (rỗng hoặc đúng một `%s`, tối đa 120 ký tự) và
      `applyTitleTemplate(template, title)`. Test.
- [ ] `layout.tsx` `generateMetadata`: thêm `title.template`/`default` và `description`
      khi có. Sửa comment "Cố ý KHÔNG đặt title mặc định": giờ là tuỳ chọn, mặc định tắt.
- [ ] `PageSeoPanel`: xem trước tiêu đề sau khi áp template (truyền template qua props từ
      `[pageId]/page.tsx`).
- [ ] Test metadata: null thì giữ nguyên output cũ; có template thì tiêu đề trang được bọc.

## Task 9 — Màn Cài đặt: Tên miền + SEO & thu thập

**Files:** `site-settings.ts`, `api/settings/route.ts`, `settings/page.tsx`, `SiteSettingsForm.tsx`.

- [ ] `site-settings.ts`: kiểm `siteUrl` (cùng luật với Task 4), `seoTitleTemplate`,
      `seoDescription` (tối đa 300 ký tự), `robotsTxt` (dùng `lintRobotsTxt`; có `warnings`
      thì cần `confirmWarnings: true` trong body), `sitemapRules`. Khi lưu `siteUrl` thì
      đồng bộ host vào `primaryDomain`. Test.
- [ ] PATCH: lưu xong gọi `revalidateTag(SITE_SETTINGS_TAG)`.
- [ ] UI khối **Tên miền**: ô URL thay cho dòng `primaryDomain` chỉ đọc. Khoá kèm ghi chú khi
      nguồn là env. Hiện "canonical sẽ thành …". Cảnh báo `SITE_URL` cũ chỉ hiện khi nguồn
      là `fallback`.
- [ ] UI khối **SEO & thu thập**: template, mô tả mặc định; robots (công tắc Tự sinh/Tự
      soạn, ô monospace, "Về mặc định", hộp xác nhận khi có cảnh báo, link xem); sitemap (hai
      ô nhiều dòng, link xem).
- [ ] e2e `e2e/seo-crawl-settings.spec.ts`:
  - tự soạn robots có dòng chặn `GPTBot` → `/robots.txt` có dòng đó;
  - "Về mặc định" → trở lại nội dung tự sinh;
  - loại tiền tố `/tin-tuc` → sitemap không còn URL bắt đầu bằng đường dẫn đó;
  - đổi domain → `<link rel=canonical>` của trang chủ đổi theo.
- [ ] `pnpm typecheck`, `pnpm test`.

## Task 10 — Dọn và kiểm tổng

- [ ] Rà `e2e/` và `scripts/e2e-stack.mjs` xem chỗ nào dựa vào `SetupForm`, `robots.ts`
      hay seed cũ; sửa lại.
- [ ] `.env.example`: ghi chú `SITE_URL` giờ là tuỳ chọn (ghi đè DB). Cập nhật phần cài
      đặt trong README/HANDOFF nếu có.
- [ ] Luồng dev từ đầu trên một DB mới:
  1. `pnpm db:up`, `pnpm db:migrate`, `pnpm dev -p 3001`;
  2. cài qua màn cài đặt;
  3. tạo một trang, Publish;
  4. đổi favicon, template SEO, robots, sitemap;
  5. kiểm `/robots.txt`, `/sitemap.xml`, một URL 404.
- [ ] `pnpm verify`, rồi **toàn bộ e2e** (verify không gồm e2e).
- [ ] Ghi lại cho user những gì đổi ở prod khi deploy: migration mới; bootstrap bổ sung
      trang 404 vào DB (chưa publish thì vẫn dùng bản code); env `SITE_URL` vẫn thắng.
