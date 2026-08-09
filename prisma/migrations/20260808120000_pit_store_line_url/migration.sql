-- 店舗マスターに公式LINE URLを追加（→ WP term meta mbpit_line。HP側で「LINEで問い合わせ」ボタンになる）
ALTER TABLE "PitStore" ADD COLUMN "lineUrl" TEXT NOT NULL DEFAULT '';
