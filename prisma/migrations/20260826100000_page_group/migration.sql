-- グレード統合: 同じpageGroupの車両を1つの車両ページ(タブ切替)に統合する
ALTER TABLE "PriceVehicle" ADD COLUMN "pageGroup" TEXT;
