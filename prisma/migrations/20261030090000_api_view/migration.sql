-- CreateTable
-- View của API công khai: đường gọi ngắn do admin đặt sẵn. Bảng mới, không chạm dữ liệu cũ.
CREATE TABLE "ApiView" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "typeKey" TEXT NOT NULL,
    "query" TEXT NOT NULL DEFAULT '',
    "allow" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "ApiView_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ApiView_key_key" ON "ApiView"("key");
