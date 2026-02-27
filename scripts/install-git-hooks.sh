#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

chmod +x "$repo_root/scripts/secret-scan.sh"
chmod +x "$repo_root/.githooks/pre-commit"
chmod +x "$repo_root/.githooks/pre-push"

git -C "$repo_root" config core.hooksPath .githooks

echo "Git hooks installed: core.hooksPath=.githooks"
echo "Enabled hooks: pre-commit, pre-push"
