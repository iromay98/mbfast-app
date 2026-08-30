-- 本店GBPへの過去記事ドリップ投稿の台帳（毎朝1件・wpPostIdで二重投稿防止）
CREATE TABLE "GbpDripPost" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "wpPostId" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "gbpPostName" TEXT,
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "GbpDripPost_wpPostId_key" ON "GbpDripPost"("wpPostId");
