CREATE TABLE "PriceSyncLog" (
    "id" TEXT NOT NULL,
    "wpPageId" INTEGER NOT NULL,
    "brandIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "payloadHash" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "backup" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceSyncLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PriceSyncLog_wpPageId_createdAt_idx" ON "PriceSyncLog"("wpPageId", "createdAt");
