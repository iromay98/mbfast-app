-- 手動の施工ログ（過去客の遡り登録等）
CREATE TABLE "ServiceLog" (
    "id" TEXT NOT NULL,
    "serviceRecordId" TEXT NOT NULL,
    "performedAt" TIMESTAMP(3) NOT NULL,
    "content" TEXT NOT NULL,
    "note" TEXT,
    "authorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ServiceLog_serviceRecordId_idx" ON "ServiceLog"("serviceRecordId");

ALTER TABLE "ServiceLog" ADD CONSTRAINT "ServiceLog_serviceRecordId_fkey"
  FOREIGN KEY ("serviceRecordId") REFERENCES "ServiceRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
