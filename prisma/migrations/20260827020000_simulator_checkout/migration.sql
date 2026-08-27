-- 見積りシミュレーター+決済: 施工メニューのWooバリエーションID対応と、オプションのJP商品ID
ALTER TABLE "PriceVehicle" ADD COLUMN "wcMenuVariations" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "VehiclePageOption" ADD COLUMN "wcProductIdJa" INTEGER;
