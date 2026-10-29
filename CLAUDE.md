# Ghi chú cho Claude

## Sửa / clone trang trong builder cho khớp maimoney.com

Đích là KHỚP SỐ ĐO của trang thật ở mọi khổ, không phải "trông giống". Làm theo đúng thứ tự:

1. **Đo trước, sửa sau.** Chạy `node scripts/size-check.mjs <pageId> <url thật> 390,1440,1920`
   (cần `MM_BUILDER_URL`, `MM_BUILDER_TOKEN`). Nó liệt kê TỪNG chữ (cỡ, line-height, độ đậm,
   màu, bề rộng), ảnh (kích thước) và nút (kích thước, nền, bo góc) lệch. `compare_with_url`
   chỉ in dòng lệch nặng nhất và ghép chữ lỏng — từng bỏ sót tiêu đề 48↔60px và nút
   150×45↔281×78 — nên không dùng nó làm bằng chứng duy nhất.
2. **Tìm breakpoint THẬT của trang thật** bằng cách quét bề rộng quanh chỗ nghi (1199/1200,
   1439/1440, 1699/1700…). maimoney.com dùng 1200, 1440 và 1700; builder chỉ có
   768/1024/1200/1560. Mốc không trùng thì dùng Len "bậc thang" ở lớp gần nhất bên dưới:
   `max(lo, min(hi, (100vw − (bp−1)px) × 9999))` — ra `lo` dưới bp, `hi` từ bp trở lên.
3. **Đi từng section, đủ cả 390 / 1440 / 1920** (người dùng xem ở ~1920): chữ, nút (kể cả
   icon bên trong), ảnh (kích thước VÀ vị trí trong khung), khoảng cách (so `y` tuyệt đối của
   phần tử đầu mỗi section để thấy lệch dồn).
4. **Chụp đối chiếu cạnh nhau** từng section; chi tiết nhỏ (icon, mũi tên) chụp
   `deviceScaleFactor: 3`.
5. **Đo lại sau mỗi lượt sửa** và báo số chỗ còn lệch, kèm lý do nếu cố ý để lệch.

### Bẫy đã gặp

- `setStyle` với `typography: { clamp: N }` THAY CẢ nhóm typography (`clamp` nằm trong
  `UNION_KEYS` của `src/lib/doc/ops.ts`) — luôn gửi đủ cả nhóm khi có `clamp`.
- Site đặt `text-wrap: balance` cho h1–h3, maimoney.com thì không → tiêu đề xuống dòng sớm.
  Đặt `typography.wrap` = `"pretty"` (hoặc `"normal"`, phát `text-wrap: wrap`).
- `customCss` của AI chỉ nhận allowlist (`src/lib/doc/ai-css-allowlist.ts`). Node có
  customCss do người viết chứa thuộc tính ngoài allowlist thì AI không ghi đè được: dùng style
  có kiểu, `transform`/`opacity`, hoặc selector từ node cha (`&&& > button:disabled {…}`).
- Button không có con: icon/mũi tên làm bằng `fill.image` (SVG vẽ sẵn trong khung đúng tỉ
  lệ nút), nút có ảnh bên trong thì dựng Stack + nút "link-cover" phủ kín.
- AI không đặt được `display: table-row`… → `duplicateNode` node sẵn có rồi `moveNode`,
  tách hai batch (validator không thấy node vừa duplicate trong cùng batch).
- `get_node` ≤ 20 id, `apply_ops` ≤ 80 op; luôn `dryRun` trước batch lớn.
- Font thân của site là SF Pro (`--font-body` bị đè), maimoney.com dùng Inter — chủ ý, giữ SF Pro.
- Header/Footer dùng Instance của component dùng chung; header `fixed` cao 92px nên section
  đầu cần đủ padding-top.
- Dải trượt: effect `slider` (part viewport/track/slide/prev/next). Mũi tên của maimoney.com
  không bao giờ mờ ở hai đầu dải.
- "Xem thêm / Thu gọn": effect `show-more` (part more-toggle / more-panel).
- Hiện dần khi cuộn (framer `whileInView` của maimoney.com): `scroll-reveal` với `delay` riêng,
  `rootMargin: "0px 0px 0px 0px"` (live kích hoạt ngay khi ló vào), và customCss
  `html[data-reveal-ready="true"] & { opacity: 0; transform: … }` +
  `html[data-reveal-ready="true"] &[data-revealed="true"] { opacity: 1; transform: none; transition: … }`
  — transition đặt ở trạng thái HIỆN để lúc tải trang không lóe mờ đi. Nhịp đo được: section
  `translateY(10px)` 0.6s, phần tử ±30px 1s, cả hai `cubic-bezier(0, 0, 0.58, 1)`; dải tin
  `translateX(80%)` 1s. Đo bằng getComputedStyle — live chạy opacity bằng WAAPI, style nội dòng
  không đổi giữa chừng.
- Clone chép luôn trạng thái ẨN ban đầu của framer (`opacity: 0` + `transform` trong customCss)
  → khối đó vô hình trên trang ta. Quét sau mỗi lần clone: phần tử có chữ mà opacity < 1.
- Danh sách bước bấm chọn + ảnh đổi theo bước: effect `steps` (part step / step-media), state
  `step-active` / `step-inactive`. State của effect áp cho cả cây con của node mang cờ, nên style
  node bên trong (vòng số, tiêu đề, khung mô tả) theo state đó được.
- SEO: `set_page_seo` (mô tả, ảnh OG, canonical, noindex — ra site NGAY), tiêu đề bằng
  `update_page`.
- Trang chi tiết bài (`blogs/post/[slug]`, loại `news`, vai `entry`): clone một bài thật rồi
  `update_page` đổi slug + `collection`, và GỠ noindex (clone luôn noindex). Chữ dùng
  `{t:'bind', ref:{source:'collection', path}}` — đọc được cả khoá ảo `published_at`
  (`format:'date'`), `taxonomy`, `author`. Thân bài: `part="entry:body"` trên khối chứa; ảnh
  bìa / ảnh tác giả: `part="entry:cover"` / `"entry:author_photo"` trên node Image. Bài liên
  quan: Instance `the-tin-live` lặp nguồn `related`, `part:"slide"` để effect `slider` thấy.
- Link clone từ live mang tiền tố `/vi/…` → site ta trả 404. Đổi về đường dẫn không tiền tố.
- Trang `/en`: bài chỉ hiện khi bản tiếng Anh đã ĐĂNG (không rơi về tiếng Việt), còn tên
  danh mục rơi về tên gốc khi chưa dịch. Tên dịch đặt ở builder (Kho dữ liệu → Danh mục) hoặc
  `set_taxonomy_locale` (cần token có quyền đăng bản dịch — lên site ngay). Trang clone tĩnh
  (thẻ bài là chữ gõ cứng) thì không đổi theo ngôn ngữ: phải dựng bằng khối lặp.
- API công khai lấy field của bản ghi được liên kết bằng `populate[field]=a,b` (một cấp, chỉ
  field nhẹ); app gọi bộ tham số dài qua view đặt sẵn `/api/public/v1/views/<khoá>` — admin
  tạo ở Kho dữ liệu → View của API, AI không có tool ghi view. Xem `docs/API-PUBLIC.md` §2.5.
- Chạy thử local với dữ liệu MaiMoney cần `QUILDER_PROJECT=maimoney`, nếu không header/menu
  của gói dự án không nạp và trông như "chưa dịch".
- Không publish; người dùng tự bấm Publish sau khi xem bản nháp.
