-- Origin được phép cho `CustomCode` trong iframe.
--
-- Xem docblock của `EmbedOrigin` trong schema.prisma. Tóm lại: allowlist là dữ
-- liệu để thêm một CDN không cần deploy.

-- CreateTable
CREATE TABLE "EmbedOrigin" (
    "id" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "note" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmbedOrigin_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmbedOrigin_origin_key" ON "EmbedOrigin"("origin");

-- Seed ba CDN ESM thông dụng, để một bản mới dựng lên là dùng được ngay.
--
-- KHÔNG seed rỗng: bảng rỗng làm CSP sinh `connect-src;` trần, và người dùng đầu
-- tiên thử `import` từ esm.sh sẽ thấy khối trắng kèm một lỗi CSP trong console mà
-- không có gì trong builder nói vì sao.
INSERT INTO "EmbedOrigin" ("id", "origin", "note") VALUES
  ('embedorigin_esmsh',   'https://esm.sh',           'CDN ESM, hỗ trợ đa số package npm'),
  ('embedorigin_unpkg',   'https://unpkg.com',        'CDN npm nguyên bản'),
  ('embedorigin_jsdelivr','https://cdn.jsdelivr.net', 'CDN npm + GitHub');
