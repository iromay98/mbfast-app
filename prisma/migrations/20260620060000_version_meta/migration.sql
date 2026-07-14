-- 版(TunedVariantVersion)に ver名(label) と特徴メモ(note) を追加
ALTER TABLE "TunedVariantVersion" ADD COLUMN "label" TEXT;
ALTER TABLE "TunedVariantVersion" ADD COLUMN "note" TEXT;
