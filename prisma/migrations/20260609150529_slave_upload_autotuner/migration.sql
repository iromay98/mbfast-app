-- CreateEnum
CREATE TYPE "RecordStatus" AS ENUM ('UPLOADED', 'DECRYPTING', 'DECODED', 'FAILED');

-- CreateEnum
CREATE TYPE "RecordSource" AS ENUM ('MANUAL', 'SLAVE_UPLOAD');

-- AlterTable
ALTER TABLE "ServiceRecord" ADD COLUMN     "autotunerEcuId" INTEGER,
ADD COLUMN     "autotunerMcuId" TEXT,
ADD COLUMN     "autotunerModelId" INTEGER,
ADD COLUMN     "autotunerSlaveId" TEXT,
ADD COLUMN     "decryptError" TEXT,
ADD COLUMN     "decryptedFilePath" TEXT,
ADD COLUMN     "decryptedHash" TEXT,
ADD COLUMN     "ecuManufacturer" TEXT,
ADD COLUMN     "engineInfo" JSONB,
ADD COLUMN     "mcu" TEXT,
ADD COLUMN     "method" TEXT,
ADD COLUMN     "slaveFilePath" TEXT,
ADD COLUMN     "slaveHash" TEXT,
ADD COLUMN     "slaveName" TEXT,
ADD COLUMN     "source" "RecordSource" NOT NULL DEFAULT 'MANUAL',
ADD COLUMN     "status" "RecordStatus" NOT NULL DEFAULT 'DECODED',
ALTER COLUMN "vin" DROP NOT NULL,
ALTER COLUMN "carMaker" DROP NOT NULL,
ALTER COLUMN "carModel" DROP NOT NULL,
ALTER COLUMN "ecuType" DROP NOT NULL,
ALTER COLUMN "workType" DROP NOT NULL,
ALTER COLUMN "workedAt" SET DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "AutotunerApiLog" (
    "id" TEXT NOT NULL,
    "recordId" TEXT,
    "mode" TEXT NOT NULL,
    "httpStatus" INTEGER,
    "success" BOOLEAN NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutotunerApiLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AutotunerApiLog_recordId_idx" ON "AutotunerApiLog"("recordId");

-- CreateIndex
CREATE INDEX "AutotunerApiLog_createdAt_idx" ON "AutotunerApiLog"("createdAt");

-- CreateIndex
CREATE INDEX "ServiceRecord_status_idx" ON "ServiceRecord"("status");

-- CreateIndex
CREATE INDEX "ServiceRecord_slaveHash_idx" ON "ServiceRecord"("slaveHash");

-- CreateIndex
CREATE INDEX "ServiceRecord_decryptedHash_idx" ON "ServiceRecord"("decryptedHash");

-- AddForeignKey
ALTER TABLE "AutotunerApiLog" ADD CONSTRAINT "AutotunerApiLog_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "ServiceRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;
