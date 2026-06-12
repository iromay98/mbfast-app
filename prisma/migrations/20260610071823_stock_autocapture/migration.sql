-- CreateEnum
CREATE TYPE "BaseFileSource" AS ENUM ('AUTO_CAPTURE', 'MANUAL');

-- AlterTable
ALTER TABLE "BaseFile" ADD COLUMN     "archived" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "capturedFromRecordId" TEXT,
ADD COLUMN     "source" "BaseFileSource" NOT NULL DEFAULT 'MANUAL';

-- CreateIndex
CREATE INDEX "BaseFile_source_idx" ON "BaseFile"("source");

-- CreateIndex
CREATE INDEX "BaseFile_archived_idx" ON "BaseFile"("archived");
