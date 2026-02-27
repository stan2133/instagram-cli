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
