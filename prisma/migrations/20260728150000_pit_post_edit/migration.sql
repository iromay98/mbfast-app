-- 公開後の編集: 追記（訂正・補足）テキストを保持する。
-- 削除は status = 'deleted'（WordPress側はゴミ箱へ移動して復元可能にする）。
ALTER TABLE "PitPost" ADD COLUMN "editNote" TEXT NOT NULL DEFAULT '';
