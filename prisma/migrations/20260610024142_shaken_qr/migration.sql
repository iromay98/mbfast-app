-- AlterTable
ALTER TABLE "ServiceRecord" ADD COLUMN     "engineModelCode" TEXT,
ADD COLUMN     "firstRegistration" TEXT,
ADD COLUMN     "inspectionExpiry" TEXT,
ADD COLUMN     "modelDesignationNumber" TEXT,
ADD COLUMN     "registrationNumber" TEXT,
ADD COLUMN     "shakenScanRaw" JSONB,
ADD COLUMN     "vehicleModelCode" TEXT;
