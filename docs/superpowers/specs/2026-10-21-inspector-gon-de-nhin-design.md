# Inspector gọn, dễ nhìn — sidebar kéo giãn, hàng thẳng, chọn màu có ô xem trước — thiết kế

Ngày 21/10/2026 · nhánh đề xuất `feat/inspector-gon` (tách từ `feat/cai-dat-site`) · trạng thái: **chờ duyệt**

## 1. Mục tiêu

User so Inspector (cột phải của editor) với Framer và nêu bốn vấn đề (21/10/2026):

1. **Sidebar không kéo giãn được.** Cần có min width, max width, và kéo được.
2. **Các ô nhập và ô chọn bị lệch nhau.**
3. **Chọn màu không có ô xem trước**, nên không biết màu đó trông ra sao.
4. **Các lựa chọn to, nhiều thông tin, khó hiểu.**

Thành công nghĩa là:

- Kéo mép trái của sidebar để đổi bề rộng. Bề rộng nằm trong khoảng **280–560px**, được nhớ
  qua lần tải lại, và bấm đúp vào tay kéo thì về mặc định.
- Ở mọi hàng thuộc tính, **nhãn bắt đầu cùng một cột, ô điều khiển bắt đầu cùng một cột và
  kết thúc cùng một mép phải**. Mọi ô cao bằng nhau (28px).
- Danh sách token **không bao giờ tràn quá ô chọn**: nó là một popover gọn ngay dưới ô (tối
  đa ~320px, có ô tìm), không còn là `<select>` gốc của trình duyệt. Token màu có **ô màu tròn**
  ở mỗi dòng.
- Mỗi ô chỉ liệt kê token **đúng loại**. Ô `gap` chỉ có `space-*`. Ô rộng/cao chỉ có
  `space-*` và `measure`. Không ô nào liệt kê đủ 469 token như hôm nay.
- Nhãn **giữ tên CSS** như hôm nay (user chốt 21/10/2026). Cái "khó hiểu" nằm ở các dải nút
  chữ và danh sách token, không ở nhãn — xem D8, D9.

## 2. Hiện trạng — vì sao nó như vậy

| Vấn đề | Nguyên nhân trong code |
|---|---|
| Không kéo giãn | `--shell-right: clamp(300px, 21vw, 560px)` (`builder.css:392`), gán thẳng vào grid ở `EditorShell.tsx:661` và `ComponentEditorShell.tsx:158`. Không có tay kéo, không lưu bề rộng. |
| Lệch hàng | `ROW = grid-cols-[8rem_1fr]` (`controls.tsx:91`), nhưng: (a) `SegmentedControl` có hơn 4 lựa chọn thì bỏ cột nhãn, nên bắt đầu ở x=0 (`:966`); (b) dải nút cao 24px, còn ô nhập cao 28px; (c) bên phải, `LenControl` gồm ô nhập cộng `<select>` 3.75rem cách `gap-1`, `ColorControl` gồm ô màu cộng ô nhập cách `gap-1.5`, còn `SelectControl` là một ô nguyên — mép chữ và mép phải không trùng nhau. |
| Dropdown khổng lồ | Ô đơn vị của `LenControl` là `<select>` gốc có `optgroup` (`controls.tsx:676-708`). Chrome trên Windows tự vẽ nó to cả màn hình, mình không style được. |
| Không thấy màu | Gợi ý token màu là `<datalist>` gốc (`controls.tsx:847`), không có ô màu. Lưới ô màu chỉ có trong `ColorPopover` khi bấm vào ô màu nhỏ — người dùng không biết đường đó. |
| Liệt kê mọi token | `tokenOptions` chỉ lọc khi có `tokenCategory` (`controls.tsx:422`). Ô rộng/cao/min/max, `tracking`, `border-width`, `blur` không truyền loại nào, nên liệt kê toàn bộ token. |
| Nhãn khó hiểu | `labelFor` → `cssLabel` trả tên CSS logic (`inline-size`, `padding-block-start`) — `style-css-map.ts:251`. Dải nút dùng chữ ("đầu giữa cuối giãn chân chữ"). |

## 3. Quyết định

| # | Câu hỏi | Chọn | Vì sao |
|---|---|---|---|
| D1 | Dùng thư viện gì? | **Radix UI Primitives**: `@radix-ui/react-popover` và `@radix-ui/react-tooltip`. Không dùng UI kit (MUI, Chakra, Mantine). | Radix không kèm giao diện, nên style bằng token của builder. Nó có thứ `Popover` tự viết đang thiếu: **portal** (Inspector có `overflow-hidden`, popover tuyệt đối bị cắt), **tự lật** khi đụng mép màn, và đo vị trí. UI kit thì mang giao diện riêng, đánh nhau với design system. |
| D2 | Bề rộng sidebar | 280–560px, mặc định giữ `clamp(300px, 21vw, 560px)` khi chưa kéo. Lưu trong `localStorage` qua `persisted.ts` (khoá `rightWidth`). | Cùng cơ chế với `leftCollapsed` đang có. Lưu theo trình duyệt chứ không theo tài khoản: bề rộng phụ thuộc màn hình, không phụ thuộc người. |
| D3 | Lưới hàng | Một lưới cho MỌI hàng: cột nhãn `minmax(4.5rem, 36%)`, cột ô `1fr`, `gap-x-2`, căn giữa theo chiều dọc. Bỏ chế độ "wide" của `SegmentedControl`. | Nhãn theo tỉ lệ (như Framer): sidebar kéo rộng thì ô rộng ra, nhãn không chiếm chỗ vô ích. Mọi control nằm ở cột phải là điều kiện để thẳng hàng. |
| D4 | Ô có đơn vị | Đơn vị thành **hậu tố bên trong ô nhập** (`24 px ▾`), bấm hậu tố thì mở popover chọn đơn vị/token. Một ô duy nhất, không còn hai ô cạnh nhau. | Mép phải của mọi ô trùng nhau. Framer cũng làm vậy (`Rel ▾`, `Fixed ▾`). |
| D5 | Ô màu | Ô màu nằm **bên trong ô nhập** (đầu ô). Bấm vào bất kỳ đâu trong ô thì mở popover: ô tìm, danh sách token có **ô màu tròn + tên + mã**, rồi bộ chọn màu tự do. Bỏ `<datalist>`. | Một đường duy nhất, và luôn thấy màu. |
| D6 | Popover token dùng chung | Một component `TokenPicker`: ô tìm, nhóm (Đơn vị / Từ khoá / Token), tối đa ~320px, cuộn bên trong, phím lên xuống và Enter dùng được. Đơn vị hiện thành **một hàng chip** (`px rem % vw …`) ở đầu, không chiếm mỗi đơn vị một dòng. | Giải quyết cả dropdown khổng lồ lẫn "quá nhiều thông tin". |
| D7 | Lọc token theo loại | Mọi ô phải khai loại token. Rộng/cao/min/max → `space` + `measure`. `tracking` → token `tracking-*`. `border-width`, `blur` → không có token (chỉ đơn vị). Ô nào không khai loại thì không hiện token, không còn hiện tất cả. | Hôm nay ô rộng liệt kê `dur-*`, `ease-*`, màu… — vô nghĩa và là nguồn chính của "quá nhiều thông tin". |
| D8 | Nhãn | **Giữ tên CSS** (`inline-size`, `align-items`) — user chốt 21/10/2026. Nhãn dài bị cắt bằng `…` trong cột nhãn, tooltip (Radix) hiện đủ tên và tên vật lý (`inline-size · width`). | Không đổi thứ người dùng đã quen; tooltip chỉ bổ sung khi nhãn bị cắt. |
| D9 | Dải nút | Căn chỉnh (`align-items`, `justify-content`, `flex-direction`) dùng **icon**, tooltip là giá trị CSS (`center`, `space-between`). `display` hiện 4 giá trị hay dùng (`block`, `flex`, `grid`, `none`), các giá trị còn lại vào menu "…". Các dải khác đổi chữ tiếng Việt ("đầu giữa cuối", "liền gạch") sang giá trị CSS ngắn. Mọi dải nút cao 28px. | Nhãn là tên CSS thì lựa chọn cũng nên là giá trị CSS — một ngôn ngữ. Năm chữ chen trong một hàng là chỗ khó hiểu nhất trong ảnh user gửi; icon nhìn là hiểu. |

## 4. Ngoài phạm vi

- Ô Position dạng hộp kiểu Framer, và hàng nút căn nhanh ở đầu panel.
- Kéo giãn sidebar TRÁI (hôm nay chỉ thu gọn thành rail).
- Đổi cấu trúc nhóm (Bố cục / Kích thước / Chữ / Nền & viền / Hiệu ứng).
- Theme sáng riêng cho Inspector.

## 5. Thiết kế

### 5.1 Sidebar kéo giãn

- Tay kéo `PaneResizer` nằm ở mép trái `<aside>` Inspector: dải 6px, con trỏ `col-resize`,
  hover hiện vạch màu nhấn. `role="separator"`, `aria-orientation="vertical"`,
  `aria-valuemin/max/now`. Phím ←/→ đổi 16px, Shift + phím đổi 64px.
- Kéo bằng pointer events + `setPointerCapture`. Trong lúc kéo chỉ đổi biến CSS `--shell-right`
  trên khung editor (không re-render React). Thả tay mới ghi vào `localStorage`.
- Kẹp `[280, min(560, 45vw)]` — vế 45vw để canvas không bao giờ bị ép còn quá hẹp.
- Bấm đúp: xoá giá trị đã lưu, về `clamp(...)` mặc định.
- Dùng ở cả `EditorShell` và `ComponentEditorShell`, cùng khoá lưu trữ.

### 5.2 Lưới hàng chung

`controls.tsx`: thay `ROW` bằng một container query trên thân Inspector:

```
ROW = 'grid grid-cols-[minmax(4.5rem,36%)_minmax(0,1fr)] items-center gap-x-2 min-h-control-sm'
```

- Dòng phụ (giá trị token đã giải, lỗi) đặt ở **hàng thứ hai của lưới, cột 2** (`col-start-2`),
  để không đẩy nhãn lệch khỏi ô.
- Chấm "có giá trị", nút ×, chip "kế thừa" nằm trong cột nhãn, căn giữa dọc cùng chữ.
- `SegmentedControl` luôn ở cột 2. Item cao `h-control-sm` (28px).
- Mọi ô nhập dùng `ui.fieldSm` (28px). Bỏ viền, dùng nền `shell-raised` như Framer; focus thì
  hiện viền màu nhấn.

### 5.3 `TokenPicker` (Radix Popover)

```tsx
<TokenPicker
  anchor={...}               // ô nhập
  units={['px','rem','%',…]} // hàng chip; rỗng = không có
  keywords={['auto','full']}
  tokens={tokensOfKind}      // đã lọc theo D7
  kind="color" | "length"
  value={…}
  onPick={(v) => …}
/>
```

- `Popover.Portal` + `collisionPadding={8}`, `align="end"`, rộng bằng ô (tối thiểu 220px).
- Ô tìm đặt ở đầu. Gõ thì lọc theo tên token và giá trị. Lên/xuống để chọn, Enter để áp, Esc để đóng.
- Dòng token: `kind=color` → ô màu tròn 14px (màu giải bằng `resolveTokenColor`, ô nền bàn cờ
  cho màu trong suốt) + tên + mã nhỏ. `kind=length` → tên + giá trị nhỏ, rút gọn `clamp(...)`
  thành "co giãn 1.15–3.5rem".
- Token đang chọn có dấu ✓.

### 5.4 `LenControl` và `ColorControl`

- `LenControl`: `[ ô số ............ px ▾ ]` — hậu tố là nút mở `TokenPicker`. Khi giá trị là
  token, ô hiện tên token (chữ màu nhấn) thay cho số, hậu tố hiện "token".
- `ColorControl`: `[ ● color-ink-raised ........ ]`. Bấm vào ô thì mở `TokenPicker kind=color`,
  bên dưới danh sách có `ColorPickerPanel` (react-colorful, đã có) cho màu tự do và nút "Tạo
  token từ màu này" (luồng đang có của `ColorPopover`). Bỏ `<datalist>`.

### 5.5 Nhãn và tooltip

- Nhãn giữ nguyên `cssLabel` (tên CSS logic). Cột nhãn `truncate`, nên `min-inline-size` ở
  sidebar hẹp thành `min-inline-s…`.
- `Label` bọc chữ trong `Tooltip` (Radix, `delayDuration=400`): "`inline-size` · width". Thay
  cho thuộc tính `title` hiện tại (hiện chậm và không style được).

### 5.6 Icon cho dải căn chỉnh

Thêm icon vào `ui/Icon.tsx` (SVG 16px, stroke theo màu chữ): `align-start/center/end/stretch/
baseline`, `justify-start/center/end/between/around`, `dir-row/column/row-reverse/
column-reverse`. Mỗi item có `aria-label` và tooltip là giá trị CSS (`flex-start`, `center`…).

## 6. Rủi ro

| Rủi ro | Chặn bằng |
|---|---|
| Spec e2e đang tìm `<select>` theo label hoặc `selectOption` trên ô đơn vị | Rà `e2e/inspector*.spec.ts`, `style-hidden.spec.ts`, `instance-ui.spec.ts`. Thêm helper `pickToken(page, field, name)` và sửa các chỗ dùng. |
| Đổi lưới làm vỡ `BoxModel` (8 ô gọn) | `BoxModel` dùng chế độ `compact` của `LenControl`, không đi qua `ROW`. Kiểm bằng ảnh chụp trước/sau. |
| Popover trong portal mất theme (`data-theme` nằm ở `<html>`) | Portal gắn vào `document.body`, vẫn nằm dưới `<html data-theme>`, nên biến màu vẫn đúng. |
| Kéo sidebar giật khi canvas đo lại | Trong lúc kéo chỉ đổi biến CSS. Canvas đã có `ResizeObserver`, nó tự đo khi thả tay. |
| Thêm 2 package | Pin phiên bản chính xác. Bundle chỉ tăng ở route editor (client). |
