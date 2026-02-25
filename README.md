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
├── qr-monitor-server.js        # 登录二维码监听服务（HTTP + SSE）
├── graphql-monitor.js          # GraphQL 请求监听脚本
├── docs/                       # 补充文档
└── package.json
```

## Quick Start

### 1) Install

```bash
npm install
```

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
node login_web.js https://www.instagram.com
```

2. 保持浏览器与脚本运行
3. 使用仓库中的 `mcp_config.json` / `MCP_SETUP.md` 完成 MCP 配置

## Session Storage

- Session 文件目录：`~/.instagram-cli/sessions/`
- 支持多账户，通过 `--account <name>` 区分
- 二维码固定输出：`logs/qr-current.png`

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

### 1) 先打开目标网站登录页

```bash
node login_web.js https://www.douyin.com
```

### 2) 启动监听服务

```bash
npm run qr:monitor
```

指定目标域名（例如淘宝）：

```bash
TARGET_DOMAIN=taobao.com npm run qr:monitor
```

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
- 淘宝：使用 `TARGET_DOMAIN=taobao.com`
- 即梦（`jimeng.jianying.com`）：已适配“开启xx”类登录按钮关键词（如“开启即梦”“立即开启”）

### 4) API

- `GET /api/status`：当前监听状态
- `GET /api/qr/current`：当前二维码（包含 `qrDataUrl`）
- `GET /api/qr/image`：当前二维码 PNG 文件
- `GET /api/qr/stream`：SSE 实时事件流
- `GET /qr`：内置二维码查看页面

### 5) 淘宝登录示例

```bash
node login_web.js https://www.taobao.com
TARGET_DOMAIN=taobao.com npm run qr:monitor
```

### 6) 即梦登录示例

```bash
node login_web.js https://jimeng.jianying.com/
TARGET_DOMAIN=jianying.com npm run qr:monitor
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
