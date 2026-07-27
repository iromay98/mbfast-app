-- 車両（車のお薬手帳）: 車台番号は平文保存せず HMAC キーのみ
CREATE TABLE "PitVehicle" (
    "id" TEXT NOT NULL,
    "vehicleKey" TEXT NOT NULL,
    "chassisLast3" TEXT,
    "vehicleName" TEXT,
    "modelCode" TEXT,
    "inspectionExpiry" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PitVehicle_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PitVehicle_vehicleKey_key" ON "PitVehicle"("vehicleKey");

ALTER TABLE "PitPost" ADD COLUMN "vehicleId" TEXT;
ALTER TABLE "PitPost" ADD COLUMN "externalProof" JSONB;

CREATE INDEX "PitPost_vehicleId_idx" ON "PitPost"("vehicleId");

ALTER TABLE "PitPost" ADD CONSTRAINT "PitPost_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "PitVehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;
