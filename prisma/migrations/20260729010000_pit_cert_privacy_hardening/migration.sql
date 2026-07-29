-- 施工証明書 Step A の修正（レビュー反映）
-- 1. 照合は既存の下3桁に合わせる（新たな平文断片を増やさない）
ALTER TABLE "PitCertificate" RENAME COLUMN "verifyLast4" TO "verifyLast3";

-- 2. 証明書作成の失敗を可視化（沈黙させない）
ALTER TABLE "PitCertificate" ADD COLUMN "errorMessage" TEXT NOT NULL DEFAULT '';

-- 3. 保存期間は目的別（加盟店退会時もこの日までは削除しない）
--    legal_record = 記載日から2年 / warranty = 保証期間満了まで / none = 保持理由なし
ALTER TABLE "PitCertificate" ADD COLUMN "retentionUntil" TIMESTAMP(3);
ALTER TABLE "PitCertificate" ADD COLUMN "retentionReason" TEXT NOT NULL DEFAULT 'none';

-- 4. 個人情報（車台番号・登録番号）の復号アクセスログ
CREATE TABLE "PitPiiAccessLog" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "actorRole" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "certificateId" TEXT,
    "vehicleId" TEXT,
    "keyId" TEXT,
    "ok" BOOLEAN NOT NULL DEFAULT true,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PitPiiAccessLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PitPiiAccessLog_certificateId_at_idx" ON "PitPiiAccessLog"("certificateId", "at");
CREATE INDEX "PitPiiAccessLog_actorUserId_at_idx" ON "PitPiiAccessLog"("actorUserId", "at");
