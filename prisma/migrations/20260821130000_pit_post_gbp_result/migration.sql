-- 施工記録ごとのGoogleマップ投稿の結果を残す。
-- GBPの投稿は作成後に編集できず削除しかできないため、「何をいつ出したか」を
-- 追えるようにしておく（取り消しには gbpPostName が要る）。
ALTER TABLE "PitPost" ADD COLUMN "gbpPostName" TEXT;
ALTER TABLE "PitPost" ADD COLUMN "gbpPostedAt" TIMESTAMP(3);
ALTER TABLE "PitPost" ADD COLUMN "gbpError"    TEXT;
