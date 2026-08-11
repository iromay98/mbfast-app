-- 車両バリアント個別ページ（JP/EN）の管理テーブル。マスタは PriceVehicle。
CREATE TABLE "VehiclePage" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'hold',
    "options" JSONB NOT NULL DEFAULT '{}',
    "relatedPosts" JSONB NOT NULL DEFAULT '[]',
    "enPriceMode" TEXT NOT NULL DEFAULT 'quote',
    "wpPageIdJp" INTEGER,
    "wpPageIdEn" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VehiclePage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VehiclePage_vehicleId_key" ON "VehiclePage"("vehicleId");
CREATE UNIQUE INDEX "VehiclePage_slug_key" ON "VehiclePage"("slug");
CREATE INDEX "VehiclePage_status_idx" ON "VehiclePage"("status");

ALTER TABLE "VehiclePage" ADD CONSTRAINT "VehiclePage_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "PriceVehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
