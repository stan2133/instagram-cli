# Troubleshooting

## 1) Session Not Logged In

Symptoms:

- Redirects to `/accounts/login`
- Script says current session is not logged in

Fix:

```bash
node login.js
```

## 2) Browser Connection Failed

Symptoms:

- Cannot connect via WebSocket/debug port

Fix:

- Ensure login process is still running
- Retry with explicit port:

```bash
node fetch-user-posts.js "nike" --debug-port 9222
```

## 3) net::ERR_ABORTED

Symptoms:

- Navigation aborted while running multiple scripts

Root cause:

- Concurrent scripts using same browser session

Fix:

- Run session-based scripts serially
- Avoid parallel invocations unless isolated browser instances are used

## 4) CDN Download Timeout / AggregateError

Symptoms:

- `timeout`
- `AggregateError`
- `Failed to connect to scontent-*.cdninstagram.com:443`

Fix:

```bash
node download-hot-media-assets.js --input ./logs/nike-hot-media.json --output-dir ./downloads --proxy http://127.0.0.1:7897
```

Optional debug scope:

```bash
node download-hot-media-assets.js --input ./logs/nike-hot-media.json --output-dir ./downloads --max-posts 1 --proxy http://127.0.0.1:7897
```

## 5) Proxy Format Invalid

Use one of:

- `http://127.0.0.1:7897`
- `https://user:pass@host:port`
- `socks5://127.0.0.1:1080`

## 6) Circuit Breaker Triggered

Symptoms:

- Error contains `请求被熔断保护拦截`
- Error contains `触发熔断保护`

Fix:

1. Stop chaining more IG scripts for the same account.
2. Wait for cooldown to expire (message includes remaining seconds).
3. Resume with safer profile (higher delay / lower threshold).

Example safe profile:

```bash
export IG_RATE_LIMIT_MIN_DELAY_MS=1200
export IG_RATE_LIMIT_JITTER_MS=800
export IG_CIRCUIT_BREAKER_FAILURE_THRESHOLD=2
export IG_CIRCUIT_BREAKER_COOLDOWN_MS=600000
export IG_CIRCUIT_BREAKER_RISK_COOLDOWN_MS=3600000
```
