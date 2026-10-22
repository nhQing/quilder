-- AlterTable
ALTER TABLE "Site" ADD COLUMN     "robotsTxt" TEXT,
ADD COLUMN     "seoDescription" TEXT,
ADD COLUMN     "seoTitleTemplate" TEXT,
ADD COLUMN     "siteUrl" TEXT,
ADD COLUMN     "sitemapRules" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "Page" ADD COLUMN     "system" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Page_siteId_system_key" ON "Page"("siteId", "system");

-- Điền `siteUrl` cho site đang có từ `primaryDomain`. Đây là lần DUY NHẤT scheme
-- được đoán: localhost/127.* là http, còn lại https. Người dùng sửa được trong Cài đặt,
-- và env SITE_URL (nếu đặt) vẫn ghi đè cột này.
UPDATE "Site"
SET "siteUrl" = CASE
  WHEN "primaryDomain" LIKE 'localhost%' OR "primaryDomain" LIKE '127.%'
    THEN 'http://' || "primaryDomain"
  ELSE 'https://' || "primaryDomain"
END
WHERE "siteUrl" IS NULL AND "primaryDomain" <> '';
