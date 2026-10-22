-- Số phiên bản người dùng đọc được (`v41`), và bộ đếm sinh ra nó.
--
-- Vì sao là trigger chứ không phải application code: có TÁM chỗ trong repo tạo
-- `PageVersion` — `doc/apply-to-page.ts`, `builder/page-history.ts` (lùi bản),
-- `builder/create-page.ts`, `prisma/seed.ts`, `scripts/migrate/seed-doc.ts`,
-- `scripts/prove-rollback.ts`, và hai chỗ trong `scripts/seed-second-page.ts`.
-- Năm trong tám là seed/script, tức đúng loại file không ai nghĩ tới khi thêm
-- tính năng. Một helper biến bất biến thành việc phải nhớ ở tám chỗ; trigger làm
-- chỗ thứ chín tự đúng.

ALTER TABLE "Page"        ADD COLUMN "versionSeq" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PageVersion" ADD COLUMN "seq"        INTEGER NOT NULL DEFAULT 0;

-- BACKFILL TRƯỚC KHI TẠO UNIQUE INDEX.
--
-- Thứ tự này chịu lực: mọi hàng cũ vừa nhận `seq = 0` từ DEFAULT, nên tạo unique
-- index ngay bây giờ sẽ đánh trượt mọi trang có từ 2 phiên bản trở lên.
WITH n AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY "pageId" ORDER BY "createdAt") AS rn
  FROM "PageVersion"
)
UPDATE "PageVersion" v SET "seq" = n.rn FROM n WHERE n.id = v.id;

UPDATE "Page" p SET "versionSeq" =
  COALESCE((SELECT MAX("seq") FROM "PageVersion" WHERE "pageId" = p.id), 0);

CREATE UNIQUE INDEX "PageVersion_pageId_seq_key" ON "PageVersion"("pageId", "seq");

-- `UPDATE ... RETURNING ... INTO` lấy row lock của Postgres trên đúng hàng `Page`
-- đó, nên hai lần insert song song cùng trang bị tuần tự hoá. Không có cửa sổ
-- đọc-rồi-ghi như `MAX(seq)+1`.
--
-- Nếu `UPDATE` không khớp hàng nào thì `NEW."seq"` thành NULL và ràng buộc NOT NULL
-- làm insert FAIL TO TIẾNG. Không có nhánh im lặng. (Khoá ngoại
-- `PageVersion.pageId → Page.id` vốn đã buộc `Page` tồn tại trước, nên nhánh đó
-- chỉ xảy ra nếu ai đó gỡ khoá ngoại.)
CREATE OR REPLACE FUNCTION page_version_next_seq() RETURNS trigger AS $$
BEGIN
  UPDATE "Page" SET "versionSeq" = "versionSeq" + 1
  WHERE id = NEW."pageId"
  RETURNING "versionSeq" INTO NEW."seq";
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER page_version_next_seq_trg
BEFORE INSERT ON "PageVersion"
FOR EACH ROW EXECUTE FUNCTION page_version_next_seq();
