-- 記録単位のファイル形式（MASTER=生bin交換: Kess3 Master・Powergate3等、AutoTuner再暗号化なし）
-- 既存レコードは SLAVE 初期化。MASTER店(OBLY等)の既存記録は Dealer.fileFormat 側のORで従来どおり動く。
ALTER TABLE "ServiceRecord" ADD COLUMN "fileFormat" TEXT NOT NULL DEFAULT 'SLAVE';
