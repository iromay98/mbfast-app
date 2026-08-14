-- mbPIT店舗マスタに地図情報を追加する。
-- 加盟店はGoogleマップの共有URL（mapUrl）を貼るだけでよく、lat/lng は保存時に
-- アプリ側が機械的に解決して埋める（src/server/pit/store-geo.ts）。
-- 既存行は空文字で始まり、表示側は座標が無ければ住所検索リンクにフォールバックする。
ALTER TABLE "PitStore" ADD COLUMN "mapUrl" TEXT NOT NULL DEFAULT '';
ALTER TABLE "PitStore" ADD COLUMN "lat"    TEXT NOT NULL DEFAULT '';
ALTER TABLE "PitStore" ADD COLUMN "lng"    TEXT NOT NULL DEFAULT '';
