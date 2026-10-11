#!/usr/bin/env bash
# Turns on Telegram sign-in for the web app on the server.
#   scripts/set-telegram.sh @your_username[,123456789,...] [user@host]
# The bot token is read from ~/.config/slipbox/telegram-bot-token and copied to
# the server's .env without appearing in any command line or output.
set -euo pipefail
USERS="${1:?Pass the Telegram @usernames or numeric ids allowed to sign in, comma-separated}"
# Host and address come from deploy/deploy.env (git-ignored; see deploy/deploy.env.example).
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
[ -f "$ROOT_DIR/deploy/deploy.env" ] && . "$ROOT_DIR/deploy/deploy.env"
HOST="${2:-${SLIPBOX_DEPLOY_HOST:?Set SLIPBOX_DEPLOY_HOST in deploy/deploy.env}}"
TOKEN_FILE="${SLIPBOX_TELEGRAM_TOKEN_FILE:-$HOME/.config/slipbox/telegram-bot-token}"

grep -qE '^[0-9]+:[A-Za-z0-9_-]{30,}[[:space:]]*$' "$TOKEN_FILE" || { echo "No bot token found in $TOKEN_FILE" >&2; exit 1; }
[[ "$USERS" =~ ^[@A-Za-z0-9_,\ ]+$ ]] || { echo "Usernames and ids may only contain letters, digits, _, @ and commas" >&2; exit 1; }

scp -q "$TOKEN_FILE" "$HOST:/opt/slipbox/.telegram-token.tmp"
ssh "$HOST" bash -s -- "$USERS" <<'REMOTE'
set -euo pipefail
cd /opt/slipbox
umask 077
token=$(tr -d '[:space:]' < .telegram-token.tmp)
rm -f .telegram-token.tmp
grep -v -e '^SLIPBOX_TELEGRAM_BOT_TOKEN=' -e '^SLIPBOX_TELEGRAM_USERS=' .env > .env.next || true
printf 'SLIPBOX_TELEGRAM_BOT_TOKEN=%s\nSLIPBOX_TELEGRAM_USERS=%s\n' "$token" "$1" >> .env.next
mv .env.next .env
docker compose --env-file .env -f deploy/docker-compose.yml up -d 2>&1 | grep -v "^time=" || true
REMOTE
sleep 4
curl -sS "$(grep -m1 '^SLIPBOX_URL=' "$HOME/.config/slipbox/credentials" | cut -d= -f2-)/api/session"; echo
