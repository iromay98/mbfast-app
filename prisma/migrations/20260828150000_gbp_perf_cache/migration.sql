-- Googleでの表示実績のキャッシュ（加盟店ホームで自動表示するため）。
-- 開くたびにGoogleへ問い合わせず、1日1回だけ取得して使い回す。
ALTER TABLE "PitStore" ADD COLUMN "gbpPerfCache"    JSONB;
ALTER TABLE "PitStore" ADD COLUMN "gbpPerfCachedAt" TIMESTAMP(3);
