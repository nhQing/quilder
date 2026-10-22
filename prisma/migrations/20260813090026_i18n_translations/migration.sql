-- AlterTable
ALTER TABLE "Release" ADD COLUMN     "translations" JSONB;

-- CreateTable
CREATE TABLE "Locale" (
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Locale_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "Translation" (
    "id" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT NOT NULL,

    CONSTRAINT "Translation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Translation_pageId_locale_idx" ON "Translation"("pageId", "locale");

-- CreateIndex
CREATE UNIQUE INDEX "Translation_locale_pageId_nodeId_field_key" ON "Translation"("locale", "pageId", "nodeId", "field");

-- AddForeignKey
ALTER TABLE "Translation" ADD CONSTRAINT "Translation_locale_fkey" FOREIGN KEY ("locale") REFERENCES "Locale"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Translation" ADD CONSTRAINT "Translation_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;
