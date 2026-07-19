#!/usr/bin/env bash
# 本番VPS上でのデプロイ（/root/dev/mbfast-app のクローンから実行する）。
# 手順: デプロイ先の src/prisma を消す → git archive で転送 → docker compose ビルド起動 → ヘルスチェック。
# Macからのリモートデプロイと同一の結果になるように、rsyncではなく git archive を使う。
set -euo pipefail

DEV_DIR="/root/dev/mbfast-app"
DEPLOY_DIR="/root/mbfast-app"
LOG="/root/deploy.log"

if [ "$(pwd)" != "$DEV_DIR" ]; then
  cd "$DEV_DIR"
fi

if [ -n "$(git status --porcelain)" ]; then
  echo "⚠ 未コミットの変更があります。コミットしてから実行してください。" >&2
  git status --short >&2
  exit 1
fi

echo "== 同期 =="
rm -rf "$DEPLOY_DIR/src" "$DEPLOY_DIR/prisma"
git archive --format=tar HEAD | tar -x -C "$DEPLOY_DIR"
echo "synced $(git rev-parse --short HEAD)"

echo "== ビルド・起動（数分かかります） =="
cd "$DEPLOY_DIR"
: > "$LOG"
docker compose -f docker-compose.prod.yml up -d --build >> "$LOG" 2>&1

echo "== ヘルスチェック =="
for i in $(seq 1 30); do
  if docker ps --format '{{.Names}} {{.Status}}' | grep -q 'mbfast-app-app-1 Up'; then
    up_for=$(docker ps --format '{{.Names}} {{.Status}}' | grep app-1)
    echo "$up_for"
    break
  fi
  sleep 5
done
sleep 3
docker logs --tail 5 mbfast-app-app-1 2>&1 | grep -E "Ready|migrat|Error" || true
code=$(curl -s -o /dev/null -m 10 -w "%{http_code}" https://portal.mbfasttuning.com/ || echo "curl-failed")
echo "portal: $code (307=正常)"
