-- CreateTable
CREATE TABLE "RecordMessage" (
    "id" TEXT NOT NULL,
    "serviceRecordId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "authorRole" "Role" NOT NULL,
    "body" TEXT,
    "filePath" TEXT,
    "fileName" TEXT,
    "fileSize" INTEGER,
    "contentType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecordMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RecordMessage_serviceRecordId_idx" ON "RecordMessage"("serviceRecordId");

-- AddForeignKey
ALTER TABLE "RecordMessage" ADD CONSTRAINT "RecordMessage_serviceRecordId_fkey" FOREIGN KEY ("serviceRecordId") REFERENCES "ServiceRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecordMessage" ADD CONSTRAINT "RecordMessage_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
