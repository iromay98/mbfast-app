-- AlterTable
ALTER TABLE "ServiceRecord" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "TunedVariant" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "ServiceRecord_deletedAt_idx" ON "ServiceRecord"("deletedAt");

-- CreateIndex
CREATE INDEX "TunedVariant_deletedAt_idx" ON "TunedVariant"("deletedAt");
