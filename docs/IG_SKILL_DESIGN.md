# Instagram 操作 Skill 设计文档

## 1. 目标

为当前仓库的 Instagram 自动化脚本设计一个 Anthropic/Codex 风格 Skill，用于让 Agent 在接到 IG 相关任务时，自动选择合适脚本并按统一流程执行。

目标结果：

- 降低“该用哪个脚本”的判断成本
- 统一输入参数、输出目录和错误处理
- 支持从“抓取 -> 计算 -> 下载”的一条龙任务

## 2. Skill 定位

建议 skill 名称：`instagram-ops`

建议 frontmatter：

```yaml
---
name: instagram-ops
description: Execute Instagram browser-session automation workflows in this repository, including login reuse, user search, profile post fetching, following list fetching, hot media ranking, hot comments extraction, and media asset downloading with metadata. Use when users ask to operate IG accounts/posts/reels via local scripts, produce structured JSON outputs, or troubleshoot IG script execution errors.
---
```

说明：

- `description` 中明确“做什么 + 何时触发”
- 触发关键词覆盖：搜索用户、抓帖子、抓关注、抓热评、下载图片视频、代理下载、失败排障

## 3. 能力映射（脚本到任务）

当前 IG 操作脚本与职责：

- `login.js`：启动登录会话并持久化浏览器连接信息
- `search-user.js`：搜索 IG 用户并可跳转目标主页
- `fetch-user-posts.js`：抓取指定账号帖子列表
- `fetch-user-following.js`：抓取指定账号关注列表
- `fetch-user-hot-media.js`：计算最热 reels/posts 地址
- `fetch-post-hot-comments.js`：抓取单帖热评
- `download-hot-media-assets.js`：按 hot-media JSON 下载全部媒体并生成 metadata/errors

## 4. Skill 目录设计

建议目录：

```text
skills/instagram-ops/
├── SKILL.md
├── agents/
│   └── openai.yaml
├── references/
│   ├── workflows.md
│   ├── commands.md
│   ├── outputs.md
│   └── troubleshooting.md
└── scripts/
    └── run_ig_pipeline.sh
```

设计原则：

- `SKILL.md` 只放核心流程和“何时读取哪个 references”
- 参数细节、输出结构、排障放到 `references/`
- 常用串联流程放到 `scripts/run_ig_pipeline.sh`，降低重复命令拼接

## 5. SKILL.md 内容设计

SKILL.md 建议结构：

1. 快速路由规则
- 先判断用户目标属于：搜索/抓列表/抓评论/下载媒体/端到端流水线
- 对应选择单脚本或 pipeline

2. 执行前检查
- 检查登录会话是否存在（`browser-info.json`）
- 若无会话，先执行 `node login.js`

3. 标准执行流程
- 单任务执行：一个请求对应一个脚本
- 组合任务执行：按“热度计算 -> 媒体下载”串行执行
- 串行原则：避免同时运行多个会话脚本导致 `net::ERR_ABORTED`

4. 输出约定
- 优先写入 `./logs` 或 `./downloads`
- 总是回传输出文件路径与关键统计字段

5. 失败处理
- 首先归类：登录态问题、参数问题、网络/CDN问题、代理问题
- 按 `references/troubleshooting.md` 给出下一步命令

## 6. References 设计

### 6.1 `references/workflows.md`

内容：

- 常见任务模板
- 输入到脚本映射
- 多步骤任务编排

建议模板：

- 获取用户关注列表
- 获取最热 reels/posts 地址
- 下载最热媒体（可带代理）
- 抓热评并过滤

### 6.2 `references/commands.md`

内容：

- 每个脚本的标准命令模板
- 参数含义、默认值、边界值
- 推荐参数组合（快速/完整/调试）

### 6.3 `references/outputs.md`

内容：

- 各脚本输出 JSON 结构摘要
- 跨脚本字段对齐约定
- 路径规范（logs/downloads 目录）

关键约定：

- 热度结果文件作为下载脚本输入
- 下载结果必须包含 `metadata.json` 与 `errors.json`

### 6.4 `references/troubleshooting.md`

内容：

- `net::ERR_ABORTED`：并行冲突，改串行
- `accounts/login`：会话失效，重新登录
- `scontent-*.cdninstagram.com timeout`：网络或代理问题
- 代理配置示例：`--proxy http://127.0.0.1:7897`

## 7. Pipeline 脚本设计

建议新增：`scripts/run_ig_pipeline.sh`

职责：

- 输入用户名
- 先执行 `fetch-user-hot-media.js`
- 再执行 `download-hot-media-assets.js`
- 可透传 `--proxy`
- 输出最终产物目录

示例流程：

```bash
node fetch-user-hot-media.js "nike" --scan-limit 60 --top-reels 5 --top-posts 5 --output ./logs/nike-hot-media.json
node download-hot-media-assets.js --input ./logs/nike-hot-media.json --output-dir ./downloads --proxy http://127.0.0.1:7897
```

## 8. 执行策略与约束

- 会话型脚本默认串行执行
- 优先复用已登录浏览器，不重复开新会话
- 对下载任务默认启用重试（`--retry`）
- 大批量下载建议低并发（`--concurrency 1~2`）

## 9. 验收标准

Skill 可视为完成，当满足：

1. 用户说“抓某账号关注列表”时，Agent 自动调用 `fetch-user-following.js`
2. 用户说“抓最热 reels/post 并下载全部媒体”时，Agent 自动执行两步串行流程
3. 失败时能给出明确分层错误与修复命令
4. 输出路径、文件名、metadata 结构稳定

## 10. 实施计划

Phase 1（基础）：

- 创建 `skills/instagram-ops/SKILL.md`
- 写 `references/commands.md` 与 `references/workflows.md`

Phase 2（增强）：

- 增加 `references/outputs.md` 与 `references/troubleshooting.md`
- 增加 `scripts/run_ig_pipeline.sh`

Phase 3（验证）：

- 跑 3 组真实任务（单脚本、组合流程、代理下载）
- 根据失败案例迭代 Skill 文案与流程

