-- Mercedes 系メーカー表記を "Mercedes" に統合（既存データ）
UPDATE "BaseFile"
SET "manufacturer" = 'Mercedes'
WHERE "manufacturer" IN ('Mercedes-Benz', 'Mercedes-AMG', 'Mercedes-benz', 'Benz', 'AMG');

UPDATE "ServiceRecord"
SET "carMaker" = 'Mercedes'
WHERE "carMaker" IN ('Mercedes-Benz', 'Mercedes-AMG', 'Mercedes-benz', 'Benz', 'AMG');
