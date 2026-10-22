-- Slug và trạng thái đăng theo từng ngôn ngữ cho entry của kho dữ liệu.
--
-- Thuần CỘNG THÊM: một bảng mới, không cột nào của bảng cũ bị sửa, không dòng dữ
-- liệu nào bị di chuyển. Chạy trên DB đang phục vụ được, và không có trạng thái
-- nửa vời nào để dọn nếu nó dừng giữa đường.
--
-- Mọi entry đang tồn tại KHÔNG có hàng nào ở đây, và đó là trạng thái đúng: chưa
-- ngôn ngữ nào được đăng riêng, mọi URL đang chạy vẫn tra vào `Entry.slug` như cũ.
CREATE TABLE "EntryLocale" (
    "entryId" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "typeKey" TEXT NOT NULL,
    -- NULL = dùng `Entry.slug`. Postgres coi các NULL là khác nhau nên UNIQUE bên
    -- dưới không chặn nhiều ngôn ngữ cùng để trống.
    "slug" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT NOT NULL,

    CONSTRAINT "EntryLocale_pkey" PRIMARY KEY ("entryId","locale")
);

-- Một slug chỉ thuộc một bài, trong phạm vi một loại và một ngôn ngữ.
CREATE UNIQUE INDEX "EntryLocale_typeKey_locale_slug_key" ON "EntryLocale"("typeKey", "locale", "slug");

-- Đường đi của "10 tin tiếng Anh mới nhất đã đăng".
CREATE INDEX "EntryLocale_typeKey_locale_status_publishedAt_idx" ON "EntryLocale"("typeKey", "locale", "status", "publishedAt" DESC);

-- CASCADE ở cả hai chiều, và cả hai đều có lý:
--   entry bị xoá  → slug/trạng thái của các bản dịch của nó là rác, không có nghĩa
--   locale bị xoá → cùng luật với `Translation.locale`, tắt một ngôn ngữ khỏi bảng
--                   `Locale` là bỏ nó hẳn
ALTER TABLE "EntryLocale" ADD CONSTRAINT "EntryLocale_entryId_fkey"
    FOREIGN KEY ("entryId") REFERENCES "Entry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EntryLocale" ADD CONSTRAINT "EntryLocale_locale_fkey"
    FOREIGN KEY ("locale") REFERENCES "Locale"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Backfill: giữ nguyên thứ đang sống ────────────────────────────────────────
--
-- Không có bước này, migration là một lượt THÁO XUỐNG im lặng. Từ lúc nó chạy,
-- `publishWhere` lọc bản dịch theo hàng `EntryLocale`, nên mọi bài đang hiện ở
-- `/en` biến mất cùng một lúc — DB đúng, code đúng, và site mất một nửa nội dung
-- mà không có lỗi nào để lần.
--
-- Sao chép trạng thái của bản gốc: cùng `status`, cùng `publishedAt`, `slug` để
-- trống (= dùng slug gốc). Kết quả là `/en` phục vụ ĐÚNG những gì nó đang phục vụ
-- hôm nay, không thêm không bớt.
--
-- CHỈ ngôn ngữ đã bật và không phải mặc định: ngôn ngữ mặc định cố ý không có hàng
-- ở đây (xem docblock `entry-locale.ts`), và một ngôn ngữ đang tắt chưa phục vụ ai
-- nên nó bắt đầu từ nháp — đúng nhịp "dịch trước, bật sau" mà bảng `Locale` đã đặt.
--
-- Bài tạo SAU migration này không được backfill, và đó là chủ ý: từ đây mỗi ngôn
-- ngữ được duyệt riêng.
INSERT INTO "EntryLocale" ("entryId", "locale", "typeKey", "slug", "status", "publishedAt", "updatedAt", "updatedBy")
SELECT e."id", l."code", e."typeKey", NULL, e."status", e."publishedAt", NOW(), 'migration:20260828120000_entry_locale'
FROM "Entry" e
CROSS JOIN "Locale" l
WHERE l."isDefault" = false AND l."enabled" = true;
