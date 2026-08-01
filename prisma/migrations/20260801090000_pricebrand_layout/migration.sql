-- 価格表マスターの版面駆動化（Step A）:
--   blockIndex … 同一WPページ内で対象とする wp:html ブロックの位置。
--                既定0。mbd（page 9679）は 2（同ページに mb=block0 と mbd=block2 が同居）。
--   layout    … ライブWordPress HTMLから実測した版面情報（parse-wp.mts の BrandLayout）。
--                {naming, ids{search,clear,count,noResults,tbody}, classes{hidden,active},
--                 minWidth, series, placeholder, note ...}。
-- DBデータは変更しない（列追加のみ・既定値付き）。
ALTER TABLE "PriceBrand" ADD COLUMN "blockIndex" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PriceBrand" ADD COLUMN "layout" JSONB NOT NULL DEFAULT '{}';
