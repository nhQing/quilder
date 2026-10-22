# Dùng builder

Builder ở `/builder`. Thanh menu trái có hai nhóm: **Nội dung** (Trang, Văn bản, Kho dữ liệu,
Component, Thư viện) và **Hệ thống** (Cài đặt, Lịch sử publish, Tài khoản). **Kết nối Claude** nằm
cạnh nút đăng xuất.

`Ctrl+K` ở bất kỳ đâu mở **Tìm chung**: trang, loại nội dung, component trong một danh sách —
mũi tên để chọn, Enter để mở.

---

## 1. Trang

Màn chính `/builder` liệt kê mọi trang:

- **Trang mới** — nhập Tiêu đề và đường dẫn (slug), được một bản nháp trống.
- **Nhập trang** (admin) — nhập một trang từ file `.zip` xuất từ một builder Quilder khác
  (staging → production chẳng hạn), kèm ảnh và component nó dùng.
- Khối **thay đổi chưa publish** — mỗi trang có thay đổi một dòng, mỗi dòng một nút
  **Publish trang này**.
- Lọc: Tất cả / Đang chạy / Có thay đổi / Chưa publish / Lưu trữ.
- Menu "…" của mỗi thẻ: Mở editor, Xem nháp, **Đổi tên** (tiêu đề, đường dẫn, vai của trang),
  Lịch sử (lùi về một phiên bản cũ), **Xuất trang (.zip)**, Hoàn tác lần nhập, **Lưu trữ**.
- Trang trong Lưu trữ có **Khôi phục** và **Xoá hẳn** (gõ lại đường dẫn để xác nhận). Trang 404 là
  trang hệ thống, không lưu trữ được.

## 2. Editor trang

Mở một trang là vào editor: khung xem trước ở giữa, pane trái để chọn và thêm, pane phải
(**Thuộc tính**) để sửa.

### Thanh trên

| Nút | Làm gì |
|---|---|
| Hoàn tác / Làm lại | `Ctrl+Z` / `Ctrl+Shift+Z` |
| Chia sẻ trang | lấy link trang trên site thật |
| **Xem nháp** | mở bản nháp ở tab mới (`/preview/…`), có nút giả lập bề rộng |
| **Publish trang này** | đưa riêng trang này lên site, hỏi xác nhận; nút mờ khi bản nháp trùng bản đang chạy, và ghi số lần sửa chưa publish |

### Pane trái: Lớp · Comp · Ảnh · Trang

- **Lớp** — cây phần tử của trang. Ô tìm (`Ctrl+P`, gõ không dấu cũng được), mở/gập nhánh, ẩn một
  phần tử (phần tử ẩn không lên site), xoá. Thanh dưới cây: **Thêm** (Section, Stack, Grid, Văn
  bản, Nút, Ảnh — chèn sau hoặc vào trong phần tử đang chọn), **Copy link cho AI**
  (`Ctrl+Shift+L`), **Nhân bản** (`Ctrl+D`), Đưa lên / Đưa xuống, **Xoá** (`Delete`).
- **Comp** — component dựng sẵn: **Chèn** (giữ liên kết — sửa component là mọi trang đổi theo),
  **Bản sao** (tách rời thành phần tử thường), **Sửa** (vào chế độ sửa component).
- **Ảnh** — chọn một phần tử Ảnh hoặc Video, rồi bấm một ảnh trong kho để gắn.
- Pane thu gọn được để khung rộng hơn.

Ở đáy khung còn **Thêm component** (có ô tìm) và **Thêm trang**.

### Khung xem trước và breakpoint

Thanh trên khung chọn **khổ màn**: 1920 / 1440 / 1024 / 768 / 320 (thêm hoặc bớt ở "Khổ màn", từ
240 tới 3840px). Mỗi khổ ứng với một **lớp style**:

| Lớp | Từ | Thiết bị |
|---|---|---|
| base | 0 | Mobile — nền, mọi khổ kế thừa |
| sm | 768px | Tablet |
| md | 1024px | Desktop nhỏ |
| lg | 1200px | Desktop |
| xl | 1560px | Desktop lớn |

Sửa style ở khổ nào là ghi vào **lớp của khổ đó**; khổ lớn hơn kế thừa nếu không ghi đè. Huy hiệu
"đang sửa lớp …" luôn nói bạn đang ghi vào lớp nào. **Toàn trang** cho khung cao bằng cả trang (hiệu
ứng cuộn đứng yên) để chọn phần tử ở xa; nút `%` chuyển về cỡ thật 100%.

Bấm link hay nút trong khung là **chọn** nó, không đi theo link.

### Pane phải: Thuộc tính

- Tên phần tử, loại, id; ngôn ngữ đang sửa.
- Nội dung (chữ, nhãn nút, link, ảnh…).
- Dải **Lớp override**: lớp nào đang ghi đè gì, gỡ từng ô được.
- Ô **Tìm thuộc tính**, rồi các nhóm: **Bố cục, Kích thước, Khoảng cách, Vị trí, Chữ, Nền & viền,
  Hiệu ứng** (độ mờ, blur, overflow, con trỏ). Mỗi nhóm hiện ô đang có giá trị; bấm thêm để mở ô
  khác. Màu, khoảng cách, cỡ chữ chọn từ **design token** — đổi token là cả site đổi theo.
- Lớp Tailwind và **CSS riêng** (`&:hover { … }`) cho thứ ô không làm được.
- **Lặp theo** — dựng một khối lặp theo bài viết trong Kho dữ liệu (xem [Kho dữ liệu](kho-du-lieu.md)).
- **Trang · SEO & chia sẻ** ở cuối: tiêu đề, mô tả, canonical, ảnh chia sẻ, chặn Google index, xem
  trước kết quả Google và thẻ chia sẻ; mỗi ngôn ngữ một bản.

Hiệu ứng chuyển động (hiện dần khi cuộn, parallax, dải chạy, đếm số…) gắn qua Claude; editor hiện
huy hiệu `fx` trên phần tử đã gắn. Danh sách: `docs/generated/effects.md`.

### Dải dưới

**Văn bản** (bảng chữ của trang này) và **Cảnh báo chất lượng (N)** — danh sách vấn đề builder
tự phát hiện trên trang, bấm một dòng là chọn đúng phần tử đó; cảnh báo không chặn Publish.

### Phím tắt

| Phím | Việc |
|---|---|
| `Ctrl+K` | Tìm chung |
| `Ctrl+P` | Tìm trong cây Lớp |
| `Ctrl+Z` / `Ctrl+Shift+Z` | Hoàn tác / Làm lại |
| `Ctrl+D` | Nhân bản phần tử |
| `Delete` | Xoá phần tử |
| `Ctrl+Shift+L` | Copy link cho AI của phần tử đang chọn |
| `Esc` | Đóng menu, xoá ô tìm |

## 3. Component

Component là một khối dùng lại (đầu trang, chân trang, thẻ…). Sửa một chỗ, mọi trang dùng nó đổi
theo.

- `/builder/components`: **Component mới**, lọc theo nhóm. Thẻ ghi "Có sẵn" (trích tự động) hoặc
  "Tự tạo"; menu: Mở canvas, Xem chi tiết, Nhân bản.
- Trang chi tiết: xem trước, **Trang cha ghi đè được gì**, cây phần tử, **Đang dùng ở** trang nào,
  thông tin (tên, nhóm, mô tả cho AI), lịch sử, xoá (component "Có sẵn" không xoá được — nhân bản
  rồi sửa bản sao).
- Trong một trang, chọn một **instance** (chỗ dùng component): **Sửa component** để vào chế độ sửa
  (có băng nhắc thay đổi áp cho mọi trang, và **Quay lại trang**); **Nội dung riêng** để đổi chữ,
  nhãn và link nút, ảnh của RIÊNG trang này. Cấu trúc và style luôn theo component.

## 4. Văn bản — chữ và bản dịch

`/builder/text`: mọi đoạn chữ của một trang trong một bảng — Vị trí, Loại, **Bản gốc** và cột dịch
của ngôn ngữ chọn ở **Cột dịch**.

- Lọc: tất cả, rỗng, chờ nội dung, trùng, quá dài, có cấu trúc, chưa dịch, **cần dịch lại** (bản
  gốc đã đổi sau khi dịch). Tìm gõ không dấu được.
- Sửa bản gốc ở đây là sửa bản nháp trang. Chữ trong component sửa ở đây là **nội dung riêng** của
  trang, không đổi component.
- Ô dịch để trống thì site hiện bản gốc. Chữ có cấu trúc (link, chữ đậm, hiệu ứng tách chữ) sửa
  trong editor.
- Thêm/bật ngôn ngữ ở *Cài đặt → Ngôn ngữ* — xem [Vận hành](van-hanh.md#ngôn-ngữ).

## 5. Thư viện — ảnh và file

`/builder/assets`:

- Cây thư mục: Tất cả file, Chưa phân loại, thư mục của bạn, **Thùng rác**. Menu thư mục: thư mục
  con mới, đổi tên, xoá.
- **Tải file lên**, hoặc kéo file từ máy thả thẳng vào một thư mục. Kéo ảnh sang thư mục khác để
  dời; chọn nhiều rồi **Chuyển thư mục**.
- Lọc Đang dùng / Chưa dùng — biết ảnh nào an toàn để dọn.
- Định dạng: png, jpeg, svg, pdf, mp4, webm, mov, mp3, wav, ogg, m4a, woff, woff2 — tối đa 10 MB.
- Xoá là vào Thùng rác, khôi phục được. Chỉ admin xoá hoàn toàn hoặc dọn sạch thùng rác.

## 6. Lịch sử publish

`/builder/releases`: mọi lần publish, mới nhất trên cùng.

- **Publish toàn site** — đẩy bản nháp của mọi trang cùng lúc.
- **Lùi một bước**, hoặc **Đưa site về bản này** ở một release cũ — tức thì.
- **Xem** — mở đúng site của release đó.

## 7. Cài đặt

Tên site, favicon, ảnh chia sẻ mặc định, nhận diện builder (logo, favicon riêng), biến site
(`globals` — hotline, tên công ty… mà trang trỏ tới), URL nhận dữ liệu của form, ngôn ngữ, giao diện
sáng/tối/theo máy, URL site, SEO mặc định, robots.txt, sitemap. Nút Lưu chỉ sáng khi có thay đổi;
mỗi khối ghi rõ có hiệu lực ngay hay chờ Publish.

---

[← Mục lục](README.md) · [Kho dữ liệu →](kho-du-lieu.md)
