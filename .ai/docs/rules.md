# Luật của dự án

<!-- Chỉ ghi luật RIÊNG của dự án mà CLAUDE.md chưa có — CLAUDE.md đã nạp mỗi phiên, chép lại là tốn token hai lần.
     Mỗi luật một dòng, kèm lý do ngắn. Chưa có gì thì để trống. -->

`CLAUDE.md` lo việc sửa/clone trang trong builder. File này lo việc **sửa code lõi Quilder**.

## Luôn làm

- Đổi tool AI (thêm, bớt, đổi schema) → `pnpm mcp:snapshot` rồi commit `mcp/contract.snapshot.json`: `src/lib/ai/contract.test.ts` so hash, và diff của file là chỗ người review thấy tool GHI mới.
- Đổi registry node type / op / effect / field kind / tool AI → `pnpm docs:gen`: CI chạy `pnpm docs:check` và đỏ khi `docs/generated/` lệch code.
- Đổi giao diện vỏ builder → theo `Design.md` (token `shell-*`, `rem`, không palette Tailwind mặc định, không `dark:`).

## Không bao giờ

- Sửa tay file sinh tự động: `docs/generated/*` (`pnpm docs:gen`), `mcp/contract.snapshot.json` (`pnpm mcp:snapshot`), `.ai/folder-tree/tree.md`.
- Commit nội dung của gói dự án thật (`projects/*` trừ `projects/example`): mỗi gói là repo riêng, đồ khách hàng không lọt vào lõi.
- Viết class Tailwind trong `src/lib/render` hay dùng token website trong vỏ builder (`Design.md`: hai thế giới không trộn).
- Gỡ `server-only` khỏi module để test được: vitest đã thay nó bằng `test/server-only-stub.ts`.
- Thêm `dangerouslySetInnerHTML` mà không có `eslint-disable-next-line react/no-danger` kèm lý do (rule đang `error`).
- Để gói dự án mang file font hay khối `@font-face`: gói dự án không mang file font hay @font-face; font thêm ở Cài đặt › Font.

## Code & kiến trúc

- Alias: `@/` = `src/`, `@project` = gói đang chọn (`scripts/project-dir.mjs`, dùng chung cho Next và vitest).
- Unit test đặt cạnh file nguồn (`*.test.ts`); e2e Playwright ở `e2e/`; spec của gói ở `projects/<gói>/e2e/`.
- Biến cố ý không dùng đặt tên `_tên` (cấu hình `no-unused-vars` trong `eslint.config.mjs`).
- Thay đổi lớn: spec + plan ở `docs/superpowers/specs|plans/YYYY-MM-DD-<slug>.md` (checkbox trong plan cũ không được tick, đừng coi đó là việc còn dở).

## Test & kiểm tra trước khi báo xong

- Tối thiểu: `pnpm typecheck && pnpm lint && pnpm test && pnpm docs:check`, giống job `check` của CI và hook pre-push.
- `pnpm verify` = prisma generate + typecheck + test + `check:tokens` (cần DB).
- Đụng giao diện site sinh ra → visual regression `pnpm e2e:up --scripted && pnpm e2e:visual` (job này CHẶN trên CI).

## Git (nhánh, commit)

- Conventional Commits, scope theo khu vực (`form`, `inspector`, `components`, `collections`…), mô tả tiếng Việt **không dấu**.
- Bật hook một lần mỗi máy: `pnpm hooks:install`. Bỏ qua chỉ khi thật cần: `git push --no-verify` / `MM_SKIP_PREPUSH=1`.
- Phát hành: `pnpm release <tag>` (đòi CI xanh; `--skip-ci` chỉ dùng khi đã tự chạy đủ cổng CI ở máy).
