-- 方式B（加盟店が自分でGoogleログインして自店を選ぶ）のための列を追加する。
-- 既存店は全て方式A（本部が紐付け）なので既定値 'HQ' で始まる。
-- リフレッシュトークンは暗号化して保存する（src/server/pit/gbp/token-crypto.ts）。
ALTER TABLE "PitStore" ADD COLUMN "gbpAuthMode"        TEXT NOT NULL DEFAULT 'HQ';
ALTER TABLE "PitStore" ADD COLUMN "gbpRefreshTokenEnc" TEXT;
ALTER TABLE "PitStore" ADD COLUMN "gbpAuthEmail"       TEXT NOT NULL DEFAULT '';
ALTER TABLE "PitStore" ADD COLUMN "gbpAuthAt"          TIMESTAMP(3);
ALTER TABLE "PitStore" ADD COLUMN "gbpAuthRevokedAt"   TIMESTAMP(3);
