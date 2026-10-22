-- AlterTable
ALTER TABLE "Effect" ADD COLUMN     "statesWritten" TEXT[] DEFAULT ARRAY[]::TEXT[];
