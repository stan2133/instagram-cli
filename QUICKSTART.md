# 🚀 Instagram CLI - Phase 1 快速测试指南

## ✅ 阶段一完成状态

基于 **xiaohongshu-mcp** 架构的 Instagram 登录管理系统已全部实现！

### 已实现功能

- ✅ **CookieManager** - Cookie 持久化存储
- ✅ **LoginAction** - Instagram 登录领域逻辑
- ✅ **InstagramService** - 业务逻辑层
- ✅ **HTTP API** - REST 接口（3个端点）
- ✅ **MCP Server** - Model Context Protocol 支持
- ✅ **API Server** - Express 服务器
- ✅ 完整文档 - USAGE_GUIDE.md (700+ 行)

---

## 🧪 快速测试

### 方式 1: 测试 HTTP API

#### 1. 启动服务器

```bash
npm run server
```

**预期输出**：
```
═══════════════════════════════════════════════════════
  Instagram API Server Started
═══════════════════════════════════════════════════════
  HTTP API:  http://localhost:3000
  MCP:        http://localhost:3000/mcp
  Health:     http://localhost:3000/health
═══════════════════════════════════════════════════════
```

#### 2. 健康检查

```bash
curl http://localhost:3000/health
```

#### 3. 检查登录状态

```bash
curl http://localhost:3000/api/v1/login/status
```

#### 4. 启动登录流程（新终端）

```bash
curl -X POST http://localhost:3000/api/v1/login/qrcode
```

**操作流程**：
1. Chrome 浏览器会自动打开
2. 在浏览器中完成 Instagram 登录
3. 等待自动检测（最多 2 分钟）
4. Cookies 自动保存到 `.instagram-cli/cookies.json`

#### 5. 使用测试脚本

```bash
node test-api.js
```

---

### 方式 2: 使用现有 CLI 命令

#### 1. 登录

```bash
node bin/insta.js login
```

#### 2. 查看登录状态

```bash
node bin/insta.js session:check
```

#### 3. 查看浏览器状态

```bash
node bin/insta.js browser:status
```

#### 4. 关闭浏览器

```bash
node bin/insta.js browser:close
```

---

## 📁 文件结构

```
src/
├── api/
│   ├── routes.js              ✅ HTTP API 路由
│   └── mcp-server.js          ✅ MCP 协议服务器
├── services/
│   ├── browser-manager.ts     (已有)
│   ├── cookie-manager.js      ✅ 新增
│   └── instagram-service.js   ✅ 新增
├── instagram/
│   └── login.js               ✅ 新增
└── server.js                  ✅ 新增

根目录：
├── test-api.js                ✅ 新增
├── USAGE_GUIDE.md             ✅ 新增 (700+ 行)
├── PHASE1_XIAOHONGSHU_MCP_COMPLETE.md  ✅ 新增
└── QUICKSTART.md              ✅ 本文件
```

---

## 🔌 API 端点

### POST /api/v1/login/qrcode
启动浏览器并等待用户手动登录 Instagram

### GET /api/v1/login/status
检查登录状态（验证 Cookies）

### DELETE /api/v1/login/cookies
删除 Cookies（登出）

---

## 📚 完整文档

查看 **USAGE_GUIDE.md** 获取：
- 详细使用说明
- 故障排除指南
- 高级技巧
- 最佳实践
- 多语言示例（JavaScript、Python）

---

## 🎯 下一步建议

1. **立即测试**：
   ```bash
   npm run server
   # 然后另一个终端
   node test-api.js
   ```

2. **阅读文档**：
   ```bash
   cat USAGE_GUIDE.md
   ```

3. **开始使用**：
   - 使用 CLI 命令进行日常操作
   - 使用 HTTP API 集成到自动化流程
   - 参考架构设计进行扩展

---

## ✨ 与 xiaohongshu-mcp 的对比

| 特性 | xiaohongshu-mcp (Go) | Instagram CLI (JS) | 状态 |
|------|---------------------|-------------------|------|
| Cookie 管理 | ✓ JSON 文件 | ✓ JSON 文件 | ✅ 完成 |
| HTTP API | ✓ Gin | ✓ Express | ✅ 完成 |
| MCP 协议 | ✓ 官方 SDK | ✓ 官方 SDK（可选） | ✅ 完成 |
| 登录方式 | 二维码扫码 | 手动登录 | ✅ 适配 |
| 浏览器自动化 | Rod | Puppeteer | ✅ 完成 |
| 错误处理 | ✓ Panic 恢复 | ✓ Try-catch | ✅ 完成 |

---

**🎉 恭喜！阶段一完成！**

现在可以开始使用 Instagram CLI 的登录管理系统了。
