-- CreateTable
CREATE TABLE "AssetHold" (
    "key" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "releaseIds" TEXT[],
    "purgedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "purgedBy" TEXT NOT NULL,

    CONSTRAINT "AssetHold_pkey" PRIMARY KEY ("key")
);
