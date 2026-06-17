-- 候補トークンの出現ファイル記録（複数ファイル共通の定数を検出して除外するため）
CREATE TABLE "EcuTokenSeen" (
    "token" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    CONSTRAINT "EcuTokenSeen_pkey" PRIMARY KEY ("token","hash")
);
CREATE INDEX "EcuTokenSeen_token_idx" ON "EcuTokenSeen"("token");
