-- 誤DL/誤リクエストのキャンセル依頼フロー
ALTER TABLE "CatalogDownloadLog" ADD COLUMN "cancelRequestedAt" TIMESTAMP(3);
ALTER TABLE "CatalogDownloadLog" ADD COLUMN "cancelReason" TEXT;
ALTER TABLE "CatalogDownloadLog" ADD COLUMN "cancelledAt" TIMESTAMP(3);
ALTER TABLE "CatalogDownloadLog" ADD COLUMN "cancelRejectedAt" TIMESTAMP(3);
ALTER TABLE "FileRequest" ADD COLUMN "cancelRequestedAt" TIMESTAMP(3);
ALTER TABLE "FileRequest" ADD COLUMN "cancelReason" TEXT;
ALTER TABLE "FileRequest" ADD COLUMN "cancelRejectedAt" TIMESTAMP(3);
