-- AlterTable
ALTER TABLE "ServiceRecord" ADD COLUMN     "calNumber" TEXT,
ADD COLUMN     "ecuIdRaw" JSONB,
ADD COLUMN     "hwNumber" TEXT,
ADD COLUMN     "swNumber" TEXT;

-- CreateIndex
CREATE INDEX "ServiceRecord_swNumber_idx" ON "ServiceRecord"("swNumber");

-- CreateIndex
CREATE INDEX "ServiceRecord_calNumber_idx" ON "ServiceRecord"("calNumber");
