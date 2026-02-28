---
name: instagram-ops
description: Execute Instagram automation tasks in this repository by reusing the logged-in browser session. Use when users ask to search users, fetch profile posts, fetch following lists, extract hot comments, rank hot reels/posts, download media assets with metadata/errors, or troubleshoot IG script failures (login/session/CDN/proxy).
---

# Instagram Ops

## Quick Routing

Route requests to scripts by intent:

- Search users or open a result: use `search-user.js`
- Fetch profile posts: use `fetch-user-posts.js`
- Fetch following list: use `fetch-user-following.js`
- Rank hot reels/posts: use `fetch-user-hot-media.js`
- Fetch hot comments for one post: use `fetch-post-hot-comments.js`
- Download media files from hot-media JSON: use `download-hot-media-assets.js`
- Run end-to-end ranking + download: use `scripts/run_ig_pipeline.sh`

For command templates, read `references/commands.md`.
For multi-step flows, read `references/workflows.md`.

## Preflight

Before running any IG operation:

1. Check whether a reusable logged-in browser session exists.
2. If session is missing or expired, run `node login.js` and wait for successful login.
3. Prefer serial execution for session-based scripts.

## Execution Rules

Apply these rules for all runs:

- Run session-based scripts serially unless user explicitly asks for parallel.
- Write JSON outputs to `./logs` by default.
- Write media downloads to `./downloads` by default.
- Return absolute output file paths and key counts (`actualCount`, `failedCount`, etc.).
- If download touches Instagram CDN and fails, retry with proxy before changing logic.
- Keep IG request guard enabled (rate limiter + circuit breaker) unless user explicitly asks to disable.
- If circuit breaker is triggered, stop further script chaining and report cooldown seconds.

## IG Request Guard (Built-in)

These scripts include built-in request guard:

- `search-user.js`
- `fetch-user-posts.js`
- `fetch-user-following.js`
- `fetch-post-hot-comments.js`
- `download-hot-media-assets.js` (post-resolve API stage)

Default behavior:

- Rate limit: `900ms` minimum + random jitter `0~600ms`
- Circuit breaker: open after `3` consecutive failures
- Cooldown: `300s` for normal failures, `1800s` for risk signals (`429/challenge/checkpoint/feedback`)

Environment overrides (optional):

- `IG_RATE_LIMIT_ENABLED`
- `IG_RATE_LIMIT_MIN_DELAY_MS`
- `IG_RATE_LIMIT_JITTER_MS`
- `IG_CIRCUIT_BREAKER_ENABLED`
- `IG_CIRCUIT_BREAKER_FAILURE_THRESHOLD`
- `IG_CIRCUIT_BREAKER_COOLDOWN_MS`
- `IG_CIRCUIT_BREAKER_RISK_COOLDOWN_MS`

## Standard Workflows

Use these defaults unless user overrides:

1. Followings only:
- Run `fetch-user-following.js` with `--limit` and `--output`.

2. Hot URLs only:
- Run `fetch-user-hot-media.js` with `--scan-limit`, `--top-reels`, `--top-posts`, and `--output`.

3. Hot URLs + media download:
- First run `fetch-user-hot-media.js` to generate input JSON.
- Then run `download-hot-media-assets.js --input <hot-json>`.
- Pass `--proxy` when network cannot reach `scontent-*.cdninstagram.com`.

For exact examples, read `references/workflows.md`.

## Outputs

Keep output contracts stable:

- `fetch-user-hot-media.js` output contains `topReelUrls` and `topPostUrls`.
- `download-hot-media-assets.js` output directory must contain:
  - `media/*`
  - `metadata.json`
  - `errors.json`

For field-level structure, read `references/outputs.md`.

## Troubleshooting

Diagnose failures in this order:

1. Login/session issues (`/accounts/login`, browser connect error).
2. Request/permission issues (private account, invalid URL/shortcode).
3. Network/CDN issues (`timeout`, `AggregateError`, CDN 443 connect failures).
4. Proxy issues (bad proxy scheme/port/auth).

Use ready-to-run fixes from `references/troubleshooting.md`.
