# Outputs

## fetch-user-following.js

Output JSON:

- `profile`: target profile summary
- `following[]`: following users
- `meta`: counts and pagination status

Key fields:

- `meta.actualCount`
- `meta.pagesFetched`
- `meta.hasMore`

## fetch-user-hot-media.js

Output JSON:

- `profile`
- `topReels[]`
- `topPosts[]`
- `topReelUrls[]`
- `topPostUrls[]`
- `meta`

Key fields:

- `meta.scannedCount`
- `meta.actualTopReels`
- `meta.actualTopPosts`

## download-hot-media-assets.js

Output directory:

- `downloads/instagram/<username>/<capturedAt>/media/*`
- `downloads/instagram/<username>/<capturedAt>/metadata.json`
- `downloads/instagram/<username>/<capturedAt>/errors.json`

`metadata.json` summary keys:

- `summary.requestedPostCount`
- `summary.mediaCount`
- `summary.successCount`
- `summary.skippedCount`
- `summary.failedCount`

`errors.json`:

- Empty array `[]` means no failures
- Non-empty means partial or full download failure
