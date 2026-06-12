# mbFAST 本店⇄代理店 連携アプリ（MVP）

ECUチューニングのフランチャイズ事業「mbFAST」の **本店（HQ）と全国の代理店ショップをつなぐ業務用Webアプリ** です。
施工記録（愛車カルテ）・本店への作業依頼ワークフロー・お知らせ配信を、ひとつの台帳とワークフローにまとめます。

## 主な機能

- **認証 / ロール認可**: 本店管理者（HQ_ADMIN）/ 代理店（DEALER）。認可はサーバー側で強制。
- **代理店管理（本店）**: 一覧 / 登録 / 編集 / 有効・無効切替 / 代理店ログインアカウント発行（初期パスワードを一度だけ表示）。
- **施工記録**: 代理店が自店分を登録（VIN・車種・ECU/TCU型式・SW番号・施工種別・適用マップ・施工日・写真・メモ）。本店は全店横断で一覧・検索（VIN/メーカー/車種/SW番号/種別/代理店/期間）。
- **作業依頼ワークフロー**: 代理店が依頼＋ファイルアップロード → 本店が受付/作業中/納品へ更新し成果ファイルを返却・コメント・施工記録へ紐付け。状態変更は監査履歴に記録。
- **お知らせ配信**: 本店が作成（Markdown可・カテゴリ別）→ 代理店が閲覧・既読管理。
- **通知**: `NotificationService` で抽象化（MVPはコンソール出力スタブ、本番はLINE Messaging APIへ差し替え前提）。
- **PWA対応**（manifest + service worker、モバイルファースト）。

## 技術スタック

| 項目 | 採用 |
|---|---|
| フレームワーク | Next.js 16（App Router）+ TypeScript |
| DB | PostgreSQL 16 |
| ORM | Prisma 7（driver-adapter `@prisma/adapter-pg`）+ マイグレーション + シード |
| 認証 | Auth.js（NextAuth v5）credentials + JWT・ロールベース認可 |
| UI | Tailwind CSS v4（白／グレー／ゴールド・モバイルファースト） |
| ファイル保存 | ローカルディスク（Web公開外）。`StorageProvider` で抽象化しS3差し替え可 |

> **注**: Next.js 16 では旧 `middleware` が `proxy` に改称され、`cookies()/headers()/params/searchParams` は非同期、Turbopack が既定です。本リポジトリはこれに準拠しています。

---

## セットアップ（ローカル開発）

### 前提
- Node.js 20.9 以上（推奨 22）
- PostgreSQL（下記いずれか）
  - A. Docker で起動（推奨・後述）
  - B. ローカルにインストール済みの PostgreSQL
  - C. Docker もインストールも無い環境向けの **ポータブル版 PostgreSQL**（`scripts/pg.sh`）

### 1. 依存インストール

```bash
npm install
```

### 2. 環境変数

```bash
cp .env.example .env
# AUTH_SECRET を生成して .env に設定
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

`.env` の主な項目:

| 変数 | 説明 |
|---|---|
| `DATABASE_URL` | PostgreSQL 接続文字列 |
| `AUTH_SECRET` | Auth.js のセッション署名鍵（32バイトのランダム） |
| `AUTH_URL` / `NEXTAUTH_URL` | アプリのURL（dev は `http://localhost:3000`） |
| `STORAGE_DRIVER` / `STORAGE_LOCAL_DIR` | ファイル保存ドライバ（`local`）と保存先 |
| `MAX_UPLOAD_BYTES` | アップロード上限（既定 50MB） |
| `NOTIFICATION_DRIVER` | `console`（MVP）。本番は `line` 実装に差し替え |

### 3. データベース起動

**A. Docker を使う場合**

```bash
docker compose up -d postgres
# .env の DATABASE_URL を postgresql://mbfast:mbfast@localhost:5432/mbfast?schema=public に
```

**C. ポータブル版 PostgreSQL を使う場合**（Docker/インストール不要）

```bash
npm run pg:init    # 初回のみ: データディレクトリ作成 + 起動（.pgdata に作成）
npm run pg:start   # 2回目以降の起動
npm run pg:stop    # 停止
```

> このスクリプトは [Zonky 製の組み込み PostgreSQL バイナリ](https://github.com/zonkyio/embedded-postgres) をローカル展開して使います（psql/createdb は含まれません。DB は Prisma が自動作成）。

### 4. スキーマ適用 & 初期データ投入

```bash
npm run db:migrate   # マイグレーション適用（初回は DB も自動作成）
npm run db:seed      # シード投入
```

### 5. 起動

```bash
npm run dev
# http://localhost:3000
```

### ログイン情報（シード・共通パスワード: `password123`）

| ロール | メールアドレス |
|---|---|
| 本店管理者 | `admin@mbfast.jp` |
| 代理店（東京） | `tokyo@mbfast.jp` |
| 代理店（大阪） | `osaka@mbfast.jp` |
| 代理店（福岡） | `fukuoka@mbfast.jp` |

---

## Docker での起動（app + postgres）

```bash
# 初回（マイグレーション適用 + シード）
AUTH_SECRET="$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")" \
SEED_ON_START=1 docker compose up -d --build

# 2回目以降
docker compose up -d
```

- アプリ: http://localhost:3000
- アップロードファイルは名前付きボリューム `storage`（コンテナ内 `/data/storage`）に永続化されます。
- 本番では `AUTH_SECRET` を必ず安全な値に設定してください。

### デプロイとデータの分離（重要）

- **コード（デプロイ対象）とデータ（DB・アップロード済みファイル）は別領域に置く。** コードのデプロイ／再ビルドで
  DB の中身やストレージ上のファイルが消えたり再生成されたりしてはならない。
- ストレージ実体（`STORAGE_LOCAL_DIR`）と PostgreSQL のデータ領域は、アプリのコード/ビルド成果物とは別の
  **永続ボリューム**に置く（Docker は名前付きボリューム、VPS は `/srv/mbfast/storage` 等のコード外パス）。
- ファイルは**公開ディレクトリの外**に保存し、配信は**認可付きエンドポイント経由のみ**
  （`/api/catalog/*`・`/api/match/*`・`/api/records/*`）。直リンク配信はしない。
- **DB スキーマ変更はマイグレーションで管理**（`prisma/migrations/`）。各マイグレーションは追加的（新規テーブル／
  nullable カラム）にして、データ量に依らず安全・短時間に適用できるようにする。

---

## npm スクリプト

| コマンド | 内容 |
|---|---|
| `npm run dev` | 開発サーバー |
| `npm run build` / `npm run start` | 本番ビルド / 起動 |
| `npm run db:migrate` | マイグレーション作成・適用（dev） |
| `npm run db:push` | スキーマを DB へ反映（マイグレーション無し） |
| `npm run db:seed` | シード投入 |
| `npm run db:studio` | Prisma Studio |
| `npm run db:reset` | DB リセット＋シード |
| `npm run pg:init/start/stop/status` | ポータブル PostgreSQL 管理 |

---

## ディレクトリ構成（抜粋）

```
prisma/
  schema.prisma          # データモデル
  migrations/            # マイグレーション
  seed.ts                # 初期データ
src/
  auth.ts                # Auth.js 本体（Credentials + JWT）
  auth.config.ts         # 共有設定（認可ゲート）
  proxy.ts               # Next 16 proxy（旧 middleware・ルートガード）
  app/
    login/               # ログイン
    hq/                  # 本店（HQ_ADMIN 専用）: dashboard/dealers/records/requests/announcements
    dealer/              # 代理店（DEALER 専用）: dashboard/records/requests/announcements
    api/
      auth/[...nextauth] # Auth.js ハンドラ
      records/[id]/photos/[index]   # 施工写真の認可付き配信
      requests/[id]/[kind]          # 依頼ファイル(input/result)の認可付き配信
  lib/
    db.ts                # Prisma クライアント（pg アダプタ）
    authz.ts             # requireHQ / requireDealer / assertOwnsDealer
    actions/             # サーバーアクション（dealers/records/requests/announcements/auth）
    validation/          # Zod スキーマ
  server/
    storage/             # StorageProvider（LocalDiskStorage / S3 差し替え用）
    notifications/       # NotificationService（console スタブ / LINE 差し替え用）
  components/            # 共通UI
```

---

## セキュリティ / 非機能

- **認可はサーバー側で二重に強制**: `proxy.ts`（粗いルートガード）+ 各ページ/サーバーアクション/ルートハンドラ冒頭の `requireHQ`/`requireDealer`/`assertOwnsDealer`。
- **ファイルは推測可能URLで直接配信しない**: ECUバイナリ・写真は必ず親レコードのアクセス権を確認する認可付きルート経由でのみ配信。保存キーはランダム。保存先は Web 公開ディレクトリの外。
- **入力バリデーションはサーバー側（Zod）**で実施。
- **監査**: 施工記録・依頼の主要な状態変更に作成者・日時を記録（`RequestEvent` 等）。

---

## 今回のスコープ外（将来フェーズ）

顧客向け公開ページ、AutoTuner 公式API連携、Instagram連携、第三者ショップ課金、中古車アラート、ネイティブアプリ化、実際の LINE 送信。
データモデルとモジュール構成はこれらを後から足せる前提で分離しています（例: `NotificationService` を `line` ドライバに、`StorageProvider` を `s3` に差し替え）。
