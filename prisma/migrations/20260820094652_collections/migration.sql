-- AlterTable
ALTER TABLE "Page" ADD COLUMN     "collection" JSONB;

-- CreateTable
CREATE TABLE "CollectionType" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "namePlural" TEXT NOT NULL,
    "icon" TEXT,
    "schema" JSONB NOT NULL DEFAULT '[]',
    "titleField" TEXT NOT NULL,
    "slugField" TEXT,
    "defaultSort" TEXT NOT NULL DEFAULT 'publishedAt:desc',
    "singleton" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CollectionType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FieldGroupDef" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT,
    "schema" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FieldGroupDef_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Entry" (
    "id" TEXT NOT NULL,
    "typeId" TEXT NOT NULL,
    "typeKey" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "i18n" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "publishedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT NOT NULL,

    CONSTRAINT "Entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Taxonomy" (
    "id" TEXT NOT NULL,
    "typeKey" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Taxonomy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EntryTaxonomy" (
    "entryId" TEXT NOT NULL,
    "taxonomyId" TEXT NOT NULL,

    CONSTRAINT "EntryTaxonomy_pkey" PRIMARY KEY ("entryId","taxonomyId")
);

-- CreateIndex
CREATE UNIQUE INDEX "CollectionType_key_key" ON "CollectionType"("key");

-- CreateIndex
CREATE UNIQUE INDEX "FieldGroupDef_key_key" ON "FieldGroupDef"("key");

-- CreateIndex
CREATE INDEX "Entry_typeKey_status_publishedAt_idx" ON "Entry"("typeKey", "status", "publishedAt" DESC);

-- CreateIndex
CREATE INDEX "Entry_typeKey_updatedAt_idx" ON "Entry"("typeKey", "updatedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "Entry_typeId_slug_key" ON "Entry"("typeId", "slug");

-- CreateIndex
CREATE INDEX "Taxonomy_typeKey_parentId_order_idx" ON "Taxonomy"("typeKey", "parentId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "Taxonomy_typeKey_key_key" ON "Taxonomy"("typeKey", "key");

-- CreateIndex
CREATE INDEX "EntryTaxonomy_taxonomyId_idx" ON "EntryTaxonomy"("taxonomyId");

-- AddForeignKey
ALTER TABLE "Entry" ADD CONSTRAINT "Entry_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "CollectionType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Taxonomy" ADD CONSTRAINT "Taxonomy_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Taxonomy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntryTaxonomy" ADD CONSTRAINT "EntryTaxonomy_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "Entry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntryTaxonomy" ADD CONSTRAINT "EntryTaxonomy_taxonomyId_fkey" FOREIGN KEY ("taxonomyId") REFERENCES "Taxonomy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
