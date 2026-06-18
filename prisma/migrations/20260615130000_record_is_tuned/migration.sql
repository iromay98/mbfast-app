-- アップしたスレーブが既にチューニング済みか
ALTER TABLE "ServiceRecord" ADD COLUMN "isTuned" BOOLEAN NOT NULL DEFAULT false;
