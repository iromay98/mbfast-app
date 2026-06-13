-- CreateTable
CREATE TABLE "EcuRule" (
    "id" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "matchKey" TEXT NOT NULL,
    "value" TEXT,
    "beforeMarker" TEXT,
    "tokenRegex" TEXT,
    "sourceBaseFileId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EcuRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EcuRule_kind_idx" ON "EcuRule"("kind");

-- CreateIndex
CREATE INDEX "EcuRule_field_idx" ON "EcuRule"("field");

-- CreateIndex
CREATE INDEX "EcuRule_matchKey_idx" ON "EcuRule"("matchKey");
