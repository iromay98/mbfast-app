-- 代理店にECU業務フラグを追加。既定 true＝既存の代理店はそのままON（施工依頼・記録が出る）。
-- false にするとECUの特殊機能（施工依頼・記録）を出さない（コーティング等の別業種向け）。
ALTER TABLE "Dealer" ADD COLUMN "ecuEnabled" BOOLEAN NOT NULL DEFAULT true;
