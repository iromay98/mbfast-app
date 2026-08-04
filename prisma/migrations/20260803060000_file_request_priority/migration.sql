-- 依頼の「重要」フラグ。一覧の最上位に固定して見落としを防ぐ。
-- 状態(status)とは独立させる（作業中でも新規でも立てられる）。
ALTER TABLE "FileRequest" ADD COLUMN "priority" BOOLEAN NOT NULL DEFAULT false;

-- 一覧は「重要が先・更新が新しい順」で引くので複合indexを張る
CREATE INDEX "FileRequest_priority_updatedAt_idx" ON "FileRequest"("priority" DESC, "updatedAt" DESC);
