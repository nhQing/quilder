-- AlterTable
ALTER TABLE "Taxonomy" ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'draft';

-- Mọi danh mục ĐANG CÓ thành 'published'.
--
-- Mặc định của cột là 'draft' vì đó là trạng thái đúng cho một danh mục MỚI. Nhưng
-- các hàng đang có đã hiện trên site từ trước khi cột này tồn tại, nên để chúng ở
-- 'draft' là dùng một migration để gỡ nội dung đang chạy xuống — và nó sẽ xảy ra
-- vào đúng lúc ai đó bật bộ lọc `published`, tức rất lâu sau khi migration chạy,
-- khi không ai còn nối hai việc đó với nhau.
UPDATE "Taxonomy" SET "status" = 'published';
