# 📘 Instagram CLI - 完整使用教程

## 🎯 快速开始

本教程将指导你如何使用 Instagram CLI 的所有功能。

---

## 📋 目录

1. [环境准备](#环境准备)
2. [方式一：CLI 命令使用](#方式一cli-命令使用)
3. [方式二：HTTP API 使用](#方式二http-api-使用)
4. [常见问题](#常见问题)
5. [高级技巧](#高级技巧)

---

## 环境准备

### 1. 安装依赖

```bash
npm install
```

### 2. 编译 TypeScript

```bash
npm run build
```

### 3. 验证安装

```bash
node bin/insta.js --help
```

应该看到帮助信息。

---

## 方式一：CLI 命令使用

### 1. 登录 Instagram

```bash
node bin/insta.js login
```

**操作流程**：

1. 命令执行后会自动打开 Chrome 浏览器窗口
2. 在浏览器中完成以下操作：
   - 输入用户名和密码
   - 完成双因素认证（如果启用）
   - 等待跳转到主页

3. 看到主页后，回到终端按 **ENTER** 键

4. 系统会自动检测登录成功并保存 Cookies

**预期输出**：
```
🌐 Opening Chrome browser...
📱 Opening Instagram home page...
✅ Browser opened successfully!

═══════════════════════════════════════════════════════
  Please complete these steps in the Chrome window:
═══════════════════════════════════════════════════════
  1. Click "Log In" button
  2. Enter your username and password
  3. Complete 2FA if needed
  4. Wait until you see your Feed/Home page
  → When you see your Feed, come back here and press ENTER
═══════════════════════════════════════════════════════

✅ Login completed!

🔄 Browser will stay OPEN for all operations
You can now use commands like:
  insta photo:upload <photo.jpg>
  insta browser:status

To close browser when done:
  insta browser:close
```

### 2. 查看登录状态

```bash
node bin/insta.js session:check
```

**预期输出**（已登录）：
```
Session Status for "default":

────────────────────────────────────────
  ✓ Status:     Valid
  Username:   your_username
  User ID:    123456789
  Expires:    2025-02-18 10:30:00
  Time left:  6d 23h
────────────────────────────────────────
```

### 3. 查看浏览器状态

```bash
node bin/insta.js browser:status
```

**预期输出**（浏览器运行中）：
```
Browser Status:

────────────────────────────────────────
  ✓ Status:     Running
  Session:    Loaded
  Username:   your_username
────────────────────────────────────────

💡 Browser is persistent and will be used for all operations
```

### 4. 上传照片

```bash
node bin/insta.js photo:upload <照片路径> -c "照片描述"
```

**示例**：
```bash
node bin/insta.js photo:upload /Users/you/Pictures/photo.jpg -c "我的第一张照片！"
```

### 5. 关闭浏览器

```bash
node bin/insta.js browser:close
```

### 6. 查看所有可用命令

```bash
node bin/insta.js --help
```

---

## 方式二：HTTP API 使用

### 1. 启动 API 服务器

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

Available endpoints:
  POST   /api/v1/login/qrcode   - Start login process
  GET    /api/v1/login/status   - Check login status
  DELETE /api/v1/login/cookies - Delete cookies (logout)
═══════════════════════════════════════════════════════
```

服务器将在 `http://localhost:3000` 启动。

### 2. 健康检查

```bash
curl http://localhost:3000/health
```

**预期输出**：
```json
{
  "success": true,
  "data": {
    "status": "ok",
    "timestamp": "2025-02-11T12:00:00.000Z",
    "service": "instagram-api",
    "version": "1.0.0"
  }
}
```

### 3. 检查登录状态

```bash
curl http://localhost:3000/api/v1/login/status
```

**响应示例**（已登录）：
```json
{
  "success": true,
  "data": {
    "loggedIn": true,
    "username": "your_username",
    "timestamp": "2025-02-11T12:00:00.000Z"
  }
}
```

**响应示例**（未登录）：
```json
{
  "success": true,
  "data": {
    "loggedIn": false,
    "message": "Not logged in (no cookies)"
  }
}
```

### 4. 启动登录流程

```bash
curl -X POST http://localhost:3000/api/v1/login/qrcode
```

**操作流程**：

1. 执行命令后会自动打开 Chrome 浏览器
2. 在浏览器中完成登录操作
3. 系统自动检测登录成功（约 2 分钟超时）
4. Cookies 自动保存到 `.instagram-cli/cookies.json`

**响应示例**：
```json
{
  "success": true,
  "data": {
    "loggedIn": true,
    "username": "your_username",
    "timestamp": "2025-02-11T12:00:00.000Z"
  }
}
```

### 5. 删除 Cookies（登出）

```bash
curl -X DELETE http://localhost:3000/api/v1/login/cookies
```

**响应示例**：
```json
{
  "success": true,
  "data": {
    "loggedOut": true,
    "message": "Successfully logged out"
  }
}
```

### 6. 使用 JavaScript/Node.js 调用 API

创建 `test-api.js`：

```javascript
import fetch from 'node-fetch';

const BASE_URL = 'http://localhost:3000';

// 检查登录状态
async function checkStatus() {
  const response = await fetch(`${BASE_URL}/api/v1/login/status`);
  const data = await response.json();
  console.log('登录状态:', data);
}

// 启动登录
async function login() {
  const response = await fetch(`${BASE_URL}/api/v1/login/qrcode`, {
    method: 'POST'
  });
  const data = await response.json();
  console.log('登录结果:', data);
}

// 登出
async function logout() {
  const response = await fetch(`${BASE_URL}/api/v1/login/cookies`, {
    method: 'DELETE'
  });
  const data = await response.json();
  console.log('登出结果:', data);
}

// 运行测试
checkStatus();
```

运行：
```bash
node test-api.js
```

### 7. 使用 Python 调用 API

```python
import requests

BASE_URL = "http://localhost:3000"

# 检查登录状态
response = requests.get(f"{BASE_URL}/api/v1/login/status")
print("登录状态:", response.json())

# 启动登录
response = requests.post(f"{BASE_URL}/api/v1/login/qrcode")
print("登录结果:", response.json())

# 登出
response = requests.delete(f"{BASE_URL}/api/v1/login/cookies")
print("登出结果:", response.json())
```

### 8. 使用其他 HTTP 客户端

**Postman**：
1. 导入 `http://localhost:3000`
2. 测试各个端点

**Insomnia**：
1. 创建新请求
2. 设置方法和 URL
3. 发送请求

---

## 常见问题

### Q1: 浏览器无法启动？

**错误信息**：`Failed to launch browser`

**解决方案**：

1. 检查 Chrome 是否已安装：
   ```bash
   # macOS
   ls /Applications/Google\ Chrome.app/

   # Linux
   which google-chrome

   # Windows
   where chrome
   ```

2. 如果未安装，从 https://www.google.com/chrome/ 下载安装

### Q2: 登录超时？

**错误信息**：`Login timeout`

**解决方案**：

1. 确保在浏览器中完成了登录操作
2. 确保看到了主页/动态流
3. 回到终端按 ENTER 键
4. 如果超时，重新运行登录命令

### Q3: Cookie 过期？

**错误信息**：`Cookies expired`

**解决方案**：

```bash
# 方法1: 使用 CLI
node bin/insta.js login

# 方法2: 使用 API
curl -X POST http://localhost:3000/api/v1/login/qrcode
```

### Q4: 浏览器一直显示"Not initialized"？

**解决方案**：

1. 先运行登录命令启动浏览器：
   ```bash
   node bin/insta.js login
   ```

2. 完成登录后，浏览器会保持运行

3. 再次检查状态：
   ```bash
   node bin/insta.js browser:status
   ```

### Q5: 端口被占用？

**错误信息**：`Error: listen EADDRINUSE: address already in use :::3000`

**解决方案**：

1. 查找占用端口的进程：
   ```bash
   # macOS/Linux
   lsof -i :3000

   # Windows
   netstat -ano | findstr :3000
   ```

2. 杀死进程或更改端口：
   ```bash
   # 更改端口
   PORT=3001 npm run server
   ```

### Q6: 上传照片失败？

**可能原因**：
- 浏览器未登录
- Cookie 过期
- 文件路径错误
- 文件格式不支持

**解决方案**：

1. 检查登录状态：
   ```bash
   node bin/insta.js session:check
   ```

2. 如果未登录，重新登录：
   ```bash
   node bin/insta.js login
   ```

3. 确认文件路径正确：
   ```bash
   # macOS/Linux
   ls /path/to/photo.jpg

   # Windows
   dir C:\path\to\photo.jpg
   ```

---

## 高级技巧

### 1. 使用环境变量配置端口

```bash
# 设置自定义端口
export PORT=8080
npm run server
```

### 2. 后台运行服务器

**Linux/macOS**：
```bash
npm run server &
```

**Windows (PowerShell)**：
```powershell
Start-Process -NoNewWindow npm -ArgumentList "run","server"
```

### 3. 日志重定向

```bash
# 保存日志到文件
npm run server > server.log 2>&1

# 同时输出到终端和文件
npm run server 2>&1 | tee server.log
```

### 4. 自动重启开发模式

使用 `nodemon` 实现代码修改后自动重启：

```bash
# 安装 nodemon
npm install -g nodemon

# 使用 nodemon 运行
nodemon src/server.js
```

### 5. 使用不同账户

```bash
# 登录到账户1
node bin/insta.js login -a account1

# 登录到账户2
node bin/insta.js login -a account2

# 查看所有账户
node bin/insta.js session:list
```

### 6. Docker 部署

创建 `Dockerfile`：

```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 3000

CMD ["npm", "run", "server"]
```

构建和运行：

```bash
# 构建镜像
docker build -t instagram-cli .

# 运行容器
docker run -p 3000:3000 instagram-cli
```

### 7. 集成到 CI/CD

**GitHub Actions 示例**：

```yaml
name: Test Instagram CLI

on: [push]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - name: Setup Node.js
        uses: actions/setup-node@v2
        with:
          node-version: '18'
      - name: Install dependencies
        run: npm install
      - name: Build
        run: npm run build
      - name: Test API
        run: npm test
```

---

## 📊 功能对比表

| 功能 | CLI 命令 | HTTP API | 说明 |
|------|---------|----------|------|
| 登录 | `insta login` | `POST /api/v1/login/qrcode` | 启动浏览器并等待用户登录 |
| 查看状态 | `insta session:check` | `GET /api/v1/login/status` | 检查登录状态 |
| 查看浏览器 | `insta browser:status` | - | 查看浏览器运行状态 |
| 关闭浏览器 | `insta browser:close` | - | 关闭浏览器 |
| 登出 | `insta logout` | `DELETE /api/v1/login/cookies` | 删除 Cookies |
| 上传照片 | `insta photo:upload` | - | 上传照片到 Instagram |

---

## 🎓 最佳实践

### 1. 推荐工作流程

```bash
# 1. 登录（一次性）
node bin/insta.js login

# 2. 验证登录状态
node bin/insta.js session:check

# 3. 检查浏览器状态
node bin/insta.js browser:status

# 4. 上传照片（可多次）
node bin/insta.js photo:upload photo1.jpg -c "第一张照片"
node bin/insta.js photo:upload photo2.jpg -c "第二张照片"
node bin/insta.js photo:upload photo3.jpg -c "第三张照片"

# 5. 完成后关闭浏览器
node bin/insta.js browser:close
```

### 2. 定期维护

**每周检查一次**：
```bash
# 检查登录状态
node bin/insta.js session:check

# 如果快过期，重新登录
node bin/insta.js browser:close
node bin/insta.js login
```

### 3. 安全建议

1. **保护 Cookies 文件**：
   - `.instagram-cli/cookies.json` 包含敏感信息
   - 不要提交到 Git
   - 定期更换密码

2. **使用双因素认证**：
   - 在 Instagram 账户中启用 2FA
   - 提高账户安全性

3. **避免频繁登录**：
   - Cookies 有效期为 7 天
   - 避免不必要的重新登录

---

## 📞 获取帮助

### 查看命令帮助

```bash
# 查看所有命令
node bin/insta.js --help

# 查看特定命令帮助
node bin/insta.js login --help
node bin/insta.js photo:upload --help
node bin/insta.js session:check --help
```

### 查看文档

```bash
# 阶段一完成文档
cat PHASE1_XIAOHONGSHU_MCP_COMPLETE.md

# 跨进程浏览器架构文档
cat CROSS_PROCESS_BROWSER_ARCHITECTURE.md
```

---

## 🚀 下一步

完成基础使用后，你可以：

1. **探索更多功能**：
   - 尝试不同的上传选项
   - 测试批量上传
   - 自定义上传参数

2. **集成到自动化流程**：
   - 集成到脚本
   - 集成到 CI/CD
   - 集成到定时任务

3. **开发扩展功能**：
   - 添加新的 API 端点
   - 添加新的 CLI 命令
   - 贡献代码到项目

---

**祝你使用愉快！** 🎉

有问题？查看 [常见问题](#常见问题) 或查看项目文档。
