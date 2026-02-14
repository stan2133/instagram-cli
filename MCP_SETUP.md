# Instagram CLI - MCP 集成指南

本项目已集成 **Puppeteer MCP Server**，允许你在 Cursor 或其他支持 MCP 的工具中直接操作已登录的 Instagram 浏览器。

## 快速开始

### 1. 安装依赖

```bash
npm install

# 安装 Puppeteer MCP Server (全局)
npm install -g puppeteer-mcp-server
```

### 2. 启动登录会话

```bash
# 登录 Instagram
node login_web.js https://www.instagram.com
```

**流程**：
1. 浏览器自动打开
2. 手动输入用户名和密码登录
3. 看到主页后按 **Enter**
4. 浏览器保持运行在端口 9222

### 3. 使用 MCP 工具

项目已配置 `mcp_config.json`，Cursor 会自动读取。

**在 Cursor 中使用**：

```
你: 使用 puppeteer 连接到浏览器

AI: ✅ 已连接到浏览器
    当前 URL: https://www.instagram.com/

你: 截图保存为 homepage

AI: ✅ 截图已保存

你: 点击搜索图标

AI: ✅ 已点击搜索图标

你: 在搜索框输入 "travel"

AI: ✅ 已输入文本 "travel"

你: 截图保存为 search-results

AI: ✅ 截图已保存
```

## 可用的 MCP 工具

### 1. puppeteer_connect_active_tab
连接到已运行的浏览器标签页

**参数**：
- `targetUrl` (可选): 特定标签页 URL
- `debugPort` (可选): 调试端口，默认 9222

**示例**：
```
"使用 puppeteer_connect_active_tab 连接到浏览器"
"连接到 Instagram 页面，debugPort 设为 9222"
```

### 2. puppeteer_navigate
导航到新 URL

**参数**：
- `url` (必需): 目标 URL

**示例**：
```
"导航到 https://www.instagram.com/explore/"
```

### 3. puppeteer_screenshot
截图当前页面或特定元素

**参数**：
- `name` (必需): 截图名称
- `selector` (可选): CSS 选择器
- `width` (可选): 宽度，默认 800
- `height` (可选): 高度，默认 600

**示例**：
```
"截图整个页面，保存名为 homepage"
"截图搜索框元素，选择器为 [aria-label='Search']"
```

### 4. puppeteer_click
点击页面元素

**参数**：
- `selector` (必需): CSS 选择器

**示例**：
```
"点击搜索按钮，选择器为 svg[aria-label='Search']"
"点击登录按钮，选择器为 button[type='submit']"
```

### 5. puppeteer_fill
填写表单字段

**参数**：
- `selector` (必需): CSS 选择器
- `value` (必需): 要输入的文本

**示例**：
```
"在搜索框中输入 'coco'"
"在用户名输入框中输入 'myusername'"
```

### 6. puppeteer_evaluate
执行 JavaScript 代码

**参数**：
- `script` (必需): JavaScript 代码

**示例**：
```
"执行 document.title 获取页面标题"
"执行 document.querySelectorAll('a').length 获取链接数量"
```

### 7. puppeteer_hover
悬停在元素上

**参数**：
- `selector` (必需): CSS 选择器

**示例**：
```
"悬停在用户头像上"
```

### 8. puppeteer_select
选择下拉菜单选项

**参数**：
- `selector` (必需): select 元素选择器
- `value` (必需): 选项值

**示例**：
```
"在下拉菜单中选择 'English' 选项"
```

## 配置文件

项目包含两个 MCP 配置文件（Cursor 会自动读取）：

### 1. `.mcp.json` (推荐)
项目根目录的标准 MCP 配置文件：

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

### 2. `mcp_config.json`
备用配置文件（与 `.mcp.json` 内容相同）

### 全局配置 (可选)

如果想全局使用，可创建 `~/.cursorrules`：

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

## 工作流示例

### 示例 1：自动搜索用户

1. **启动登录**：
   ```bash
   node login_web.js https://www.instagram.com
   # [手动登录并按 Enter]
   ```

2. **在 Cursor 中**：
   ```
   你: 连接到浏览器，点击搜索图标，输入 "coco"，截图

   AI: [自动执行所有操作]
   ```

### 示例 2：批量操作

```
你: 连接到浏览器

AI: ✅ 已连接

你: 对每个搜索结果执行：
     1. 点击链接
     2. 截图
     3. 返回上一页

AI: [自动化执行重复任务]
```

### 示例 3：数据提取

```
你: 获取页面所有标题

AI: 使用 puppeteer_evaluate 执行：
    Array.from(document.querySelectorAll('h1, h2, h3'))
      .map(h => h.textContent)
```

## 故障排查

### MCP 工具不显示

1. **确认安装**：
   ```bash
   npm list -g | grep puppeteer-mcp-server
   ```

2. **确认配置**：检查 `mcp_config.json` 格式

3. **重启 Cursor**：完全退出后重新打开

### 连接失败

1. **确认 login_web.js 正在运行**：
   ```bash
   ps aux | grep login_web
   ```

2. **检查端口**：
   ```bash
   lsof -i :9222
   ```

3. **确认浏览器窗口**：Chrome 窗口应保持打开

### 操作无响应

1. **查看页面状态**：使用截图工具查看

2. **检查选择器**：在浏览器 DevTools 中验证

3. **使用 JavaScript**：直接执行代码调试

## 安全注意事项

- **调试端口仅限本地**：9222 端口仅在本地监听
- **会话隔离**：每次运行 `login_web.js` 启动新实例
- **Cookie 安全**：Cookies 保存在 `.instagram-cli/sessions/`

## 相关文档

- [完整集成指南](./MCP_INTEGRATION.md)
- [快速开始](./QUICKSTART.md)
- [puppeteer-mcp-server GitHub](https://github.com/merajmehrabi/puppeteer-mcp-server)

## 更多信息

**提示**：保持 `login_web.js` 运行，这样 MCP 工具才能连接到浏览器！
