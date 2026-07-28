-- mbPIT 加盟店の顧客カルテ（車検満了日の管理・声かけ営業の基盤）
CREATE TABLE "PitCustomer" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kana" TEXT NOT NULL DEFAULT '',
    "tel" TEXT NOT NULL DEFAULT '',
    "vehicleName" TEXT NOT NULL DEFAULT '',
    "inspectionExpiry" TIMESTAMP(3),
    "note" TEXT NOT NULL DEFAULT '',
    "vehicleId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PitCustomer_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PitCustomer_storeId_inspectionExpiry_idx" ON "PitCustomer"("storeId", "inspectionExpiry");

ALTER TABLE "PitCustomer" ADD CONSTRAINT "PitCustomer_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "PitStore"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
