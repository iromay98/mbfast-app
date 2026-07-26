# mbFAST app 引き継ぎメモ（2026-07-26時点）

新しいセッション（Mac / VPSの`mb` / claude.ai/code）はまずこれとリポジトリ直下の `CLAUDE.md` を読むこと。

## プロジェクト概要

- **mbfast-app** = ECUチューニング業 mbFAST Tuning の本店⇄代理店ポータル。Next.js 16 App Router / Prisma 7 + Postgres / Auth.js v5 / Tailwind v4 / output:standalone。UIは全て日本語、白×グレー×ゴールド
- 本番: `portal.mbfasttuning.com`（VPS root@162.43.42.72、Docker Compose）。公式サイト: `mbfasttuning.com`（WordPress、テーマArkhe）
- GitHub: `git@github.com:iromay98/mbfast-app.git`（プライベート、mainブランチ運用）
- ユーザー: 更家さん（saraya@ns-inc.jp）。**実装・検証後は指示を待たず自動デプロイして良い**（大型プロジェクトはステップごとにレビュー停止）

## 絶対に守る制約

- 代理店には Cal/HW/SW/TCU/復号bin を**絶対に見せない**（.slaveのみ）。`hideTechnical` 系の設計を崩さない
- `.env` はコミット/同期禁止。本番secretは docker-compose.prod.yml の environment に**列挙された変数しかコンテナに渡らない**（allowlist方式。変数追加時はcompose修正が必要）
- WP・Airtable認証はローカル `.env` のみ（WP_BASE_URL / WP_USER / WP_APP_PASSWORD / AIRTABLE_PAT / AIRTABLE_PRICE_BASE_ID）
- **WPのdaihatsuページ(15302)は触らない**
- mbPITは既存の代理店カテゴリツリー(/dealer/)に触れない
- **WPへ書き込むインラインJSに裸の `<` を入れない**（レンダー時に以降の`&`が`&#038;`化されJS全死。比較は `length > i` 形式。`npm run check:price-templates` が検査）

## 環境・デプロイ

- Macローカル: `export PATH="$HOME/.local/node/node-v22.14.0-darwin-arm64/bin:$PATH"`、DB `bash scripts/pg.sh start`、スクリプトは `set -a && . ./.env && set +a && tsx ...`。system node/docker/sudo無し
- Macからの本番デプロイ: commit/push → `ssh 'rm -rf src prisma'` → `git archive | ssh tar xzf` →（**転送とビルドは別SSHに分ける**。まとめるとパイプ切断事故）→ `nohup docker compose -f docker-compose.prod.yml up -d --build`。migrationは起動時 `prisma migrate deploy` で自動
- VPS上での作業: `/root/dev/mbfast-app`（gitクローン）で編集 → `bash scripts/deploy-vps.sh`。`/root/mbfast-app` はデプロイ先なので直接編集禁止
- スマホ遠隔: Termiusで `root@162.43.42.72` → **`mb`**（tmux+claude。切断しても継続）。**初回`claude`ログインのみ未完（ユーザー操作待ち）**

## 完了済みの主要機能（詳細は各実装とCLAUDE.md）

1. **MVP 9フェーズ**（認証/代理店管理/施工記録/依頼/お知らせ/ダッシュボード）
2. **カタログ＋コンフィギュレータ**: BaseFile→TunedVariant、代理店はステージ+バブリング+OP選択→DL可否判定、有料OP同意必須
3. **開発ツリー**（実車開発モード）: DevNode(ok/ng分岐)、代理店の良い/ダメ報告で自動進行、上下型ツリーUI、代理店自由選択は本部許可制
4. **左右ECU**: RecordEcuSide、cal(.slave)共通・bakのみ側別
5. **mbPIT**（施工記録→AI記事→WordPress自動公開）: 5店舗、Phase1-3済。残: テスト記事品質確認→プレートぼかし(Phase4)→実運用(Phase5)
6. **通知**: 全15種でWeb Push（iPhoneはPWAホーム画面追加が必要）。LINE通知は未実装（雛形あり）
7. **AI識別改善**: EcuDenyToken拒否リスト（手修正で自動学習）、grade/generation推定
8. **価格同期プロジェクト（Step A〜D 全完了 2026-07-25/26）** ↓

## 価格同期システム（完成・運用中）

- **全19ブランド1,364行**が価格マスター（PriceBrand/PriceVehicle）に一元化。本番DB反映済み
  - 静的HTML由来4ブランド870行（bmw/mercedes_gasoline/mercedes_diesel/audi/lamborghini、source=html）
  - Airtable由来15ブランド494行（source=airtable、market=JP）
- **運用フロー**: `/hq/prices` で編集 → 「WordPress同期」パネルで差分プレビュー → 確定 → 該当WPページ即時更新
- エンジン: `src/server/prices/wp-sync.ts`（wp:htmlブロックをラッパーclassで特定・payload_hash同一スキップ・失敗時WP未変更・PriceSyncLogに置換前全文バックアップ・mercedes2ブランド→1ページ9679合成）
- 15ブランドのHTMLは `src/lib/prices/generated-template.ts` がcolumns(Json)から機械生成（ES5・ブランド別プレフィックス・.active/.hidden不使用）
- 15ページのAirtable iframeは全て生成HTMLに**置換済み**（レンダー検証15/15合格）。置換前バックアップ: `prisma/data/wp-backup/`＋PriceSyncLog
- 検証: `npm run check:price-golden`（既存4ブランドのバイト一致）/ `npm run check:price-templates`（規約）/ `scripts/price-sync/dryrun-live.mts`（ライブ突き合わせ）
- 規約: 価格キー無し=LINEボタン、labor null=LINEボタン・"—"=ダッシュ、価格"242000"=¥表示・非数値は原文
- 残タスク（次フェーズ・未着手）: EN側WooCommerce同期（REMOTE_DEVICE_FEE 249等、price-sync-spec v1参照）/ LINE bot連携 / 夜間バッチ
- 小ネタ: 15ページに旧iframe時代の注記「＊表示されるまで10秒ほどお待ち下さい」が残存（ユーザー要望あれば一括削除）

## ユーザー側の残作業（催促しない・聞かれたら案内）

- VPSの初回 `claude` ログイン（Termius→`mb`→OAuth URL→コード貼り付け）
- mbPITテスト記事の品質確認、footerHtml投入
- OS再起動（`ssh root@162.43.42.72 "reboot"`）は保留中だったはず

## 既知の罠

- Claude Codeの権限クラシファイアが本番DB書き込み・一部のWP書き込み・scpをブロックすることがある → ユーザーにRunボタン付きコマンドを渡す
- ブラウザペインは稀に空ツリー/空screenshotを返す → curl+HTML断片アサーション or DOM経由JS検証で代替
- シード系SQLは text[] 列が `{"a","b"}` 形式（JSON形式だとmalformed array literal）。`scripts/dump-prices-sql.mts` は対応済み（`--replace` で洗い替え）
- ローカルでmigrate+generate後はdevサーバー再起動必須
