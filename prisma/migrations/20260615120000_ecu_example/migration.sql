-- 本店が確定した識別子の実例（AIのfew-shot学習用）
CREATE TABLE "EcuExample" (
    "id" TEXT NOT NULL,
    "manufacturer" TEXT NOT NULL,
    "ecu" TEXT,
    "cal" TEXT,
    "sw" TEXT,
    "hw" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EcuExample_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "EcuExample_manufacturer_idx" ON "EcuExample"("manufacturer");
