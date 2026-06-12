#!/usr/bin/env bash
# ------------------------------------------------------------------
# ポータブル PostgreSQL 管理スクリプト（開発用・sudo 不要）
#
# Docker や OS グローバルの PostgreSQL を使わず、プロジェクト直下の
# .pgdata にデータディレクトリを作って localhost で起動します。
# 本番(VPS)では通常の PostgreSQL に DATABASE_URL を向けるだけで差し替え可。
#
# 使い方:
#   ./scripts/pg.sh init      # 初回のみ: データディレクトリ作成
#   ./scripts/pg.sh start     # 起動
#   ./scripts/pg.sh stop      # 停止
#   ./scripts/pg.sh status    # 稼働確認
#
# 注: このポータブルビルドには psql/createdb クライアントは含まれません。
#     mbfast データベースの作成は Prisma (npm run db:push / db:migrate) が
#     自動で行います。SQL を直接叩きたいときは `npm run db:studio` を使用。
# ------------------------------------------------------------------
set -euo pipefail

# 展開済みポータブル PostgreSQL の bin（環境変数で上書き可）
PG_BIN="${PG_BIN:-$HOME/.local/pgsql/dist/bin}"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PGDATA="${PGDATA:-$PROJECT_DIR/.pgdata}"
PGPORT="${PGPORT:-5432}"
PGDB="${PGDB:-mbfast}"
PGUSER_SUPER="postgres"
LOGFILE="$PGDATA/postgres.log"

export PATH="$PG_BIN:$PATH"

cmd="${1:-}"
case "$cmd" in
  init)
    if [ -d "$PGDATA" ]; then
      echo "[pg] $PGDATA は既に存在します。スキップ。"
    else
      echo "[pg] initdb -> $PGDATA"
      # 開発用: ローカル接続は trust（パスワード不要）。本番では使わないこと。
      initdb -D "$PGDATA" -U "$PGUSER_SUPER" -A trust --encoding=UTF8 --locale=C >/dev/null
    fi
    echo "[pg] start"
    pg_ctl -D "$PGDATA" -o "-p $PGPORT -k '$PGDATA'" -l "$LOGFILE" start
    echo "[pg] init 完了。データベース '$PGDB' は Prisma が初回マイグレーション時に自動作成します。"
    echo "[pg] DATABASE_URL=postgresql://$PGUSER_SUPER@127.0.0.1:$PGPORT/$PGDB"
    ;;
  start)
    pg_ctl -D "$PGDATA" -o "-p $PGPORT -k '$PGDATA'" -l "$LOGFILE" start
    ;;
  stop)
    pg_ctl -D "$PGDATA" stop -m fast
    ;;
  restart)
    pg_ctl -D "$PGDATA" -o "-p $PGPORT -k '$PGDATA'" -l "$LOGFILE" restart -m fast
    ;;
  status)
    pg_ctl -D "$PGDATA" status || true
    ;;
  *)
    echo "usage: $0 {init|start|stop|restart|status}"
    exit 1
    ;;
esac
