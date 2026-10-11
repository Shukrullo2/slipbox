#!/usr/bin/env bash
# Turns on "Fill in with AI" on the server.
#   scripts/set-ai.sh huggingface [user@host]     token from ~/.config/slipbox/hf-token
#   scripts/set-ai.sh anthropic   [user@host]     key   from ~/.config/slipbox/anthropic-api-key
#   scripts/set-ai.sh off         [user@host]     remove both
# The secret is copied to the server's .env without appearing in any command line or output.
set -euo pipefail
PROVIDER="${1:?Pass huggingface, anthropic or off}"
# Host and address come from deploy/deploy.env (git-ignored; see deploy/deploy.env.example).
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
[ -f "$ROOT_DIR/deploy/deploy.env" ] && . "$ROOT_DIR/deploy/deploy.env"
HOST="${2:-${SLIPBOX_DEPLOY_HOST:?Set SLIPBOX_DEPLOY_HOST in deploy/deploy.env}}"

case "$PROVIDER" in
  huggingface) FILE="$HOME/.config/slipbox/hf-token"; VAR=SLIPBOX_HF_TOKEN; PATTERN='^hf_[A-Za-z0-9]{20,}$' ;;
  anthropic)   FILE="$HOME/.config/slipbox/anthropic-api-key"; VAR=SLIPBOX_AI_API_KEY; PATTERN='^sk-ant-[A-Za-z0-9_-]{20,}$' ;;
  off)         FILE=""; VAR=""; PATTERN="" ;;
  *) echo "Unknown provider: $PROVIDER" >&2; exit 1 ;;
esac

if [ -n "$FILE" ]; then
  [ -s "$FILE" ] || { echo "No token found in $FILE" >&2; exit 1; }
  tr -d '[:space:]' < "$FILE" | grep -qE "$PATTERN" || { echo "The contents of $FILE don't look like a $PROVIDER token" >&2; exit 1; }
  scp -q "$FILE" "$HOST:/opt/slipbox/.ai-token.tmp"
fi

ssh "$HOST" bash -s -- "$PROVIDER" "$VAR" <<'REMOTE'
set -euo pipefail
cd /opt/slipbox
umask 077
grep -v -e '^SLIPBOX_HF_TOKEN=' -e '^SLIPBOX_AI_API_KEY=' -e '^SLIPBOX_AI_PROVIDER=' .env > .env.next || true
if [ "$1" != "off" ]; then
  token=$(tr -d '[:space:]' < .ai-token.tmp); rm -f .ai-token.tmp
  printf '%s=%s\nSLIPBOX_AI_PROVIDER=%s\n' "$2" "$token" "$1" >> .env.next
fi
mv .env.next .env
docker compose --env-file .env -f deploy/docker-compose.yml up -d 2>&1 | grep -v "^time=" || true
sleep 4
docker logs --since 30s slipbox 2>&1 | grep "AI fill" || true
REMOTE
