-- AlterTable
ALTER TABLE "User" ADD COLUMN     "avatarAssetId" TEXT,
ADD COLUMN     "lockedAt" TIMESTAMP(3),
ADD COLUMN     "lockedBy" TEXT;

-- Nói ra TÊN của hàng sai trước khi khoá ngoại nói "có hàng sai".
--
-- `Entry.createdBy`/`updatedBy` đã chứa email từ trước (mọi đường ghi truyền
-- `auth.email`), nên khoá ngoại bên dưới áp được mà không cần migration dữ liệu —
-- MIỄN LÀ mọi email trong hai cột đó còn một hàng `User`. Nếu một tài khoản từng
-- bị xoá cứng bằng `DELETE /api/users/[id]` cũ, hàng của họ mồ côi và khoá ngoại
-- sẽ nổ.
--
-- Lỗi mặc định của Postgres cho ca đó KHÔNG nói hàng nào: nó chỉ nói
-- "violates foreign key constraint". Trên một lần deploy đó là nửa buổi đi dò.
-- Khối này đổi nó thành một câu có danh sách email, kèm cách chữa.
DO $$
DECLARE
  mo_coi TEXT;
BEGIN
  SELECT string_agg(DISTINCT e, ', ')
  INTO mo_coi
  FROM (
    SELECT "createdBy" AS e FROM "Entry"
    UNION
    SELECT "updatedBy" AS e FROM "Entry"
  ) AS emails
  WHERE NOT EXISTS (SELECT 1 FROM "User" u WHERE u.email = emails.e);

  IF mo_coi IS NOT NULL THEN
    RAISE EXCEPTION
      'Không áp được khoá ngoại tác giả: % không còn tài khoản. Tạo lại tài khoản với đúng email đó (chúng là tác giả của bài đang có), rồi chạy lại migration.',
      mo_coi;
  END IF;
END $$;

-- AddForeignKey
ALTER TABLE "Entry" ADD CONSTRAINT "Entry_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("email") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Entry" ADD CONSTRAINT "Entry_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "User"("email") ON DELETE RESTRICT ON UPDATE CASCADE;
