-- Thứ tự do người dùng đặt cho loại nội dung và nhóm field dùng lại.
--
-- Backfill theo `createdAt` chứ không để cả bảng bằng 0: trước migration này màn
-- Kho dữ liệu sắp theo đúng `createdAt`, nên gán số theo thứ tự đó giữ nguyên cái
-- người dùng đang nhìn. Để tất cả bằng 0 thì lần mở màn đầu tiên sau khi deploy,
-- các thẻ nhảy sang một thứ tự khác mà không ai đụng vào gì.
--
-- "order" là từ khoá SQL nên luôn phải đặt trong nháy kép.
ALTER TABLE "CollectionType" ADD COLUMN "order" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "FieldGroupDef"  ADD COLUMN "order" INTEGER NOT NULL DEFAULT 0;

UPDATE "CollectionType" AS t
SET "order" = s.rn
FROM (SELECT id, (ROW_NUMBER() OVER (ORDER BY "createdAt")) - 1 AS rn FROM "CollectionType") AS s
WHERE t.id = s.id;

UPDATE "FieldGroupDef" AS g
SET "order" = s.rn
FROM (SELECT id, (ROW_NUMBER() OVER (ORDER BY "createdAt")) - 1 AS rn FROM "FieldGroupDef") AS s
WHERE g.id = s.id;
