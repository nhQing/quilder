-- Favicon của site, trỏ tới một hàng Asset.
--
-- Nullable: site chưa đặt favicon thì trình duyệt tự xử (không có <link rel=icon>),
-- đúng như trước khi có cột này.
--
-- KHÔNG có khoá ngoại tới "Asset": xoá một asset đang được dùng làm favicon phải là
-- chuyện của đường xoá asset xử lý, và kho ảnh cố ý CHƯA có nút xoá. Thêm FK ở đây
-- sẽ khiến một lệnh DELETE trong tương lai đổ vỡ ở chỗ không ai ngờ, trong khi hệ
-- quả thật của một id treo chỉ là favicon không hiện.
ALTER TABLE "Site" ADD COLUMN "faviconAssetId" TEXT;
