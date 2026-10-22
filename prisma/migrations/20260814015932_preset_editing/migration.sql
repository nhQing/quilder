-- AlterTable
ALTER TABLE "Preset" ADD COLUMN     "builtin" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "PresetVersion" (
    "id" TEXT NOT NULL,
    "presetId" TEXT NOT NULL,
    "tree" JSONB NOT NULL,
    "label" TEXT,
    "prompt" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,
    "parentId" TEXT,

    CONSTRAINT "PresetVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PresetVersion_presetId_createdAt_idx" ON "PresetVersion"("presetId", "createdAt");

-- CreateIndex
CREATE INDEX "Preset_category_idx" ON "Preset"("category");

-- AddForeignKey
ALTER TABLE "PresetVersion" ADD CONSTRAINT "PresetVersion_presetId_fkey" FOREIGN KEY ("presetId") REFERENCES "Preset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
