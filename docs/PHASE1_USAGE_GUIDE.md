# Instagram CLI - 第一阶段使用文档

## 📋 目录

- [快速开始](#快速开始)
- [登录流程](#登录流程)
- [会话管理](#会话管理)
- [浏览器管理](#浏览器管理)
- [常见问题](#常见问题)

---

## 🚀 快速开始

### 环境要求

- Node.js >= 16.0.0
- npm >= 7.0.0
- Google Chrome 浏览器

### 安装依赖

```bash
npm install
```

### 首次登录

```bash
node bin/insta.js login
```

---

## 🔐 登录流程

### 1. 启动登录

```bash
node bin/insta.js login
```

**选项参数**:
- `-a, --account <name>` - 指定账户名称（默认: default）
- `--headless` - 无头模式运行（不推荐）
- `--timeout <seconds>` - 登录超时时间（默认: 120秒）

**示例**:

```bash
# 默认账户登录
node bin/insta.js login

# 多账户登录
node bin/insta.js login -a work
node bin/insta.js login -a personal

# 自定义超时时间
node bin/insta.js login --timeout 180
```

### 2. 浏览器登录步骤

登录命令执行后，会自动打开Chrome浏览器窗口：

```
═══════════════════════════════════════════════════════
  Please complete these steps in the Chrome window:
═══════════════════════════════════════════════════════

  1. Click "Log In" button
  2. Enter your username and password
  3. Complete 2FA if needed
  4. Wait until you see your Feed/Home page

  ⏳ Take your time - no rush!

  → When you see your Feed, come back here and press ENTER
═══════════════════════════════════════════════════════
```

**操作步骤**:
1. 在打开的Chrome窗口中点击 "Log In" 按钮
2. 输入Instagram用户名和密码
3. 如果启用了双因素认证，完成2FA验证
4. 等待看到你的主页/动态流
5. **返回终端，按 ENTER 键**

### 3. 登录成功

登录成功后会显示：

```
✅ Login completed!

🔄 Browser will stay OPEN for all operations
You can now use commands like:
  insta photo:upload <photo.jpg>
  insta browser:status

To close browser when done:
  insta browser:close
```

**重要**: 浏览器会保持打开状态，供后续操作使用！

---

## 💾 会话管理

### 查看当前用户

```bash
node bin/insta.js whoami
```

**输出示例**:
```
Current User:
────────────────────────────────────────
  Username:  your_username
  Full Name:  Your Name
  Account:   default
────────────────────────────────────────
```

### 检查会话状态

```bash
node bin/insta.js session:check
```

**输出示例**:
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

### 列出所有会话

```bash
node bin/insta.js session:list
```

**输出示例**:
```
Active Sessions (2):

✓ your_username (default)
   Status:  Valid
   Expires: 2025-02-18 10:30:00

✓ work_account (work)
   Status:  Valid
   Expires: 2025-02-19 15:45:00
```

### 修复会话

如果会话显示为无效，可以使用修复命令：

```bash
node bin/insta.js session:fix
```

**选项**:
- `-a, --account <name>` - 指定要修复的账户（默认: default）

**什么情况下需要修复**？
- session:check 显示会话无效
- userId 字段为空
- 会话快过期但仍有有效cookies

### 删除会话

```bash
node bin/insta.js session:remove
```

**选项**:
- `-a, --account <name>` - 删除指定账户
- 交互式选择：不指定账户时会显示列表供选择

### 登出

```bash
# 登出当前账户
node bin/insta.js logout

# 登出所有账户
node bin/insta.js logout --all
```

---

## 🌐 浏览器管理

### 查看浏览器状态

```bash
node bin/insta.js browser:status
```

**输出示例**:
```
Browser Status:

────────────────────────────────────────
  ✓ Status:     Running
  Session:    Loaded
  Username:   your_username
────────────────────────────────────────

💡 Browser is persistent and will be used for all operations
```

**状态说明**:
- **Running** - 浏览器正在运行
- **Disconnected** - 浏览器已断开连接
- **Not initialized** - 浏览器未初始化

### 关闭浏览器

```bash
node bin/insta.js browser:close
```

**何时关闭浏览器**:
- 完成所有操作后
- 需要重新登录时
- 释放系统资源

**注意**: 关闭浏览器后，需要重新登录才能使用需要浏览器的命令。

---

## 🔧 多账户管理

### 添加多个账户

```bash
# 登录个人账户
node bin/insta.js login -a personal

# 登录工作账户
node bin/insta.js login -a work

# 登录测试账户
node bin/insta.js login -a test
```

### 查看所有账户

```bash
node bin/insta.js session:list
```

### 切换账户

当前版本需要关闭浏览器后重新登录：

```bash
# 1. 关闭当前浏览器
node bin/insta.js browser:close

# 2. 登录另一个账户
node bin/insta.js login -a work
```

---

## ❓ 常见问题

### Q1: 登录超时怎么办？

**错误信息**: `Login timeout. Please complete the login within 2 minutes.`

**解决方案**:
```bash
# 增加超时时间（单位：秒）
node bin/insta.js login --timeout 300
```

### Q2: 浏览器无法启动？

**可能原因**:
- Chrome未安装
- Chrome路径不正确

**解决方案**:
```bash
# macOS: 确认Chrome已安装在Applications文件夹
# Linux: sudo apt-get install google-chrome-stable
# Windows: 从 https://www.google.com/chrome/ 下载安装
```

### Q3: 会话显示无效？

**检查步骤**:
```bash
# 1. 检查会话状态
node bin/insta.js session:check

# 2. 尝试修复
node bin/insta.js session:fix

# 3. 如果修复失败，重新登录
node bin/insta.js browser:close
node bin/insta.js login
```

### Q4: 忘记按ENTER就关闭了浏览器？

**解决方案**:
```bash
# 检查会话是否已保存
node bin/insta.js session:check

# 如果显示无效，使用修复命令
node bin/insta.js session:fix

# 或者重新登录
node bin/insta.js login
```

### Q5: 如何知道浏览器是否在运行？

```bash
# 查看浏览器状态
node bin/insta.js browser:status

# 或者检查是否有Chrome进程
# macOS/Linux:
ps aux | grep -i chrome

# Windows:
tasklist | findstr chrome
```

### Q6: 可以使用无头模式吗？

**可以，但不推荐**:
```bash
node bin/insta.js login --headless
```

**为什么不推荐**:
- 登录需要手动操作（输入密码、2FA）
- 无头模式下无法看到浏览器窗口
- 调试困难

**适用场景**:
- 已有有效会话，只需保持浏览器运行
- 自动化脚本

### Q7: 会话有效期多久？

**默认**: 7天

**延期方法**:
```bash
# 会话快过期时，重新登录即可延期
node bin/insta.js browser:close
node bin/insta.js login
```

### Q8: 浏览器占用多少资源？

**典型资源占用**:
- 内存: 200-300MB
- CPU: 空闲时 < 5%
- 磁盘: < 50MB

**优化建议**:
- 完成操作后及时关闭浏览器
- 避免同时运行多个浏览器实例

---

## 📝 最佳实践

### 推荐工作流程

```bash
# 1. 登录（浏览器启动）
node bin/insta.js login

# 2. 检查状态
node bin/insta.js browser:status
node bin/insta.js session:check

# 3. 执行操作（上传照片等）
node bin/insta.js photo:upload photo.jpg -c "My caption!"

# 4. 完成后关闭浏览器
node bin/insta.js browser:close
```

### 定期维护

```bash
# 每周检查一次会话状态
node bin/insta.js session:check

# 会话过期前3天重新登录
node bin/insta.js browser:close
node bin/insta.js login
```

### 安全建议

1. **不要共享会话文件**: `.instagram-cli/sessions/` 目录包含敏感信息
2. **定期更换密码**: 提高账户安全性
3. **启用2FA**: 双因素认证保护账户
4. **定期清理**: 删除不使用的账户会话

---

## 🎯 下一阶段

完成第一阶段（认证）后，你可以继续使用：

- **第二阶段**: 媒体上传
  ```bash
  node bin/insta.js photo:upload <photo.jpg> -c "caption"
  ```

- **第三阶段**: 数据分析（开发中）

---

## 📚 相关文档

- [常驻浏览器架构](../PERSISTENT_BROWSER_ARCHITECTURE.md)
- [系统架构设计](../docs/SDD_ARCHITECTURE.md)
- [API文档](../docs/API_REFERENCE.md)

---

## 🆘 获取帮助

```bash
# 查看所有命令
node bin/insta.js --help

# 查看特定命令帮助
node bin/insta.js login --help
node bin/insta.js session:check --help
```

---

**文档版本**: 1.0
**最后更新**: 2025-02-11
**维护者**: Instagram CLI Team
