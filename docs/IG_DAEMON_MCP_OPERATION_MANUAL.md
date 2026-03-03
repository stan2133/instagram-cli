# IG Daemon MCP 操作手册

适用目录：`/Users/lyg/software/instagram-cli`

本手册用于快速完成三件事：

1. 启动 `ig-daemon` 服务
2. 启动/接入 `igDaemon` MCP 服务
3. 通过 MCP 或 HTTP 提交 Instagram 抓取任务

## 1. 前置条件

- Node.js `>=18`
- 已在仓库目录下
- 已安装依赖

```bash
cd /Users/lyg/software/instagram-cli
npm install
```

## 2. 启动 ig-daemon 服务

```bash
npm run daemon:start
```

默认监听地址：

- `http://127.0.0.1:4060`

可选环境变量：

- `IG_DAEMON_HOST`（默认 `127.0.0.1`）
- `IG_DAEMON_PORT`（默认 `4060`）

### 2.1 健康检查

```bash
curl -sS http://127.0.0.1:4060/v1/health | jq
```

成功时 `ok=true`，且会返回 `login.phase`、`queue.jobs` 等状态。

## 3. 配置 MCP（当前目录）

仓库内已配置好：

- `.mcp.json`
- `mcp_config.json`

其中 `igDaemon` 已固定为：

- `command`: `node`
- `args`: `["/Users/lyg/software/instagram-cli/ig-daemon-mcp-server.js"]`
- `env.IG_DAEMON_URL`: `http://127.0.0.1:4060`

如果你要手动粘贴配置，使用：

```json
{
  "mcpServers": {
    "igDaemon": {
      "command": "node",
      "args": ["/Users/lyg/software/instagram-cli/ig-daemon-mcp-server.js"],
      "env": {
        "IG_DAEMON_URL": "http://127.0.0.1:4060"
      }
    }
  }
}
```

## 4. 启动 MCP 服务

两种方式：

1. 手动启动（调试）：

```bash
npm run mcp:daemon
```

2. 由 MCP 客户端按配置自动拉起（常用）：
- 重启你的 MCP 客户端，让它读取 `.mcp.json` 或客户端配置文件。

## 5. 登录流程（Human in the loop）

`ig-daemon` 不会自动输入账号密码，必须人工在浏览器登录。

### 5.1 启动登录会话

```bash
curl -sS -X POST http://127.0.0.1:4060/v1/login/start \
  -H 'content-type: application/json' \
  -d '{
    "targetUrl":"https://www.instagram.com",
    "debugPort":9222,
    "hideOnAuthenticated":true
  }' | jq
```

参数说明：

- `targetUrl`：默认 `https://www.instagram.com`
- `debugPort`：默认 `9222`
- `hideOnAuthenticated`：默认 `true`，登录成功后尝试最小化/隐藏窗口

### 5.2 人工完成浏览器登录

在浏览器中完成账号登录。

### 5.3 发送确认

```bash
curl -sS -X POST http://127.0.0.1:4060/v1/login/confirm | jq
```

### 5.4 查看登录状态

```bash
curl -sS "http://127.0.0.1:4060/v1/login/status?tail=80" | jq
```

当 `status.phase=authenticated` 时可以提交任务。

## 6. 可用 MCP 工具（igDaemon）

- `ig_health`
- `ig_login_start`
- `ig_login_status`
- `ig_login_confirm`
- `ig_login_stop`
- `ig_job_submit`
- `ig_job_list`
- `ig_job_status`
- `ig_job_cancel`

## 7. 任务调用（HTTP 示例）

统一入口：`POST /v1/jobs`

### 7.1 fetch_user_posts（抓取账号帖子）

```bash
curl -sS -X POST http://127.0.0.1:4060/v1/jobs \
  -H 'content-type: application/json' \
  -d '{
    "type":"fetch_user_posts",
    "params":{
      "target":"ohttomom",
      "limit":10,
      "output":"./logs/ohttomom-posts.json"
    }
  }' | jq
```

### 7.2 fetch_user_following（抓取关注列表）

```bash
curl -sS -X POST http://127.0.0.1:4060/v1/jobs \
  -H 'content-type: application/json' \
  -d '{
    "type":"fetch_user_following",
    "params":{
      "target":"nike",
      "limit":100,
      "output":"./logs/nike-following.json"
    }
  }' | jq
```

### 7.3 fetch_post_hot_comments（抓取单帖热评）

```bash
curl -sS -X POST http://127.0.0.1:4060/v1/jobs \
  -H 'content-type: application/json' \
  -d '{
    "type":"fetch_post_hot_comments",
    "params":{
      "target":"https://www.instagram.com/p/POST_ID/",
      "limit":50,
      "minLikes":10,
      "includeReplies":true,
      "output":"./logs/post-comments.json"
    }
  }' | jq
```

### 7.4 fetch_user_hot_media（抓取账号最热媒体）

```bash
curl -sS -X POST http://127.0.0.1:4060/v1/jobs \
  -H 'content-type: application/json' \
  -d '{
    "type":"fetch_user_hot_media",
    "params":{
      "target":"nike",
      "scanLimit":60,
      "topReels":10,
      "topPosts":10,
      "output":"./logs/nike-hot-media.json"
    }
  }' | jq
```

### 7.5 go_home（回到 Instagram 首页）

```bash
curl -sS -X POST http://127.0.0.1:4060/v1/jobs \
  -H 'content-type: application/json' \
  -d '{
    "type":"go_home",
    "params":{
      "targetUrl":"https://www.instagram.com/",
      "output":"./logs/go-home.json"
    }
  }' | jq
```

### 7.6 轮询任务状态

```bash
curl -sS http://127.0.0.1:4060/v1/jobs | jq
curl -sS http://127.0.0.1:4060/v1/jobs/<jobId> | jq
```

终态：

- `succeeded`
- `failed`
- `cancelled`

## 8. MCP 调用格式（通用）

使用 `ig_job_submit`：

```json
{
  "type": "fetch_user_posts",
  "params": {
    "target": "ohttomom",
    "limit": 10,
    "output": "./logs/ohttomom-posts.json"
  }
}
```

## 9. 常见问题

1. 健康检查失败 `Failed to connect 127.0.0.1:4060`
- 原因：daemon 未启动
- 处理：`npm run daemon:start`

2. 提交 job 报未认证
- 错误：`当前未认证登录，请先完成 /v1/login/start + /v1/login/confirm`
- 处理：按第 5 章重新登录

3. 用户 404 或抓取失败
- 常见原因：用户名拼写错误、账号不存在、账号不可访问
- 处理：先用 `search_users` 确认准确用户名，再抓帖子

4. daemon 重启后任务记录丢失
- 当前是内存队列，重启会清空 job 历史

## 10. 推荐操作顺序（最短路径）

1. `npm run daemon:start`
2. `curl /v1/health`
3. `POST /v1/login/start`
4. 浏览器人工登录
5. `POST /v1/login/confirm`
6. `GET /v1/login/status` 确认 `authenticated`
7. `POST /v1/jobs` 提交任务
8. `GET /v1/jobs/<jobId>` 轮询结果
