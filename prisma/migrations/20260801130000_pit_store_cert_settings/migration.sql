-- mbPIT: 施工証明書の体裁・記載範囲と、AI記事の公開前確認を店舗ごとに設定できるようにする。
--
-- certBrandName … 帳票の左上に出す「その店舗のブランド名」（会社名ではない）。空なら displayName にフォールバック。
-- certShow*     … お客様へ渡す証明書・共有ページに載せる項目の可否（個人情報保護のため店舗が外せる）。
--                 既定は true（従来の見た目を変えない）。法定記録簿モードでは必須記載事項を外せない
--                 ＝アプリ側 cert-display.ts が判定する（DBの値は保存したまま「載せないだけ」）。
-- postReviewRequired … AI記事を公開前に人が確認するか。既定 false（従来どおり生成して公開）。
--
-- いずれも WordPress へは同期しない（store-meta.ts の STORE_META_FIELDS に載せない）。
ALTER TABLE "PitStore"
  ADD COLUMN "certBrandName" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "certShowCustomerName" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "certShowCustomerAddress" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "certShowCustomerTel" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "certShowAmount" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "postReviewRequired" BOOLEAN NOT NULL DEFAULT false;

-- 生成した記事本文。公開前確認（status='review'）で店舗が中身を読めるようにするため保存する。
ALTER TABLE "PitPost" ADD COLUMN "bodyHtml" TEXT;
