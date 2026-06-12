-- CreateEnum
CREATE TYPE "VariantStatus" AS ENUM ('DRAFT', 'AVAILABLE', 'DISABLED');

-- CreateEnum
CREATE TYPE "DownloadContext" AS ENUM ('MATCH_AUTO', 'HQ_MANUAL');

-- AlterTable
ALTER TABLE "ServiceRecord" ADD COLUMN     "matchedBaseFileId" TEXT;

-- CreateTable
CREATE TABLE "BaseFile" (
    "id" TEXT NOT NULL,
    "stockHash" TEXT,
    "manufacturer" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "ecu" TEXT NOT NULL,
    "mcu" TEXT,
    "note" TEXT,
    "stockFileRef" TEXT,
    "stockFileName" TEXT,
    "stockFileSize" INTEGER,
    "stockContentType" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BaseFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TunedVariant" (
    "id" TEXT NOT NULL,
    "baseFileId" TEXT NOT NULL,
    "stage" TEXT NOT NULL DEFAULT '',
    "popsAndBangs" BOOLEAN NOT NULL DEFAULT false,
    "options" TEXT,
    "status" "VariantStatus" NOT NULL DEFAULT 'DRAFT',
    "note" TEXT,
    "currentVersionId" TEXT,
    "fileRef" TEXT,
    "fileHash" TEXT,
    "fileName" TEXT,
    "fileSize" INTEGER,
    "contentType" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TunedVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TunedVariantVersion" (
    "id" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "fileRef" TEXT NOT NULL,
    "fileHash" TEXT NOT NULL,
    "fileName" TEXT,
    "fileSize" INTEGER,
    "contentType" TEXT,
    "replacedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "replacedById" TEXT,

    CONSTRAINT "TunedVariantVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogDownloadLog" (
    "id" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "versionId" TEXT,
    "fileHash" TEXT,
    "userId" TEXT,
    "dealerId" TEXT,
    "serviceRecordId" TEXT,
    "context" "DownloadContext" NOT NULL,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CatalogDownloadLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BaseFile_stockHash_key" ON "BaseFile"("stockHash");

-- CreateIndex
CREATE INDEX "BaseFile_manufacturer_idx" ON "BaseFile"("manufacturer");

-- CreateIndex
CREATE INDEX "BaseFile_model_idx" ON "BaseFile"("model");

-- CreateIndex
CREATE INDEX "BaseFile_ecu_idx" ON "BaseFile"("ecu");

-- CreateIndex
CREATE UNIQUE INDEX "TunedVariant_currentVersionId_key" ON "TunedVariant"("currentVersionId");

-- CreateIndex
CREATE INDEX "TunedVariant_baseFileId_idx" ON "TunedVariant"("baseFileId");

-- CreateIndex
CREATE INDEX "TunedVariant_status_idx" ON "TunedVariant"("status");

-- CreateIndex
CREATE INDEX "TunedVariant_stage_idx" ON "TunedVariant"("stage");

-- CreateIndex
CREATE INDEX "TunedVariant_fileHash_idx" ON "TunedVariant"("fileHash");

-- CreateIndex
CREATE INDEX "TunedVariantVersion_variantId_idx" ON "TunedVariantVersion"("variantId");

-- CreateIndex
CREATE UNIQUE INDEX "TunedVariantVersion_variantId_version_key" ON "TunedVariantVersion"("variantId", "version");

-- CreateIndex
CREATE INDEX "CatalogDownloadLog_variantId_idx" ON "CatalogDownloadLog"("variantId");

-- CreateIndex
CREATE INDEX "CatalogDownloadLog_dealerId_idx" ON "CatalogDownloadLog"("dealerId");

-- CreateIndex
CREATE INDEX "CatalogDownloadLog_createdAt_idx" ON "CatalogDownloadLog"("createdAt");

-- CreateIndex
CREATE INDEX "ServiceRecord_matchedBaseFileId_idx" ON "ServiceRecord"("matchedBaseFileId");

-- AddForeignKey
ALTER TABLE "ServiceRecord" ADD CONSTRAINT "ServiceRecord_matchedBaseFileId_fkey" FOREIGN KEY ("matchedBaseFileId") REFERENCES "BaseFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BaseFile" ADD CONSTRAINT "BaseFile_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TunedVariant" ADD CONSTRAINT "TunedVariant_baseFileId_fkey" FOREIGN KEY ("baseFileId") REFERENCES "BaseFile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TunedVariant" ADD CONSTRAINT "TunedVariant_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "TunedVariantVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TunedVariant" ADD CONSTRAINT "TunedVariant_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TunedVariantVersion" ADD CONSTRAINT "TunedVariantVersion_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "TunedVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TunedVariantVersion" ADD CONSTRAINT "TunedVariantVersion_replacedById_fkey" FOREIGN KEY ("replacedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogDownloadLog" ADD CONSTRAINT "CatalogDownloadLog_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "TunedVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogDownloadLog" ADD CONSTRAINT "CatalogDownloadLog_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "TunedVariantVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogDownloadLog" ADD CONSTRAINT "CatalogDownloadLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogDownloadLog" ADD CONSTRAINT "CatalogDownloadLog_dealerId_fkey" FOREIGN KEY ("dealerId") REFERENCES "Dealer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogDownloadLog" ADD CONSTRAINT "CatalogDownloadLog_serviceRecordId_fkey" FOREIGN KEY ("serviceRecordId") REFERENCES "ServiceRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;
