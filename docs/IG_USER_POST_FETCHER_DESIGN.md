# Instagram 账号 Post 信息抓取脚本设计

## 1. 目标

新增一个脚本：输入一个 Instagram 账号主页 URL，输出该账号的 Post 信息（可保存为 JSON），用于后续分析或自动化处理。

脚本名建议：`fetch-user-posts.js`

## 2. 输入与输出

### 输入

- 必填：`profileUrl`
  - 示例：`https://www.instagram.com/nike/`
- 可选参数：
  - `--limit <n>`：抓取帖子数量上限（默认 `12`，最大 `100`）
  - `--output <file>`：输出 JSON 文件路径
  - `--debug-port <port>`：浏览器调试端口（默认 `9222`）
  - `--keep-connected`：结束后保持浏览器连接
  - `--mode <auto|dom|network>`：抓取模式（默认 `auto`）

### 输出 JSON 结构（建议）

```json
{
  "profile": {
    "url": "https://www.instagram.com/nike/",
    "username": "nike",
    "displayName": "Nike",
    "bio": "...",
    "isVerified": true,
    "isPrivate": false,
    "followersText": "3.2亿",
    "followingText": "200",
    "postsText": "1,234"
  },
  "posts": [
    {
      "shortcode": "DExxxxxxxx",
      "postUrl": "https://www.instagram.com/p/DExxxxxxxx/",
      "type": "image",
      "caption": "...",
      "likeCountText": "12,345",
      "commentCountText": "321",
      "viewCountText": "",
      "publishedAt": "2026-02-20T10:00:00.000Z",
      "thumbnailUrl": "https://...",
      "mediaUrls": []
    }
  ],
  "meta": {
    "capturedAt": "2026-02-25T12:00:00.000Z",
    "requestedLimit": 12,
    "actualCount": 12,
    "mode": "auto"
  }
}
```

## 3. 复用现有能力

复用当前项目已有连接模式：

- 优先读取 `~/.instagram-cli/sessions/browser-info.json` 的 `webSocketDebuggerUrl`
- 失败后回退 `http://127.0.0.1:<debugPort>` 连接
- 该模式与 `search-user.js` 一致

这样用户只需先执行 `node login.js` 登录一次即可复用会话。

## 4. 抓取策略（核心）

采用“两阶段抓取 + 合并”的策略，兼顾稳定性和信息完整度。

### 阶段 A：Profile 页面抓取（DOM）

1. 打开 `profileUrl`
2. 采集账号基础信息（用户名、名称、简介、关注数据、是否认证/私密）
3. 在主页九宫格/时间线中提取帖子链接（`/p/<shortcode>/`, `/reel/<shortcode>/`）
4. 若不足 `limit`，执行滚动加载并继续提取

结果：拿到 `postUrl + shortcode + thumbnail` 基础列表。

### 阶段 B：逐帖详情补全（Post 页面）

对 A 阶段得到的帖子链接逐个补全（建议串行或小并发 2）：

1. 打开帖子页面
2. 优先提取：
   - `script[type="application/ld+json"]`
   - `meta[property="og:*"]`
   - 页面可见 DOM（caption/likes/comments/time）
3. 如果 `mode=network` 或 `auto` 且字段缺失：
   - 监听当前页网络响应（`/graphql/query`, `/api/v1/...`）
   - 从 JSON 响应中补齐缺失字段

结果：拿到每条 Post 的完整信息并统一归一化。

## 5. 模式定义

- `dom`：仅 DOM + meta/json-ld，最稳妥，抗风控
- `network`：强依赖接口响应，字段更全但波动大
- `auto`：默认，先 DOM，缺失字段再尝试网络补全

## 6. 错误与边界处理

### URL 校验

- 非 `instagram.com/<username>/` URL 直接报错
- 自动规范化末尾 `/`

### 账号状态

- 私密账号：仅输出可见范围信息并标注 `isPrivate=true`
- 不存在账号：返回明确错误码和提示

### 登录状态

- 若跳转到登录页，提示先执行 `node login.js`

### 抓取失败容错

- 单条帖子抓取失败不终止全局流程，记录 `errors[]`
- 输出成功抓到的帖子，并在 `meta` 标记失败数量

## 7. CLI 与日志设计

### 命令示例

```bash
node fetch-user-posts.js "https://www.instagram.com/nike/" --limit 12 --output ./logs/nike-posts.json
```

### 控制台输出建议

- 打印目标账号、limit、连接方式（ws/debug-port）
- 打印抓取进度：`[3/12]`
- 结束时打印：
  - 实际抓取条数
  - 失败条数
  - 输出文件路径

## 8. 代码结构建议

新增文件：

- `fetch-user-posts.js`

内部模块函数建议：

- `parseCliArgs(argv)`
- `normalizeProfileUrl(url)`
- `connectBrowser(puppeteer, debugPort)`
- `pickInstagramPage(browser)`
- `extractProfileSummary(page)`
- `collectPostLinks(page, limit)`
- `extractPostDetail(page, postUrl, mode)`
- `mergePostData(base, detail)`
- `saveResults(result, outputFile)`

## 9. 测试计划

### 单元测试（Jest）

- URL 规范化与校验
- 参数解析（`--limit`, `--mode` 等）
- Post 链接去重与 limit 截断
- 数据归一化（空值与默认值）

建议新增：

- `tests/unit/fetch-user-posts.test.js`

### 端到端手工测试

1. 先登录：`node login.js`
2. 抓取公开账号（如 `nike`）并保存 JSON
3. 验证字段完整性、数量上限和失败容错
4. 验证私密账号场景（应返回可见数据 + 提示）

## 10. 实施阶段建议

### P1（可用版本）

- 支持 profile URL 输入
- 抓取账号概要 + 前 N 条帖子基础信息
- 输出 JSON

### P2（增强版本）

- 帖子详情补全（caption/likes/comments/time/type）
- `auto/dom/network` 模式
- 错误聚合与更细粒度日志

### P3（稳定性）

- 选择器多路回退
- 小并发抓取与重试
- 结果缓存（可选）
