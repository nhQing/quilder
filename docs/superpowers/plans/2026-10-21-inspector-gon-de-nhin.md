# Inspector gọn, dễ nhìn — kế hoạch triển khai

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sidebar Inspector kéo giãn được (280–560px, nhớ qua lần tải). Mọi hàng thuộc tính
thẳng một lưới. Chọn token qua popover gọn có ô màu xem trước. Nhãn giữ tên CSS; dải nút căn
chỉnh dùng icon.

**Architecture:**
- Hai primitive Radix (`react-popover`, `react-tooltip`), style bằng token của builder.
- Một `TokenPicker` dùng chung cho mọi ô có đơn vị hoặc màu.
- Một lưới `ROW` chung trong `controls.tsx`.
- Bề rộng sidebar là biến CSS `--shell-right`, đổi bằng `PaneResizer` và lưu qua `persisted.ts`.

**Spec:** `docs/superpowers/specs/2026-10-21-inspector-gon-de-nhin-design.md`

## Global Constraints

- Không đổi dữ liệu doc hay hình dạng style: chỉ lớp hiển thị. `pnpm test` (2667+) phải xanh
  nguyên trạng.
- Mọi chữ tiếng Việt có dấu. Mọi màu, khoảng cách theo token shell (`shell-*`, `h-control-*`),
  không hex.
- Mỗi task kết thúc bằng `pnpm typecheck`, `pnpm test`, `pnpm lint` (hook pre-push chạy lint).
- Task có giao diện: chụp ảnh trước/sau ở bề rộng sidebar 300px và 520px. Dựng lại dev server
  (`-p 3001`) trước khi chụp hay chạy e2e.
- **RAM:** cả bộ e2e từng làm máy hết bộ nhớ (20/10/2026). Mỗi task chỉ chạy các spec liên quan,
  bằng `pnpm e2e:up` rồi `pnpm e2e:test <spec>`. Chạy cả bộ một lần ở task cuối.
- Commit theo task, message kiểu repo, kết thúc bằng
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Bản đồ file

```
Mới:
  src/components/builder/PaneResizer.tsx
  src/components/builder/TokenPicker.tsx            (+ .test.tsx: lọc, phím, rút gọn clamp)
  src/lib/builder/token-kinds.ts                    (+ .test.ts: field → loại token)
  e2e/inspector-v3.spec.ts
Sửa:
  package.json (+ @radix-ui/react-popover, @radix-ui/react-tooltip — pin chính xác)
  src/styles/builder.css (--shell-right mặc định, tay kéo)
  src/lib/builder/persisted.ts (khoá rightWidth)
  src/components/builder/EditorShell.tsx, ComponentEditorShell.tsx
  src/components/builder/controls.tsx (ROW, Label, LenControl, ColorControl, SegmentedControl, SelectControl)
  src/components/builder/ColorPopover.tsx (tách lưới token sang TokenPicker, giữ ColorPickerPanel + tạo token)
  src/components/builder/ExtraFields.tsx, src/lib/builder/extra-fields.ts (nhãn, tokenKind)
  src/components/builder/Inspector.tsx (truyền tokenKind, icon cho dải căn)
  src/components/builder/ui/Icon.tsx (icon căn chỉnh)
  e2e/* đang dùng selectOption trên ô đơn vị
```

---

## Task 1 — Sidebar kéo giãn

- [ ] `persisted.ts`: thêm `rightWidth` (số, kẹp 280–560), `readNumber`/`write`, theo cùng kiểu với `readFlag`.
- [ ] `PaneResizer`:
  - pointer capture; trong lúc kéo set `style.setProperty('--shell-right', px)` trên khung;
  - thả tay thì lưu;
  - bấm đúp thì xoá giá trị đã lưu;
  - phím ←/→ (16px), Shift (64px);
  - ARIA separator.
- [ ] `EditorShell` và `ComponentEditorShell`:
  - gắn tay kéo vào mép trái `<aside>` Inspector;
  - đọc giá trị đã lưu sau khi mount (giống `leftCollapsed`) để không lệch SSR.
- [ ] Kẹp thêm `45vw` khi cửa sổ thu nhỏ (`resize` listener).
- [ ] e2e: kéo sang trái 120px thì aside rộng thêm khoảng 120px; tải lại vẫn giữ; bấm đúp thì về mặc định; không vượt 560.

## Task 2 — Lưới hàng chung + tooltip

- [ ] Thêm `@radix-ui/react-tooltip` (pin chính xác). Bọc `Tooltip.Provider` ở `EditorShell`.
- [ ] `controls.tsx`:
  - `ROW` mới (spec §5.2), dòng phụ ở `col-start-2`;
  - `Label` giữ tên CSS, `truncate`, tooltip Radix "tên CSS · tên vật lý" thay cho `title`;
  - `SegmentedControl` bỏ chế độ wide, item 28px;
  - `SelectControl` bọc `min-w-0`;
  - ô nhập nền `shell-raised`, không viền, focus có viền màu nhấn.
- [ ] e2e: với mọi hàng trong section Bố cục, Kích thước, Nền & viền, `x` của ô lệch nhau ≤ 1px, mép phải lệch ≤ 1px.

## Task 3 — `TokenPicker` + `LenControl` một ô

- [ ] Thêm `@radix-ui/react-popover` (pin chính xác).
- [ ] `token-kinds.ts`: field → `{ units, keywords, tokenCategories }` theo spec D7. Test.
- [ ] `TokenPicker`:
  - Portal, collision, ô tìm, hàng chip đơn vị, nhóm từ khoá và token;
  - phím lên/xuống/Enter/Esc;
  - rút gọn `clamp()`.
  - Test bằng testing-library: lọc theo tên, chọn bằng phím, không bao giờ có token khác loại.
- [ ] `LenControl`:
  - ô nhập có hậu tố là nút mở picker, bỏ `<select>`;
  - giá trị token hiện tên token;
  - giữ nguyên `parseLen`/`formatLen` hiện có (không đổi dữ liệu).
- [ ] Sửa các e2e đang `selectOption` trên ô đơn vị: thêm helper `pickUnit` và `pickToken`.

## Task 4 — `ColorControl` có ô màu, popover màu thống nhất

- [ ] `TokenPicker kind=color`:
  - mỗi dòng có ô màu tròn (`resolveTokenColor`), bàn cờ cho màu có alpha;
  - phần dưới gồm `ColorPickerPanel` + "Tạo token từ màu này" (chuyển từ `ColorPopover`).
- [ ] `ColorControl`: ô màu nằm trong ô nhập, bấm cả ô thì mở picker. Bỏ `<datalist>`.
- [ ] `ColorPopover`: rút gọn còn phần dùng chung, hoặc xoá nếu không còn ai gọi.
- [ ] e2e:
  - mở ô màu nền, mỗi dòng token có ô màu với `background-color` khớp mã;
  - chọn một token thì canvas đổi màu.

## Task 5 — Icon cho dải căn chỉnh, rút gọn `display`

- [ ] Thêm icon vào `Icon.tsx` (spec §5.6).
- [ ] `SegmentedControl` nhận `icon` cho từng option. `aria-label` và tooltip là giá trị CSS. Các dải còn chữ tiếng Việt (`border-style` "liền gạch", `flex-wrap` "xuống dòng một dòng") đổi sang giá trị CSS.
- [ ] `Inspector.tsx`:
  - `align-items`, `justify-content`, `flex-direction` dùng icon;
  - `display` chỉ còn `block` / `flex` / `grid` / `none`, các giá trị khác vào menu "…".
- [ ] e2e: chọn được bằng `getByRole('radio', { name: 'center' })` trong hàng `align-items`.

## Task 6 — Kiểm tổng

- [ ] Chụp ảnh Inspector ở 300px và 520px, đặt cạnh ảnh Framer user gửi, đối chiếu bốn vấn đề ở spec §1.
- [ ] `pnpm verify`, rồi cả bộ e2e (đóng bớt ứng dụng trước; nếu máy vẫn thiếu RAM thì chạy
  theo nhóm như CI).
- [ ] Ghi vào HANDOFF: tay kéo, `TokenPicker`, bảng nhãn — ba chỗ người sau cần biết khi thêm thuộc tính mới.
