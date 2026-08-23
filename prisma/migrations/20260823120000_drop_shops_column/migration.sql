-- 全ブランドの列定義から「対応店舗」(shops) 列を外す（2026-08-23 更家さん指示）。
-- 車両データ側の shops フィールドは消さない＝列を編集画面で戻せば値も戻る。
UPDATE "PriceBrand" pb
SET "columns" = COALESCE(
  (
    SELECT jsonb_agg(elem ORDER BY ord)
    FROM jsonb_array_elements(pb."columns") WITH ORDINALITY AS t(elem, ord)
    WHERE elem->>'key' <> 'shops'
  ),
  '[]'::jsonb
)
WHERE pb."columns" @> '[{"key": "shops"}]'::jsonb;
