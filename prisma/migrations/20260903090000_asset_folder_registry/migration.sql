-- Thư mục ảo tồn tại kể cả khi rỗng.
--
-- `Asset.folder` vẫn là nơi lưu ảnh nào nằm đâu — bảng này CHỈ nói thư mục nào có
-- thật. Xem doc của model `AssetFolder` trong schema.prisma.
CREATE TABLE "AssetFolder" (
    "path" TEXT NOT NULL,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssetFolder_pkey" PRIMARY KEY ("path")
);

CREATE INDEX "AssetFolder_createdBy_idx" ON "AssetFolder"("createdBy");

-- Backfill: mọi thư mục đang được suy ra từ ảnh phải có hàng ở đây, nếu không lần
-- đầu ai đó xoá một thư mục cũ sẽ không tìm thấy gì để xoá.
--
-- Cả CẤP CHA nữa: kho có `a/b` mà không ảnh nào nằm trực tiếp trong `a` là chuyện
-- bình thường, và cây thiếu `a` thì `a/b` không hiện được ở đâu. `generate_series`
-- dựng lại từng tiền tố thay vì chỉ lấy đường dẫn đầy đủ.
--
-- `createdBy` để NULL: không truy được ai tạo những thư mục này, và đoán bừa là
-- trao quyền xoá cho nhầm người. NULL = chỉ admin xoá được.
INSERT INTO "AssetFolder" ("path", "createdBy")
SELECT DISTINCT
    array_to_string((string_to_array("folder", '/'))[1:depth.n], '/') AS path,
    NULL
FROM "Asset",
     LATERAL generate_series(1, array_length(string_to_array("folder", '/'), 1)) AS depth(n)
WHERE "folder" IS NOT NULL
ON CONFLICT ("path") DO NOTHING;
