-- mbPIT 施工記録 → 自動ブログ公開（店舗マスタ＋投稿ログ）
CREATE TYPE "PitCategory" AS ENUM ('ECU', 'COATING', 'POLISH', 'MAINTENANCE', 'OTHER');
CREATE TYPE "PitPostStatus" AS ENUM ('PROCESSING', 'PUBLISHED', 'HELD', 'FAILED');

CREATE TABLE "PitStore" (
    "id" TEXT NOT NULL,
    "dealerId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "wpCategoryId" INTEGER NOT NULL,
    "storeSlug" TEXT NOT NULL,
    "footerHtml" TEXT NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PitStore_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PitStore_dealerId_key" ON "PitStore"("dealerId");
ALTER TABLE "PitStore" ADD CONSTRAINT "PitStore_dealerId_fkey" FOREIGN KEY ("dealerId") REFERENCES "Dealer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "PitPost" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "dealerId" TEXT NOT NULL,
    "vehicle" TEXT NOT NULL,
    "category" "PitCategory" NOT NULL,
    "memo" TEXT,
    "photoPaths" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "processedPaths" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "PitPostStatus" NOT NULL DEFAULT 'PROCESSING',
    "holdReason" TEXT,
    "error" TEXT,
    "guardResult" JSONB,
    "cautionAdded" BOOLEAN NOT NULL DEFAULT false,
    "plateBlurLog" JSONB,
    "title" TEXT,
    "slug" TEXT,
    "wpPostId" INTEGER,
    "publishedUrl" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PitPost_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PitPost_storeId_idx" ON "PitPost"("storeId");
CREATE INDEX "PitPost_dealerId_idx" ON "PitPost"("dealerId");
CREATE INDEX "PitPost_status_idx" ON "PitPost"("status");
CREATE INDEX "PitPost_createdAt_idx" ON "PitPost"("createdAt");
ALTER TABLE "PitPost" ADD CONSTRAINT "PitPost_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "PitStore"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
