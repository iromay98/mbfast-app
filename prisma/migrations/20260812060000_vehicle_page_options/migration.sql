-- 車両ページ「対応オプション」の語彙マスタ（管理画面から編集可能に）
CREATE TABLE "VehiclePageOption" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "labelJa" TEXT NOT NULL,
    "labelEn" TEXT NOT NULL,
    "shortLabel" TEXT,
    "derivedFrom" TEXT,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VehiclePageOption_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VehiclePageOption_key_key" ON "VehiclePageOption"("key");
CREATE INDEX "VehiclePageOption_displayOrder_idx" ON "VehiclePageOption"("displayOrder");

-- 既定の語彙（これまでコードに持っていた8件）を投入
INSERT INTO "VehiclePageOption" ("id","key","labelJa","labelEn","shortLabel","derivedFrom","displayOrder","enabled","updatedAt") VALUES
  ('vpo_babble','babble','バブリング（ポップス＆バングス）','Pops and Bangs (Burble)','バブ','babble',10,true,CURRENT_TIMESTAMP),
  ('vpo_dragon','dragonAfterfire','ドラゴンアフターファイヤ','Dragon Afterfire','ドラゴン',NULL,20,true,CURRENT_TIMESTAMP),
  ('vpo_coldstart','coldStartOff','コールドスタートオフ','Cold Start Off','冷始OFF',NULL,30,true,CURRENT_TIMESTAMP),
  ('vpo_idlingstop','idlingStopOff','アイドリングストップ解除','Auto Start-Stop Off','アイスト',NULL,40,true,CURRENT_TIMESTAMP),
  ('vpo_mapswitch','mapSwitch','マップスイッチ','Map Switch','MapSW',NULL,50,true,CURRENT_TIMESTAMP),
  ('vpo_ecuunlock','ecuUnlock','ECUアンロック（要ベンチ作業）','ECU Unlock (bench required)','解錠要',NULL,60,true,CURRENT_TIMESTAMP),
  ('vpo_limitercut','limiterCut','スピードリミッター解除','Speed Limiter Removal','リミッタ','limiterCut',70,true,CURRENT_TIMESTAMP),
  ('vpo_tcu','tcu','TCUチューニング','TCU Tuning','TCU','tcu',80,true,CURRENT_TIMESTAMP);
