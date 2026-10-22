# Design system — vỏ builder (giao diện v2)

Tài liệu chuẩn cho giao diện **vỏ builder** (`src/app/(builder)`, `src/components/builder`).
Nguồn sự thật của mọi giá trị là `src/styles/builder.css`; bản tham chiếu đầy đủ (token, 29
component có bản xem trước, logo, luật dùng) là design system **"Quilder UI"**
(https://claude.ai/artifact/Qmb5fd9fWnoFKqXDGs6w6T), bản vẽ từng màn ở canvas "Builder
redesign" (https://claude.ai/artifact/8Xh2id9b4nq5VdD6UmP2nu). Hai chỗ lệch nhau thì **CSS
đúng**, sửa file này. Giao diện cũ (v1, nền tối ám tím) giữ ở tag git `ui-v1`.

> **Hai thế giới, không trộn.** Vỏ builder dùng Tailwind + token `shell-*`. Website được
> sinh ra dùng `src/styles/tokens.css` + CSS compiler, **không** Tailwind (Tailwind chỉ
> quét `app/(builder)` và `components/builder` — xem đầu `builder.css`). Không dùng token
> website trong vỏ, không viết class Tailwind trong `src/lib/render`.

---

## 1. Nguyên tắc

1. **Token theo vai trò, không theo giá trị.** Viết `text-shell-muted`, không viết
   `text-gray-400` hay `text-[#999]`. Palette Tailwind mặc định (`gray`, `amber`,
   `emerald`…) và `white`/`black` **cấm** trong vỏ — chúng không lật theo theme.
2. **Một nguồn cho sáng/tối.** Theme SÁNG là gốc (`@theme`); theme tối ghi đè biến
   `--color-shell-*` ở hai khối (`[data-theme='dark']` và `@media` cho `system`). Không dùng
   biến thể `dark:`. Thêm token mới: khai ở `@theme` và, nếu tối khác sáng, ở **cả hai** khối tối.
3. **Nền lùi, thẻ nổi.** Ba lớp: `shell-bg` (nền) → `shell-panel` (thanh menu, thẻ, dialog)
   → `shell-raised` (hàng hover, ô lồng). Thẻ nổi trên nền bằng `shadow-shell-card`; bên trong
   một panel chia nhóm bằng `shell-raised`, không chồng thêm bóng.
4. **Mọi kích thước bằng `rem`.** `:root` đổi 16 → 17 → 18px ở 1680/2100px; cả vỏ giãn
   theo một cần. Không `text-[11px]`, không `w-[260px]` cho thứ có chữ bên trong.
5. **Trạng thái luôn có tên.** Đang lưu / đã lưu / lỗi là ba trạng thái riêng
   (`SaveState`), không phải hai boolean. Nút phá hoại nói hậu quả trong nhãn. Màu trạng thái
   luôn đi kèm chữ.

---

## 2. Màu

### 2.1 Bề mặt và chữ

| Token | Vai trò |
|---|---|
| `shell-bg` | Nền trang, sau thanh menu và thẻ |
| `shell-panel` | Thanh menu, panel, thẻ, dialog, menu bật lên |
| `shell-raised` | Hàng hover, nền nhóm Tabs, ô lồng trong panel |
| `shell-line` | Vách ngăn không mang nghĩa (giữa hàng bảng, chân thẻ) |
| `shell-line-strong` | Viền **control**: ô nhập, checkbox, switch tắt (≥3:1) |
| `shell-ink` / `shell-muted` | Chữ chính / nhãn, metadata, placeholder. Không nhạt hơn `shell-muted` |
| `canvas-bg` / `canvas-grid` / `canvas-grid-major` | Mặt bàn canvas của editor |
| `shell-paper` / `shell-paper-ink` | Giấy của trang đang soạn (không đổi theo theme) |

### 2.2 Accent và trạng thái

| Token | Nghĩa | Dùng cho |
|---|---|---|
| `shell-accent` + `shell-on-accent` | Hành động chính, đang chọn, link, focus | một nút chính mỗi vùng, mục menu đang mở |
| `shell-accent-soft` | Nền sau chữ accent | mục đang chọn, hàng đang chọn, thanh chọn nhiều |
| `shell-ok` / `-soft` | Thành công, đang chạy, đã lưu, đã đăng | Badge `ok` |
| `shell-warn` / `-soft` | Vẫn chạy nhưng nên biết | có thay đổi chưa publish, hẹn giờ, giá trị bị đè |
| `shell-danger` / `-soft` + `shell-on-danger` | Lỗi, phá huỷ | nút xoá, khối hậu quả, nút xác nhận phá |
| `shell-hero` / `shell-on-hero` / `shell-hero-muted` | Thẻ nổi duy nhất trong lưới | Trang chủ trên màn Trang, release đang chạy |
| `shell-backdrop` | Lớp phủ sau dialog | `backdrop:bg-shell-backdrop` |

Nền nhạt của trạng thái dùng token `*-soft`, không phải độ mờ của màu chữ.

### 2.3 Màu theo nội dung

- `tint-*` (blue, teal, amber, violet, rose) + `tint-*-ink`: ô chữ cái đầu của thẻ, xoay vòng
  theo thứ tự (`tintAt(i)` trong `lib/builder/ui.ts`).
- `folder-*`: icon thư mục trong Thư viện. `kind-*` + `kind-label`: tờ giấy theo đuôi file.
- `node-image`, `node-button`, `node-code`: chỉ trong cây lớp. Không dùng làm màu trạng thái.

### 2.4 Bóng

`shadow-shell-card` (thẻ, panel), `shadow-shell-card-hover` (thẻ bấm được khi hover),
`shadow-shell-pop` (menu, popover, dialog, toast), `shadow-shell-dock` (dock nổi). Không đặt
bóng `rgba(...)` cứng.

---

## 3. Chữ

Font: `font-shell` = **Be Vietnam Pro** (tự host qua `@fontsource`, nạp ở `(builder)/layout.tsx`);
`font-shell-mono` = JetBrains Mono cho id, slug, khoá, đường dẫn, email, số đo, phím tắt —
**không** cho nhãn nút hay câu chữ.

| Class | Cỡ | Vai trò |
|---|---|---|
| `text-page` (700) | 30px | Tiêu đề màn — một lần mỗi màn, số đếm trong ngoặc màu muted |
| `text-section` (600) | 18px | Tiêu đề nhóm trong màn, tiêu đề dialog |
| `text-card` (600) | 16px | Tên trên thẻ |
| `text-ui` | 14px | Nhãn nút, mục menu, tab, đoạn văn trong dialog |
| `text-small` | 13px | Nội dung bảng và panel, metadata trên thẻ |
| `text-mini` | 12px | Nhãn ô, chip, chú thích |
| `text-micro` | 11px | Nhãn nhóm viết hoa (`ui.eyebrow`), badge nhỏ |

- `text-xs` ≡ `text-small`, `text-sm` ≡ `text-ui` (được ghim trong `@theme`). Code mới viết tên
  theo vai trò. **Cấm** `text-[Npx]`.
- `cn()` (`lib/builder/cn.ts`) đã dạy `tailwind-merge` thang chữ này — đừng dùng `twMerge` trần,
  nó sẽ xoá `text-micro` khi gộp với một class màu.

---

## 4. Khoảng cách, bo góc, bố cục

### 4.1 Bo góc (thang Tailwind đã ánh xạ lại trong `@theme`)

| Class | Giá trị | Dùng cho |
|---|---|---|
| `rounded-sm` | 6px | phím tắt, control 28px trong panel editor |
| `rounded` | 10px | nút icon, mục menu, chip vuông, ô nhập 36px |
| `rounded-md` | 12px | nút, ô nhập 44px, ô chữ cái đầu |
| `rounded-lg` | 20px | thẻ, dialog, popover, dock, khối hậu quả |
| `rounded-xl` | 22px | panel lớn của vỏ: thanh menu, cây thư mục, Inspector |
| `rounded-full` | — | badge, avatar, thanh tiến độ, switch |

### 4.2 Mật độ và chiều cao control

- **Dashboard** (Trang, Văn bản, Kho dữ liệu, Component, Thư viện, Cài đặt, Lịch sử publish,
  Tài khoản): control `h-control-lg` (44px), chữ `text-ui`.
- **Thanh công cụ**: `h-control-md` (36px). **Panel editor** (Inspector, cây lớp): `h-control-sm`
  (28px), chữ `text-small`. Vùng bấm không nhỏ hơn 28px; điều hướng chính không nhỏ hơn 44px.

### 4.3 Khung vỏ và bề rộng

| Biến / utility | Giá trị | Dùng cho |
|---|---|---|
| `--shell-gutter` | 0.75rem | Lề quanh khung vỏ |
| `--shell-nav` | 2 × gutter | Phần màn KHÔNG thuộc về trang (editor trừ ra khỏi `100svh`) |
| `--shell-sidebar` / `--shell-rail` | 15.5rem / 4.75rem | Thanh menu đầy đủ / rail chỉ icon (Thư viện, editor) |
| `--shell-left` / `--shell-right` | clamp | Pane trái / Inspector của editor |
| `shell-page` / `-wide` / `-narrow` | có trần | Trang không canvas / bảng nhiều cột / một cột văn bản |

Thanh menu dọc bên trái (`BuilderNav`), thu thành rail ở route rộng (`isWideRoute`). Trên điện
thoại thanh nằm ngang ở trên. Lưới thẻ: `repeat(auto-fill, minmax(250px, 1fr))` cho thẻ trang và
component, `minmax(190px, 1fr)` cho thẻ thư mục và file. Bảng rộng nằm trong khung
`overflow-x-auto` của riêng nó.

---

## 5. Trạng thái tương tác

| Trạng thái | Chuẩn |
|---|---|
| Hover (hàng, mục menu, nút phụ) | `hover:bg-shell-raised` |
| Hover (thẻ bấm được) | `ui.cardHover`: nhấc 2px + `shadow-shell-card-hover`, tắt khi reduced-motion |
| Focus bàn phím | `focusRing`: viền 2px liền `shell-accent`, cách 2px |
| Focus trong ô nhập | viền `shell-accent` + `ring-3 ring-shell-accent-soft` (có sẵn trong `ui.field*`) |
| Disabled | `disabled:opacity-40` + `disabled:cursor-not-allowed`, có lý do bằng chữ gần đó |
| Đang chọn | `bg-shell-accent-soft text-shell-accent`, hoặc viền 2px `shell-accent` cho thẻ |
| Đang tải nội dung có hình dạng (ảnh, lưới, dòng tên) | `Skeleton` / utility `shell-skeleton`: khung đúng hình, dải sáng chạy qua, tĩnh khi reduced-motion. **Không in chữ "đang nạp…"** |
| Đang chạy một hành động (lưu, tải lên, publish) | `Button loading` (Spinner trong nút) — chữ trên nút nói việc đang làm |
| Đang chuyển trang (bấm link, `router.push`) | Link vừa bấm báo chờ ngay (`LinkIcon` / `useLinkStatus`: nền hover, icon thành spinner sau `--shell-pending-delay` 120ms); cùng nhịp đó thanh `NavProgress` (`shell-accent`) chạy ở mép trên tới khi trang thật hiện; URL vừa đổi thì `loading.tsx` vẽ `RouteSkeleton` đúng hình màn đích. **Không khoá link** — bấm lặp vào đích đang mở đã bị `NavProgress` bỏ qua |

Mọi thứ hiện khi hover (`group-hover:`) phải có cặp `group-focus-within:` cho bàn phím.

Thêm màn builder mới: thêm một nhánh hình khung ở `lib/builder/route-shape.ts`; nếu đoạn route
đó có route CON thì thêm `loading.tsx` một dòng `<RouteSkeleton />` (lý do: `builder/loading.tsx`).

Ảnh của kho luôn vẽ qua `AssetThumb` / `ImageThumb` (`asset/AssetThumb.tsx`): khung shimmer tới
khi ảnh vẽ xong rồi ảnh hiện dần lên; ảnh lỗi thì gỡ shimmer, không để khung "sắp có" mãi.

---

## 6. Component

Dựng sẵn ở `src/components/builder/ui/`; công thức class cho markup tay ở `lib/builder/ui.ts`;
nút viết tay dùng `btn.*` (`lib/builder/btn.ts`). Tách thành component khi một mẫu lặp lại ≥ 3 lần.

| Cần | Dùng |
|---|---|
| Nút có chữ | `Button` / `ButtonLink` (`variant` primary · secondary · ghost · danger · danger-solid, `size` sm · md · lg) |
| Nút chỉ icon | `IconButton` (`label` bắt buộc → `aria-label` + `title`) |
| Trạng thái | `Badge` (`tone` neutral · accent · ok · warn · danger, `dot`) |
| Lọc danh sách có số đếm | `Tabs` (`role="group"` + `aria-pressed`) |
| Đầu màn | `PageShell` + `PageHeader` (hoặc `PageHead` cũ đã đổi hình), `Breadcrumb`, `Section` |
| Rỗng | `EmptyState` |
| Ô nhập | `TextField`, `TextArea`, `SearchField`, `SelectField`, `Checkbox`, `Switch` |
| Lớp nổi | `Dialog`, `ConfirmDialog` (+ `Consequence`), `MenuButton`/`MenuList`, `Toast`/`ToastRegion` |
| Nhỏ khác | `Icon`, `Kbd`, `Avatar`, `Progress`, `Tile`, `Spinner`, `Skeleton`, `Note`, `LinkIcon` (icon trong `<Link>`, báo đang chờ) |
| Khung cả màn khi tải | `SkeletonPage` + `SkeletonHeader` + `SkeletonText` (cùng hộp với `PageShell`/`PageHeader`) — chỉ dùng trong `RouteSkeleton` |

- Nhãn nút là **động từ + đối tượng**: `Publish trang này`, `Xoá 3 ảnh`, `Tải file lên`.
- Một nút `primary` mỗi vùng. Nút phá hoại nói hậu quả: `Xoá vĩnh viễn`, không phải `OK`.
- Dialog dùng `<dialog>` + `showModal()`; tiêu đề `text-section`, hàng nút căn phải, nút chính
  ngoài cùng bên phải. Hành động không lùi được dùng `ConfirmDialog`: hậu quả bằng con số thật,
  bắt gõ lại tên khi xoá thứ có tên.
- Chip trạng thái lưu dùng `<SaveChip>` — không tự dựng.

---

## 7. Icon

- **Không thêm thư viện icon.** Bộ icon ở `ui/Icon.tsx` (cùng tên với `MMB.Icon` của design
  system): lưới 24, nét `currentColor` 1.8 (2 ở cỡ ≤16px), đầu nét tròn, `aria-hidden`.
- Màu do phần tử cha quyết định. Icon-only luôn kèm `aria-label` + `title` (`IconButton` lo việc này).
- Logo: `public/brand/quilder-symbol-white.svg` và `quilder-wordmark-white.svg`, một màu trắng —
  chỉ đặt trên `shell-accent` hoặc `shell-hero`.

---

## 8. Chữ trên giao diện

- Tiếng Việt, câu ngắn. Chip trạng thái viết thường đầu câu: `đang lưu…`, `đã lưu · v41`,
  `nháp`, `đang chạy`. Tiêu đề và nhãn nút viết hoa chữ đầu.
- Dấu `·` ngăn các mảnh thông tin cùng hàng; `…` (một ký tự) cho trạng thái đang chạy.
- Thuật ngữ giữ tiếng Anh khi đó là tên tính năng: Publish, component, node, slug, release.
- Số đếm nói đúng thứ nó đếm: `3 lần sửa chưa publish`, không phải `3 thay đổi`.
- Lỗi nói **chuyện gì xảy ra + làm gì tiếp**, không chỉ `Lỗi`. Không emoji.

---

## 9. Khả năng truy cập

- Vùng bấm tối thiểu 28px trong panel dày đặc; 44px cho điều hướng chính.
- Mọi thứ bấm được là `<button>`/`<a>`, không phải `div onClick`. Không lồng nút trong nút.
- Tương phản: chữ 4.5:1 trên nền của nó ở cả hai theme; viền control, icon mang nghĩa, vòng
  focus 3:1. `shell-muted` trên `shell-panel` là mức thấp nhất cho chữ.
- Không truyền đạt trạng thái chỉ bằng màu: kèm chữ hoặc icon.
- Kiểm cả **sáng và tối** trước khi coi là xong.

---

## 10. Checklist review UI

- [ ] Chỉ dùng token (`shell-*`, `canvas-*`, `node-*`, `tint-*`, `folder-*`, `kind-*`) — không `white`, `black`, palette Tailwind, hex
- [ ] Không `text-[Npx]`; cỡ chữ theo vai trò; mono chỉ cho giá trị máy đọc
- [ ] Bo góc, chiều cao control theo §4; dùng component `ui/` thay vì tự dựng lại
- [ ] Có hover, focus-visible, disabled theo §5
- [ ] Nút icon-only có `aria-label` + `title`; nút phá hoại nói hậu quả
- [ ] Token mới khai ở `@theme` và ở cả hai khối tối nếu tối khác sáng
- [ ] Đã xem ở theme sáng và tối, ở 1440 và 2560px, và ở bề rộng điện thoại
