#!/usr/bin/env bash
set -euo pipefail

MODE="${1:---tracked}"

if ! command -v rg >/dev/null 2>&1; then
  echo "Error: ripgrep (rg) is required for secret scanning." >&2
  exit 1
fi

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Error: must run inside a git repository." >&2
  exit 1
fi

files=()
case "$MODE" in
  --staged)
    while IFS= read -r -d '' file; do
      [[ -f "$file" ]] && files+=("$file")
    done < <(git diff --cached --name-only --diff-filter=ACMR -z --)
    ;;
  --tracked)
    while IFS= read -r -d '' file; do
      [[ -f "$file" ]] && files+=("$file")
    done < <(git ls-files -z)
    ;;
  *)
    echo "Usage: $0 [--staged|--tracked]" >&2
    exit 1
    ;;
esac

if [[ ${#files[@]} -eq 0 ]]; then
  echo "Secret scan: no files to scan ($MODE)."
  exit 0
fi

patterns=(
  "ghp_[A-Za-z0-9]{36}"
  "github_pat_[A-Za-z0-9_]{20,}"
  "AKIA[0-9A-Z]{16}"
  "ASIA[0-9A-Z]{16}"
  "AIza[0-9A-Za-z_-]{35}"
  "sk-[A-Za-z0-9]{20,}"
  "xox[baprs]-[A-Za-z0-9-]{10,}"
  "-----BEGIN (EC|OPENSSH|RSA|DSA|PGP|PRIVATE) PRIVATE KEY-----"
  "sessionid=[A-Za-z0-9%._-]{10,}"
  "csrftoken=[A-Za-z0-9%._-]{10,}"
  "(api[_-]?key|client[_-]?secret|secret|token|password|passwd)[[:space:]]*[:=][[:space:]]*[\"'][^\"'[:space:]]{8,}[\"']"
  "authorization[[:space:]]*[:=][[:space:]]*[\"']?bearer[[:space:]][A-Za-z0-9._-]{16,}"
)

rg_cmd=(rg -n -i --no-heading --color=never)
for pattern in "${patterns[@]}"; do
  rg_cmd+=(-e "$pattern")
done
rg_cmd+=(--)
rg_cmd+=("${files[@]}")

matches="$("${rg_cmd[@]}" || true)"

if [[ -n "$matches" ]]; then
  echo "Potential secrets detected. Commit/push blocked." >&2
  echo "$matches" >&2
  echo "" >&2
  echo "If this is a false positive, move sample values to .env.example or sanitize before commit." >&2
  exit 1
fi

echo "Secret scan passed ($MODE)."
