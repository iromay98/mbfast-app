# Step B マッピング表（人間レビュー用）— Airtable 15ブランド → 価格マスター

実施日: 2026-07-25 ／ 状態: **本取込前。このマッピング表の承認待ち**

## 取得結果（レコード数＝取込予定数）

Meta APIで15/15テーブルのスキーマ取得済み（Base内26テーブル中。対象外: VW/Suzuki/Abarth/Alfa Romeo/AstonMartin/MB/BMW/Audi/Lamborghini/Daihatsu/その他）。

| brand | table | records | 備考 |
|---|---|---|---|
| toyota | Toyota | 30 | |
| nissan | Nissan | 10 | |
| lexus | Lexus | 19 | |
| honda | Honda | 7 | |
| mitsubishi-fuso | Fuso | 7 | 列構成が特殊（価格1列） |
| porsche | Porsche | 159 | 最大。Powergate3のみ multipleSelects 型 |
| mini | Mini | 30 | |
| ferrari | Ferrari | 24 | 価格列が最多（6種） |
| maserati | Maserati | 33 | |
| mclaren | McLaren | 14 | **フィールド名「Status」の中身はStage1ゲイン**（誤名） |
| landrover | Land Rover | 38 | AT One列あり |
| jaguar | Jaguar | 36 | |
| chevrolet | Chevrolet | 14 | TCU価格列あり |
| ford | Ford | 12 | **「Stage1」が価格列**（currency。他ブランドではゲイン） |
| chrysler-dodge-jeep | Dodge | 61 | **Jeep 32 + Dodge 21 + Chrysler 8 の3メーカー同居を確認**（メーカー列あり→seriesGroupに使用） |
| 計 | | **494** | |

## 共通正規化ルール（ソースAと同一思想）

| 入力 | 保存値 |
|---|---|
| currency型の数値 `198000` | `"198000"` |
| 文字列価格 `¥242,000` | `"242000"` |
| `ASK` / 空欄 / null | キー無し（=ask。公開HTMLではLINEボタン） |
| `+¥22,000` `+¥33,000/+¥33,000` `¥297,000~` 等の非数値価格 | 原文のまま保存（既存ディーゼルの `+¥33,000/各` と同じ扱い） |
| Stage1価格あり かつ 上位ステージ列が明示的に非提供 | `not_offered`（表では「—」）※Airtable側に「—」明示は無いため、初期取込では全て ask 扱い。—化は取込後にアプリで設定 |
| リモート列 `対応` | フラグ true |
| `非対応` / `要確認` / `要動作確認` / 空 | フラグ false（`要確認`系は notes に「Flasher要確認」等を追記） |
| 車種セル内の改行 `V36\nNV36` | 半角スペースに畳む |
| Porsche Powergate3 の配列 `["対応"]` | 先頭要素で判定 |

market=`JP` / source=`airtable` を全レコードに設定。

## フィールド → 価格マスター マッピング（ブランド別）

凡例: `→prices.xxx` は動的価格キー（＝公開HTMLの価格列になる）。列の表示順は下記の記載順を踏襲。

| brand | carName | grade | engine | prices（キー←フィールド） | stockOutput | stage1Gain | labor | ecuType | remote | notes |
|---|---|---|---|---|---|---|---|---|---|---|
| toyota | 車種 | — | 型式(排気量)※改行畳み | limiterCut←リミッター解除のみ / babble←バブリングのみ / stage1←ECUﾁｭｰﾆﾝｸﾞ(ﾊﾞﾌﾞ無料) / limiterOpt←リミッター解除オプション | 純正 | Stage1 | 工賃 | — | AT/PG3/Flasher | 備考 |
| nissan | 車種 | グレード | —（グレード内にエンジン型式） | babble / stage1 | 純正馬力 | Stage1 | 工賃 | — | AT/PG3/Flasher | — |
| lexus | 車種 | — | ｴﾝｼﾞﾝ | limiterCut←ﾘﾐｯﾀｰｶｯﾄのみ / babble / stage1 / limiterOpt←ﾘﾐｯﾀｰｶｯﾄｵﾌﾟｼｮﾝ | 純正 | Stage1 | 工賃 | — | AT/PG3/Flasher | 備考＋shops←取扱店 |
| honda | Chassis | — | エンジン型式 | babble / stage1 / limiterOpt←リミッター解除オプション | 純正 | ECUﾁｭｰﾆﾝｸﾞ(Stage1) | 工賃 | — | AT | 備考 |
| mitsubishi-fuso | Name | — | — | tuning←価格 | 純正 | チューニング | — | — | — | — |
| porsche | 車種 | グレード | エンジン | babble / stage1 | 純正 | Stage1 | ECU脱着等工賃 | — | AT/PG3/Flasher | — |
| mini | グレード | — | エンジン | babble / stage1 | 純正 | Stage1 | ECU脱着等工賃 | ECU | AT | — |
| ferrari | 車種 | — | — | babble / stage1 / o2opf←O2／OPFカット / stage2←Stage2 / mapswitch←MapSwitch / labor←脱着工賃 | 純正 | Stage1 | 脱着工賃 | — | AT | — |
| maserati | 車種 | グレード | エンジン | babble / stage1 | 純正 | Stage1 | ECU脱着殻割り工賃 | — | AT(ECU/TCU) | shops←取扱店 |
| mclaren | 車種 | — | エンジン | babble / stage1 | 純正 | **Status**（中身はゲイン） | 工賃 | — | — | — |
| landrover | 車種 | — | エンジン | babble / stage1 / tcu←TCUﾁｭｰﾆﾝｸﾞ | 純正 | ECUﾁｭｰﾆﾝｸﾞ(Stage1) | — | ECU/TCU | AT/AT1/PG3/Flasher | — |
| jaguar | 車種 | — | エンジン | babble / stage1 / tcu←TCUﾁｭｰﾆﾝｸﾞ | 純正 | ECUﾁｭｰﾆﾝｸﾞ(Stage1) | — | — | AT(ECU/TCU)/PG3/Flasher | — |
| chevrolet | モデル | — | エンジン | babble / stage1 / tcu←TCUﾁｭｰﾆﾝｸﾞ | — | チューニング | — | ECU/TCU | AT | — |
| ford | モデル | — | エンジン | babble / **stage1←Stage1（currency＝価格）** | 純正 | チューニング | — | ECU | AT | — |
| chrysler-dodge-jeep | 車種 | — | エンジン | babble / stage1 | 純正 | チューニング | ECU脱着・殻割り工賃 | — | AT | 備考。**seriesGroup←メーカー（Jeep/Dodge/Chrysler）**＝ページ内のフィルタチップに使用 |

seriesGroup（フィルタ用）は chrysler-dodge-jeep 以外は車種名から機械生成（先頭トークン）し、取込後にアプリで編集可能。

## 生成ページの列構成（brand_layout）

各ブランドの `columns`(Json) は上表の記載順で生成（車種→グレード→エンジン→価格列→純正出力→Stage1ゲイン→工賃→取扱店→リモート→ECU型番）。CSSプレフィックスは新設: `toyota-` `nissan-` `lexus-` `honda-` `fuso-` `porsche-` `mini-` `ferrari-` `maserati-` `mclaren-` `landrover-` `jaguar-` `chevrolet-` `ford-` `cdj-`。デザインは既存システム（白×ゴールド・LINEボタン緑グラデ・ES5のみ）準拠で、ガソリンMercedesテンプレを基準に各ブランド分を生成。

## レビューポイント（承認前に確認したい点）

1. **リミッター解除（トヨタ/レクサス）**: 「解除のみ」を独立した価格列、「解除オプション」を追加価格列として扱います。列名は「リミッター解除のみ」「リミッター解除OP」でよいですか？
2. **remote「要確認」系**: フラグはfalseにして備考へ「Flasher要動作確認」等を残します（バッジは出さない）。よいですか？
3. **Fuso**: 価格1列（「チューニング価格」）のシンプル表になります。
4. **chrysler-dodge-jeep**: メーカー（Jeep/Dodge/Chrysler）をシリーズフィルタとして使い、1ページ3メーカー構成を維持します。
5. **not_offered（—表示）**: Airtableには「—」の明示が無いため初期取込では全てask（LINEボタン）になります。—にしたい行は取込後にアプリの価格グリッドで設定してください（Mercedesと同じ `"—"` 運用…価格キーでは「明示的not_offered」を今後サポート）。

**承認をもらえたら本取込を実行し、照合レポート（全ブランドのレコード数一致＋先頭10行・ランダム10行のサンプル照合）を出します。**
