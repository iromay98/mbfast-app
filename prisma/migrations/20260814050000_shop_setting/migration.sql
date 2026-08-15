-- 購入導線の全体設定（送料・端末価格）
CREATE TABLE "ShopSetting" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "shippingDomesticJpy" INTEGER NOT NULL DEFAULT 0,
    "shippingOverseasJpy" JSONB NOT NULL DEFAULT '{}',
    "deviceAtOneJpy" INTEGER,
    "deviceIxiJpy" INTEGER,
    "mailInBaseFeeJpy" INTEGER,
    "usdRate" INTEGER,
    "notesJa" TEXT,
    "notesEn" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopSetting_pkey" PRIMARY KEY ("id")
);

INSERT INTO "ShopSetting" ("id","updatedAt") VALUES ('default', CURRENT_TIMESTAMP);

-- 車両ごとの提供方式（対面/AT One/IXI/ECU郵送）。未設定キーは「不可」として扱う
ALTER TABLE "VehiclePage" ADD COLUMN "methods" JSONB NOT NULL DEFAULT '{}';

-- オプション料金: 既定料金（語彙マスタ）と車両ごとの上書き
ALTER TABLE "VehiclePageOption" ADD COLUMN "priceJpy" INTEGER;
ALTER TABLE "VehiclePage" ADD COLUMN "optionPrices" JSONB NOT NULL DEFAULT '{}';
