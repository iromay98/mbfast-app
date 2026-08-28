-- 店舗LINEの@ID(oaMessage用)キャッシュ。lin.ee短縮リンクから同期時に自動解決する
ALTER TABLE "PitStore" ADD COLUMN "lineOaId" TEXT NOT NULL DEFAULT '';
