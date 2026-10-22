-- AlterTable
ALTER TABLE "Release" ADD COLUMN     "assets" JSONB,
ADD COLUMN     "cssHash" TEXT,
ADD COLUMN     "globals" JSONB,
ADD COLUMN     "tokens" JSONB;

-- CreateTable
CREATE TABLE "StyleBundle" (
    "hash" TEXT NOT NULL,
    "css" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StyleBundle_pkey" PRIMARY KEY ("hash")
);

-- AddForeignKey
ALTER TABLE "Release" ADD CONSTRAINT "Release_cssHash_fkey" FOREIGN KEY ("cssHash") REFERENCES "StyleBundle"("hash") ON DELETE SET NULL ON UPDATE CASCADE;
