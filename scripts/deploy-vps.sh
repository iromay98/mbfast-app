#!/usr/bin/env bash
# ⚠ このスクリプトは使用禁止（2026-08-21の障害を受けて無効化）。
#
# rsync等でVPSへ直接転送する旧デプロイは、VPSのGit管理と混在すると
# 片方の作業がもう片方を黙って消す。実際に実装が消える障害が起きた。
#
# 正しいデプロイ（CLAUDE.mdの「デプロイ」節を参照）:
#   1. commit → git push
#   2. VPSで: cd /root/mbfast-app && git pull
#   3. docker compose -f docker-compose.prod.yml up -d --build
#   4. git log --oneline -1 と docker compose ps app のCREATEDで反映確認
echo "deploy-vps.sh は使用禁止です。git pull 方式でデプロイしてください（CLAUDE.md 参照）。" >&2
exit 1
