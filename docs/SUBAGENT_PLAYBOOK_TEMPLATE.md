# Subagent Playbook Template (instagram-cli)

用途：把一个需求拆成多个 subagent 并行执行，最后由主代理统一收敛，适合当前 `ig-daemon + MCP` 项目。

## 1. 一键调用

```bash
npm run subagent:template
```

常用：

```bash
# 只看模板路径
npm run subagent:template:path

# 复制到剪贴板（macOS）
npm run subagent:template:copy
```

## 2. 主代理提示词（直接复制）

```text
你是主代理。目标：<在这里写本次目标>。

请将任务拆给 3 个 subagent，并严格限制目录边界：

1) A-API（只允许改 daemon/*）
职责：
- 调整 daemon 接口、登录状态、job 提交/执行行为
- 保持向后兼容，避免改动 MCP 层细节

2) B-MCP（只允许改 src/mcp/* 和 mcp server 入口）
职责：
- 调整 MCP tool schema/返回结构/错误映射
- 补充自动登录触发逻辑与同步等待逻辑

3) C-QA-Docs（只允许改 tests/* docs/*）
职责：
- 增加或更新最小测试
- 更新 runbook/manual，给出可执行命令

全局约束：
- 不允许跨目录修改；发现跨边界需求时上报主代理统一处理
- 不允许 destructive git 命令
- 每个 subagent 输出固定 4 项：
  1) 改动文件
  2) 行为变化
  3) 验证命令
  4) 风险点
- 每个行为变化必须附一个最小调用示例（curl 或 MCP JSON）

主代理收敛要求：
- 统一解决冲突，统一运行验证，统一给出最终提交说明
- 最终输出：变更摘要、验证结果、剩余风险、下一步建议
```

## 3. subagent 输出模板

```text
[Subagent 名称]
1) 改动文件
- <绝对或仓库相对路径>

2) 行为变化
- 变化A：<一句话>
- 最小调用示例：<curl 或 MCP JSON>

3) 验证命令
- <命令1>
- <命令2>

4) 风险点
- <风险与影响范围>
```

## 4. 当前项目推荐拆分

- A-API：`daemon/login-manager.js`, `daemon/job-manager.js`, `daemon/server.js`
- B-MCP：`src/mcp/ig-daemon-mcp.js`, `ig-daemon-mcp-server.js`
- C-QA-Docs：`tests/unit/*`, `docs/IG_DAEMON_AI_RUNBOOK.md`, `docs/IG_DAEMON_MCP_OPERATION_MANUAL.md`

## 5. 验收基线（建议每次都跑）

```bash
node --check src/mcp/ig-daemon-mcp.js
node --check daemon/login-manager.js
npm test -- tests/unit/login-manager.test.js
```

流程验收（手工）：

1. 未登录状态调用 `ig_job_submit`
2. 返回 `requiresManualLogin=true` 并触发登录流程
3. 人工登录后调用 `ig_login_confirm`
4. 重试 job 成功

## 6. 你的快捷流程

1. 运行 `npm run subagent:template`
2. 复制“主代理提示词”
3. 把 `<在这里写本次目标>` 替换成当前需求
4. 让主代理并行分发到 3 个 subagent
5. 主代理完成统一验证后再提交
