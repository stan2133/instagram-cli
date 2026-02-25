# QR Monitor MCP 化实施计划

## 1. 实施目标

按可回滚、可验证的方式，将 QR 监控能力迁移到 MCP 架构，并新增二维码图片资源读取能力。

## 2. 里程碑与阶段

## 阶段 A：重构准备（P0）

任务：

1. 将 `qr-monitor-server.js` 中与 HTTP 无关的逻辑抽出为 `QRMonitorCore`。
2. 统一会话对象结构（`sessionId`、`targetDomain`、`debugPort`、`status`、`qrHash` 等）。
3. 抽象事件通知接口（状态变更、二维码变更）。

产出：

1. `src/qr/monitor-core.js`
2. 核心层单元测试或脚本级回归验证记录

验收：

1. 在不启用 MCP 的情况下，HTTP 版本行为与当前一致。

## 阶段 B：MCP Adapter（P0）

任务：

1. 实现 MCP Server 入口（stdio）。
2. 实现 Tools：
   - `qr_monitor_start`
   - `qr_monitor_stop`
   - `qr_monitor_status`
   - `qr_monitor_get_current`
   - `qr_monitor_refresh`
   - `qr_monitor_list`
3. 统一错误模型与参数校验。

产出：

1. `src/mcp/qr-monitor-mcp.js`
2. `bin/qr-monitor-mcp.js`
3. `mcp_config.json` 增加 `qrMonitor` 配置示例

验收：

1. MCP Client 可启动会话并查询状态。
2. 多会话并行不冲突。

## 阶段 C：二维码图片 Resource（P0，重点）

任务：

1. 实现 Resources：
   - `qr://sessions`
   - `qr://sessions/{sessionId}/status`
   - `qr://sessions/{sessionId}/image/latest`
   - `qr://sessions/{sessionId}/image/current`
   - `qr://sessions/{sessionId}/image/history/{hash}`
2. 为 `image/latest` 输出 `image/png`。
3. 为 `image/current` 输出 JSON（含 `dataUrl`）。
4. 增加资源缓存与错误码。

产出：

1. MCP resource registry
2. `read_resource` 实现

验收：

1. 能通过 Resource 直接拿到淘宝和抖音的二维码图片。
2. 二维码更新时 `hash` 变化正确反映在资源数据中。

## 阶段 D：兼容与文档（P1）

任务：

1. HTTP 适配层改为调用 `QRMonitorCore`。
2. 更新 README、MCP 指南与故障排查。
3. 输出并行会话操作手册（淘宝 + 抖音示例）。

产出：

1. `src/qr/http-adapter.js`（可选独立）
2. 文档更新 PR

验收：

1. HTTP API 与 MCP API 输出一致。
2. 原有扫码页面仍可用。

## 3. 实施顺序（建议）

1. 先落地 Core，再做 MCP Tool。
2. Tool 稳定后再做 Resource 图片输出。
3. 最后做 HTTP 兼容收口和文档补齐。

## 4. 测试计划

## 4.1 功能测试

1. 单会话：淘宝登录页抓码、状态更新、过期刷新。
2. 双会话并行：淘宝 + 抖音同时运行，互不覆盖。
3. Resource 测试：
   - 读取 `image/latest` 返回 PNG
   - 读取 `image/current` 返回 JSON + dataUrl
   - 读取不存在会话返回 `SESSION_NOT_FOUND`

## 4.2 回归测试

1. `/api/status` 与 `/api/qr/current` 与迁移前字段兼容。
2. `logs/` 图片归档行为不回退。

## 4.3 稳定性测试

1. 连续运行 30 分钟轮询。
2. 浏览器断开重连后恢复。
3. 强制刷新冷却机制有效。

## 5. 发布与回滚

发布策略：

1. 先灰度启用 MCP Server（保留 HTTP）。
2. 通过环境变量切换新旧适配层。

回滚策略：

1. MCP 异常时回退到纯 HTTP 模式。
2. 保留旧入口脚本，避免登录链路中断。

## 6. 风险与应对

风险：

1. 多会话竞争同一 debug port。
2. 资源图片输出体积大导致响应慢。
3. 站点 DOM 波动导致识别失败。

应对：

1. `start` 时做端口冲突提示与会话映射校验。
2. 优先输出 PNG 资源，JSON dataUrl 仅必要时使用。
3. 关键词与选择器策略可配置化，按站点增量维护。

## 7. 交付清单

1. 代码：
   - `src/qr/monitor-core.js`
   - `src/mcp/qr-monitor-mcp.js`
   - `bin/qr-monitor-mcp.js`
2. 配置：
   - `mcp_config.json` 新增 `qrMonitor` 示例
3. 文档：
   - `docs/QR_MONITOR_MCP_SOLUTION.md`
   - `docs/QR_MONITOR_MCP_IMPLEMENTATION_PLAN.md`

## 8. 完成标准（Definition of Done）

1. MCP Tool 与 Resource 全部可用。
2. `image/latest` 可稳定输出二维码 PNG。
3. 淘宝 + 抖音双会话并行测试通过。
4. README 与 MCP 文档包含可直接执行示例。
