-- mbPIT 店舗マスター: 店舗情報（所在地・営業時間等）をアプリで一元管理し WP term meta へ投影する
ALTER TABLE "PitStore" ADD COLUMN "area" TEXT NOT NULL DEFAULT '';
ALTER TABLE "PitStore" ADD COLUMN "address" TEXT NOT NULL DEFAULT '';
ALTER TABLE "PitStore" ADD COLUMN "hours" TEXT NOT NULL DEFAULT '';
ALTER TABLE "PitStore" ADD COLUMN "closedDays" TEXT NOT NULL DEFAULT '';
ALTER TABLE "PitStore" ADD COLUMN "tel" TEXT NOT NULL DEFAULT '';
ALTER TABLE "PitStore" ADD COLUMN "email" TEXT NOT NULL DEFAULT '';
ALTER TABLE "PitStore" ADD COLUMN "website" TEXT NOT NULL DEFAULT '';
ALTER TABLE "PitStore" ADD COLUMN "serviceTags" TEXT NOT NULL DEFAULT '';
ALTER TABLE "PitStore" ADD COLUMN "intro" TEXT NOT NULL DEFAULT '';
ALTER TABLE "PitStore" ADD COLUMN "contactPerson" TEXT NOT NULL DEFAULT '';
ALTER TABLE "PitStore" ADD COLUMN "internalNote" TEXT NOT NULL DEFAULT '';
ALTER TABLE "PitStore" ADD COLUMN "plan" TEXT NOT NULL DEFAULT 'record';
ALTER TABLE "PitStore" ADD COLUMN "wpCategorySlug" TEXT NOT NULL DEFAULT '';
ALTER TABLE "PitStore" ADD COLUMN "wpPageId" INTEGER;
ALTER TABLE "PitStore" ADD COLUMN "lastSyncedAt" TIMESTAMP(3);

CREATE TABLE "PitStoreSyncLog" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "prevMeta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PitStoreSyncLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PitStoreSyncLog_storeId_createdAt_idx" ON "PitStoreSyncLog"("storeId", "createdAt");
