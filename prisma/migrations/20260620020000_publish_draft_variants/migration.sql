-- 修正前にカタログ/未整備からアップされた mod（ファイル実体あり・下書きのまま）を配布可に。
-- ファイル未添付の枠(fileRef NULL)と削除済み・無効(DISABLED)は触らない。
UPDATE "TunedVariant" SET "status" = 'AVAILABLE'
WHERE "status" = 'DRAFT' AND "fileRef" IS NOT NULL AND "deletedAt" IS NULL;
