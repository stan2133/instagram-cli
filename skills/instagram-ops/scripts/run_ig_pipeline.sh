#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <username-or-profile-url> [proxy-url]"
  echo "Example: $0 nike http://127.0.0.1:7897"
  exit 1
fi

TARGET="$1"
PROXY="${2:-}"
SCAN_LIMIT="${SCAN_LIMIT:-60}"
TOP_REELS="${TOP_REELS:-5}"
TOP_POSTS="${TOP_POSTS:-5}"

mkdir -p ./logs

SAFE_TARGET="$(echo "$TARGET" | sed 's#https\?://##g; s#[^A-Za-z0-9._-]#-#g')"
HOT_JSON="./logs/${SAFE_TARGET}-hot-media.json"

echo "[1/2] Fetch hot media URLs..."
node fetch-user-hot-media.js "$TARGET" \
  --scan-limit "$SCAN_LIMIT" \
  --top-reels "$TOP_REELS" \
  --top-posts "$TOP_POSTS" \
  --output "$HOT_JSON"

echo "[2/2] Download media assets..."
CMD=(node download-hot-media-assets.js --input "$HOT_JSON" --output-dir ./downloads)
if [[ -n "$PROXY" ]]; then
  CMD+=(--proxy "$PROXY")
fi
"${CMD[@]}"

echo "Done. Hot JSON: $HOT_JSON"
