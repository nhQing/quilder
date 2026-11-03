-- AlterTable
-- Khoá mẫu hệ thống của component. Cột mới, nullable: hàng cũ giữ NULL (component thường).
ALTER TABLE "Preset" ADD COLUMN "system" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Preset_system_key" ON "Preset"("system");
