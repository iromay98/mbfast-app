# 本番デプロイ手順（VPS・常時公開・自動HTTPS）

「どこからでもアクセスできる」状態にする手順。小さなLinux VPS（1〜2GB RAM）で十分。
DB とアップロード済みファイルは永続ボリュームに保存され、**再デプロイで消えない**。

## 0. 用意するもの
- VPS 1台（さくら/ConoHa/Xserver VPS/Vultr/Hetzner/DigitalOcean など。Ubuntu 22.04+ 推奨）
- ドメイン1つ（例 `catalog.example.com`）。サブドメインで可。
- AutoTuner の `AUTOTUNER_ID` / `AUTOTUNER_API_KEY`

## 1. DNS とポート
- ドメインの **A レコード**を VPS のグローバル IP に向ける。
- VPS のファイアウォールで **80 / 443 を開放**（証明書取得と配信に必要）。22(SSH)も。

## 2. VPS に Docker を入れる
```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER   # 入り直すと sudo 不要に
```

## 3. コードを配置
```bash
git clone <このリポジトリ> mbfast-app   # または rsync で転送
cd mbfast-app
```

## 4. 本番設定
```bash
cp .env.production.example .env
# .env を編集:
#   DOMAIN=catalog.example.com
#   AUTH_SECRET=（node -e "console.log(require('crypto').randomBytes(32).toString('base64'))" で生成）
#   POSTGRES_PASSWORD=（強い値）
#   AUTOTUNER_ID= / AUTOTUNER_API_KEY=
#   SEED_ON_START=1   ← 初回のみ（初期アカウント投入）
```

## 5. 起動（初回）
```bash
SEED_ON_START=1 docker compose -f docker-compose.prod.yml up -d --build
```
- 起動時に `prisma migrate deploy` が走り、スキーマが適用される。
- Caddy が `DOMAIN` の証明書を Let's Encrypt から自動取得（数十秒）。
- `https://catalog.example.com` で表示される。スマホ等どこからでもアクセス可。

## 6. 初回ログイン後すぐやること（セキュリティ）
- シードの共通パスワード **`password123` を必ず変更**。不要な初期アカウントは整理。
- `.env` はコミットしない（`.gitignore`/`.dockerignore` 済み）。

## 7. 更新デプロイ（コード変更を反映）
```bash
git pull            # 最新コード取得
docker compose -f docker-compose.prod.yml up -d --build
```
- マイグレーションは起動時に自動適用（追加的・短時間設計）。
- **DB と storage ボリュームは保持**されるのでデータは消えない（`SEED_ON_START` は 0 のまま）。

## 8. バックアップ（推奨）
```bash
# DB ダンプ
docker compose -f docker-compose.prod.yml exec postgres \
  pg_dump -U mbfast mbfast | gzip > backup_$(date +%F).sql.gz
# アップロード済みファイル（storage ボリューム）
docker run --rm -v mbfast-app_storage:/data -v "$PWD":/out alpine \
  tar czf /out/storage_$(date +%F).tar.gz -C /data .
```
（ボリューム名はプロジェクトディレクトリ名で変わる。`docker volume ls` で確認）

## 構成メモ
- `caddy`(80/443) → `app:3000`(内部) → `postgres`(内部)。**app と postgres はインターネット非公開**。
- 永続ボリューム: `pgdata`(DB) / `storage`(アップロード) / `caddy_data`(証明書)。コード/イメージとは分離。
- HTTPS なので車検証カメラ(getUserMedia)も動作。
- 大容量アップロード対応のため `next.config.ts` の `serverActions.bodySizeLimit` を 60MB に設定済み。

## トラブル時
```bash
docker compose -f docker-compose.prod.yml logs -f app    # アプリログ
docker compose -f docker-compose.prod.yml logs -f caddy  # 証明書取得の確認
docker compose -f docker-compose.prod.yml ps             # 稼働状況
```
- 証明書が出ない: DNS が VPS を指しているか、80/443 が開いているか確認。
- 復号が「認証情報未設定」: `.env` の AUTOTUNER_ID/API_KEY を設定して `up -d` し直す。
