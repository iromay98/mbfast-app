-- 代理店のやり取りファイル形式。SLAVE=AutoTunerスレーブ / MASTER=Powergate3のMaster File(生bin)。
ALTER TABLE "Dealer" ADD COLUMN "fileFormat" TEXT NOT NULL DEFAULT 'SLAVE';
