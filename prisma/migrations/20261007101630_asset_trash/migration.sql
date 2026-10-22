-- AlterTable
ALTER TABLE "Asset" ADD COLUMN     "trashedAt" TIMESTAMP(3),
ADD COLUMN     "trashedBy" TEXT;

-- CreateIndex
CREATE INDEX "Asset_trashedAt_idx" ON "Asset"("trashedAt");
