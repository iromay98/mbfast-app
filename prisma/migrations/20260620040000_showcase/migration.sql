-- 施工事例（ショーケース）
CREATE TYPE "ShowcaseVisibility" AS ENUM ('PUBLIC', 'DEALER');

CREATE TABLE "Showcase" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "comment" TEXT,
    "carMaker" TEXT NOT NULL,
    "carModel" TEXT NOT NULL,
    "generation" TEXT,
    "grade" TEXT,
    "stage" TEXT,
    "contentLabel" TEXT,
    "embeds" JSONB NOT NULL DEFAULT '[]',
    "coverImage" TEXT,
    "visibility" "ShowcaseVisibility" NOT NULL DEFAULT 'PUBLIC',
    "createdFromRecordId" TEXT,
    "publishedById" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Showcase_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Showcase_carMaker_carModel_idx" ON "Showcase"("carMaker", "carModel");
CREATE INDEX "Showcase_visibility_idx" ON "Showcase"("visibility");
CREATE INDEX "Showcase_publishedAt_idx" ON "Showcase"("publishedAt");

ALTER TABLE "Showcase" ADD CONSTRAINT "Showcase_publishedById_fkey"
    FOREIGN KEY ("publishedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
