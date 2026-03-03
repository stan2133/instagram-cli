# IG Daemon AI Runbook

本文件面向 AI Agent（MCP/自动化代理）使用，目标是稳定调用本地 `ig-daemon` 完成：

- 人工登录管理（浏览器里由人完成）
- 作业提交与轮询
- 失败可恢复处理

## 1. Service Contract

- 服务名：`ig-daemon`
- 默认地址：`http://127.0.0.1:4060`
- 启动命令：`npm run daemon:start`
- 重要前提：所有业务 job 只有在登录状态 `authenticated` 时才能提交

MCP 适配器：

- 启动命令：`npm run mcp:daemon`
- 配置项：`igDaemon`（见 `mcp_config.json` / `.mcp.json`）
- 支持工具：
  - `ig_health`
  - `ig_login_start`
  - `ig_login_status`
  - `ig_login_confirm`
  - `ig_login_stop`
  - `ig_job_submit`
  - `ig_job_list`
  - `ig_job_status`
  - `ig_job_cancel`

## 2. Login Is Human-in-the-Loop

AI 不负责输入账号密码。登录流程必须包含人工步骤：

1. AI 调用 `POST /v1/login/start`
2. 人在浏览器完成登录
3. AI 调用 `POST /v1/login/confirm`（相当于给登录脚本回车）
4. AI 轮询 `GET /v1/login/status` 直到 `phase=authenticated`

## 3. Endpoints

### 3.1 Health

- `GET /v1/health`
- 用于检查 daemon 是否可用

### 3.2 Login

- `POST /v1/login/start`
- `GET /v1/login/status?tail=80`
- `POST /v1/login/confirm`
- `POST /v1/login/stop`

`POST /v1/login/start` body:

```json
{
  "targetUrl": "https://www.instagram.com",
  "debugPort": 9222,
  "chromePath": "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "hideOnAuthenticated": true
}
```

字段说明：

- `targetUrl` 可省略，默认 Instagram
- `debugPort` 可省略，默认 `9222`
- `chromePath` 可省略，默认 Puppeteer 路径
- `hideOnAuthenticated` 默认 `true`（登录成功后最小化/隐藏窗口）

### 3.3 Jobs

- `POST /v1/jobs`
- `GET /v1/jobs`
- `GET /v1/jobs/:jobId`
- `POST /v1/jobs/:jobId/cancel`

`POST /v1/jobs` body:

```json
{
  "type": "fetch_user_posts",
  "params": {
    "target": "nike",
    "limit": 24,
    "output": "./logs/nike-posts-daemon.json"
  }
}
```

## 4. Login Status State Machine

`GET /v1/login/status` 返回 `status.phase`，常见状态：

- `idle`: 未启动
- `starting`: 登录脚本启动中
- `waiting_manual_login`: 等待人工登录，通常 `canConfirm=true`
- `confirming`: 已发送确认回车，等待脚本检测结果
- `authenticated`: 已认证，可提交 jobs
- `stopping`: 停止中
- `stopped`: 已停止
- `error`: 登录失败

AI 决策规则：

1. `authenticated` -> 允许提交 job
2. `waiting_manual_login` 且 `canConfirm=true` -> 提示人工完成登录，然后调用 `/v1/login/confirm`
3. `error` -> 读取 `status.lastError` + `logs`，告知人工并重新 `/v1/login/start`

## 5. Job Types and Params

当前支持：

1. `search_users`
2. `fetch_user_posts`
3. `fetch_user_following`
4. `fetch_post_hot_comments`
5. `fetch_user_hot_media`
6. `download_hot_media_assets`
7. `go_home`

参数映射到现有脚本，示例：

- `fetch_user_posts`: `target`, `limit`, `output`, `debugPort`, `keepConnected`
- `fetch_user_following`: `target`, `limit`, `output`, `debugPort`, `keepConnected`
- `fetch_post_hot_comments`: `target`, `limit`, `minLikes`, `includeReplies`, `output`, `debugPort`, `keepConnected`
- `search_users`: `query`, `limit`, `output`, `open`, `debugPort`, `keepConnected`
- `download_hot_media_assets`: `input`, `outputDir`, `concurrency`, `retry`, `timeout`, `maxPosts`, `proxy`, `overwrite`, `includeCover`, `debugPort`, `keepConnected`
- `go_home`: `targetUrl`, `output`, `debugPort`, `keepConnected`

## 6. Job Lifecycle

`job.status`:

- `queued`
- `running`
- `succeeded`
- `failed`
- `cancelled`

轮询建议：

1. `POST /v1/jobs` 获取 `job.id`
2. 每 1~2 秒 `GET /v1/jobs/:jobId`
3. 终态（`succeeded|failed|cancelled`）后停止轮询
4. 读取 `job.logs` 与 `job.error`

## 7. Agent Execution Template

```text
Step 1: GET /v1/health
Step 2: GET /v1/login/status
Step 3: if phase != authenticated:
  3.1 POST /v1/login/start (if not running)
  3.2 wait human login
  3.3 POST /v1/login/confirm
  3.4 poll /v1/login/status until authenticated
Step 4: POST /v1/jobs
Step 5: poll /v1/jobs/:jobId until terminal state
Step 6: return structured result (status, logs tail, output path if provided)
```

## 8. Error Handling Rules

1. `POST /v1/jobs` 返回未认证错误：
- 错误文案：`当前未认证登录，请先完成 /v1/login/start + /v1/login/confirm`
- 处理：回到登录流程

2. 登录阶段 `phase=error`：
- 处理：读取 `status.lastError`，提示人工修复（账号验证、路径错误、网络问题），再重启登录

3. job `failed`：
- 处理：返回 `job.error` + `job.logs` 末尾
- 若包含风控信号（429/challenge/checkpoint/feedback），建议延迟后重试

## 9. Operational Notes

- daemon 当前无鉴权，默认仅绑定 `127.0.0.1`，不要暴露公网。
- daemon 重启后，内存中的 job 列表会丢失（登录脚本状态也会重置）。
- `hideOnAuthenticated=true` 仅隐藏窗口，不会关闭浏览器进程。
