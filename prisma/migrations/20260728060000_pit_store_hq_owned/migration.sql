-- 本店直営のmbPIT店舗（代理店に紐づかないPitStore）を許可する。
-- dealerId が NULL の行は複数あってもよい（Postgres の UNIQUE は NULL を重複扱いしない）。
ALTER TABLE "PitStore" ALTER COLUMN "dealerId" DROP NOT NULL;
