-- AlterTable
ALTER TABLE "Release" ADD COLUMN     "fonts" JSONB;

-- CreateTable
CREATE TABLE "FontFamily" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "cssName" TEXT NOT NULL,
    "fallback" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "googleFamily" TEXT,
    "licenseNote" TEXT,
    "licenseConfirmedBy" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FontFamily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FontFace" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "weight" TEXT NOT NULL,
    "style" TEXT NOT NULL,
    "unicodeRange" TEXT NOT NULL DEFAULT '',
    "subset" TEXT NOT NULL DEFAULT '',
    "warnings" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "assetId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FontFace_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FontFamily_slug_key" ON "FontFamily"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "FontFamily_cssName_key" ON "FontFamily"("cssName");

-- CreateIndex
CREATE UNIQUE INDEX "FontFace_familyId_weight_style_unicodeRange_key" ON "FontFace"("familyId", "weight", "style", "unicodeRange");

-- AddForeignKey
ALTER TABLE "FontFace" ADD CONSTRAINT "FontFace_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "FontFamily"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FontFace" ADD CONSTRAINT "FontFace_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

