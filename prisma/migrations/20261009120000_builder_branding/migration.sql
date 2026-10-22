-- AlterTable
ALTER TABLE "Site" ADD COLUMN     "builderFaviconAssetId" TEXT,
ADD COLUMN     "builderFaviconUseSite" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "builderLogoAssetId" TEXT;
