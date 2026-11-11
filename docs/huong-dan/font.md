# Font

Font của site nằm trong **kho font** của builder (*Cài đặt › Font*), không nằm trong gói dự án.
Inter của lõi luôn có sẵn và chỉ đọc; mọi họ khác do người biên tập thêm.

## Thêm font

**Tải file.** *Cài đặt › Font › Tải file font*: chọn TTF, OTF hoặc WOFF2 (tối đa 10 MB; cắt và đổi định dạng quá 30 giây thì bị từ chối với lỗi `too_large`), kiểm tên
họ, weight, kiểu chữ, rồi **tick xác nhận bạn có giấy phép dùng font trên web**. Không tick thì không
lưu được. Builder cắt bớt glyph, đổi sang WOFF2 và báo cảnh báo nếu file thiếu chữ tiếng Việt có dấu
hoặc cờ nhúng (`fsType`) cấm dùng trên web.

**Nhập từ Google Fonts.** *Nhập từ Google Fonts*: dán tên họ hoặc link `fonts.google.com/specimen/…`,
chọn weight, bấm nhập. Họ từ Google (giấy phép OFL) không đòi tick giấy phép.

Mỗi họ có một **token** dạng `font-<tên>` — dùng ở Inspector.

## Gán font cho chữ

Chọn phần tử chữ → Inspector → mục Typography → **Font**: chọn họ trong danh sách. Giá trị lưu là
`typography.family: {"$token": "font-<tên>"}`. Bản nháp và canvas thấy font ngay.

## Lên site thật chỉ sau Publish

Release là ảnh chụp **niêm phong** của cả site, kể cả font. Thêm, thay hay xoá font ở kho **không đổi
site đang chạy** cho tới khi bấm Publish. Lùi bản cũ thì font cũ quay lại cùng bản đó. File font
phục vụ ở `/mm-font/…`, URL có hash nên cache `immutable`.

## Xoá font

- **Xoá họ** bị khoá khi còn trang hay component dùng token của họ đó (nút mờ, kèm lý do). Gỡ họ
  khỏi các chỗ đó trước.
- **Xoá một face** xoá được bình thường, trừ **face cuối** của một họ đang được dùng.
- Xoá xong vẫn cần Publish; bản đã publish giữ font đến lúc đó.

## Nhờ Claude

Claude có hai tool: `list_fonts` (xem kho, token, chỗ đang dùng) và `upload_font` (từ `filePath` trên
máy bạn, `sourceUrl`, hoặc `google`). **Claude phải hỏi bạn về giấy phép** ("bạn có quyền dùng font này
trên web không?") và chỉ đặt `licenseConfirmed: true` khi bạn đã trả lời có. `filePath` chỉ chạy qua
MCP server trên máy bạn, không qua HTTP. Claude không Publish được.

---

## Dành cho người vận hành

### Chuyển font của gói cũ vào kho (một lần mỗi môi trường)

Làm lần lượt, ở từng môi trường (dev, staging, production):

1. **Deploy** bản có tính năng font, **kèm migration**, trước khi ai Publish. Publish sớm hơn sẽ
   niêm phong release không có font và chữ rơi về font dự phòng.
2. `pnpm fonts:adopt --actor <email>` — chỉ in kế hoạch (đọc các khối `@font-face` trong
   `projects/<gói>/styles/fonts.css`); xem kỹ, rồi chạy lại với `--apply` để ghi vào kho.
3. **Khởi động lại app**: script không làm mới được cache của tiến trình
   đang chạy, nên builder chưa thấy font mới ngay.
4. Kiểm canvas: chữ dùng font gói hiển thị đúng ở bản nháp.
5. **Publish.**
6. Ở repo gói: xoá các khối `@font-face` trong `styles/fonts.css` (giữ khối `:root`) và thư mục
   `public/fonts/`, deploy gói. Kiểm DevTools không còn request `/p/fonts/`.

Quy ước: gói dự án không mang file font hay `@font-face`; font thêm ở Cài đặt › Font.

### Kiểm bản standalone (chưa chạy tự động)

Việc cắt font chạy bằng `subset-font` trong một worker. Bản `output: 'standalone'` phải mang theo
module này và file `.wasm` của nó. Sau khi dựng image:

1. `pnpm docker:build`, rồi chép `.next/standalone` ra thư mục khác.
2. Xác nhận `.next/standalone/node_modules` có `subset-font`, `fontverter`, `p-limit`,
   `harfbuzzjs` (gồm `dist/harfbuzz-subset.wasm`). Thiếu `.wasm` thì sửa
   `outputFileTracingIncludes` cho `/api/fonts/**` và `/api/ai/tool` trong `next.config.mjs`.
3. Chạy server từ bản đã chép (`node server.js`, đúng `PORT`, `DATABASE_URL`, `AUTH_SECRET`).
4. `curl -b <cookie phiên admin> -F file=@x.ttf -F licenseConfirmed=true http://localhost:<port>/api/fonts`
   → HTTP 200, JSON có face đã chuyển với `unicodeRange` khác rỗng.
5. Lặp lại với một file `.woff2`: cũng 200.
6. Dọn: `DELETE /api/fonts/<id>` cho họ vừa thêm.
