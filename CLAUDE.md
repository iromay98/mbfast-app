@AGENTS.md

# mbFAST 連携アプリ — エージェント引き継ぎメモ

HQ（mbFAST Tuning本店）⇄ 代理店のポータル。Next.js 16 App Router / Prisma 7 + Postgres / Auth.js v5 / Tailwind v4。UIは全て日本語。ブランド色は白・グレー・ゴールド。本番: https://portal.mbfasttuning.com

## 作業環境の判別

- **本番VPS上（/root/dev/mbfast-app で作業している場合）**: このディレクトリは開発用クローン。**/root/mbfast-app はデプロイ先**（docker compose が動く場所）で、直接編集しない。デプロイは `bash scripts/deploy-vps.sh`。DBへは `docker compose -f /root/mbfast-app/docker-compose.prod.yml exec -T postgres psql -U mbfast -d mbfast` で入れる（ホストにポート公開していない）。**ここは本番サーバー**。rm・DB書き込み・再起動は慎重に。ユーザー確認なしに本番データを変更しない。
- **Mac上（/Users/apple/dev/mbfast-app）**: ローカルNode（`export PATH="$HOME/.local/node/node-v22.14.0-darwin-arm64/bin:$PATH"`）とローカルPostgres（`bash scripts/pg.sh start`）。system node/docker/sudoは無い。

## 絶対に守るセキュリティルール

- 代理店には Cal/HW/SW/TCU/復号bin/専門情報を**絶対に見せない**（配布は .slave のみ。`hideTechnical` 系の設計を崩さない）
- `.env` は**絶対にコミット・同期しない**。本番のsecret追記はユーザー自身が行う（新しい環境変数を足したら docker-compose.prod.yml の `environment:` 一覧への追加を忘れない — 一覧に無い変数はコンテナに渡らない。`npm run check:env-allowlist` が突き合わせる＝**足し忘れると静かに未設定として動く**ので必ず通す）
- パスワードは初期発行時のみ平文を表示。以後はハッシュのみ
- ファイルは推測不能キーで保存し、認可付きルート経由でのみ配信

## デプロイ（実装・検証後は指示を待たず自動デプロイして良い）

- コミットメッセージは日本語、`git push` は origin=github.com:iromay98/mbfast-app
- VPS上なら: `bash scripts/deploy-vps.sh`（同期→ビルド→起動→ヘルスチェックまで一括）
- Macからなら: `rm -rf src prisma` をSSHで先に実行 → `git archive | ssh tar xzf` → `docker compose up -d --build` をnohup起動 → deploy.log で `app-1 Started` と `✓ Ready` を確認。**転送とビルド起動を1つのSSHにまとめない**（パイプが切れる事故があった）
- スキーマ変更は手書きmigration（`prisma/migrations/<timestamp>_<name>/migration.sql`）＋起動時 `prisma migrate deploy` が適用。ローカルは `npx prisma migrate deploy && npx prisma generate` 後に**devサーバー再起動必須**

## 主要機能マップ（詳細はコードのコメント参照）

- 依頼の運用: `FileRequest.priority`＝本店だけの「重要」印（statusとは独立・一覧で最上位固定・`PriorityToggle`は行のLinkへ伝播させない）。本店の依頼一覧は「対応中／完了」、記録一覧は「対応中／新規リクエスト」に分ける。一覧→詳細→戻るで位置を保つのは `RestoreScroll`（sessionStorage・キーはpathname＋検索条件）。住所入力は `/api/cities`（市区町村）＋`/api/towns`（町域）で選ばせ、**手入力は番地・建物だけ**（保存値は1文字列のままでWP契約は不変）
- 施工記録・依頼: `src/app/{hq,dealer}/records` — スレーブ復号(AutoTuner Master API)・コンフィギュレータ・バリエーション表・依頼ワークフロー・OLSXカード型チャット（送信取り消し/備考/再DL制御）
- カタログ: BaseFile→TunedVariant。本店専用。ニコイチ(splice)ツールあり。**バリエーションの差し替えは行(variantId)を狙う**（構成から引き直すと選択肢外のOP＝燃料修正後のEGR等が落ちて別の行を書き換える）。同構成の重複行は配信がどれを引くか保証できないため差し替え時に同じファイルへ揃える（`src/server/catalog/variant-config.ts` が構成同定・差し替え先選択・.slaveキャッシュキーの原本）。検証: `npm run check:variant-replace`／実データ診断（読み取り専用）: `npm run report:variant-dupes`
- mbPIT: 施工記録→AI記事化→WordPress自動公開。`src/server/pit/`（pipeline/generate/guard/wordpress/images/vehicle/gamification）＋ `/hq/pit` 管理画面。本部投稿は `/hq/pit/post`（店舗選択・本店直営店舗=PitStore.dealerId null 可）。車両登録・証明書も本部が代行できる（`/hq/pit/vehicles` `/hq/pit/certificates`。加盟店と同じコンポーネントに storeId と basePath を渡す形。**店舗の解決は `acting-store.ts` が唯一の入口**＝加盟店は引数のstoreIdを無視して自店固定、本部だけが任意店舗を指定できる）。店舗マスタでカテゴリID空欄なら親545配下にWPカテゴリ自動作成。新規加盟店は公開ページ `/pit/join` から自己登録（利用規約 `/pit/terms` 同意必須・1日20件のレート制限・Dealer.pitOnly=true＝ブログ投稿以外のECU系画面は一切見せない・requireFullDealerで強制）→登録と同時に自動承認（WPカテゴリ自動作成。WP接続エラー時のみ承認待ち）。不適切店舗は /hq/pit の「停止」でワンタップ停止（pitOnlyはログインも失効）。店舗マスター: 店舗情報9項目（所在地・営業時間等）はアプリが原本、/hq/pit「店舗情報」または加盟店自身が /dealer/pit「店舗情報を編集」（自店のみ・slug/店舗名不可・変更時は本部へ差分通知）で編集→差分プレビュー→確定でWP term metaへ即時同期（`src/server/pit/store-meta.ts`がマッピング唯一の原本・`store-sync.ts`が同期エンジン・書込前に親545検証必須・読み戻し検証あり）。ガード: 排ガスデバイス無効化=held、音量系=注意書き。WPカテゴリ: 親545 / Charism=547 / On's=549 / **RAF INDUSTRIES=551（旧Anubis。改名済み）** / プレジャー=553 / Glanzcoat=555 / mbFAST Tuning=659 / ユウキロジ=661。新規加盟店ごとに親545配下へ自動採番されるので**IDは増え続ける**（固定リストを前提にしない）。**命名の原則: slugは英小文字（`^[a-z0-9-]+$` で強制）／表示名は日本語**。表示名はWPへ同期しない（同期対象は `STORE_META_FIELDS` の9項目のみ）ので、WPのカテゴリ名とは各自で揃える。slugはWP取込がアプリを上書きするため**WPのカテゴリslugが正**。店舗が改名したら `job=slug`→`job=links`（記事本文に `storePageUrl(store.slug)` が焼き込まれているため過去記事のリンクが404になる）。**既存の代理店カテゴリツリーには触れない**。投稿ジャンル（ポータルのジャンル絞り込み用WPタグ）: **`src/config/mbpit-genres.json` が単一の正**（本部確定の公式8ジャンル: ecu=671 / custom=699 / coating=663 / bodypaint=701 / maintenance=667 / parts-electrical=703 / tire-wheel=705 / wash-cleaning=707。2026-08-09の8ジャンル化で旧polish(665)/other(669)は廃止＝DBの既存行は `normalizeGenreSlug` で読み替え）。投稿フォーム・API許可リスト・タグ付与・表示ラベルは全て `src/lib/mbpit-genres.ts` 経由でこのJSONから導出＝ジャンルの追加・改名はJSONだけ直す（WP側に同slugのタグを先に作って固定IDを書く）。WP側の店メタmbpit_tags・ジャンル定義の背景はClaudeプロジェクト「mbFAST Tuning」の `claude/mbPITジャンル定義書.md`。**mbFAST本体のブログが使う「ECUチューニング」(365) は自動付与しない**（共用すると記事が混ざる。詳細タグの付与は本部が記事単位で判断）。整合検査＝`npm run check:pit-tags`。既存記事への遡及付与は `npm run pit:backfill-tags`（既定ドライラン・`--commit` で書込・タグは足すだけ）。記事本文にmbFAST禁止（mbPIT別ブランド運用。旧BRAND_BLOCK挿入は2026-08廃止＝WP側テンプレートが担当・既存記事の除去は `job=brand`）。顧客向け: `/mycar`（車検証QR→HMAC vehicle_key・車台番号は平文非保存）＋施工証明書 `/verify/[postId]?h=`（SERVER_SECRET必須・変更禁止）
- mbPIT 施工証明書（1入力→公開ブログ／施工証明書／法定記録簿の3出力）: **公開ブログに車台番号・氏名・住所・連絡先・金額を絶対に出さない**。境界は `src/server/pit/cert-visibility.ts` が原本（型で分離・写真は種類で除外・`assertNoPrivateLeak` で公開直前に検査）。項目定義は `cert-fields.ts`（法令改正に備えて定義ファイル分離・事業場区分で出し分け・**施工種別の細目は全て任意**＝必須にすると記録自体が生まれないため。必須が残るのは法令要件のエーミングのみ。足りない組み合わせは `moduleAdvice` が注意を返すだけ。ECUは施工方法（OBD／ECU直接）と純正バックアップの区別（取得済み／他社データで取得不可／同意ありで取得しない）を持つ）。車台番号/登録番号は `pii-crypto.ts` で AES-256-GCM 暗号化（鍵 `PII_ENC_KEYS` は SERVER_SECRET と別・キーID付きでローテ可・復号は監査ログ必須の `decryptPiiAudited` のみ・**import できるのは vehicle-register.ts だけ**）。鍵の管理は `docs/pii-key-management.md`。保存期間は目的別（`cert-retention.ts`: 法定記録簿=記載日から2年 / 保証は満了日まで / 退会でも消さない）。下タブは4つに絞っているため、顧客カルテ・車両・施工証明書の行き来は `pit-sub-nav.tsx`（未発行件数のバッジ付き）が担う＝**下書きに戻れる経路を必ず残す**。顧客カルテにはその方の車両と施工履歴（証明書・下書き含む）を出す。車両の修正は**顧客カルテからも**行える（`vehicles/vehicle-edit-panel.tsx` を両画面で共用＝車検証を撮り直さないと直せない状態を作らない。カルテの「＋この方の車両を追加」は `?customerId=` でその顧客を選択済みにする）。車両登録は `/dealer/pit/vehicles`（**車検証QR**（`shaken-qr.ts`が解析の原本・サーバーとカメラのスキャナで共用・複数QRから値を集めて合わせる・車台番号と型式が揃えば自動で閉じる。QRに氏名住所は入っていない）＋車検証OCR `shaken-ocr.ts` → 確認・修正 → 登録。QRで取れた車台番号はOCRで上書きしない。**車検証画像は保存しない**。和暦変換もここ。入力ミスは同画面の「修正」から上書き修正でき、車台番号だけは変更不可＝登録し直し。修正履歴は PitVehicleEditLog に残る（登録番号は値を残さない））。証明書は `/dealer/pit/certificates`（作成→下書き→**発行で内容確定**。発行後は編集不可で訂正は無効化＋replacesIdの再発行。`certificate.ts`が唯一の入口・ハッシュは`cert-hash.ts`（DB非依存・平文VINを使わずvehicleKeyで作る）・帳票は`components/certificate-sheet.tsx`）。お客様へは共有URL `/cert/[token]`（ログイン不要・noindex・任意で車台下3桁の照合・`publicCertMetadata`でmbFAST表記を上書き）＋印刷/PDF。**帳票は画面=黒地×金／印刷=白地に反転**（色は globals.css の `.cert-*` に集約・`certificate-sheet.tsx` はクラス名だけ持つ）。検証QRは `qr-svg.ts`（@zxing のエンコーダでSVG生成・外部リクエストなし）＋`cert-share.ts`。**共有ページの車台番号は既定マスク**（`?vin=1` で全桁＝そのときも監査ログに残す。マスク時は全桁をHTMLに載せない）。復号は`readVehicleSecrets`のみ（監査ログ必須）。証跡写真は `cert-media.ts` が唯一の入口（下書きのみ追加・削除可／保存時に processPhoto でWebP化＋EXIF除去／保存キーはUUID）。**公開判定は許可リスト方式**＝`cert-visibility.ts` の `PUBLIC_ALLOWED_MEDIA_KINDS`（before/after/product_label/tire）に**明示的に載っている種別だけ**が公開候補で、未知の種別を足しても勝手に公開されない。配信は認可付きの2経路のみ（自店・本部=`/api/pit/cert-media/[mediaId]`（本部はstoreId必須）／共有ページ=`/cert/[token]/media/[mediaId]` は公開可のみで種別を再チェック）。写真OCRは `photo-ocr.ts`（製品ラベル=ロット番号/製品名・タイヤ側面=DOT/銘柄/サイズ・メーター=走行距離・測定器画面=SOH。**読み取りキーはモジュールの項目キーと一致させている**・DOTは週01-53を検証して不正なら空＋警告・写真は保存しない）。顧客・車両の参照は `customer-repo.ts` 経由（storeIdをwhereに必ず含める唯一の層＝店舗間で顧客情報が見えない）。法定記録簿は事業場区分（本部が /hq/pit の店舗編集で設定・認証工場/指定工場は認証番号必須）で出し分け、`legal-record.ts` の `missingLegalFields` が発行時に記載事項の欠けをブロック（記録として成立しないものを発行済みにしない）。**退会・停止でも記録は消さない**（保存義務は事業者本人に残る）ため記録の一括CSVエクスポートを用意（`/api/pit/records/export`。加盟店は自店のみ・本部は storeId 指定。復号は監査ログ経由・BOM付きでExcel可）。停止操作時に件数と保存期限を出して先に書き出すよう促す。検証: `npm run check:cert-privacy` / `check:shaken-ocr` / `check:photo-ocr` / `check:store-isolation`
- 価格表: `/hq/prices`（5ブランド870モデル・インライン編集）＋公開HTML生成（`src/lib/prices/generate-html.ts`、`prisma/data/reference/*.html` とバイト一致を `scripts/verify-price-html.mts` で保証）。**工賃列はメインのECUチューニング価格列の直後**（`applyColumnOrderRule`＋`findMainPriceIndex`。メイン列名はブランドごとに違うのでキーだけで判定しない＝以前 key==="stage1" 固定で Ferrari 等が最後の価格列の後ろに落ちていた）。工賃データが無いブランドは列を作らない。**生成JSにアンパサンドと小なり記号を書かない**（WPのREST保存で `&#038;` に変換されJSが壊れる。必要なら `String.fromCharCode(38)`）。WP反映は `src/lib/prices/wp-sync.ts`＝**既定は読み取りのみ**（`npm run prices:wp-diff`）で、`npm run prices:wp-push -- --yes` だけが書き込む。**列順が本番と不一致のブランドは push でも書き込まない**（手作業の並び替えを巻き戻さないため。承知の上でやるときだけ `--force`）。検証: `npm run check:price-columns`
- mbPIT Googleマップ投稿: `src/server/pit/gbp/`（client=API・link=紐付け）＋ `/hq/pit/gbp`。方式A＝**mbFASTのGoogleアカウント1つだけで認可**し、加盟店は自店プロフィールにmbFASTを管理者招待（加盟店ごとのOAuthはしない・同意画面は「内部」＝組織アカウントのみ認可可）。認証情報は環境変数のみ（`GBP_CLIENT_ID/SECRET/REFRESH_TOKEN`・エラー本文は `redact()` を通す）。**紐付けは必ず人が選ぶ**（店名の自動照合を入れない・住所を並べて確認・gbpLocationIdは一意）。投稿は既定で無効、Phase1は本部確認後に公開（自動公開しない）。**一覧API(Account Management/Business Information)の割り当てが0（アクセス未承認）でも投稿できる手動指定モードがある**＝`GBP_ACCOUNT_ID` と `GBP_LOCATION_MAP="slug:locationId,..."` を入れると一覧APIを1回も呼ばない（DBの紐付けがあればそちらを優先。投稿は `gbpPostingEnabled` が true のときだけ＝手動指定でもこのゲートは外れない）。接続確認 `npm run gbp:accounts` / v4の割り当て確認（投稿を作らずGETのみ）`npm run gbp:v4check` / 認可 `npm run gbp:auth` / 検証 `npm run check:gbp` `npm run check:no-secrets`
- 通知: `src/server/notifications`（console スタブ）＋ Web Push(VAPID)

## 進行中・未完タスク

- mbPIT施工証明書: Phase1（Step A〜E）＋証跡写真まで完了。未実装は Phase2（車両オーナーアカウント・所有権移転・第三者検証ビュー・保険会社向けエクスポート）
- mbPIT: テスト記事の品質確認（Phase3完了: 音声投稿UI・WebP変換・統一フォーマット・AUTO_PUBLISH/STEALTH_MODE(noindex)対応済み）→ ナンバープレート自動ぼかし（Phase4, `src/server/pit/images.ts` に差し込み口あり）
- 価格表: golden参照HTMLの再基準化が必要（表示順共通化=アルファベット順で行順が変わったため。VPS上で prod DB に対し `npm run check:price-golden` → `.verify-out/*.html` を `prisma/data/reference/` にコピー。ローカルDBは価格編集が入っていて基準にできない）
- 通知のLINE実装（`NotificationService` の line ドライバ）

## 検証の作法（本番でしか出来ないもの）

- 価格表のWP同期・mbPITの利用状況レポートは**本番DBとWP認証の両方**が要る。開発クローン(/root/dev/mbfast-app)の `.env` には無く、postgres もホスト非公開なので**アプリのコンテナの中で実行する**:
  `docker compose -f /root/mbfast-app/docker-compose.prod.yml exec app npm run prices:wp-diff`（読み取りのみ）→ 一致を確認 → 同じ形で `npm run prices:wp-push -- --yes`。新しいスクリプトを使うには先に `bash scripts/deploy-vps.sh`
- mbPITの利用状況（店舗ごとの証明書・車両・投稿の件数）も同様に `… exec app npm run report:pit-usage`（読み取りのみ）

## 検証の作法

- `node_modules/.bin/tsc --noEmit` を必ず通す
- 画面はログインして確認（ローカルseed: admin@mbfast.jp / password123。本番の認証情報は聞くこと）
- ブラウザ操作ツールが空を返す場合は curl + HTML断片アサーションで代替（過去に頻発）

## 車両バリアント個別ページ（vpages）

- 1バリアント=1レコード（`VehiclePage`・PriceVehicle market=JP に1:1）→ WPのJP/ENページ2枚を生成。マスタは価格表と同じ PriceVehicle＝**価格を直すのはアプリの価格表だけ**。ページ側で価格を持たない
- URL: `/tuning/{brandSlug}/{slug}/`（親ページは push が slug 照合で自動作成）。ENは Polylang lang=en + translations 紐付け
- EN価格は既定 quote（数字非表示・見積CTA）。`enPriceMode=price` にすると market=EN の PriceVehicle を (brandId, carName, grade) で照合して表示
- status: hold（既定・生成対象外）→ draft → publish。**seed は必ず hold で作る**＝一斉公開させない設計。実績記事が紐づいた車種から順次 publish に上げる運用（スケールドコンテンツ対策）
- 更新はマーカー区間（`<!-- START: 貼り付け範囲 -->`）だけ差し替え＝マーカー外の人の追記は保護。scriptタグ内の生アンパサンドは書込前に弾く（価格表と同じ理由）
- **オプションの○×は完全に手動**（2026-08-13）。価格表から初期値を自動で入れない＝触っていない項目に〇が付かない。**全項目が価格表グリッドと車両ページ画面の両方でタップできる**（derivedFrom が付いた項目も隠さない）。過去に自動で入った値は /hq/prices の「自動で入った○×を消す」で掃除できる
- **対応オプションの語彙はDB(`VehiclePageOption`)が単一の正**。追加・並べ替え・非表示・削除は /hq/prices の「対応オプションの項目を編集」から（コード変更不要）。`derivedFrom` に価格列keyを指定すると、その列に**金額が入っている**車両は自動で〇／「—」なら—（**ASK・空欄は判定しない**＝要相談の意味のため。2026-08-13更家さん判断）。手動設定が常に優先
- 価格表の「WordPressに反映」で、そのブランドの下書き・公開中の車両ページも自動更新される。さらに「頁」列で 下書き/公開 に切り替えた時点でも、その1枚が即WPへ反映される（車両ページ画面での個別操作は不要）
- **グレード統合**: PriceVehicle.pageGroupに同じキーを入れたJP行は1つの車両ページに統合(displayOrder最小が代表・そのslug/WPページを維持)。ページ内はCSSのみのラジオタブで457/487/507等を切替(全バリエーションがHTMLに載る=SEO対応)。非代表行の同期はスキップされ警告が出る。設定は/hq/pricesの「統合」列から。ハブ一覧は代表のみ表示
- **EN側の窓口はWhatsApp**(+81 90-6730-4953 / wa.me/819067304953)。車種名入りの定型文つきリンク。JP側はLINEのまま
- **ハブページ**: /tuning/(メーカー一覧)と/tuning/{brand}/(シリーズ別車種一覧)はアプリが自動生成(hub-sync)。「全ページを再反映」後に自動追従、単独更新は「ハブページを更新」ボタン。車両ページ下部にハブへの内部リンク(vpg-related)が入る
- **自動同期**: GitHub Actions `車両ページをWPへ同期`（毎時0分・手動実行可）が `vpages:wp-push --yes` を回す。価格表を直す／頁列で公開にするだけでよく、反映操作は不要。過去の取りこぼしもここで拾われる
- コマンド: `npm run vpages:seed -- <brandId> [--commit]`（ドライラン既定）／ `vpages:set -- --list` `--slug X --status draft` `--option babble=on` `--related <記事ID>`（状態・オプション・実績記事の運用CLI）／ `vpages:wp-diff`（読み取りのみ）／ `vpages:wp-push -- --yes`（書込）／ `vpages:preview`（DB不要・.verify-out/ にサンプルHTML）
