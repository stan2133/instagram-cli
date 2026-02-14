# Puppeteer MCP 快速开始指南

## 5 分钟上手

### 前置要求

- Node.js 已安装
- Claude Desktop 或 Cursor IDE

### 第一步：安装依赖

```bash
npm install

# 安装 puppeteer-mcp-server (MCP 工具)
npm install -g puppeteer-mcp-server
```

### 第二步：登录网站

```bash
# 以 Instagram 为例
node login_web.js https://www.instagram.com
```

**操作**:
1. 浏览器自动打开
2. 手动输入用户名和密码登录
3. 看到主页后回到终端按 **Enter**
4. 看到 MCP 配置信息

### 第三步：配置 MCP

**复制登录成功后显示的配置**:

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

**Claude Desktop 用户**:
1. 打开 `~/Library/Application Support/Claude/claude_desktop_config.json`
2. 粘贴上述配置
3. 保存文件
4. 重启 Claude Desktop

**Cursor 用户**:
1. 打开 `~/.cursorrules`
2. 粘贴上述配置
3. 保存文件
4. 重启 Cursor

### 第四步：在 Claude/Cursor 中使用

现在你可以直接在对话中使用 MCP 工具！

**示例对话**:

```
👤 用户: 使用 puppeteer 连接到浏览器

🤖 Claude: ✅ 已连接到浏览器
   当前 URL: https://www.instagram.com/
   
👤 用户: 截图保存为 homepage

🤖 Claude: ✅ 截图已保存

👤 用户: 点击搜索图标

🤖 Claude: ✅ 已点击搜索图标

👤 用户: 在搜索框输入 "travel"

🤖 Claude: ✅ 已输入文本

👤 用户: 截图保存为 search-results

🤖 Claude: ✅ 截图已保存
```

## 可用工具

- `puppeteer_connect_active_tab` - 连接到浏览器
- `puppeteer_navigate` - 导航到新页面
- `puppeteer_screenshot` - 截图
- `puppeteer_click` - 点击元素
- `puppeteer_fill` - 填写表单
- `puppeteer_evaluate` - 执行 JavaScript
- `puppeteer_hover` - 悬停
- `puppeteer_select` - 选择下拉菜单

## 故障排查

### MCP 工具不显示

1. 确认安装: `npm list -g | grep puppeteer-mcp-server`
2. 检查配置 JSON 格式
3. 重启应用

### 连接失败

1. 确认 `login_web.js` 正在运行
2. 检查端口: `lsof -i :9222`
3. 确认浏览器窗口未关闭

---

**提示**: 保持 `login_web.js` 运行，这样 MCP 工具才能连接到浏览器！
