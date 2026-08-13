-- 代理店の契約管理（1年更新の開始日・周期・見直し猶予・解約日・本部メモ）
ALTER TABLE "Dealer" ADD COLUMN "contractStartedAt" TIMESTAMP(3);
ALTER TABLE "Dealer" ADD COLUMN "contractRenewalMonths" INTEGER NOT NULL DEFAULT 12;
ALTER TABLE "Dealer" ADD COLUMN "contractNoticeDays" INTEGER NOT NULL DEFAULT 60;
ALTER TABLE "Dealer" ADD COLUMN "contractEndedAt" TIMESTAMP(3);
ALTER TABLE "Dealer" ADD COLUMN "contractNote" TEXT;

-- 更新が近い代理店の抽出は開始日で並べるため索引を付ける
CREATE INDEX "Dealer_contractStartedAt_idx" ON "Dealer"("contractStartedAt");
