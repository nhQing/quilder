-- Địa chỉ cũ → địa chỉ mới khi đổi slug một trang đã publish.
--
-- Bảng LIVE, cố ý không nằm trong ảnh chụp release: redirect là chuyện định tuyến,
-- không phải nội dung. Xem docblock trong schema.prisma.
CREATE TABLE "Redirect" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "from" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "pageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Redirect_pkey" PRIMARY KEY ("id")
);

-- Một slug cũ chỉ trỏ tới đúng một chỗ. Hai hàng cùng "from" nghĩa là trình duyệt
-- nhận địa chỉ nào tuỳ thứ tự truy vấn — một lỗi không tái hiện được.
CREATE UNIQUE INDEX "Redirect_siteId_from_key" ON "Redirect"("siteId", "from");

-- Đổi tên lần thứ hai phải tìm được mọi hàng đang trỏ tới slug vừa bị thay, để
-- gộp chuỗi 301 thay vì nối dài nó.
CREATE INDEX "Redirect_siteId_to_idx" ON "Redirect"("siteId", "to");

ALTER TABLE "Redirect" ADD CONSTRAINT "Redirect_siteId_fkey"
    FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
