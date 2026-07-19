-- 実車開発モード: 候補ファイルのツリー（良い/ダメで次を開放）
ALTER TABLE "ServiceRecord" ADD COLUMN "devMode" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ServiceRecord" ADD COLUMN "devCurrentNodeId" TEXT;

CREATE TABLE "DevNode" (
    "id" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "note" TEXT,
    "filePath" TEXT,
    "fileName" TEXT,
    "fileHash" TEXT,
    "okNextId" TEXT,
    "ngNextId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DevNode_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "DevNode_recordId_sortOrder_idx" ON "DevNode"("recordId", "sortOrder");
ALTER TABLE "DevNode" ADD CONSTRAINT "DevNode_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "ServiceRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "DevTrial" (
    "id" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "comment" TEXT,
    "byUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DevTrial_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "DevTrial_recordId_createdAt_idx" ON "DevTrial"("recordId", "createdAt");
ALTER TABLE "DevTrial" ADD CONSTRAINT "DevTrial_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "DevNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
