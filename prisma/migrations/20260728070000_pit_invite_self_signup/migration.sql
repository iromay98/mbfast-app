-- mbPIT加盟店の自己登録（招待リンク）対応
-- Dealer.pitOnly: mbPIT専用アカウント（ブログ投稿のみ・ECU系画面は見せない）
ALTER TABLE "Dealer" ADD COLUMN "pitOnly" BOOLEAN NOT NULL DEFAULT false;

-- 招待トークン（単回使用・本部発行）
CREATE TABLE "PitInvite" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "usedAt" TIMESTAMP(3),
    "storeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PitInvite_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PitInvite_token_key" ON "PitInvite"("token");
