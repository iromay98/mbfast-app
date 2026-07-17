-- 価格表（ブランド定義＋車両行）
CREATE TABLE "PriceBrand" (
    "id" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "namespacePrefix" TEXT NOT NULL,
    "seriesGroups" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "columns" JSONB NOT NULL DEFAULT '[]',
    "csvMapping" JSONB NOT NULL DEFAULT '{}',
    "intro" TEXT NOT NULL DEFAULT '',
    "jsonLdDescription" TEXT NOT NULL DEFAULT '',
    "wordPressPageId" INTEGER,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PriceBrand_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PriceBrand_slug_key" ON "PriceBrand"("slug");

CREATE TABLE "PriceVehicle" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "seriesGroup" TEXT NOT NULL,
    "carName" TEXT NOT NULL,
    "grade" TEXT,
    "engine" TEXT NOT NULL DEFAULT '',
    "engineFamily" TEXT,
    "ecuType" TEXT,
    "stockOutput" TEXT,
    "stage1Gain" TEXT,
    "prices" JSONB NOT NULL DEFAULT '{}',
    "labor" TEXT,
    "shops" TEXT,
    "remote" JSONB NOT NULL DEFAULT '{}',
    "notes" TEXT,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PriceVehicle_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PriceVehicle_brandId_displayOrder_idx" ON "PriceVehicle"("brandId", "displayOrder");
CREATE INDEX "PriceVehicle_brandId_seriesGroup_idx" ON "PriceVehicle"("brandId", "seriesGroup");
ALTER TABLE "PriceVehicle" ADD CONSTRAINT "PriceVehicle_brandId_fkey"
    FOREIGN KEY ("brandId") REFERENCES "PriceBrand"("id") ON DELETE CASCADE ON UPDATE CASCADE;
