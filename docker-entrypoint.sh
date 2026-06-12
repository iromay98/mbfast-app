#!/bin/sh
set -e

echo "[entrypoint] DB マイグレーションを適用します..."
# 本番はマイグレーション履歴で適用。履歴が無い初回は db push にフォールバック。
if [ -d prisma/migrations ] && [ "$(ls -A prisma/migrations 2>/dev/null)" ]; then
  npx prisma migrate deploy
else
  npx prisma db push
fi

# 初回のみシードしたい場合は SEED_ON_START=1 を設定
if [ "${SEED_ON_START:-0}" = "1" ]; then
  echo "[entrypoint] シードを投入します..."
  npx prisma db seed || echo "[entrypoint] seed をスキップ（既に投入済みの可能性）"
fi

echo "[entrypoint] アプリを起動します..."
exec npm run start
