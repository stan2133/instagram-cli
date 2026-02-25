# Instagram 单篇 Post 热评抓取设计文档

## 1. 目标

新增脚本：在**已登录 Instagram 会话**下，针对某一篇指定 Post（`/p/.../` 或 `/reel/.../`）抓取热评数据并输出结构化 JSON。

建议脚本名：`fetch-post-hot-comments.js`

## 2. 设计原则（对齐你当前思路）

- 复用 `search-user.js` / `fetch-user-posts.js` 的连接策略：
  - 先读 `~/.instagram-cli/sessions/browser-info.json` 的 `webSocketDebuggerUrl`
  - 失败后回退 `--debug-port`（默认 `9222`）
- 必须在登录态下执行（检测到登录页则直接报错）
- 尽量使用 IG Web 内部 API 拉结构化数据，避免纯 DOM 解析
- 输出可用于后续分析/自动化（JSON 稳定字段 + 排序信息 + 原始计数）

## 3. 输入与输出

### 输入

- 必填：`postTarget`
  - 支持：
    - `https://www.instagram.com/p/<shortcode>/`
    - `https://www.instagram.com/reel/<shortcode>/`
    - `<shortcode>`
- 可选参数：
  - `--limit <n>`：热评数量上限（默认 `20`，最大 `200`）
  - `--output <file>`：输出文件
  - `--debug-port <port>`：调试端口回退
  - `--keep-connected`：执行后保持浏览器连接
  - `--include-replies`：是否附带每条热评的首层回复（可选）
  - `--min-likes <n>`：仅保留点赞数不小于 n 的评论（可选）

### 输出（建议）

```json
{
  "post": {
    "shortcode": "DVEQd9PjhJH",
    "postUrl": "https://www.instagram.com/nike/p/DVEQd9PjhJH/",
    "mediaPk": "3838265209794728519",
    "ownerUsername": "nike",
    "caption": "...",
    "likeCount": 67812,
    "commentCount": 686,
    "takenAt": "2026-02-22T16:14:50.000Z"
  },
  "hotComments": [
    {
      "rank": 1,
      "commentPk": "18000000000000000",
      "commentId": "18000000000000000",
      "text": "...",
      "likeCount": 1113,
      "createdAt": "2026-02-22T18:10:00.000Z",
      "ownerUsername": "goswish",
      "ownerIsVerified": true,
      "ownerIsPostAuthor": false,
      "replyCount": 28,
      "isPinned": false,
      "score": 1349
    }
  ],
  "meta": {
    "capturedAt": "2026-02-25T16:00:00.000Z",
    "requestedLimit": 20,
    "actualCount": 20,
    "sortMode": "popular"
  }
}
```

## 4. 抓取流程（核心）

### Step A: 连接与登录态确认

1. 连接已打开浏览器（WebSocket -> debug-port fallback）
2. 打开目标 post URL
3. 若跳到 `/accounts/login`，报错提示先 `node login.js`

### Step B: 解析目标 Post 元信息

目标：拿到 `mediaPk`（评论 API 的关键参数）与 post 概要。

优先路径：
1. 使用 `shortcode` 走内部接口获取 post info（含 `mediaPk`）
2. 若接口失败，监听页面网络响应，捕获包含 post info 的 `/api/v1/...` 响应回退

### Step C: 拉取评论并定位“热评”

优先调用“popular”排序接口（如果当前会话可用）：
- 评论接口按 `mediaPk` 获取
- 参数携带 `sort_order=popular`（或等价参数）
- 处理分页游标（如 `next_min_id`），直到达到 `--limit`

若“popular”不可用：
- 拉取默认评论列表
- 本地计算热度分（见 Step D）

### Step D: 热评排序策略（本地回退）

当接口不直接返回热评顺序时，执行本地评分：

`score = likeCount * 1.0 + replyCount * 20 + isPinned*800 + ownerIsVerified*120 + ownerIsPostAuthor*200 - ageDecay`

说明：
- `ageDecay`：按发布时间衰减，避免旧评论长期霸榜
- 排序：`score` 降序，分数相同按 `likeCount`、`createdAt` 兜底

## 5. 关键字段映射

评论维度建议统一字段：

- 标识：`commentPk/commentId`
- 内容：`text`
- 热度：`likeCount/replyCount/isPinned/score/rank`
- 作者：`ownerUsername/ownerIsVerified/ownerIsPostAuthor`
- 时间：`createdAt`（ISO）/`createdAtUnix`

帖子维度建议保留：
- `shortcode/mediaPk/postUrl`
- `ownerUsername`
- `caption/likeCount/commentCount/takenAt`

## 6. 异常与边界

- 私密账号或不可见 post：返回明确错误（权限不足）
- 评论关闭：返回空列表 + 状态说明
- 限流/风控：指数退避重试（建议 2~3 次）
- 单条评论字段缺失：保留记录并填默认值，不中断整体

## 7. CLI 示例

```bash
# 基础：抓取 20 条热评
node fetch-post-hot-comments.js "https://www.instagram.com/nike/p/DVEQd9PjhJH/" --limit 20 --output ./logs/hot-comments.json

# 只保留点赞>=50
node fetch-post-hot-comments.js "DVEQd9PjhJH" --limit 50 --min-likes 50 --output ./logs/hot-comments-50.json

# 包含回复
node fetch-post-hot-comments.js "DVEQd9PjhJH" --limit 30 --include-replies --output ./logs/hot-comments-with-replies.json
```

## 8. 代码结构建议

新增文件：
- `fetch-post-hot-comments.js`

建议函数：
- `parseCliArgs(argv)`
- `normalizePostTarget(target)`
- `connectBrowser(puppeteer, debugPort)`
- `pickInstagramPage(browser)`
- `ensureLoggedIn(page, postUrl)`
- `resolvePostMeta(page, shortcode)`
- `fetchCommentsPage(page, mediaPk, cursor, limit, mode)`
- `rankHotComments(comments, postMeta)`
- `normalizeComment(raw, postOwnerUsername)`
- `saveResults(data, outputFile)`

## 9. 测试计划

### 单元测试（Jest）

- `normalizePostTarget`（URL/shortcode 校验）
- 参数解析（`--limit`、`--min-likes`）
- 热度评分与排序稳定性
- 评论字段归一化（缺失值兜底）

建议测试文件：
- `tests/unit/fetch-post-hot-comments.test.js`

### E2E 手测

1. `node login.js` 完成登录
2. 对公开大号单帖抓 20 条热评
3. 验证字段完整性、排序合理性、输出文件落盘
4. 验证评论关闭/私密帖子失败提示

## 10. 迭代阶段

### P1（最小可用）

- 输入 post URL/shortcode
- 输出前 N 条热评（优先接口 popular，失败回退本地排序）

### P2（增强）

- `--include-replies`
- `--min-likes`
- 更细粒度错误码与重试

### P3（稳定性）

- 请求节流配置
- 结果缓存（避免短时间重复抓取）
- 统一埋点日志（便于对比 IG 接口变化）

