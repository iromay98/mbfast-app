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
docker logs --tail 20 mbfast-app-app-1 2>&1 | grep -E "Ready|migrat|Applied|Error" || true

# 応答するまで待つ。コンテナが Up になった直後は prisma migrate deploy → Next起動の途中で
# 502 が返るため、1回きりのcurlでは常に502が記録され「ヘルスチェックが意味を持たない」状態だった。
# 200/307 を確認できるまで最大2分待ち、それでも駄目ならログを出して失敗させる（赤くする）。
code=""
for i in $(seq 1 24); do
  code=$(curl -s -o /dev/null -m 10 -w "%{http_code}" https://portal.mbfasttuning.com/ || echo "000")
  case "$code" in
    200 | 307 | 308) break ;;
  esac
  sleep 5
done
echo "portal: $code"
case "$code" in
  200 | 307 | 308)
    echo "✓ 正常に応答しました"
    ;;
  *)
    echo "✗ 応答が $code のままです（2分待機）。直近のアプリログ:" >&2
    docker logs --tail 60 mbfast-app-app-1 2>&1 | tail -n 60 >&2
    exit 1
    ;;
esac
