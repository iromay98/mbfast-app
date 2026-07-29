-- 車両情報の修正履歴。車両は店舗をまたいで共有されるため、上書きの事実を追えるようにする。
CREATE TABLE "PitVehicleEditLog" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "changes" JSONB NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PitVehicleEditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PitVehicleEditLog_vehicleId_at_idx" ON "PitVehicleEditLog"("vehicleId", "at");
CREATE INDEX "PitVehicleEditLog_storeId_at_idx" ON "PitVehicleEditLog"("storeId", "at");
