-- mbPIT: 施工記録→自動ブログ公開
CREATE TABLE "PitStore" (
    "id" TEXT NOT NULL,
    "dealerId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "wpCategoryId" INTEGER NOT NULL,
    "footerHtml" TEXT NOT NULL DEFAULT '',
    "faqJson" JSONB NOT NULL DEFAULT '[]',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PitStore_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PitStore_dealerId_key" ON "PitStore"("dealerId");
CREATE UNIQUE INDEX "PitStore_slug_key" ON "PitStore"("slug");
ALTER TABLE "PitStore" ADD CONSTRAINT "PitStore_dealerId_fkey" FOREIGN KEY ("dealerId") REFERENCES "Dealer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "PitPost" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "vehicle" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "memo" TEXT,
    "photoKeys" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'processing',
    "guardResult" TEXT,
    "title" TEXT,
    "wpPostId" INTEGER,
    "publishedUrl" TEXT,
    "errorMessage" TEXT,
    "plateLog" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PitPost_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PitPost_storeId_createdAt_idx" ON "PitPost"("storeId", "createdAt");
CREATE INDEX "PitPost_status_idx" ON "PitPost"("status");
ALTER TABLE "PitPost" ADD CONSTRAINT "PitPost_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "PitStore"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
