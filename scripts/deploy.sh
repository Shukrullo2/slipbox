#!/usr/bin/env bash
# Builds the web app and ships Slipbox to the server, then restarts its container.
# The server's vault (/var/lib/slipbox/vault) and .env are never touched.
#   scripts/deploy.sh [user@host]
set -euo pipefail
# Host and address come from deploy/deploy.env (git-ignored; see deploy/deploy.env.example).
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
[ -f "$ROOT_DIR/deploy/deploy.env" ] && . "$ROOT_DIR/deploy/deploy.env"
HOST="${1:-${SLIPBOX_DEPLOY_HOST:?Set SLIPBOX_DEPLOY_HOST in deploy/deploy.env}}"
APP=/opt/slipbox
cd "$(dirname "$0")/.."
# A restrictive umask in the calling shell would make the built files unreadable in the container.
umask 022

npm run build
ssh "$HOST" "mkdir -p $APP"
rsync -az --delete --relative \
  Dockerfile .dockerignore package.json package-lock.json server shared claude dist deploy \
  "$HOST:$APP/"
ssh "$HOST" "cd $APP && docker compose --env-file .env -f deploy/docker-compose.yml up -d --build --remove-orphans && docker compose --env-file .env -f deploy/docker-compose.yml ps"
