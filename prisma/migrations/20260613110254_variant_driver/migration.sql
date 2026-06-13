-- AlterTable
ALTER TABLE "TunedVariant" ADD COLUMN     "driver" TEXT,
ADD COLUMN     "driverBorrowed" BOOLEAN NOT NULL DEFAULT false;
