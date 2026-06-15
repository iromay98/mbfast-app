-- ServiceRecord: 復号の backup_supported（リアル/ヴァーチャル判定 → 純正復元名 backup/ori）
ALTER TABLE "ServiceRecord" ADD COLUMN "backupSupported" BOOLEAN;

-- BaseFile: スピードリミッターカット不可フラグ（本店設定）
ALTER TABLE "BaseFile" ADD COLUMN "limiterCutDisabled" BOOLEAN NOT NULL DEFAULT false;
