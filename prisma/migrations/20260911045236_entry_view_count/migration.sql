-- AlterTable
ALTER TABLE "Entry" ADD COLUMN     "viewCount" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "Entry_typeKey_status_viewCount_idx" ON "Entry"("typeKey", "status", "viewCount" DESC);
