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
- mbPIT: 施工記録→AI記事化→WordPress自動公開。`src/server/pit/`（pipeline/generate/guard/wordpress/images）＋ `/hq/pit` 管理画面。ガード: 排ガスデバイス無効化=held、音量系=注意書き。WPカテゴリ: 親545 / Charism=547 / On's=549 / Anubis=551 / プレジャー=553 / Glanzcoat=555。**既存の代理店カテゴリツリーには触れない**
- 価格表: `/hq/prices`（5ブランド870モデル・インライン編集）＋公開HTML生成（`src/lib/prices/generate-html.ts`、`prisma/data/reference/*.html` とバイト一致を `scripts/verify-price-html.mts` で保証）
- 通知: `src/server/notifications`（console スタブ）＋ Web Push(VAPID)

## 進行中・未完タスク

- mbPIT: テスト記事の品質確認 → 店舗用投稿画面（Phase3）→ ナンバープレート自動ぼかし（Phase4, `src/server/pit/images.ts` に差し込み口あり）
- 価格表: WordPress自動反映（`src/lib/prices/wordpress.ts` は雛形のみ）
- 通知のLINE実装（`NotificationService` の line ドライバ）

## 検証の作法

- `node_modules/.bin/tsc --noEmit` を必ず通す
- 画面はログインして確認（ローカルseed: admin@mbfast.jp / password123。本番の認証情報は聞くこと）
- ブラウザ操作ツールが空を返す場合は curl + HTML断片アサーションで代替（過去に頻発）
