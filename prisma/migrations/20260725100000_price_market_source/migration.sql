-- price-sync-spec v1: 市場別レコード・取込元・WooCommerce紐付け
ALTER TABLE "PriceVehicle" ADD COLUMN "market" TEXT NOT NULL DEFAULT 'JP';
ALTER TABLE "PriceVehicle" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'html';
ALTER TABLE "PriceVehicle" ADD COLUMN "wcProductId" INTEGER;
CREATE INDEX "PriceVehicle_market_idx" ON "PriceVehicle"("market");
