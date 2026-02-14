# login_web.js 与 Puppeteer MCP 集成指南

## 概述

`login_web.js` 现已完全集成 `puppeteer-mcp-server`，允许你在登录任何网站后，通过 Claude Desktop 或 Cursor 的 MCP 工具直接操作已登录的浏览器。

## 工作原理

```
login_web.js (登录会话)
    ↓
保持浏览器运行在 9222 端口
    ↓
puppeteer-mcp-server 连接到浏览器
    ↓
Claude Desktop / Cursor 调用 MCP 工具
    ↓
操作已登录的页面 (截图、点击、填写表单等)
```

## 使用步骤

### 步骤 1: 使用 login_web.js 登录网站

```bash
# 登录 Instagram
node login_web.js https://www.instagram.com

# 登录 Twitter
node login_web.js https://twitter.com

# 登录任意网站
node login_web.js https://example.com
```

**登录流程**:
1. 脚本自动启动 Chrome 浏览器 (端口 9222)
2. 在浏览器中手动完成登录
3. 登录成功后回到终端按 Enter
4. 脚本自动检测登录状态并保存 cookies
5. 生成 MCP 配置文件

**输出示例**:
```
✅ 登录成功! (检测方式: cookie)
🍪 提取 session cookies...
✅ Cookies 已保存到: .instagram-cli/sessions/cookies-instagram-com.json

🔧 生成 MCP 配置文件...

═══════════════════════════════════════════════════════
  🔗 MCP 服务器配置
═══════════════════════════════════════════════════════

📋 puppeteer-mcp-server 已配置:
   调试端口: 9222
   目标网站: www.instagram.com

📘 下一步：将配置添加到 Claude Desktop 或 Cursor
```

### 步骤 2: 安装 puppeteer-mcp-server

```bash
# 全局安装
npm install -g puppeteer-mcp-server

# 或使用 npx (无需安装)
npx -y puppeteer-mcp-server
```

### 步骤 3A: Claude Desktop 配置 (macOS)

1. **找到配置文件位置**:
   ```
   ~/Library/Application Support/Claude/claude_desktop_config.json
   ```

2. **添加 MCP 配置**:

   `login_web.js` 会在登录成功后显示完整配置，例如:
   ```json
   {
     "mcpServers": {
       "puppeteer": {
         "command": "npx",
         "args": ["-y", "puppeteer-mcp-server"],
         "env": {
           "DEBUG_PORT": "9222"
         }
       }
     }
   }
   }
   ```

3. **保存到配置文件**:
   - 如果配置文件不存在，创建新文件
   - 如果已存在，在文件中添加或更新 `mcpServers.puppeteer` 部分

4. **重启 Claude Desktop**

### 步骤 3B: Cursor 配置

Cursor 支持两种配置方式：

**方式 1: 全局配置文件**

1. 创建文件 `~/.cursorrules` (如果不存在)
2. 添加 MCP 配置:
   ```json
   {
     "mcpServers": {
       "puppeteer": {
         "command": "npx",
         "args": ["-y", "puppeteer-mcp-server"],
         "env": {
           "DEBUG_PORT": "9222"
         }
       }
     }
   }
   ```

**方式 2: 项目配置文件**

在项目根目录创建 `mcp_config.json`:
```json
{
  "mcpServers": {
    "puppeteer": {
      "command": "npx",
      "args": ["-y", "puppeteer-mcp-server"],
      "env": {
        "DEBUG_PORT": "9222"
      }
    }
  }
}
```

重启 Cursor。

### 步骤 4: 使用 MCP 工具

配置完成后，在 Claude Desktop 或 Cursor 中即可使用以下工具：

#### 1. 连接到浏览器标签页

**工具**: `puppeteer_connect_active_tab`

**参数**:
- `targetUrl` (可选): 指定要连接的标签页 URL
- `debugPort` (可选): 调试端口，默认 9222

**示例**:
```
"使用 puppeteer_connect_active_tab 连接到当前浏览器页面"
"连接到 Instagram 页面，debugPort 设为 9222"
```

#### 2. 导航到新 URL

**工具**: `puppeteer_navigate`

**参数**:
- `url` (必需): 要导航到的 URL

**示例**:
```
"导航到 https://www.instagram.com/explore/"
```

#### 3. 截图

**工具**: `puppeteer_screenshot`

**参数**:
- `name` (必需): 截图名称
- `selector` (可选): CSS 选择器，截图特定元素
- `width` (可选): 宽度 (默认 800)
- `height` (可选): 高度 (默认 600)

**示例**:
```
"截图整个页面，保存名为 homepage"
"截图搜索框元素，选择器为 [aria-label='Search']"
```

#### 4. 点击元素

**工具**: `puppeteer_click`

**参数**:
- `selector` (必需): CSS 选择器

**示例**:
```
"点击搜索按钮，选择器为 svg[aria-label='Search']"
"点击登录按钮，选择器为 button[type='submit']"
```

#### 5. 填写表单

**工具**: `puppeteer_fill`

**参数**:
- `selector` (必需): CSS 选择器
- `value` (必需): 要输入的文本

**示例**:
```
"在搜索框中输入 'coco'"
"在用户名输入框中输入 'myusername'"
```

#### 6. 执行 JavaScript

**工具**: `puppeteer_evaluate`

**参数**:
- `script` (必需): JavaScript 代码

**示例**:
```
"执行 document.title 获取页面标题"
"执行 document.querySelectorAll('a').length 获取链接数量"
```

#### 7. 悬停元素

**工具**: `puppeteer_hover`

**参数**:
- `selector` (必需): CSS 选择器

**示例**:
```
"悬停在用户头像上"
```

#### 8. 选择下拉菜单

**工具**: `puppeteer_select`

**参数**:
- `selector` (必需): select 元素选择器
- `value` (必需): 选项值

**示例**:
```
"在下拉菜单中选择 'English' 选项"
```

## 完整使用示例

### 示例 1: 自动搜索 Instagram 用户

1. **登录**:
   ```bash
   node login_web.js https://www.instagram.com
   # [手动登录并按 Enter]
   ```

2. **在 Claude Desktop 中**:
   ```
   你: 使用 puppeteer_connect_active_tab 连接到浏览器
   Claude: ✅ 已连接到浏览器，当前 URL: https://www.instagram.com/

   你: 点击搜索图标
   Claude: ✅ 已点击 svg[aria-label="Search"]

   你: 在搜索框中输入 "coco"
   Claude: ✅ 已在 input[aria-label="Search"] 中输入 "coco"

   你: 截图保存为 search-results
   Claude: ✅ 截图已保存
   ```

### 示例 2: 批量操作

```
你: 连接到浏览器，导航到 https://twitter.com/explore
Claude: ✅ 已连接并导航

你: 截图并保存为 explore-page
Claude: ✅ 截图完成

你: 点击第一个推文
Claude: ✅ 已点击

你: 执行代码获取点赞数
Claude: 结果: 1234
```

## 注意事项

### 安全

- **调试端口仅限本地**: 9222 端口仅在本地监听，不会暴露到公网
- **会话隔离**: 每次运行 `login_web.js` 启动新的浏览器实例
- **Cookie 安全**: Cookies 保存在 `.instagram-cli/sessions/` 目录，不应共享

### 兼容性

- **macOS**: 完全支持 Claude Desktop 和 Cursor
- **Windows**: 支持 Cursor (Claude Desktop 即将支持)
- **Linux**: 支持 Cursor

### 故障排查

**问题**: MCP 工具不可用
- 确认 `puppeteer-mcp-server` 已安装: `npm list -g | grep puppeteer`
- 重启 Claude Desktop 或 Cursor
- 检查配置文件格式是否正确 (JSON 格式)

**问题**: 无法连接到浏览器
- 确认 `login_web.js` 正在运行 (进程未结束)
- 检查端口 9222 是否被占用: `lsof -i :9222`
- 确认 Chrome 浏览器窗口未关闭

**问题**: 操作无响应
- 使用 `puppeteer_screenshot` 查看当前页面状态
- 确认选择器正确: 使用浏览器开发者工具检查元素
- 执行 `puppeteer_evaluate` 运行调试代码

## 高级用法

### 自定义端口

在启动 `login_web.js` 前设置环境变量:
```bash
export DEBUG_PORT=3000
node login_web.js https://www.instagram.com
```

然后在 MCP 配置中使用相同端口:
```json
{
  "env": {
    "DEBUG_PORT": "3000"
  }
}
```

### 多会话管理

可以同时运行多个 `login_web.js` 实例，使用不同端口:
```bash
# Terminal 1: Instagram
export DEBUG_PORT=9222
node login_web.js https://www.instagram.com

# Terminal 2: Twitter
export DEBUG_PORT=9223
node login_web.js https://twitter.com
```

## 更多信息

- [puppeteer-mcp-server GitHub](https://github.com/merajmehrabi/puppeteer-mcp-server)
- [Model Context Protocol 文档](https://modelcontextprotocol.io/)
- [Claude Desktop 文档](https://claude.ai/download)

## 更新日志

### v0.2.0 (当前)
- ✅ 添加 MCP 配置自动生成
- ✅ 支持 Claude Desktop 和 Cursor
- ✅ 集成 puppeteer-mcp-server
- ✅ 完整的工具文档和示例

### v0.1.0
- ✅ 基础登录功能
- ✅ Cookie 保存和浏览器持久化
- ✅ 支持 Instagram、Twitter、GitHub 等主流网站
