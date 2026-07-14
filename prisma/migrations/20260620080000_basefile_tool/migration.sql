-- 読み取りツール（AT=AutoTuner / PG3=Powergate3 / K3=Kess3 / 任意追加）
ALTER TABLE "BaseFile" ADD COLUMN "tool" TEXT NOT NULL DEFAULT 'AT';
