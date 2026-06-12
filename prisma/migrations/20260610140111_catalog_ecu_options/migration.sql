-- AlterTable
ALTER TABLE "BaseFile" ADD COLUMN     "calNumber" TEXT,
ADD COLUMN     "generation" TEXT,
ADD COLUMN     "hwNumber" TEXT,
ADD COLUMN     "method" TEXT,
ADD COLUMN     "swNumber" TEXT;

-- AlterTable
ALTER TABLE "TunedVariant" ADD COLUMN     "optionTags" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateIndex
CREATE INDEX "BaseFile_calNumber_idx" ON "BaseFile"("calNumber");
