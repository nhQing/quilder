-- AlterTable
ALTER TABLE "Site" ADD COLUMN     "ogImageId" TEXT;

-- CreateTable
CREATE TABLE "EffectPreset" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "aiDescription" TEXT NOT NULL,
    "effectKey" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EffectPreset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EffectPreset_key_key" ON "EffectPreset"("key");

-- CreateIndex
CREATE INDEX "EffectPreset_effectKey_idx" ON "EffectPreset"("effectKey");
