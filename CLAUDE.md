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
- SEO: `set_page_seo` (mô tả, ảnh OG, canonical, noindex — ra site NGAY), tiêu đề bằng
  `update_page`.
- Không publish; người dùng tự bấm Publish sau khi xem bản nháp.
