#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMPLATE_PATH="$ROOT_DIR/docs/SUBAGENT_PLAYBOOK_TEMPLATE.md"

if [[ ! -f "$TEMPLATE_PATH" ]]; then
  echo "Template not found: $TEMPLATE_PATH" >&2
  exit 1
fi

case "${1:-}" in
  --path)
    echo "$TEMPLATE_PATH"
    ;;
  --copy)
    if command -v pbcopy >/dev/null 2>&1; then
      cat "$TEMPLATE_PATH" | pbcopy
      echo "Copied template to clipboard."
    else
      echo "pbcopy not found; printing template instead." >&2
      cat "$TEMPLATE_PATH"
    fi
    ;;
  *)
    cat "$TEMPLATE_PATH"
    ;;
esac
