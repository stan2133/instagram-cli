# QR Monitor MCP 化技术方案

## 1. 目标

将现有 `qr-monitor-server.js` 的能力升级为 MCP 服务，支持以下场景：

1. 在 Claude/Cursor 中直接调用 Tool 获取状态、触发刷新、管理会话。
2. 通过 MCP Resource 直接读取二维码图片（PNG）与当前二维码元数据。
3. 同时运行多个站点会话（如淘宝 + 抖音），互不干扰。

## 2. 设计范围

本方案覆盖：

1. `qr-monitor` 业务能力抽象与复用。
2. MCP Tool 与 Resource 协议设计。
3. 多会话并行模型与文件隔离策略。
4. 与现有 HTTP API 的兼容策略。

本方案不覆盖：

1. UI 页面改版。
2. 新站点识别规则扩展（沿用现有关键词机制）。

## 3. 总体架构

采用三层结构，避免 MCP 与 HTTP 逻辑重复：

1. `QRMonitorCore`（业务层）
   - 负责浏览器连接、二维码识别、过期刷新、状态机、会话管理。
2. `HTTP Adapter`（兼容层）
   - 继续提供 `/api/status`、`/api/qr/current`、`/api/qr/image`、`/api/qr/stream`。
3. `MCP Adapter`（新增）
   - 暴露 Tool 与 Resource 给 MCP Client。

建议落地文件：

1. `src/qr/monitor-core.js`
2. `src/qr/http-adapter.js`
3. `src/mcp/qr-monitor-mcp.js`
4. `bin/qr-monitor-mcp.js`

## 4. 会话模型

每个监控会话独立维护：

1. `sessionId`
2. `targetDomain`
3. `debugPort`
4. `pollMs / maxAgeMs / refreshCooldownMs`
5. `qrFile`
6. `status`、`qrHash`、`qrDataUrl`、`qrCapturedAt`、`refreshCount`

并行原则：

1. 不共享 `qr-current` 文件路径。
2. 通过 `sessionId` 访问会话，不用全局状态。
3. 允许多会话并行轮询，互不覆盖。

## 5. MCP Tool 设计

### 5.1 `qr_monitor_start`

输入参数：

1. `targetDomain` (string, required)
2. `debugPort` (number, required)
3. `pollMs` (number, optional)
4. `maxAgeMs` (number, optional)
5. `refreshCooldownMs` (number, optional)
6. `qrFile` (string, optional)

返回：

1. `sessionId`
2. `status`
3. `targetDomain`
4. `debugPort`

### 5.2 `qr_monitor_stop`

输入参数：

1. `sessionId` (string, required)

返回：

1. `stopped` (boolean)

### 5.3 `qr_monitor_status`

输入参数：

1. `sessionId` (string, required)

返回：

1. `status`
2. `message`
3. `connected`
4. `pageUrl`
5. `qrAgeSec`
6. `refreshCount`

### 5.4 `qr_monitor_get_current`

输入参数：

1. `sessionId` (string, required)

返回：

1. `qrAvailable`
2. `qrDataUrl`
3. `qrFile`
4. `capturedAt`
5. `hash`

### 5.5 `qr_monitor_refresh`

输入参数：

1. `sessionId` (string, required)
2. `force` (boolean, optional)

返回：

1. `refreshed` (boolean)
2. `reason` (string)

### 5.6 `qr_monitor_list`

输入参数：无

返回：

1. `sessions[]`（会话摘要）

## 6. MCP Resource 设计（二维码图片）

本节为新增重点：直接通过 Resource 拉取二维码图片。

### 6.1 资源清单

1. `qr://sessions`
   - 会话列表资源（JSON）
2. `qr://sessions/{sessionId}/status`
   - 单会话状态资源（JSON）
3. `qr://sessions/{sessionId}/image/latest`
   - 最新二维码图片资源（`image/png`）
4. `qr://sessions/{sessionId}/image/current`
   - 当前二维码文本资源（JSON，含 `dataUrl`）
5. `qr://sessions/{sessionId}/image/history/{hash}`
   - 历史二维码图片资源（`image/png`）

### 6.2 `image/latest` 返回规范

URI：

1. `qr://sessions/{sessionId}/image/latest`

响应：

1. `mimeType: image/png`
2. `data: <PNG binary>`（或 SDK 要求的 base64 字节串）
3. 元数据：
   - `hash`
   - `capturedAt`
   - `ageSec`
   - `targetDomain`

### 6.3 `image/current` 返回规范

URI：

1. `qr://sessions/{sessionId}/image/current`

响应示例：

```json
{
  "sessionId": "tb-001",
  "targetDomain": "taobao.com",
  "qrAvailable": true,
  "hash": "sha256:xxxx",
  "capturedAt": "2026-02-25T13:20:11.000Z",
  "ageSec": 4,
  "dataUrl": "data:image/png;base64,...",
  "file": "/abs/path/logs/qr-current-taobao.com-4001.png"
}
```

### 6.4 资源错误码建议

1. `SESSION_NOT_FOUND`
2. `QR_NOT_READY`
3. `QR_FILE_MISSING`
4. `INVALID_RESOURCE_URI`

## 7. 更新策略

1. 当 `qrHash` 变化时，更新 `latest/current` 资源内容。
2. `history/{hash}` 仅对已归档图片可读。
3. 建议资源缓存 TTL 为 3-5 秒，降低频繁轮询开销。

## 8. 兼容策略

1. HTTP API 保持可用，兼容已有手机扫码页面流程。
2. MCP 与 HTTP 共用同一 `QRMonitorCore`，避免行为分叉。
3. 现有环境变量继续支持，同时增加 MCP 参数层覆盖能力。

## 9. 安全与约束

1. 不在日志输出完整 `dataUrl`，仅输出 hash 与文件路径。
2. 图片资源默认仅本地 MCP 可读，不对公网暴露。
3. 限制历史文件数量（如最近 N 张），防止磁盘增长失控。

## 10. 验收标准

1. 可同时创建淘宝和抖音会话并稳定运行 10 分钟以上。
2. 通过 `qr://sessions/{sessionId}/image/latest` 可读到 PNG。
3. `qr_monitor_refresh` 仅影响对应会话，不串扰。
4. HTTP 与 MCP 同时开启时，状态与二维码内容一致。
