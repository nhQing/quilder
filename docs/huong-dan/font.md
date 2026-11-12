# Font

Font của site nằm ở hai chỗ, cả hai hiện ở *Cài đặt › Font*:

- **Kho font** của builder — họ do người biên tập tải lên hoặc nhập từ Google; sửa, thay, xoá được.
- **Font gốc của gói dự án** — file trong repo gói, chỉ đọc (xem *Font gốc của gói dự án*).

Inter của lõi luôn có sẵn và chỉ đọc.

## Thêm font

**Tải file.** *Cài đặt › Font › Tải file font*: chọn TTF, OTF, WOFF hoặc WOFF2 (tối đa 10 MB; cắt và đổi định dạng quá 30 giây thì bị từ chối với lỗi `too_large`), kiểm tên
họ, weight, kiểu chữ, rồi **tick xác nhận bạn có giấy phép dùng font trên web**. Không tick thì không
lưu được. TTF, OTF và WOFF được cắt bớt glyph và đổi sang WOFF2; WOFF2 giữ nguyên. Builder báo cảnh
báo nếu file thiếu chữ tiếng Việt có dấu hoặc cờ nhúng (`fsType`) cấm dùng trên web. File TTC (nhiều
font trong một file) không nhận: tách thành từng file TTF/OTF trước.

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

- **Xoá họ** bị khoá khi còn trang hay component dùng token của họ đó, hoặc còn **biến CSS nhắc tên
  họ** — một Token khác (ví dụ `lv-font-head: gilroy, …`) hay khai báo `--font-*` trong CSS của gói
  (ví dụ `--font-body: "SF Pro Display", …`). Mục *Chỗ dùng* ghi "dùng bởi biến `--…`". Gỡ họ khỏi
  các chỗ đó trước (Token ở Design system; CSS của gói sửa ở repo gói).
- **Xoá một face** xoá được bình thường, trừ **face cuối** của một họ đang được dùng.
- Xoá xong vẫn cần Publish; bản đã publish giữ font đến lúc đó.

## Font gốc của gói dự án

Gói dự án (`projects/<gói>/`) có thể mang **font gốc**: file nằm trong `public/fonts/` của gói và
được khai `@font-face` trong `styles/fonts.css` (URL dạng `/p/fonts/<file>`). Gói MaiMoney có
SF Pro Display, newYork, gilroy theo cách này.

- **Dùng được ngay.** CSS của gói được biên vào bundle lúc build, nên site và canvas hiển thị font
  gốc mà không cần làm gì thêm. Token trỏ tới chúng (`font-display`, `font-body` gói đè trong
  `:root` của `fonts.css`, hay `font-gilroy`… trong `styles/tokens.css`) chọn được ở Inspector.
- **Builder thấy chúng qua `generated/pack-fonts/<gói>.json`.** Mỗi lần `next dev` / `next build`,
  `next.config.mjs` chạy `scripts/pack-fonts.mjs` quét `styles/fonts.css` + `public/fonts/` và
  ghi file này (không commit; chạy tay: `pnpm fonts:scan`). *Cài đặt › Font* hiện chúng với nhãn
  **Font gốc của gói (chỉ đọc)**, `list_fonts` trả `source: "pack"`, ô chọn font ở Inspector hiện
  đúng tên font site đang dùng. File font có trong `public/fonts/` mà chưa có `@font-face` thì
  chưa dùng được — màn Font cảnh báo, kèm file khai mà thiếu trên đĩa.
- **Không xoá được từ builder.** Không có nút, API, tool MCP hay script nào sửa hoặc xoá file trong
  `projects/`. Tải font trùng tên font gốc bị chặn. Font gốc chỉ mất khi có người sửa repo gói.
- **Muốn bỏ một font gốc:** chạy `pnpm fonts:adopt` (chép nó vào kho — xem *Dành cho người vận
  hành*), Publish, rồi xoá khối `@font-face` trong `styles/fonts.css` và file trong `public/fonts/`
  của repo gói, build lại. Sau khi adopt, dòng font gốc ghi "Đã chuyển vào kho" — lúc đó mới xoá
  file trong gói. Xoá file mà chưa adopt thì chữ rơi về font dự phòng.
- Thêm font gốc mới: chép file vào `public/fonts/`, khai `@font-face` trong `styles/fonts.css`
  của gói, build lại. Ưu tiên WOFF2 — font gốc phục vụ nguyên file, không được cắt như font tải lên.

## Nhờ Claude

Claude có hai tool: `list_fonts` (xem kho, font gốc của gói, token, chỗ đang dùng) và `upload_font` (từ `filePath` trên
máy bạn, `sourceUrl`, hoặc `google`). **Claude phải hỏi bạn về giấy phép** ("bạn có quyền dùng font này
trên web không?") và chỉ đặt `licenseConfirmed: true` khi bạn đã trả lời có. `filePath` chỉ chạy qua
MCP server trên máy bạn, không qua HTTP. Claude không Publish được.

---

## Dành cho người vận hành

### Chuyển font của gói cũ vào kho (một lần mỗi môi trường)

Làm lần lượt, ở từng môi trường (dev, staging, production):

1. **Deploy** bản có tính năng font. Với `docker compose up -d`, service `bootstrap` tự áp
   migration trước khi `app` chạy. `fonts:adopt` thì KHÔNG nằm trong bootstrap — chạy tay ở
   bước 2. Cho tới lúc đó site vẫn đúng font: `fonts.css` của gói còn được biên vào bundle CSS,
   nên deploy rồi để đó, hay Publish trước khi adopt, đều không làm hỏng chữ. Thứ tự chỉ bắt
   buộc ở bước 6: gỡ font khỏi gói mà chưa adopt (và chưa Publish) thì chữ rơi về font dự phòng.
2. `pnpm fonts:adopt --actor <email>` — chỉ in kế hoạch (đọc các khối `@font-face` trong
   `projects/<gói>/styles/fonts.css`); xem kỹ, rồi chạy lại với `--apply` để ghi vào kho.
3. **Xoá cache dữ liệu của app rồi khởi động lại.** Script chạy ngoài Next nên không gọi được
   `revalidateTag`; builder đọc kho font qua `unstable_cache`, và cache đó nằm **trên đĩa** ở
   `.next/cache/fetch-cache` (image không gắn volume cho thư mục này). Chỉ `docker restart` thì
   **không đủ**: container giữ nguyên đĩa nên builder vẫn thấy kho cũ.
   - Production / staging (Docker, tên container mặc định `quilder-app`):
     `docker exec quilder-app rm -rf /app/.next/cache/fetch-cache && docker restart quilder-app`
     — hoặc tạo lại container: `docker compose -f docker-compose.prod.yaml up -d --force-recreate app`.
   - Máy dev: dừng `pnpm dev`, xoá thư mục `.next/cache/fetch-cache`, chạy lại `pnpm dev`.
4. Kiểm canvas: chữ dùng font gói hiển thị đúng ở bản nháp.
5. **Publish.**
6. Ở repo gói: xoá các khối `@font-face` trong `styles/fonts.css` (giữ khối `:root`) và thư mục
   `public/fonts/`, deploy gói. Kiểm DevTools không còn request `/p/fonts/`.

Quy ước: font mới thêm ở Cài đặt › Font. Font gốc còn trong gói vẫn dùng được và hiện ở màn Font
(chỉ đọc); chỉ bỏ chúng theo đúng thứ tự trên.

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
