# 🌐 Instagram CLI - 浏览器登录指南

## 🎉 新功能：使用 Chrome 浏览器登录！

我们已将登录方式升级为使用 Chrome 浏览器，更加安全可靠！

## ✨ 优势

- ✅ **更安全** - 在真实的浏览器中登录，密码不会暴露给命令行
- ✅ **支持 2FA** - 完美支持双因素认证
- ✅ **自动化** - 登录后自动提取 Session 并保存
- ✅ **可视化** - 可以看到整个登录过程

## 🚀 使用方法

### 1. 启动登录

在你的终端中运行：

```bash
cd /Users/lyg/software/instagram-cli
node bin/insta.js login
```

### 2. 按照提示操作

你会看到：

```
   ____                 _                                                   ____   _
  |  _ \ ___  __ _| | __/ ___|_ __ _   _ ___| |_ ___ _ __
  | |_) / _ \/ _` | |/ / \___ | '__| | | / __| __/ _ \ '__|
  |  _ <  __/ (_| |   <  ___) | |  | |_| \__ \ ||  __/ |
  |_| \_\___|\__,_|_|\_\|____/|_|   \__, |___/\__\___|_|
                                     |___/

Phase 1: Authentication

🌐 Browser-based Login
You will login using Chrome browser - safe & safe!

═══════════════════════════════════════════════════════
  Login Instructions:
═══════════════════════════════════════════════════════

  1. A Chrome window will open
  2. Login to Instagram in that window
  3. Complete 2FA if needed
  4. Wait for automatic detection

═══════════════════════════════════════════════════════

? Ready to start? (Y/n)
```

### 3. 输入 `Y` 并回车

### 4. Chrome 浏览器窗口会自动打开

### 5. 在浏览器中完成登录

- 输入你的 Instagram 用户名和密码
- 如果启用了 2FA，完成验证
- 登录成功后，脚本会自动检测

### 6. 等待自动保存 Session

成功后你会看到：

```
✓ Login successful!

Account Information:
────────────────────────────────────────
  Username:  your_username
  Full Name:  Your Name
  Account:   default
  Expires:   2025-02-17 10:30:00
────────────────────────────────────────

✓ Session saved successfully
You can now use other commands without logging in again.
```

## 📋 登录选项

```bash
# 默认登录（账户名: default）
node bin/insta.js login

# 指定账户名（多账户支持）
node bin/insta.js login --account work

# 自定义超时时间（秒）
node bin/insta.js login --timeout 180
```

## 🔍 登录后验证

登录成功后，可以使用以下命令验证：

```bash
# 查看当前用户
node bin/insta.js whoami

# 检查 Session 状态
node bin/insta.js session:check

# 列出所有 Session
node bin/insta.js session:list
```

## 🛠️ 技术细节

### 工作原理

1. **Puppeteer** 启动 Chrome 浏览器
2. 自动导航到 Instagram 登录页面
3. 你在浏览器中完成登录
4. 检测登录成功（页面跳转）
5. 提取 Cookies 和用户信息
6. 保存到本地 Session 文件

### Session 保存位置

```
~/.instagram-cli/sessions/session-<account_name>.json
```

### Session 有效期

- 默认：**7 天**
- 过期后需要重新登录

## ⚠️ 常见问题

### Q: Chrome 没有打开？

**A**: 确保 Chrome 已安装在系统中。脚本会自动查找 Chrome。

### Q: 登录超时怎么办？

**A**: 默认超时 2 分钟，可以使用 `--timeout` 选项增加时间：

```bash
node bin/insta.js login --timeout 300  # 5 分钟
```

### Q: 如何查看 Chrome 版本？

**A**:
```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --version
```

### Q: 需要每次都登录吗？

**A**: 不需要！登录一次后，Session 会保存 7 天。

## 🎯 下一步

登录成功后，你可以：

1. ✅ 查看用户信息：`node bin/insta.js whoami`
2. ✅ 检查 Session：`node bin/insta.js session:check`
3. ⏳ 等待 Phase 2 实现后上传照片、查看 Feed 等功能

## 🔐 安全说明

- ✅ 密码只在浏览器中输入，不经过命令行
- ✅ Session 加密保存在本地
- ✅ 支持双因素认证
- ✅ 自动关闭浏览器窗口

---

**现在就试试吧！**

```bash
node bin/insta.js login
```
