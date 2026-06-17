-- 識別子の由来・確信度
ALTER TABLE "ServiceRecord" ADD COLUMN "idSource" TEXT;
ALTER TABLE "ServiceRecord" ADD COLUMN "idConfidence" DOUBLE PRECISION;

-- AI抽出キャッシュ（内容hash単位）
CREATE TABLE "EcuAiCache" (
    "hash" TEXT NOT NULL,
    "hw" TEXT,
    "sw" TEXT,
    "cal" TEXT,
    "confidence" DOUBLE PRECISION,
    "model" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EcuAiCache_pkey" PRIMARY KEY ("hash")
);
