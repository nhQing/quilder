-- Tuỳ chọn xem theo tài khoản (20/11/2026). Đầu tiên: thứ tự bảng bài trong Kho dữ liệu
-- (`entrySort`). Mặc định '{}' = mọi tài khoản hiện có dùng mặc định (ngày tạo).
ALTER TABLE "User" ADD COLUMN "prefs" JSONB NOT NULL DEFAULT '{}';
