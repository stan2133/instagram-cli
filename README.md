# Instagram CLI

一个面向 Instagram 的命令行工具，核心目标是：

- 先完成浏览器登录并持久化 `session`
- 在后续命令中复用 `session` 执行操作
- 支持多账户与基础会话维护

> 当前仓库以认证与会话管理能力为主，媒体能力已包含照片上传与部分占位命令。

## Features

- 浏览器登录（Puppeteer）
- 本地 Session 持久化与校验
- 多账户支持（`--account`）
- Session 运维命令（检查、修复、删除）
- 基础媒体命令（`photo:upload`）
- MCP 集成（连接已打开浏览器进行自动化）
- 二维码监听服务（自动抓取/刷新/推送登录二维码）
- 自动化抓取账号关注列表（`fetch-user-following.js`）
- 自动化提取账号最热 reels / posts 地址（`fetch-user-hot-media.js`）
- 自动化下载最热内容媒体资源并生成 metadata（`download-hot-media-assets.js`）

## Tech Stack

- Node.js (>= 18)
- TypeScript / JavaScript
- `commander`（CLI）
- `instagram-private-api`
- `puppeteer`
- `inquirer` / `ora` / `chalk`

## Project Structure

```text
.
├── dist/                       # 当前可运行的主要 CLI 产物
│   ├── index.js                # CLI 入口
│   ├── commands/
│   │   ├── auth.js             # 登录/会话命令
│   │   └── media.js            # 媒体命令
│   ├── session/                # Session manager/store/validator
│   └── services/               # auth/media/browser/session 服务
├── bin/insta.js                # 本地 CLI 可执行入口（转发到 dist）
├── src/                        # 源码目录（当前以测试内容为主）
├── login.js                    # Instagram 浏览器登录脚本
├── login_web.js                # 通用网站登录脚本（MCP 场景）
├── search-user.js              # Instagram 用户搜索与跳转脚本
├── fetch-user-posts.js         # 按账号抓取帖子信息脚本（复用登录态）
├── fetch-user-following.js     # 按账号抓取关注列表脚本（复用登录态）
├── fetch-user-hot-media.js     # 按账号计算最热 reels/posts 地址脚本
├── download-hot-media-assets.js # 从 hot-media 结果下载全部媒体并生成 metadata
├── fetch-post-hot-comments.js  # 按单帖抓取热评脚本（复用登录态）
├── qr-monitor-server.js        # 登录二维码监听服务（HTTP + SSE）
├── docs/                       # 补充文档
└── package.json
```

## Quick Start

### 1) Install

```bash
npm install
```

### 1.5) Enable Security Hooks (recommended)

```bash
npm run security:install-hooks
```

说明：
- `pre-commit`：只扫描已暂存文件，阻止疑似密钥进入提交。
- `pre-push`：扫描当前仓库已跟踪文件，阻止疑似密钥推送到远端。
- 手动全量扫描：`npm run security:scan`

### 2) Build

```bash
npm run build
```

> 当前仓库的运行入口是 `dist/`，`npm run build` 主要用于 TypeScript/JS 配置校验，不会重新生成 `dist` 产物。

### 3) Login

优先使用 CLI 登录命令（会自动走浏览器登录流程）：

```bash
node dist/index.js login
```

如果你已配置全局命令（或本地有可执行入口），也可以：

```bash
insta login
```

### 4) Check Session

```bash
node dist/index.js session:check
```

### 5) Upload Photo

```bash
node dist/index.js photo:upload ./your-photo.jpg -c "Hello from CLI"
```

## CLI Commands

以下命令来自当前实现（`dist/commands/auth.js`、`dist/commands/media.js`）：

### Auth / Session

- `login`：浏览器登录
- `logout`：登出当前账号或全部账号（`--all`）
- `whoami`：查看当前 session 用户
- `session:list`：列出所有 session
- `session:check`：检查 session 状态
- `session:remove`：删除指定 session
- `session:fix`：尝试修复可用但标记异常的 session
- `browser:status`：查看持久化浏览器状态
- `browser:close`：关闭持久化浏览器

### Media

- `photo:upload <file>`：上传照片
  - `-c, --caption <text>`
  - `-l, --location <place>`
  - `-t, --tag <user>`（可多次）
  - `--first-comment <text>`
  - `-a, --account <name>`
- `video:upload <file>`：占位命令（coming soon）

## MCP Integration

如果你要在 Cursor/Claude 等工具里通过 MCP 直接操作浏览器：

1. 启动登录会话

```bash
# 默认：使用 Puppeteer 默认浏览器路径
node login_web.js https://www.instagram.com

# 显式指定系统 Application Chrome（推荐）
node login_web.js https://www.instagram.com --chrome-path "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

# 或使用环境变量（login.js / login_web.js 都支持）
CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" node login_web.js https://www.instagram.com

# 或指定调试端口（并行多站点时推荐）
node login_web.js https://www.instagram.com --debug-port 9222
```

2. 保持浏览器与脚本运行
3. 使用仓库中的 `mcp_config.json` / `MCP_SETUP.md` 完成 MCP 配置

## IG 风控与 Chrome 路径（两个独立问题）

### 1) 下载行为被识别为机器人（风控问题）

这是行为层问题，不是浏览器路径问题。建议：

- 降低连续抓取/下载频率，避免长时间无间隔高并发请求。
- 分批执行任务，每批之间增加冷却时间，不要“整夜跑满速”。
- 保留人工操作痕迹（手动浏览、非固定节奏），避免纯脚本重复模式。
- 遇到挑战页、频率限制、异常重定向时立即暂停任务，避免继续触发风控。
- 使用测试账号验证流程，避免直接在主账号做高频自动化。

内置防护（已实现）：

- `search-user.js`
- `fetch-user-posts.js`
- `fetch-user-following.js`
- `fetch-post-hot-comments.js`
- `download-hot-media-assets.js`（帖子解析 API 阶段）

默认策略：

- 限速：每次请求最小间隔 `900ms` + 随机抖动 `0~600ms`
- 熔断阈值：连续失败 `3` 次触发冷却
- 熔断冷却：普通失败 `300s`，风险信号（如 `429/challenge/checkpoint/feedback`）`1800s`

可通过环境变量调参：

```bash
IG_RATE_LIMIT_ENABLED=true
IG_RATE_LIMIT_MIN_DELAY_MS=900
IG_RATE_LIMIT_JITTER_MS=600
IG_CIRCUIT_BREAKER_ENABLED=true
IG_CIRCUIT_BREAKER_FAILURE_THRESHOLD=3
IG_CIRCUIT_BREAKER_COOLDOWN_MS=300000
IG_CIRCUIT_BREAKER_RISK_COOLDOWN_MS=1800000
```

### 2) 使用 Application Chrome（浏览器路径问题）

这是浏览器启动来源配置，与你的下载策略独立。当前支持：

- `login_web.js`: `--chrome-path <path>` 或 `CHROME_PATH`
- `login.js`: `CHROME_PATH`
- 默认不传时：仍使用 Puppeteer 默认浏览器路径
- 优先级（`login_web.js`）：`--chrome-path` > `CHROME_PATH` > Puppeteer 默认

macOS 示例：

```bash
CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" node login.js
node login_web.js https://www.instagram.com --chrome-path "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
```

## Search User

用于在已登录的 Instagram 页面中搜索用户，并可直接跳转到指定结果。

### 1) 启动并保持 Instagram 登录会话

```bash
node login.js
```

### 2) 执行搜索

```bash
node search-user.js "coco"
```

常用参数：
- `--limit <n>`：返回结果上限（默认 `10`，最大 `50`）
- `--output <file>`：将结果保存为 JSON 文件
- `--open <index|user>`：从结果中跳转到指定用户（序号从 `1` 开始，或直接传用户名）
- `--debug-port <port>`：回退连接调试端口（默认 `9222`）
- `--keep-connected`：搜索完成后不主动断开浏览器连接

说明：`--limit` 是上限，实际返回数量受 Instagram 当前搜索接口结果限制，可能少于上限。

示例：

```bash
# 搜索并保存结果
node search-user.js "coco" --limit 10 --output ./logs/search-user-coco.json

# 跳转到第 2 个结果
node search-user.js "coco" --limit 10 --open 2

# 跳转到指定用户名
node search-user.js "coco" --open cocogauff
```

## Fetch User Posts

用于在已登录 Instagram 会话中，按账号 URL 或用户名抓取帖子信息。

先启动并完成登录（与 `search-user.js` 相同）：

```bash
node login.js
```

```bash
# URL 方式
node fetch-user-posts.js "https://www.instagram.com/nike/" --limit 12 --output ./logs/nike-posts.json

# 用户名方式
node fetch-user-posts.js "nike" --limit 24 --output ./logs/nike-posts-24.json

# 抓取 20 条帖子
node fetch-user-posts.js "https://www.instagram.com/nike/" --limit 20 --output ./logs/nike-posts-20.json
```

常用参数：
- `--limit <n>`：返回帖子上限（默认 `12`，最大 `200`）
- `--output <file>`：将结果保存为 JSON 文件
- `--debug-port <port>`：回退连接调试端口（默认 `9222`）
- `--keep-connected`：抓取完成后不主动断开浏览器连接

返回结构包含：
- `profile`：账号信息（粉丝数、关注数、简介、认证状态等）
- `posts[]`：帖子信息（shortcode、链接、caption、like/comment、发布时间、媒体 URL）
- `meta`：抓取时间与数量统计

## Fetch Post Hot Comments

用于在已登录 Instagram 会话中，按单篇帖子 URL（或 shortcode）抓取热评数据。

```bash
# 先确保已登录
node login.js

# 抓取某帖前 20 条热评
node fetch-post-hot-comments.js "https://www.instagram.com/p/DVEQd9PjhJH/" --limit 20 --output ./logs/hot-comments-DVEQd9PjhJH-20.json

# 只保留点赞 >= 50 的热评
node fetch-post-hot-comments.js "DVEQd9PjhJH" --limit 50 --min-likes 50 --output ./logs/hot-comments-min50.json
```

常用参数：
- `--limit <n>`：热评数量上限（默认 `20`，最大 `200`）
- `--min-likes <n>`：过滤最小点赞数（默认 `0`）
- `--include-replies`：包含每条评论的预览回复
- `--output <file>`：将结果保存为 JSON 文件
- `--debug-port <port>`：回退连接调试端口（默认 `9222`）

返回结构包含：
- `post`：帖子信息（shortcode、mediaPk、caption、like/comment、发布时间）
- `hotComments[]`：热评列表（rank、score、like/reply、作者信息、评论文本）
- `meta`：抓取时间、请求数量、实际数量、排序模式

## Fetch User Following

用于在已登录 Instagram 会话中，按账号 URL 或用户名抓取关注列表。

```bash
# 先确保已登录
node login.js

# 抓取 nike 前 200 个关注对象
node fetch-user-following.js "nike" --limit 200 --output ./logs/nike-following-200.json

# URL 方式
node fetch-user-following.js "https://www.instagram.com/nike/" --limit 100
```

常用参数：
- `--limit <n>`：关注列表数量上限（默认 `50`，最大 `2000`）
- `--output <file>`：将结果保存为 JSON 文件
- `--debug-port <port>`：回退连接调试端口（默认 `9222`）
- `--keep-connected`：抓取完成后不主动断开浏览器连接

返回结构包含：
- `profile`：账号基础信息（粉丝、关注、认证状态等）
- `following[]`：关注列表（用户名、主页地址、是否私密/认证、关系状态）
- `meta`：抓取时间、分页次数、是否还有更多数据

## Fetch User Hot Media

用于在已登录 Instagram 会话中，扫描某账号最近帖子并输出最热 reels / posts 地址。

```bash
# 先确保已登录
node login.js

# 默认扫描最近 60 条，输出最热 reels/post 各 5 条
node fetch-user-hot-media.js "nike"

# 扫描更多内容并保存结果
node fetch-user-hot-media.js "https://www.instagram.com/nike/" --scan-limit 120 --top-reels 10 --top-posts 10 --output ./logs/nike-hot-media.json
```

常用参数：
- `--scan-limit <n>`：扫描帖子上限（默认 `60`，最大 `200`）
- `--top-reels <n>`：输出 reels 数量（默认 `5`，最大 `50`）
- `--top-posts <n>`：输出 posts 数量（默认 `5`，最大 `50`）
- `--output <file>`：将结果保存为 JSON 文件
- `--debug-port <port>`：回退连接调试端口（默认 `9222`）
- `--keep-connected`：执行完成后不主动断开浏览器连接

返回结构包含：
- `topReels[]` / `topPosts[]`：按热度排序后的内容明细（包含分数与地址）
- `topReelUrls[]` / `topPostUrls[]`：可直接使用的地址列表
- `meta`：扫描规模、实际返回数量、热度模型说明

执行建议：
- `fetch-user-following.js` 与 `fetch-user-hot-media.js` 都会复用同一个浏览器登录会话，建议串行执行。
- 如果并行运行两个脚本，可能出现 `net::ERR_ABORTED`（页面导航被另一个连接中断）。

## Download Hot Media Assets

用于读取 `fetch-user-hot-media.js` 的输出 JSON，并下载其中 reels/posts 对应的全部媒体资源（含轮播子项），同时生成 `metadata.json` 和 `errors.json`。

```bash
# 先确保已登录
node login.js

# 从 hot-media 结果下载全部媒体
node download-hot-media-assets.js --input ./logs/test-hot-media-nike.json --output-dir ./downloads

# 调试时只处理前 1 条帖子
node download-hot-media-assets.js --input ./logs/test-hot-media-nike.json --output-dir ./downloads --max-posts 1

# 通过代理下载（HTTP/SOCKS）
node download-hot-media-assets.js --input ./logs/test-hot-media-nike.json --output-dir ./downloads --proxy http://127.0.0.1:7890
```

常用参数：
- `--input <file>`：`fetch-user-hot-media` 输出 JSON（必填）
- `--output-dir <dir>`：下载根目录（默认 `./downloads`）
- `--concurrency <n>`：下载并发（默认 `2`，范围 `1~8`）
- `--retry <n>`：单文件重试次数（默认 `3`）
- `--timeout <ms>`：下载超时毫秒（默认 `60000`）
- `--max-posts <n>`：仅处理前 n 条帖子（调试用）
- `--proxy <url>`：下载代理地址（如 `http://127.0.0.1:7890`、`socks5://127.0.0.1:1080`）
- `--overwrite`：覆盖已存在文件（默认跳过）
- `--no-cover`：视频不下载封面图
- `--debug-port <port>`：回退连接调试端口（默认 `9222`）

输出结构示例：
- `downloads/instagram/<username>/<capturedAt>/media/*`
- `downloads/instagram/<username>/<capturedAt>/metadata.json`
- `downloads/instagram/<username>/<capturedAt>/errors.json`

网络前置条件：
- 该脚本会请求 Instagram CDN（如 `scontent-*.cdninstagram.com`）。
- 如果当前网络无法访问这些 CDN 域名，脚本会出现下载超时；此时可切换网络、代理或 VPN 后重试。

## Session Storage

- Session 文件目录：`~/.instagram-cli/sessions/`
- 支持多账户，通过 `--account <name>` 区分
- 二维码当前文件：默认 `logs/qr-current.png`（端口非 3999 时自动按端口区分）

## Scripts

```bash
npm run build
npm test
npm run test:coverage
npm run lint
npm run qr:monitor
```

## QR Monitor Service

用于解决二维码容易过期的问题。服务会持续监听当前登录弹窗，自动抓取最新二维码并实时推送。

### 并行多站点规则

如果你要同时监听多个网站（例如淘宝 + 抖音），每个站点都需要独立的一组端口：

- `login_web.js --debug-port <port>`：该站点浏览器调试端口
- `qr-monitor-server.js --debug-port <port>`：必须与对应 `login_web` 端口一致
- `qr-monitor-server.js --port <port>`：二维码服务 HTTP 端口，站点之间不能重复

推荐固定映射（示例）：
- 淘宝：`debug-port=9222`，`monitor-port=4001`
- 抖音：`debug-port=9333`，`monitor-port=4002`

### 1) 先打开目标网站登录页

```bash
node login_web.js https://www.douyin.com
# 或指定调试端口
node login_web.js https://www.douyin.com --debug-port 9222
```

### 2) 启动监听服务

```bash
npm run qr:monitor
```

指定目标域名（例如淘宝）：

```bash
TARGET_DOMAIN=taobao.com npm run qr:monitor
# 或使用 CLI 参数方式
node qr-monitor-server.js --target-domain taobao.com --port 4001 --debug-port 9222
```

常用参数说明：
- `--target-domain`：优先选择该域名页面（也可用环境变量 `TARGET_DOMAIN`）
- `--debug-port`：连接浏览器调试端口（也可用环境变量 `DEBUG_PORT`）
- `--port`：监听服务端口（也可用环境变量 `QR_MONITOR_PORT`）
- `--qr-file`：自定义当前二维码文件名（默认按端口自动区分）

默认地址：
- 本机：`http://127.0.0.1:3999/qr`
- 局域网：启动日志会打印 `http://<你的IP>:3999/qr`，手机可直接访问扫码

### 3) 服务行为

- 自动尝试点击登录按钮
- 自动切换到“扫码登录”
- 自动检测二维码过期并尝试点击刷新
- 二维码更新后立即推送到页面（SSE）

站点适配说明：
- 抖音：默认支持
- 淘宝：使用 `TARGET_DOMAIN=taobao.com` 或 `--target-domain taobao.com`
- 即梦（`jimeng.jianying.com`）：已适配“开启xx”类登录按钮关键词（如“开启即梦”“立即开启”）

### 4) API

- `GET /api/status`：当前监听状态
- `GET /api/qr/current`：当前二维码（包含 `qrDataUrl`）
- `GET /api/qr/image`：当前二维码 PNG 文件
- `GET /api/qr/stream`：SSE 实时事件流
- `GET /qr`：内置二维码查看页面

### 5) 淘宝登录示例

```bash
node login_web.js https://www.taobao.com --debug-port 9222
TARGET_DOMAIN=taobao.com DEBUG_PORT=9222 QR_MONITOR_PORT=4001 npm run qr:monitor
```

### 6) 抖音登录示例

```bash
node login_web.js https://www.douyin.com --debug-port 9333
TARGET_DOMAIN=douyin.com DEBUG_PORT=9333 QR_MONITOR_PORT=4002 npm run qr:monitor
```

### 7) 同时登录淘宝和抖音（并行）

终端 A（淘宝）：

```bash
node login_web.js https://www.taobao.com --debug-port 9222
TARGET_DOMAIN=taobao.com DEBUG_PORT=9222 QR_MONITOR_PORT=4001 npm run qr:monitor
```

终端 B（抖音）：

```bash
node login_web.js https://www.douyin.com --debug-port 9333
TARGET_DOMAIN=douyin.com DEBUG_PORT=9333 QR_MONITOR_PORT=4002 npm run qr:monitor
```

访问地址：
- 淘宝二维码页：`http://127.0.0.1:4001/qr`
- 抖音二维码页：`http://127.0.0.1:4002/qr`

### 8) 即梦登录示例

```bash
node login_web.js https://jimeng.jianying.com/ --debug-port 9444
TARGET_DOMAIN=jianying.com DEBUG_PORT=9444 QR_MONITOR_PORT=4003 npm run qr:monitor
```

提示：即梦首页如果没直接弹出二维码，可先点击“开启xx”入口，监听服务会继续追踪并抓取二维码。

## Troubleshooting

### 登录后仍提示未登录

- 先执行：`node dist/index.js session:check`
- 若状态异常，执行：`node dist/index.js session:fix`
- 仍失败则重新登录：`node dist/index.js login`

### 上传命令失败

- 确认 `session:check` 为有效
- 确认文件路径存在且可读
- 先用小尺寸 JPG 图片验证流程

### 找不到 `insta` 命令

当前仓库可直接使用：

```bash
node dist/index.js <command>
```

或通过本地可执行入口：

```bash
node bin/insta.js <command>
```

## Security & Compliance

- 本项目仅用于学习与研究
- 使用非官方 API 存在风控与条款风险
- 建议使用测试账号，不建议用于主账号高频自动化

## License

MIT
