-- 本店専用の顧客関連ファイル（代理店非公開・備考付き）
CREATE TABLE "RecordHqFile" (
    "id" TEXT NOT NULL,
    "serviceRecordId" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileSize" INTEGER,
    "contentType" TEXT,
    "note" TEXT,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RecordHqFile_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "RecordHqFile_serviceRecordId_idx" ON "RecordHqFile"("serviceRecordId");
ALTER TABLE "RecordHqFile" ADD CONSTRAINT "RecordHqFile_serviceRecordId_fkey"
    FOREIGN KEY ("serviceRecordId") REFERENCES "ServiceRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
