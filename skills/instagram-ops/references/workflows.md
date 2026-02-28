# Workflows

## A. Get Following List

1. Ensure logged-in session via `node login.js`.
2. Keep IG request guard enabled (or export a safer profile before running).
3. Run `fetch-user-following.js` with target + `--limit` + `--output`.
3. Return output path and `meta.actualCount`.

Example:

```bash
node fetch-user-following.js "nike" --limit 200 --output ./logs/nike-following-200.json
```

## B. Get Hot Reels/Posts URLs

1. Ensure logged-in session.
2. Keep IG request guard enabled for all dependent API scripts.
3. Run `fetch-user-hot-media.js`.
3. Return output path and URL counts (`actualTopReels`, `actualTopPosts`).

Example:

```bash
node fetch-user-hot-media.js "nike" --scan-limit 120 --top-reels 10 --top-posts 10 --output ./logs/nike-hot-media.json
```

## C. Hot URLs + Download All Media

1. Run hot-media ranking and save JSON.
2. Run media downloader using that JSON (with request guard defaults).
3. Return media directory, `metadata.json`, and `errors.json`.

Example:

```bash
node fetch-user-hot-media.js "nike" --scan-limit 60 --top-reels 5 --top-posts 5 --output ./logs/nike-hot-media.json
node download-hot-media-assets.js --input ./logs/nike-hot-media.json --output-dir ./downloads
```

## D. Hot URLs + Download with Proxy

Use when CDN is unreachable.

```bash
node download-hot-media-assets.js --input ./logs/nike-hot-media.json --output-dir ./downloads --proxy http://127.0.0.1:7897
```

## E. Debug Minimal Scope

Use `--max-posts 1` for download debugging.

```bash
node download-hot-media-assets.js --input ./logs/nike-hot-media.json --output-dir ./downloads --max-posts 1 --proxy http://127.0.0.1:7897
```

## F. Safety-First Guard Profile

Use this profile when user mentions risk control / anti-bot concerns:

```bash
export IG_RATE_LIMIT_ENABLED=true
export IG_RATE_LIMIT_MIN_DELAY_MS=1200
export IG_RATE_LIMIT_JITTER_MS=800
export IG_CIRCUIT_BREAKER_ENABLED=true
export IG_CIRCUIT_BREAKER_FAILURE_THRESHOLD=2
export IG_CIRCUIT_BREAKER_COOLDOWN_MS=600000
export IG_CIRCUIT_BREAKER_RISK_COOLDOWN_MS=3600000
```
