-- mbPIT 施工証明書 Step A: 車両マスター拡張・顧客情報拡張・証明書・種別モジュール値・
-- 添付メディア・所有履歴・同意記録。
-- 方針: 履歴は「人」ではなく「車」に紐づける（証明書は vehicleId 直参照）。
-- 車台番号・登録番号は平文で持たず暗号化して保存する（復号は証明書/記録簿の出力時のみ）。

-- 車両マスター
ALTER TABLE "PitVehicle" ADD COLUMN "vinEnc" TEXT;
ALTER TABLE "PitVehicle" ADD COLUMN "regNumberEnc" TEXT;
ALTER TABLE "PitVehicle" ADD COLUMN "maker" TEXT;
ALTER TABLE "PitVehicle" ADD COLUMN "firstRegisteredOn" TIMESTAMP(3);

-- 顧客情報（法定記録簿の依頼者住所・連絡先）
ALTER TABLE "PitCustomer" ADD COLUMN "address" TEXT NOT NULL DEFAULT '';
ALTER TABLE "PitCustomer" ADD COLUMN "email" TEXT NOT NULL DEFAULT '';

-- 事業場区分（法定記録簿モードの出し分け）
ALTER TABLE "PitStore" ADD COLUMN "facilityType" TEXT NOT NULL DEFAULT 'general';
ALTER TABLE "PitStore" ADD COLUMN "certificationNo" TEXT NOT NULL DEFAULT '';

-- 車両と顧客の関連（所有権移転に備えて期間を持つ）
CREATE TABLE "PitVehicleCustomer" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "startedOn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedOn" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PitVehicleCustomer_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PitVehicleCustomer_vehicleId_customerId_startedOn_key" ON "PitVehicleCustomer"("vehicleId", "customerId", "startedOn");
CREATE INDEX "PitVehicleCustomer_vehicleId_endedOn_idx" ON "PitVehicleCustomer"("vehicleId", "endedOn");
ALTER TABLE "PitVehicleCustomer" ADD CONSTRAINT "PitVehicleCustomer_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "PitVehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PitVehicleCustomer" ADD CONSTRAINT "PitVehicleCustomer_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "PitCustomer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 施工証明書
CREATE TABLE "PitCertificate" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "customerId" TEXT,
    "shareToken" TEXT NOT NULL,
    "shareRevoked" BOOLEAN NOT NULL DEFAULT false,
    "verifyLast4" TEXT NOT NULL DEFAULT '',
    "serviceDate" TIMESTAMP(3) NOT NULL,
    "odometerKm" INTEGER,
    "staffName" TEXT NOT NULL DEFAULT '',
    "staffLicenseNo" TEXT NOT NULL DEFAULT '',
    "workSummary" TEXT NOT NULL DEFAULT '',
    "totalAmount" INTEGER,
    "restorationCostEstimate" INTEGER,
    "certificateType" TEXT NOT NULL,
    "legalRecord" BOOLEAN NOT NULL DEFAULT false,
    "payloadHash" TEXT NOT NULL DEFAULT '',
    "issuedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'draft',
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT NOT NULL DEFAULT '',
    "replacesId" TEXT,
    "blogPostId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PitCertificate_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PitCertificate_shareToken_key" ON "PitCertificate"("shareToken");
CREATE INDEX "PitCertificate_storeId_createdAt_idx" ON "PitCertificate"("storeId", "createdAt");
CREATE INDEX "PitCertificate_vehicleId_serviceDate_idx" ON "PitCertificate"("vehicleId", "serviceDate");
CREATE INDEX "PitCertificate_status_idx" ON "PitCertificate"("status");
ALTER TABLE "PitCertificate" ADD CONSTRAINT "PitCertificate_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "PitVehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PitCertificate" ADD CONSTRAINT "PitCertificate_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "PitStore"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PitCertificate" ADD CONSTRAINT "PitCertificate_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "PitCustomer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PitCertificate" ADD CONSTRAINT "PitCertificate_blogPostId_fkey" FOREIGN KEY ("blogPostId") REFERENCES "PitPost"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 施工種別モジュールの値（key-value。項目追加でスキーマ変更しない）
CREATE TABLE "PitCertificateDetail" (
    "id" TEXT NOT NULL,
    "certificateId" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "fieldKey" TEXT NOT NULL,
    "fieldValue" TEXT NOT NULL DEFAULT '',
    "unit" TEXT NOT NULL DEFAULT '',
    CONSTRAINT "PitCertificateDetail_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PitCertificateDetail_certificateId_module_fieldKey_key" ON "PitCertificateDetail"("certificateId", "module", "fieldKey");
ALTER TABLE "PitCertificateDetail" ADD CONSTRAINT "PitCertificateDetail_certificateId_fkey" FOREIGN KEY ("certificateId") REFERENCES "PitCertificate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 添付メディア（公開可否を isPublicSafe で明示。車検証・ナンバー写りは false のまま）
CREATE TABLE "PitCertificateMedia" (
    "id" TEXT NOT NULL,
    "certificateId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "takenAt" TIMESTAMP(3),
    "exifJson" JSONB,
    "hash" TEXT NOT NULL DEFAULT '',
    "isPublicSafe" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PitCertificateMedia_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PitCertificateMedia_certificateId_idx" ON "PitCertificateMedia"("certificateId");
ALTER TABLE "PitCertificateMedia" ADD CONSTRAINT "PitCertificateMedia_certificateId_fkey" FOREIGN KEY ("certificateId") REFERENCES "PitCertificate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 第三者提供の同意記録（Phase2の所有権移転で必要。後付けが困難なため器だけ用意）
CREATE TABLE "PitConsent" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "vehicleId" TEXT,
    "purpose" TEXT NOT NULL,
    "textVersion" TEXT NOT NULL DEFAULT '',
    "agreedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "agreedVia" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    CONSTRAINT "PitConsent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PitConsent_customerId_purpose_idx" ON "PitConsent"("customerId", "purpose");
ALTER TABLE "PitConsent" ADD CONSTRAINT "PitConsent_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "PitCustomer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
