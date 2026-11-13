# Yêu cầu của dự án

<!-- Ngắn, đủ để agent mới vào hiểu đang xây cái gì và vì sao. Ghi nguồn khi rút từ tài liệu có sẵn. -->

Nguồn: `README.md`, `mcp/README.md`, `projects/example/README.md`, `Design.md`, `docs/huong-dan/`.

## Mục tiêu

Quilder là trình dựng website bằng cách ghép khối. Mỗi trang là một **cây node có kiểu, lưu trong Postgres**. Trang được sửa
ngay trên bản xem trước bằng inspector, hoặc bằng lời qua Claude (MCP). Có bản nháp và bản xem trước; **Publish chụp lại
cả site** thành một ảnh, nên lùi về bản cũ không phải build lại. Site đang chạy thật bằng Quilder: maimoney.com (gói dự án
`projects/maimoney`, repo riêng).

## Người dùng

- Người biên tập / quản trị site: dùng `/builder` (trang, component, kho dữ liệu, ảnh, bản dịch, phát hành, cài đặt).
- Claude Desktop / Claude Code qua MCP (`mcp/server.mjs`): chỉ sửa **bản nháp**, không có tool publish.
- Khách truy cập site công khai (route `(site)`) và app bên ngoài đọc API công khai (`docs/API-PUBLIC.md`).

## Tính năng chính

- Builder: canvas + inspector, style theo breakpoint/trạng thái, component dùng lại (Instance, slot/prop), mẫu hệ thống (Form).
- Kho dữ liệu (collection): loại nội dung, entry, taxonomy, khối lặp, trang chi tiết/danh mục, view của API công khai.
- Đa ngôn ngữ: ngôn ngữ của site, bản dịch theo text unit và theo entry.
- Effect chuyển động (`src/lib/motion/effects`): slider, scroll-reveal, show-more, steps…
- Phát hành: Publish toàn site thành snapshot niêm phong, lùi bản, lịch sử phát hành.
- Ảnh/tài sản trên S3 (MinIO khi dev), thư mục, thùng rác, đếm chỗ dùng.
- Xuất/nhập site (`src/lib/transfer`), clone trang web thật (`src/lib/clone`, tool `clone_url`).
- SEO trên từng Page, robots.txt, sitemap; màn cài đặt lần đầu `/builder/setup`.
- Gói dự án: khối riêng (composite), effect, font, CSS của từng website, chọn bằng `QUILDER_PROJECT`.

## Ràng buộc (nền tảng, hiệu năng, bảo mật, hạn chót)

- Next.js 15 (App Router), React 19, Prisma 6 + Postgres, S3. Node 24 trên CI, pnpm 11.
- Lõi không biết gì về gói dự án ngoài hợp đồng `QuilderProject` (`src/lib/project/types.ts`); repo chỉ commit `projects/example`.
- Vỏ builder dùng Tailwind + token `shell-*` (`Design.md`); site sinh ra dùng `src/styles/tokens.css` + CSS compiler, không Tailwind.
- Publish là việc của người; AI không có tool publish.
- Repo riêng tư gói Free, không bật được branch protection, nên hook pre-push là chốt chặn duy nhất (`scripts/pre-push.mjs`).

## Ngoài phạm vi

- Chức năng app trên site marketing: đăng nhập khách, dashboard, upload giấy tờ, giao dịch (hướng dẫn của MCP server).
- Emit `<script>` trực tiếp: JS chỉ qua node CustomCode (iframe sandbox) hoặc effect có sẵn.
