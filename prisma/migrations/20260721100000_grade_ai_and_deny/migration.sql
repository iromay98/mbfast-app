-- AI推定のグレード/世代 と Cal誤認の拒否リスト
ALTER TABLE "ServiceRecord" ADD COLUMN "carGrade" TEXT;
ALTER TABLE "ServiceRecord" ADD COLUMN "carGeneration" TEXT;

CREATE TABLE "EcuDenyToken" (
    "token" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EcuDenyToken_pkey" PRIMARY KEY ("token")
);

-- 既知の誤認値（Mercedes系dumpに共通のライブラリ定数）
INSERT INTO "EcuDenyToken" ("token", "note") VALUES ('2789036001', 'M278系dump共通の定数。Calではない（ユーザー報告）') ON CONFLICT DO NOTHING;
