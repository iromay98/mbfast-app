@AGENTS.md

# mbFAST 連携アプリ — エージェント引き継ぎメモ

HQ（mbFAST Tuning本店）⇄ 代理店のポータル。Next.js 16 App Router / Prisma 7 + Postgres / Auth.js v5 / Tailwind v4。UIは全て日本語。ブランド色は白・グレー・ゴールド。本番: https://portal.mbfasttuning.com

## 作業環境の判別

- **本番VPS上（/root/dev/mbfast-app で作業している場合）**: このディレクトリは開発用クローン。**/root/mbfast-app はデプロイ先**（docker compose が動く場所）で、直接編集しない。デプロイは `bash scripts/deploy-vps.sh`。DBへは `docker compose -f /root/mbfast-app/docker-compose.prod.yml exec -T postgres psql -U mbfast -d mbfast` で入れる（ホストにポート公開していない）。**ここは本番サーバー**。rm・DB書き込み・再起動は慎重に。ユーザー確認なしに本番データを変更しない。
- **Mac上（/Users/apple/dev/mbfast-app）**: ローカルNode（`export PATH="$HOME/.local/node/node-v22.14.0-darwin-arm64/bin:$PATH"`）とローカルPostgres（`bash scripts/pg.sh start`）。system node/docker/sudoは無い。

## 絶対に守るセキュリティルール

- 代理店には Cal/HW/SW/TCU/復号bin/専門情報を**絶対に見せない**（配布は .slave のみ。`hideTechnical` 系の設計を崩さない）
- `.env` は**絶対にコミット・同期しない**。本番のsecret追記はユーザー自身が行う（新しい環境変数を足したら docker-compose.prod.yml の `environment:` 一覧への追加を忘れない — 一覧に無い変数はコンテナに渡らない）
- パスワードは初期発行時のみ平文を表示。以後はハッシュのみ
- ファイルは推測不能キーで保存し、認可付きルート経由でのみ配信

## デプロイ（実装・検証後は指示を待たず自動デプロイして良い）

- コミットメッセージは日本語、`git push` は origin=github.com:iromay98/mbfast-app
- VPS上なら: `bash scripts/deploy-vps.sh`（同期→ビルド→起動→ヘルスチェックまで一括）
- Macからなら: `rm -rf src prisma` をSSHで先に実行 → `git archive | ssh tar xzf` → `docker compose up -d --build` をnohup起動 → deploy.log で `app-1 Started` と `✓ Ready` を確認。**転送とビルド起動を1つのSSHにまとめない**（パイプが切れる事故があった）
- スキーマ変更は手書きmigration（`prisma/migrations/<timestamp>_<name>/migration.sql`）＋起動時 `prisma migrate deploy` が適用。ローカルは `npx prisma migrate deploy && npx prisma generate` 後に**devサーバー再起動必須**

## 主要機能マップ（詳細はコードのコメント参照）

- 施工記録・依頼: `src/app/{hq,dealer}/records` — スレーブ復号(AutoTuner Master API)・コンフィギュレータ・バリエーション表・依頼ワークフロー・OLSXカード型チャット（送信取り消し/備考/再DL制御）
- カタログ: BaseFile→TunedVariant。本店専用。ニコイチ(splice)ツールあり
- mbPIT: 施工記録→AI記事化→WordPress自動公開。`src/server/pit/`（pipeline/generate/guard/wordpress/images/vehicle/gamification）＋ `/hq/pit` 管理画面。本部投稿は `/hq/pit/post`（店舗選択・本店直営店舗=PitStore.dealerId null 可）。車両登録・証明書も本部が代行できる（`/hq/pit/vehicles` `/hq/pit/certificates`。加盟店と同じコンポーネントに storeId と basePath を渡す形。**店舗の解決は `acting-store.ts` が唯一の入口**＝加盟店は引数のstoreIdを無視して自店固定、本部だけが任意店舗を指定できる）。店舗マスタでカテゴリID空欄なら親545配下にWPカテゴリ自動作成。新規加盟店は公開ページ `/pit/join` から自己登録（利用規約 `/pit/terms` 同意必須・1日20件のレート制限・Dealer.pitOnly=true＝ブログ投稿以外のECU系画面は一切見せない・requireFullDealerで強制）→登録と同時に自動承認（WPカテゴリ自動作成。WP接続エラー時のみ承認待ち）。不適切店舗は /hq/pit の「停止」でワンタップ停止（pitOnlyはログインも失効）。店舗マスター: 店舗情報9項目（所在地・営業時間等）はアプリが原本、/hq/pit「店舗情報」または加盟店自身が /dealer/pit「店舗情報を編集」（自店のみ・slug/店舗名不可・変更時は本部へ差分通知）で編集→差分プレビュー→確定でWP term metaへ即時同期（`src/server/pit/store-meta.ts`がマッピング唯一の原本・`store-sync.ts`が同期エンジン・書込前に親545検証必須・読み戻し検証あり）。ガード: 排ガスデバイス無効化=held、音量系=注意書き。WPカテゴリ: 親545 / Charism=547 / On's=549 / Anubis=551 / プレジャー=553 / Glanzcoat=555。**既存の代理店カテゴリツリーには触れない**。記事はBRAND_BLOCK挿入＋本文にmbFAST禁止（mbPIT別ブランド運用）。顧客向け: `/mycar`（車検証QR→HMAC vehicle_key・車台番号は平文非保存）＋施工証明書 `/verify/[postId]?h=`（SERVER_SECRET必須・変更禁止）
- mbPIT 施工証明書（1入力→公開ブログ／施工証明書／法定記録簿の3出力）: **公開ブログに車台番号・氏名・住所・連絡先・金額を絶対に出さない**。境界は `src/server/pit/cert-visibility.ts` が原本（型で分離・写真は種類で除外・`assertNoPrivateLeak` で公開直前に検査）。項目定義は `cert-fields.ts`（法令改正に備えて定義ファイル分離・事業場区分で出し分け）。車台番号/登録番号は `pii-crypto.ts` で AES-256-GCM 暗号化（鍵 `PII_ENC_KEYS` は SERVER_SECRET と別・キーID付きでローテ可・復号は監査ログ必須の `decryptPiiAudited` のみ・**import できるのは vehicle-register.ts だけ**）。鍵の管理は `docs/pii-key-management.md`。保存期間は目的別（`cert-retention.ts`: 法定記録簿=記載日から2年 / 保証は満了日まで / 退会でも消さない）。車両登録は `/dealer/pit/vehicles`（車検証OCR `shaken-ocr.ts` → 確認・修正 → 登録。**車検証画像は保存しない**。和暦変換もここ。入力ミスは同画面の「修正」から上書き修正でき、車台番号だけは変更不可＝登録し直し。修正履歴は PitVehicleEditLog に残る（登録番号は値を残さない））。証明書は `/dealer/pit/certificates`（作成→下書き→**発行で内容確定**。発行後は編集不可で訂正は無効化＋replacesIdの再発行。`certificate.ts`が唯一の入口・ハッシュは`cert-hash.ts`（DB非依存・平文VINを使わずvehicleKeyで作る）・帳票は`components/certificate-sheet.tsx`）。お客様へは共有URL `/cert/[token]`（ログイン不要・noindex・任意で車台下3桁の照合・`publicCertMetadata`でmbFAST表記を上書き）＋印刷/PDF（`@media print`と`.no-print`）。復号は`readVehicleSecrets`のみ（監査ログ必須）。写真OCRは `photo-ocr.ts`（製品ラベル=ロット番号/製品名・タイヤ側面=DOT/銘柄/サイズ・メーター=走行距離・測定器画面=SOH。**読み取りキーはモジュールの項目キーと一致させている**・DOTは週01-53を検証して不正なら空＋警告・写真は保存しない）。顧客・車両の参照は `customer-repo.ts` 経由（storeIdをwhereに必ず含める唯一の層＝店舗間で顧客情報が見えない）。法定記録簿は事業場区分（本部が /hq/pit の店舗編集で設定・認証工場/指定工場は認証番号必須）で出し分け、`legal-record.ts` の `missingLegalFields` が発行時に記載事項の欠けをブロック（記録として成立しないものを発行済みにしない）。**退会・停止でも記録は消さない**（保存義務は事業者本人に残る）ため記録の一括CSVエクスポートを用意（`/api/pit/records/export`。加盟店は自店のみ・本部は storeId 指定。復号は監査ログ経由・BOM付きでExcel可）。停止操作時に件数と保存期限を出して先に書き出すよう促す。検証: `npm run check:cert-privacy` / `check:shaken-ocr` / `check:photo-ocr` / `check:store-isolation`
- 価格表: `/hq/prices`（5ブランド870モデル・インライン編集）＋公開HTML生成（`src/lib/prices/generate-html.ts`、`prisma/data/reference/*.html` とバイト一致を `scripts/verify-price-html.mts` で保証）
- 通知: `src/server/notifications`（console スタブ）＋ Web Push(VAPID)

## 進行中・未完タスク

- mbPIT施工証明書: Phase1（Step A〜E）完了。未実装は 証跡としての写真保存（PitCertificateMedia＋認可付き配信）／Phase2（車両オーナーアカウント・所有権移転・第三者検証ビュー・保険会社向けエクスポート）
- mbPIT: テスト記事の品質確認（Phase3完了: 音声投稿UI・WebP変換・統一フォーマット・AUTO_PUBLISH/STEALTH_MODE(noindex)対応済み）→ ナンバープレート自動ぼかし（Phase4, `src/server/pit/images.ts` に差し込み口あり）
- 価格表: WordPress自動反映（`src/lib/prices/wordpress.ts` は雛形のみ）
- 価格表: golden参照HTMLの再基準化が必要（表示順共通化=アルファベット順で行順が変わったため。VPS上で prod DB に対し `npm run check:price-golden` → `.verify-out/*.html` を `prisma/data/reference/` にコピー。ローカルDBは価格編集が入っていて基準にできない）
- 通知のLINE実装（`NotificationService` の line ドライバ）

## 検証の作法

- `node_modules/.bin/tsc --noEmit` を必ず通す
- 画面はログインして確認（ローカルseed: admin@mbfast.jp / password123。本番の認証情報は聞くこと）
- ブラウザ操作ツールが空を返す場合は curl + HTML断片アサーションで代替（過去に頻発）
