-- 加盟店のSNS連携（1店 × 1媒体 = 1行）。
-- 媒体を増やすたびに PitStore へカラムを生やさずに済むよう、1テーブルにまとめる。
-- トークンはその店のアカウントを操作できる鍵なので、必ず暗号化して入れる。
CREATE TABLE "PitSocialAccount" (
    "id"              TEXT NOT NULL,
    "storeId"         TEXT NOT NULL,
    "provider"        TEXT NOT NULL,
    "externalId"      TEXT NOT NULL DEFAULT '',
    "displayName"     TEXT NOT NULL DEFAULT '',
    "refreshTokenEnc" TEXT,
    "accessTokenEnc"  TEXT,
    "expiresAt"       TIMESTAMP(3),
    "postingEnabled"  BOOLEAN NOT NULL DEFAULT false,
    "connectedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt"       TIMESTAMP(3),
    "lastError"       TEXT,
    CONSTRAINT "PitSocialAccount_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PitSocialAccount_storeId_provider_key" ON "PitSocialAccount"("storeId", "provider");
CREATE INDEX "PitSocialAccount_provider_postingEnabled_idx" ON "PitSocialAccount"("provider", "postingEnabled");
ALTER TABLE "PitSocialAccount" ADD CONSTRAINT "PitSocialAccount_storeId_fkey"
  FOREIGN KEY ("storeId") REFERENCES "PitStore"("id") ON DELETE CASCADE ON UPDATE CASCADE;
