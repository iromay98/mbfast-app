-- チャット: 送信取り消し・ファイル備考(本部/代理店)・再DL可否・DL済み
ALTER TABLE "RecordMessage" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "RecordMessage" ADD COLUMN "hqNote" TEXT;
ALTER TABLE "RecordMessage" ADD COLUMN "dealerNote" TEXT;
ALTER TABLE "RecordMessage" ADD COLUMN "redownloadable" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "RecordMessage" ADD COLUMN "downloadedAt" TIMESTAMP(3);
