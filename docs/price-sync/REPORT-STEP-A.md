# Step A 差分レポート — ソースA（静的HTML 4ブランド）取込＋ラウンドトリップ検証

実施日: 2026-07-25 ／ 結果: **合格（5ブランド全てライブWPコンテンツとバイト単位一致）**

## 取得

`GET /wp-json/wp/v2/pages/{id}?context=edit&_fields=id,slug,content.raw`（Basic認証・環境変数のみ）で4ページ取得。
価格表スニペットは各ページの `wp:html` ブロックから抽出（bmw=block0 / mercedes-benz=block0(ガソリン)+block2(ディーゼル) / audi=block0 / lamborghini=block0）。

| brand | page_id | wp:htmlブロック | 行数(モデル数) |
|---|---|---|---|
| bmw | 9614 | 0 | 307 |
| mercedes-benz(ガソリン) | 9679 | 0 | 319 |
| mercedes-benz(ディーゼル) | 9679 | 2 | 29 |
| audi | 9605 | 0 | 197 |
| lamborghini | 9668 | 0 | 18 |

## 正規化の取り決め（許容差分）

- **数値文字参照 ⇄ 生文字**（例: `&#x1f50d;` ⇄ 🔍）は同値として扱う。WordPressエディタが保存時に絵文字を実体参照へ再エンコードするため。canonical（reference/生成）は生文字で保持し、比較・payload_hash計算時に正規化する。
- それ以外（価格値・モデル数・列構成・クラス名・属性順・空白）は**差分ゼロで一致**（空白・属性順の許容枠は使っていない）。

## ブランド別の発見事項

| brand | 手元zip版との差 | 対応 |
|---|---|---|
| bmw | 実体参照のみ（内容差分ゼロ） | referenceをライブ版に更新 |
| mercedes(ガソリン) | 実体参照のみ | 同上 |
| lamborghini | 実体参照のみ | 同上 |
| **audi** | **A6(C7)の2行でバブリング¥165,000が取り下げられLINE問合せ化**（実際の価格改定） | ライブを正として再取込。DBに反映済み |
| **mercedes(ディーゼル)** | **mbd-名前空間が廃止され、ガソリン表と同じ流儀に全面改修**: `mb-price-wrapper mb-diesel-wrapper` / セルは無印`cell-*` / `data-search`+`data-engine-family`+`data-series` / 工賃列が出力列の後ろへ移動 / ask-btnのラベル「ECU+アドブルーカット」 | パーサー・生成エンジン・テンプレートを全てライブ仕様に更新（手動データ修正なし） |

## ラウンドトリップ検証（scripts/verify-price-html.mts）

```
✅ bmw                完全一致 (288530 bytes / 307 rows)
✅ mercedes_gasoline  完全一致 (355959 bytes / 319 rows)
✅ mercedes_diesel    完全一致 ( 42642 bytes /  29 rows)
✅ audi               完全一致 (287380 bytes / 197 rows)
✅ lamborghini        完全一致 ( 35128 bytes /  18 rows)
```

再現手順: `tsx scripts/price-sync/fetch-wp.mts` → `tsx scripts/extract-price-templates.mts` → `tsx scripts/import-price-html.mts prisma/data/reference` → `tsx scripts/backfill-price-details.mts` → `tsx scripts/verify-price-html.mts`

## brand_layout の保存先

- 列構成・列名・表示ルール: `PriceBrand.columns`（Json）
- tbody外側のレイアウト（intro/検索UI/CSS/JS）: `src/lib/prices/templates.ts`（referenceから機械抽出・手編集禁止）
- 行のマークアップ規則: `src/lib/prices/generate-html.ts` の `BRAND_HTML_SPECS`

## DB状態（ローカル）

- 870モデル再取込済み（Audiの価格改定2件を含む）。`PriceBrand.wordPressPageId` に 9614/9679/9679/9605/9668 を設定済み。
- 本番DBへの反映はStep C（同期エンジン）のデプロイと同時に行う想定。

## レビューしてほしい点・質問

1. **price-sync-spec v1 の文書が手元にありません。** §4のスキーマ（`market`列・`wc_product_id`列の粒度＝行単位かブランド単位か、enum定義）を共有してください。Step B開始までに不要ですが、Step C前に必要です。無ければ私の設計案（PriceVehicleに market="JP" default / wcProductId Int? / source enum）で進めます。
2. Audiの2行（A6(C7) バブリング取り下げ）は**ライブを正として採用**しました。意図した改定で合っていますか？
3. ディーゼルの新レイアウト追随により、旧mbd-系のテンプレート・仕様は完全に廃止しました。問題なければStep B（Airtable 15ブランド: schema取得→マッピング表レビュー）に進みます。
