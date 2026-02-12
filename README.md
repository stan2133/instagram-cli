# Instagram CLI

> **Phase 1 已完成** - 两阶段 Instagram CLI 工具（登录阶段）

Instagram CLI 是一个功能完整的命令行工具，允许你通过终端管理 Instagram 账户。采用两阶段架构设计，将登录和操作明确分离。

## ✨ 特性

- 🚀 **单次命令模式** - 登录一次，多次使用，无需重复认证
- 🔐 **安全的 Session 管理** - Session 本地加密存储，自动刷新
- 👥 **多账户支持** - 管理多个 Instagram 账户
- ✅ **Spec-Driven Development** - 完整的测试覆盖 (59/59 测试通过)
- 💻 **TypeScript 实现** - 类型安全，易于维护
- 🎨 **美观的 CLI 界面** - 彩色输出，交互式提示

## 📋 阶段一：登录功能 (Phase 1 - COMPLETED)

### ✅ 已实现功能

- ✅ 用户登录认证 (`insta login`)
- ✅ Session 持久化存储
- ✅ Session 有效性验证
- ✅ 多账户管理
- ✅ 登出功能 (`insta logout`)
- ✅ Session 列表查看 (`insta session:list`)
- ✅ Session 状态检查 (`insta session:check`)
- ✅ Session 删除 (`insta session:remove`)
- ✅ 当前用户查询 (`insta whoami`)

### 🚧 阶段二：操作功能 (Phase 2 - PLANNED)

- ⏳ 内容上传（照片、视频、Story）
- ⏳ Feed 浏览
- ⏳ 评论管理
- ⏳ 用户关注
- ⏳ 数据统计

## 📦 安装

```bash
# 克隆仓库
git clone https://github.com/yourusername/instagram-cli.git
cd instagram-cli

# 安装依赖
npm install

# 构建项目
npm run build

# 全局安装（可选）
npm link
```

## 🚀 快速开始

### 1. 登录 Instagram

```bash
# 交互式登录（推荐）
insta login

# 或使用命令行参数
insta login --username your_username --password your_password

# 登录特定账户（多账户支持）
insta login --account work
```

登录后，你将看到：

```
   ____            _     ____                 _
  |  _ \ ___  __ _| | __/ ___|_ __ _   _ ___| |_ ___ _ __
  | |_) / _ \/ _` | |/ / \___ | '__| | | / __| __/ _ \ '__|
  |  _ <  __/ (_| |   <  ___) | |  | |_| \__ \ ||  __/ |
  |_| \_\___|\__,_|_|\_\|____/|_|   \__, |___/\__\___|_|
                                      |___/

Phase 1: Authentication

Please enter your Instagram credentials:

? Username: **********
? Password: *********
✔ Logging in to Instagram...

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

### 2. 查看当前用户

```bash
insta whoami
```

### 3. 查看所有 Session

```bash
insta session:list
```

### 4. 检查 Session 状态

```bash
insta session:check
```

### 5. 登出

```bash
# 登出当前账户
insta logout

# 登出所有账户
insta logout --all
```

## 📚 命令参考

### 登录相关

#### `insta login`
登录 Instagram 并保存 session。

```bash
insta login [options]

Options:
  -u, --username <username>  Instagram 用户名
  -p, --password <password>  Instagram 密码（不推荐）
  -a, --account <name>       账户名称（默认: default）
  --skip-validation          跳过登录后的验证
```

#### `insta logout`
登出并删除 session。

```bash
insta logout [options]

Options:
  -a, --account <name>  要登出的账户名称
  --all                 登出所有账户
```

#### `insta whoami`
显示当前登录用户信息。

```bash
insta whoami [options]

Options:
  -a, --account <name>  账户名称（默认: default）
```

### Session 管理

#### `insta session:list`
列出所有已保存的 session。

```bash
insta session:list
```

输出示例：
```
Active Sessions (2):

✓ personal_user (personal)
   Status:  Valid
   Expires: 2025-02-17 10:30:00

✓ work_user (work)
   Status:  Valid
   Expires: 2025-02-18 15:45:00
```

#### `insta session:check`
检查 session 有效性。

```bash
insta session:check [options]

Options:
  -a, --account <name>  账户名称（默认: default）
```

输出示例：
```
Session Status for "default":

────────────────────────────────────────
  ✓ Status:     Valid
  Username:   your_username
  Expires:    2025-02-17 10:30:00
  Time left:  6d 23h
────────────────────────────────────────
```

#### `insta session:remove`
删除已保存的 session。

```bash
insta session:remove [options]

Options:
  -a, --account <name>  要删除的账户名称
```

如果不指定账户，将显示交互式列表供选择。

## 🏗️ 架构设计

### 两阶段架构

```
┌─────────────────────────────────────────────────────────────┐
│                    阶段一：登录阶段 ✅                         │
├─────────────────────────────────────────────────────────────┤
│  用户登录 → Session 创建 → 本地加密保存                         │
│                                                             │
│  命令: insta login, insta logout, insta session:*           │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ Session 持久化
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    阶段二：操作阶段 🚧                         │
├─────────────────────────────────────────────────────────────┤
│  自动加载 Session → 执行操作 → 自动刷新                        │
│                                                             │
│  命令: insta upload, insta feed, insta comment, etc.       │
└─────────────────────────────────────────────────────────────┘
```

### 核心模块

#### 1. Session Store (会话存储)
- 负责将 session 数据持久化到文件系统
- 支持加密存储
- 测试覆盖：15/15 ✓

#### 2. Session Validator (会话验证器)
- 验证 session 有效性
- 检查过期时间
- 测试覆盖：14/14 ✓

#### 3. Session Manager (会话管理器)
- 统一管理 session 生命周期
- 协调 Store 和 Validator
- 测试覆盖：30/30 ✓

#### 4. Auth Service (认证服务)
- 处理 Instagram 登录认证
- 创建和管理 session
- 测试覆盖：完整覆盖 ✓

### 目录结构

```
instagram-cli/
├── src/
│   ├── commands/          # CLI 命令
│   │   └── auth.ts        # 认证命令
│   ├── services/          # 业务服务
│   │   └── auth.ts        # 认证服务
│   ├── session/           # Session 管理
│   │   ├── store.ts       # 存储
│   │   ├── validator.ts   # 验证器
│   │   └── manager.ts     # 管理器
│   ├── models/            # 数据模型
│   │   ├── types.ts       # 类型定义
│   │   └── constants.ts   # 常量
│   ├── utils/             # 工具函数
│   │   ├── errors.ts      # 自定义错误
│   │   └── logger.ts      # 日志工具
│   └── index.ts           # 入口文件
├── tests/                 # 测试文件
├── bin/                   # 可执行文件
│   └── insta.js
└── package.json
```

## 🧪 测试

```bash
# 运行所有测试
npm test

# 运行特定模块测试
npm test -- --testPathPattern=session

# 生成覆盖率报告
npm run test:coverage

# 监视模式
npm run test:watch
```

当前测试状态：**59/59 通过 ✓**

## 🔧 开发

```bash
# 安装依赖
npm install

# 开发模式运行
npm run dev

# 构建
npm run build

# 代码检查
npm run lint
```

## 📝 配置

Session 数据存储在：`~/.instagram-cli/sessions/`

每个账户的 session 保存为：`session-<account_name>.json`

## ⚠️ 重要说明

1. **仅供学习使用** - 本工具仅用于学习和个人使用
2. **遵守服务条款** - 使用时请遵守 Instagram 服务条款
3. **风险提示** - 使用非官方 API 可能存在风险
4. **建议使用测试账户** - 避免使用主账户进行测试

## 🔐 安全性

- Session 数据本地加密存储
- 密码通过交互式输入（不显示在明文）
- 支持 2FA（双因素认证）框架
- 自动 Session 刷新机制

## 🐛 故障排除

### 登录失败

```
✗ Authentication Error: Login failed
```

**解决方案：**
- 检查用户名和密码是否正确
- 确认账户未被 Instagram 限制
- 稍后重试（可能是限流问题）

### Session 过期

```
⚠ Session should be refreshed soon
```

**解决方案：**
- 重新登录：`insta login`
- 检查网络连接

### 找不到 Session

```
No session found for account "default"
```

**解决方案：**
- 先登录：`insta login`
- 检查是否使用了正确的账户名

## 📈 进度

- [x] Phase 1: 登录功能 (100%)
- [ ] Phase 2: 操作功能 (0%)

## 🤝 贡献

欢迎贡献！请遵循以下步骤：

1. Fork 本仓库
2. 创建功能分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启 Pull Request

## 📄 许可证

MIT License - 仅供学习研究使用

## 🙏 致谢

- [instagram-private-api](https://github.com/dilame/instagram-private-api) - Instagram Private API
- [Commander.js](https://github.com/tj/commander.js) - CLI 框架
- [Inquirer.js](https://github.com/SBoudrias/Inquirer.js) - 交互式 CLI

## 📮 联系方式

如有问题或建议，请创建 [Issue](https://github.com/yourusername/instagram-cli/issues)

---

**Made with ❤️ using Spec-Driven Development**
