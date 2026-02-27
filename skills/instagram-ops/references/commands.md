# Commands

## Login Session

```bash
node login.js
```

## Search User

```bash
node search-user.js "<keyword>" --limit 10 --output ./logs/search-<keyword>.json
```

## Fetch User Posts

```bash
node fetch-user-posts.js "<username-or-profile-url>" --limit 24 --output ./logs/<username>-posts.json
```

## Fetch User Following

```bash
node fetch-user-following.js "<username-or-profile-url>" --limit 200 --output ./logs/<username>-following.json
```

## Fetch Hot Media URLs

```bash
node fetch-user-hot-media.js "<username-or-profile-url>" \
  --scan-limit 120 \
  --top-reels 10 \
  --top-posts 10 \
  --output ./logs/<username>-hot-media.json
```

## Fetch Hot Comments

```bash
node fetch-post-hot-comments.js "<post-url-or-shortcode>" \
  --limit 50 \
  --min-likes 20 \
  --output ./logs/hot-comments-<shortcode>.json
```

## Download Media Assets from Hot JSON

```bash
node download-hot-media-assets.js \
  --input ./logs/<username>-hot-media.json \
  --output-dir ./downloads \
  --concurrency 2 \
  --retry 3 \
  --timeout 60000
```

With proxy:

```bash
node download-hot-media-assets.js \
  --input ./logs/<username>-hot-media.json \
  --output-dir ./downloads \
  --proxy http://127.0.0.1:7897
```
