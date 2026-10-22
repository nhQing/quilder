-- Thư mục ảo cho kho ảnh.
--
-- Nullable và không có DEFAULT: `NULL` nghĩa là "chưa phân loại", một trạng thái
-- thật chứ không phải thiếu dữ liệu. Mọi ảnh đang có rơi vào đó, đúng như trước
-- khi có tính năng này.
--
-- KHÔNG đụng tới "Asset"."key": khoá là bất biến theo hợp đồng của Release.assets.
ALTER TABLE "Asset" ADD COLUMN "folder" TEXT;

CREATE INDEX "Asset_folder_idx" ON "Asset"("folder");
