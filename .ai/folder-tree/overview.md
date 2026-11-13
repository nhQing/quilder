# Thư mục nào làm gì

<!-- Bổ sung cho tree.md (tự sinh). Mỗi dòng một thư mục quan trọng: vai trò + file vào cửa.
     Chỉ ghi điều đọc được từ code thật. Cập nhật khi thêm thư mục mới có vai trò riêng. -->

| Thư mục | Vai trò | Bắt đầu đọc từ |
|---|---|---|
| `src/app/(builder)/builder/` | Các màn builder: trang (`[pageId]`), component, kho dữ liệu (`content`), ảnh, bản dịch (`text`), phát hành, cài đặt, setup, kết nối Claude | `page.tsx`, `[pageId]/` |
| `src/app/(site)/` | Site công khai: route bắt mọi slug, xem trước bản nháp | `[[...slug]]/`, `PublishedPageView.tsx` |
| `src/app/(render)/render/` | Nội dung iframe canvas của builder: trang (`[pageId]`) và component (`component/[id]`), không nạp Tailwind của vỏ | `[pageId]/page.tsx` |
| `src/app/api/` | API: `ops` (ghi cây node), `ai` (tool MCP), `public` (API công khai), `publish`, `collections`, `assets`, `transfer`… | `ops/`, `ai/`, `public/` |
| `src/lib/doc/` | Mô hình tài liệu: kiểu node, op, validator, style, allowlist CSS cho AI | `types.ts`, `ops.ts`, `validate.ts`, `schema.ts` |
| `src/lib/render/` | Cây node → React/HTML + CSS cho site, binding, instance, snapshot phát hành, sitemap | `NodeRenderer.tsx`, `page.ts`, `css.ts` |
| `src/lib/builder/` | Logic phía builder: tạo trang/component, ảnh, link cho AI, slug… | theo tên file (`create-page.ts`, `ai-link.ts`…) |
| `src/components/builder/` | UI vỏ builder (inspector, panel, dialog), con `asset/`, `transfer/`, `ui/` | `ui/` (component cơ bản) |
| `src/lib/ai/` | Danh mục tool MCP và hợp đồng của nó | `tools.ts`, `contract.ts`, `guide.ts` |
| `src/lib/collections/` | Kho dữ liệu: entry, taxonomy, khối lặp, API công khai, view | `queries.ts`, `resolve-repeat.ts`, `public-read.ts` |
| `src/lib/composites/` | Khối tự dựng của lõi (Form, Accordion, NavChart) | `registry.ts` |
| `src/lib/motion/` | Runtime effect chuyển động; từng effect trong `effects/` | `EffectRuntime.tsx`, `effects/` |
| `src/lib/clone/` | Clone trang web thật thành bản nháp, so sánh với trang thật | `extractor.ts`, `assemble.ts`, `compare.ts` |
| `src/lib/transfer/` | Xuất/nhập site dạng zip, có hoàn tác | `export.ts`, `import-plan.ts`, `commit.ts` |
| `src/lib/site/`, `src/lib/setup/` | Cài đặt site (SEO, robots, theme, origin); seed mặc định lúc cài đặt, mẫu hệ thống | `settings.ts`; `defaults.ts`, `system-presets.ts` |
| `src/lib/auth/` | Phiên đăng nhập, token dịch vụ (MCP), guard theo quyền | `guard.ts`, `service-token.ts` |
| `src/lib/project/`, `src/project/none/` | Hợp đồng gói dự án và gói rỗng khi không đặt `QUILDER_PROJECT` | `types.ts`, `active.ts` |
| `src/styles/` | `builder.css` (vỏ, Tailwind) tách với `tokens.css`/`site.css` (site sinh ra) | `builder.css`, `tokens.css` |
| `projects/` | Gói dự án; chỉ `example/` được commit, `maimoney/` là repo riêng bị ignore | `example/README.md` |
| `mcp/` | Server MCP độc lập (không phụ thuộc thư viện) + snapshot hợp đồng tool | `README.md`, `server.mjs` |
| `prisma/` | Schema DB, migration, seed | `schema.prisma` |
| `scripts/` | Script dev/ops: release, e2e stack, pre-push, sinh docs/snapshot, `size-check.mjs` đo trang so với live | `package.json` → `scripts` |
| `e2e/` | Playwright spec; `visual/__screenshots__` là ảnh mẫu của visual regression | `playwright.config.ts` |
| `docs/` | `huong-dan/` (hướng dẫn dùng), `generated/` (sinh từ code), `API-PUBLIC.md`, `superpowers/` (spec + plan) | `huong-dan/README.md` |
| `branding/` | Logo Quilder và script vẽ logo | `README.md` |
