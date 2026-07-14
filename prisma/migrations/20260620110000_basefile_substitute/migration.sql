-- 準用グループ（同一キャリブレーション・別ツール準用の紐付けキー）
ALTER TABLE "BaseFile" ADD COLUMN "substituteKey" TEXT;
CREATE INDEX "BaseFile_substituteKey_idx" ON "BaseFile"("substituteKey");
