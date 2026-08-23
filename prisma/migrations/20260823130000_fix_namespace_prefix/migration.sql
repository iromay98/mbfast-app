-- メーカー追加画面が末尾ハイフン無しの接頭辞（"peugeot"）を保存できてしまっていた不具合の修正。
-- 既存データを規定形式（"peugeot-"）に直す。
UPDATE "PriceBrand"
SET "namespacePrefix" = "namespacePrefix" || '-'
WHERE "namespacePrefix" NOT LIKE '%-';
