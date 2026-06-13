-- Driver情報を mod(版) から 純正(BaseFile) へ移動（純正ECU基準で管理）。
-- 既存の TunedVariant 側は default(false)/null のみで実データ無し → 安全に削除。

-- AlterTable: 純正に Driver 情報を追加
ALTER TABLE "BaseFile" ADD COLUMN "driver" TEXT;
ALTER TABLE "BaseFile" ADD COLUMN "driverBorrowed" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable: 版側の Driver 情報を削除
ALTER TABLE "TunedVariant" DROP COLUMN "driver";
ALTER TABLE "TunedVariant" DROP COLUMN "driverBorrowed";
