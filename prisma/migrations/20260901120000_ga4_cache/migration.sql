-- mbPIT記事の閲覧実績キャッシュ（GA4・加盟店ホームで自動表示するため）
ALTER TABLE "PitStore" ADD COLUMN "ga4Cache"    JSONB;
ALTER TABLE "PitStore" ADD COLUMN "ga4CachedAt" TIMESTAMP(3);
