-- DropForeignKey
ALTER TABLE "CatalogDownloadLog" DROP CONSTRAINT "CatalogDownloadLog_variantId_fkey";

-- AlterTable
ALTER TABLE "CatalogDownloadLog" ALTER COLUMN "variantId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "CatalogDownloadLog" ADD CONSTRAINT "CatalogDownloadLog_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "TunedVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
