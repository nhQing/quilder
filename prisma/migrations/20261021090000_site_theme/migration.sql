-- AlterTable
ALTER TABLE "Site" ADD COLUMN     "theme" TEXT NOT NULL DEFAULT 'light';

-- Site có từ trước đang render theme TỐI (`data-theme="dark"` gõ cứng trong layout).
-- Giữ nguyên cho chúng: màu chưa bị đè trong DB đang lấy từ khối theme tối, nên đổi
-- ngầm sang sáng là đổi giao diện site đang chạy. Site tạo SAU migration này dùng
-- mặc định 'light'.
UPDATE "Site" SET "theme" = 'dark';
