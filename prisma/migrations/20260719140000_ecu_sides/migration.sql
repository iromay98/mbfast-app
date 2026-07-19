-- 左右ECU: 1記録に2基目のECU（bak系のみ側別）
ALTER TABLE "ServiceRecord" ADD COLUMN "primarySide" TEXT NOT NULL DEFAULT '左';

CREATE TABLE "RecordEcuSide" (
    "id" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "slaveFilePath" TEXT NOT NULL,
    "slaveHash" TEXT,
    "ecuType" TEXT,
    "backupSupported" BOOLEAN,
    "autotunerSlaveId" TEXT,
    "autotunerEcuId" INTEGER,
    "autotunerModelId" INTEGER,
    "autotunerMcuId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RecordEcuSide_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RecordEcuSide_recordId_side_key" ON "RecordEcuSide"("recordId", "side");
ALTER TABLE "RecordEcuSide" ADD CONSTRAINT "RecordEcuSide_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "ServiceRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
