-- jsonLdDescription を公開HTML実物に合わせる補正（scripts/fix-price-descriptions.mts が生成）
UPDATE "PriceBrand" SET "jsonLdDescription"='BMW全車種(1〜8シリーズ・X1〜X7・Z3〜Z8・i8・Mモデル)対応のECUチューニング・バブリング施工サービス。B58・N55・S58・S55など全エンジン対応。', "updatedAt"=now() WHERE id='bmw';
UPDATE "PriceBrand" SET "jsonLdDescription"='メルセデス・ベンツ全車種(A/B/C/CLA/CLS/E/S/SL/G/GLA/GLC/GLE/GT/AMG)対応のECUチューニング・バブリング施工サービス。M133・M139・M177・M178・M157・M276・M278など全エンジン対応。', "updatedAt"=now() WHERE id='mercedes_gasoline';
UPDATE "PriceBrand" SET "jsonLdDescription"='メルセデス・ベンツ ディーゼル車(OM642/OM651/OM654/OM656)対応のECUチューニング・アドブルーカット・DPF/EGR/NOxカット施工サービス。', "updatedAt"=now() WHERE id='mercedes_diesel';
UPDATE "PriceBrand" SET "jsonLdDescription"='Audi全車種(A/S/RS/Q/SQ/TT/R8)対応のECUチューニング・バブリング施工サービス。DSG/S tronic TCUチューニングも対応。', "updatedAt"=now() WHERE id='audi';
UPDATE "PriceBrand" SET "jsonLdDescription"='ランボルギーニ全車種(Aventador / Revuelto / Huracan / Temerario / Urus / Murcielago / Gallardo)対応のECUチューニング・バブリング・ドラゴンアフターファイヤ施工サービス。', "updatedAt"=now() WHERE id='lamborghini';
