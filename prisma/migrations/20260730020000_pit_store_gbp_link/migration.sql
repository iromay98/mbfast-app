-- Googleビジネスプロフィール（Googleマップ投稿）の紐付け情報。
-- 紐付けは人が選ぶ運用のため自動照合用の列は持たない。
-- gbpLocationId は一意＝同じロケーションを2店舗に割り当てられない（誤配信防止）。
ALTER TABLE "PitStore"
  ADD COLUMN "gbpAccountId" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "gbpLocationId" TEXT,
  ADD COLUMN "gbpLocationName" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "gbpLocationAddr" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "gbpLinkedAt" TIMESTAMP(3),
  ADD COLUMN "gbpLinkedByUserId" TEXT,
  ADD COLUMN "gbpPostingEnabled" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX "PitStore_gbpLocationId_key" ON "PitStore"("gbpLocationId");
