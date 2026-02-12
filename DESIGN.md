# Instagram CLI 工具设计文档

## 1. 项目概述

### 1.1 项目目标
创建一个功能完整的 Instagram 命令行工具，允许用户通过终端界面管理 Instagram 账户，包括内容上传、信息浏览和交互等功能。

### 1.2 核心功能
- 照片/视频上传
- Feed 流查看
- 评论查看与发布
- Stories 管理
- 用户信息查看
- 数据统计分析

## 2. 功能需求详解

### 2.1 数据上传功能
- **照片上传**
  - 单张照片上传
  - 多张照片上传（轮播）
  - 支持添加标题/caption
  - 支持添加位置信息
  - 支持标签 (@用户)
  - 支持话题标签 (#hashtag)

- **视频上传**
  - 支持 MP4、MOV 格式
  - 视频封面设置
  - 视频标题和描述

### 2.2 Feed 查看功能
- **查看自己 Feed**
  - 显示最近的帖子
  - 显示点赞数、评论数
  - 显示发布时间

- **查看他人 Feed**
  - 通过用户名查看
  - 分页加载
  - 过滤和排序选项

### 2.3 评论功能
- **评论查看**
  - 查看帖子所有评论
  - 查看特定评论回复
  - 按时间排序

- **评论发布**
  - 发布新评论
  - 回复评论
  - 支持 emoji

### 2.4 Stories 功能
- 查看 Stories
- 上传 Story（图片/视频）
- 添加互动贴纸（投票、问答等）

### 2.5 用户功能
- 查看用户资料
- 查关注者/关注列表
- 搜索用户
- 关注/取消关注

### 2.6 数据统计
- 账户统计数据
- 帖子表现分析
- 粉丝增长趋势

## 3. 技术架构

### 3.1 两阶段架构设计

本工具采用**两阶段架构**，将登录和操作明确分离：

```
┌─────────────────────────────────────────────────────────────┐
│                    阶段一：登录阶段                          │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐ │
│  │ CLI Login    │───▶│ Auth Service │───▶│ Instagram    │ │
│  │ Command      │    │              │    │ API          │ │
│  └──────────────┘    └──────────────┘    └──────────────┘ │
│                             │                               │
│                             ▼                               │
│                    ┌──────────────┐                         │
│                    │ Session      │                         │
│                    │ Manager      │                         │
│                    └──────────────┘                         │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ Session 持久化
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    阶段二：操作阶段                          │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐ │
│  │ CLI Commands │───▶│ Business     │───▶│ Instagram    │ │
│  │ (upload,     │    │ Services     │    │ API          │ │
│  │  feed, etc.) │    │              │    │ (已认证)      │ │
│  └──────────────┘    └──────────────┘    └──────────────┘ │
│                             ▲                               │
│                             │                               │
│                    ┌────────┴────────┐                      │
│                    │ Session         │                      │
│                    │ Loader         │                      │
│                    └─────────────────┘                      │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 两种使用模式

#### 模式一：单次命令模式（推荐）
用户先登录，session 被持久化保存，后续每次命令都会自动加载 session。

```bash
# 步骤 1: 登录（一次性操作）
insta login

# 步骤 2: 执行各种操作（自动使用已保存的 session）
insta upload photo ./pic.jpg
insta feed me
insta comment list ABC123
```

**优点**：
- 符合 Unix 哲学，每次命令独立
- 易于脚本化和自动化
- 资源占用少

#### 模式二：交互式 Shell 模式
进入交互式 shell，保持长连接，适合连续操作。

```bash
# 进入交互式 shell
insta shell

# 在 shell 中执行命令
insta> upload photo ./pic.jpg
insta> feed me
insta> comment list ABC123
insta> exit
```

**优点**：
- 一次登录，多次操作
- 会话保持更稳定
- 适合交互式使用

### 3.3 Session 管理机制

```
┌──────────────────────────────────────────────────┐
│              Session 生命周期                     │
├──────────────────────────────────────────────────┤
│                                                  │
│  1. 登录阶段                                      │
│     └─▶ 用户输入凭证                              │
│     └─▶ Instagram API 认证                       │
│     └─▶ 生成 Session (cookies, tokens)           │
│     └─▶ 加密保存到 ~/.instagram-cli/session/     │
│                                                  │
│  2. 使用阶段                                      │
│     └─▶ 每次命令加载 Session                     │
│     └─▶ 检查 Session 有效性                      │
│     └─▶ 如果过期，尝试自动刷新                   │
│     └─▶ 执行 API 操作                            │
│                                                  │
│  3. 维护阶段                                      │
│     └─▶ 定期检查 Session 有效性                  │
│     └─▶ 自动刷新 Token                           │
│     └─▶ 失败则提示重新登录                       │
│                                                  │
│  4. 登出阶段                                      │
│     └─▶ 清除本地 Session 文件                    │
│     └─▶ 调用 Instagram 登出 API                  │
│                                                  │
└──────────────────────────────────────────────────┘
```

### 3.4 技术选型

#### 核心框架
- **Node.js**: 运行时环境
- **Commander.js**: CLI 命令解析
- **Inquirer.js**: 交互式命令行界面
- **Chalk**: 终端样式/颜色
- **Ora**: 加载动画
- **Figlet**: ASCII 艺术（启动横幅）

#### Instagram API
**方案一：Instagram Private API (推荐)**
- `instagram-private-api`: 功能完整的非官方 API
- 支持完整功能（上传、评论、Stories 等）
- 持续维护更新
- 风险：可能违反 Instagram 服务条款

**方案二：Instagram Basic Display API (官方)**
- 官方支持，安全可靠
- 功能受限（主要用于读取）
- 不支持上传内容
- 需要 Facebook App 审核

**建议**: 两种方案都实现，让用户选择

#### HTTP 客户端
- **Axios**: HTTP 请求
- **Form-data**: 文件上传

#### 数据存储
- **Conf**: 配置管理
- **Keytar**: 安全凭证存储（系统 keychain）
- **File-system**: Session 文件管理

#### 会话管理
- **Node-cron**: Session 自动刷新调度
- **Crypto**: Session 数据加密/解密

#### 文件处理
- **Sharp**: 图片处理（缩放、裁剪）
- **ffmpeg**: 视频处理（如需要）

#### 交互式 Shell
- **Vorpal**: 交互式 CLI 框架（可选）
- ** REPL**: Node.js 原生 REPL（可选）
- **dotenv**: 环境变量管理
- **node-cron**: 定时任务（如自动发布）
- **table**: 表格显示

## 4. 项目结构

```
instagram-cli/
├── bin/
│   └── insta.js                    # CLI 入口文件
├── src/
│   ├── commands/                   # 命令模块
│   │   ├── auth.js                 # 阶段一：登录命令
│   │   ├── shell.js                # 阶段二：交互式 shell 命令
│   │   ├── upload.js               # 阶段二：上传命令
│   │   ├── feed.js                 # 阶段二：Feed 命令
│   │   ├── comment.js              # 阶段二：评论命令
│   │   ├── story.js                # 阶段二：Story 命令
│   │   ├── user.js                 # 阶段二：用户命令
│   │   └── stats.js                # 阶段二：统计命令
│   ├── api/                        # API 封装
│   │   ├── client.js               # API 客户端基类
│   │   ├── private-api.js          # Private API 实现
│   │   ├── official-api.js         # Official API 实现
│   │   └── endpoints.js            # API 端点定义
│   ├── services/                   # 业务逻辑
│   │   ├── auth.service.js         # 阶段一：认证服务
│   │   ├── session.service.js      # Session 管理服务（核心）
│   │   ├── upload.service.js       # 阶段二：上传服务
│   │   ├── feed.service.js         # 阶段二：Feed 服务
│   │   ├── comment.service.js      # 阶段二：评论服务
│   │   ├── story.service.js        # 阶段二：Story 服务
│   │   ├── user.service.js         # 阶段二：用户服务
│   │   └── stats.service.js        # 阶段二：统计服务
│   ├── session/                    # Session 管理（核心模块）
│   │   ├── manager.js              # Session 管理器
│   │   ├── store.js                # Session 存储
│   │   ├── loader.js               # Session 加载器
│   │   ├── validator.js            # Session 有效性验证
│   │   └── refresher.js            # Session 自动刷新
│   ├── utils/                      # 工具函数
│   │   ├── config.js               # 配置管理
│   │   ├── logger.js               # 日志工具
│   │   ├── crypto.js               # 加密/解密工具
│   │   ├── file-helper.js          # 文件处理
│   │   ├── image-helper.js         # 图片处理
│   │   └── table-helper.js         # 表格显示
│   ├── models/                     # 数据模型
│   │   ├── post.js                 # 帖子模型
│   │   ├── user.js                 # 用户模型
│   │   ├── comment.js              # 评论模型
│   │   └── session.js              # Session 数据模型
│   └── middleware/                 # 中间件
│       ├── auth.middleware.js      # 认证中间件（检查 session）
│       ├── session.middleware.js   # Session 加载中间件
│       └── error.middleware.js     # 错误处理
├── config/
│   ├── default.json                # 默认配置
│   └── schema.json                 # 配置 schema
├── tests/                          # 测试文件
│   ├── unit/                       # 单元测试
│   │   ├── services/               # 服务测试
│   │   ├── session/                # Session 管理测试
│   │   └── commands/               # 命令测试
│   └── integration/                # 集成测试
├── .env.example                    # 环境变量示例
├── .gitignore
├── package.json
└── README.md
```

## 5. 命令行接口设计

### 5.1 基本命令结构

```bash
# 全局安装后
insta [command] [options]

# 或使用 npx
npx instagram-cli [command] [options]
```

### 5.2 阶段一：登录阶段命令

登录阶段负责用户认证和会话建立，所有操作都需要先完成登录。

#### 5.2.1 登录命令

```bash
# 交互式登录（推荐）
insta login
# 提示输入用户名和密码

# 命令行参数登录（不推荐，密码会暴露在 shell 历史）
insta login --username myuser --password mypass

# 使用环境变量登录
INSTAGRAM_USERNAME=myuser INSTAGRAM_PASSWORD=mypass insta login

# 登录特定账户（多账户支持）
insta login --account work
# Session 将保存为 ~/.instagram-cli/session-work.json
```

**登录流程：**
1. 交互式收集用户凭证（隐藏密码输入）
2. 调用 Instagram API 认证
3. 处理双因素认证（如果启用）
4. 生成 Session 数据（cookies, tokens）
5. 加密并保存 Session 到本地
6. 显示登录成功信息和当前用户资料

#### 5.2.2 登出命令

```bash
# 登出当前账户
insta logout

# 登出特定账户
insta logout --account work

# 登出所有账户
insta logout --all
```

#### 5.2.3 Session 管理命令

```bash
# 查看当前登录用户
insta whoami

# 查看所有已保存的 session
insta session list

# 验证 session 有效性
insta session check

# 刷新 session
insta session refresh

# 删除特定 session
insta session remove --account work
```

### 5.3 阶段二：操作阶段命令

操作阶段的所有命令都会自动加载已保存的 session，无需再次登录。

#### 5.3.1 上传功能

```bash
# 上传照片
insta upload photo <file-path> \
  [--caption "文本"] \
  [--location "地点"] \
  [--mentions "@user1,@user2"] \
  [--hashtags "#tag1,#tag2"]

# 上传视频
insta upload video <file-path> \
  [--caption "文本"] \
  [--thumbnail <cover-image>]

# 上传轮播（多张图）
insta upload album <file1,file2,file3> \
  [--caption "文本"]

# Story 上传
insta upload story <file-path> \
  [--mentions "@user1,@user2"] \
  [--links "url1,url2"]
```

#### Feed 查看

```bash
# 查看自己的 Feed
insta feed me [--limit 20] [--format table|json]

# 查看特定用户的 Feed
insta feed user <username> [--limit 20]

# 查看发现页面
insta feed discover [--limit 20]

# 查看特定帖子详情
insta post <post-id>
```

#### 评论功能

```bash
# 查看评论
insta comment list <post-id> [--limit 50]

# 发布评论
insta comment add <post-id> "评论内容"

# 回复评论
insta comment reply <post-id> <comment-id> "回复内容"

# 删除评论
insta comment delete <post-id> <comment-id>
```

#### Story 功能

```bash
# 查看 Stories
insta story list [--username <user>] [--type user|tray]

# 查看 Story 详情
insta story view <story-id>

# 标记 Story 为已看
insta story seen <story-id>
```

#### 用户功能

```bash
# 查看用户信息
insta user info <username>

# 查看关注者
insta user followers <username> [--limit 100]

# 查看关注列表
insta user following <username> [--limit 100]

# 关注用户
insta user follow <username>

# 取消关注
insta user unfollow <username>

# 搜索用户
insta user search <query> [--limit 20]
```

#### 统计功能

```bash
# 查看账户统计
insta stats account

# 查看帖子统计
insta stats posts [--days 30]

# 导出数据
insta stats export [--format json|csv] [--output file]
```

#### 配置管理

```bash
# 设置配置
insta config set <key> <value>

# 查看配置
insta config get [key]

# 重置配置
insta config reset
```

### 5.3 选项说明

**全局选项:**
- `-v, --version`: 显示版本号
- `-h, --help`: 显示帮助信息
- `--debug`: 启用调试模式
- `--no-color`: 禁用彩色输出
- `--api-mode <private|official>`: 选择 API 模式

**通用选项:**
- `--format <table|json|csv>`: 输出格式
- `--limit <number>`: 限制数量
- `--output <file>`: 输出到文件
- `--config <file>`: 指定配置文件

## 6. 核心模块设计

### 6.1 Session 管理模块 (核心)

Session 管理是两阶段架构的核心，负责 session 的创建、存储、验证、刷新和加载。

#### 6.1.1 Session Manager (session/manager.js)

```javascript
class SessionManager {
  // 创建新 session（登录时调用）
  async createSession(credentials)

  // 保存 session 到文件
  async saveSession(sessionData, accountName)

  // 加载 session
  async loadSession(accountName = 'default')

  // 删除 session
  async deleteSession(accountName)

  // 验证 session 有效性
  async validateSession(session)

  // 刷新过期的 session
  async refreshSession(session)

  // 获取所有 session
  async listSessions()

  // 检查 session 是否需要刷新
  shouldRefreshSession(session)

  // 加密 session 数据
  encryptSession(sessionData)

  // 解密 session 数据
  decryptSession(encryptedData)
}
```

#### 6.1.2 Session Store (session/store.js)

```javascript
class SessionStore {
  // 保存 session 到文件系统
  async save(accountName, sessionData)

  // 读取 session
  async load(accountName)

  // 删除 session
  async delete(accountName)

  // 检查 session 是否存在
  async exists(accountName)

  // 获取所有 session 账户名
  async listAccounts()

  // 获取 session 文件路径
  getSessionPath(accountName)

  // 确保 session 目录存在
  ensureSessionDir()
}
```

#### 6.1.3 Session Validator (session/validator.js)

```javascript
class SessionValidator {
  // 验证 session 是否有效
  async validate(session)

  // 检查 session 是否过期
  isExpired(session)

  // 检查 session 结构是否完整
  isValidStructure(session)

  // 测试 session 是否能正常调用 API
  async testSession(session)

  // 获取 session 剩余有效时间
  getTimeToExpire(session)
}
```

#### 6.1.4 Session Refresher (session/refresher.js)

```javascript
class SessionRefresher {
  // 刷新 session
  async refresh(session)

  // 启动自动刷新定时任务
  startAutoRefresh(accountName)

  // 停止自动刷新
  stopAutoRefresh(accountName)

  // 计算下次刷新时间
  calculateNextRefresh(session)

  // 处理刷新失败
  handleRefreshFailure(error)
}
```

#### 6.1.5 Session 数据模型

```javascript
{
  // 账户信息
  account: {
    username: String,
    userId: String,
    fullName: String
  },

  // 认证数据
  auth: {
    cookies: Array,              // Instagram cookies
    csrfToken: String,           // CSRF token
    sessionId: String,           // Session ID
    authToken: String,           // 认证 token
    deviceId: String             // 设备 ID
  },

  // 时间信息
  timestamps: {
    createdAt: Date,             // 创建时间
    expiresAt: Date,             // 过期时间
    lastRefreshedAt: Date,       // 最后刷新时间
    lastUsedAt: Date             // 最后使用时间
  },

  // 状态
  status: {
    isValid: Boolean,            // 是否有效
    needsRefresh: Boolean,       // 是否需要刷新
    lastError: String            // 最后的错误信息
  },

  // 元数据
  metadata: {
    version: String,             // Session schema 版本
    accountName: String,         // 账户名称（多账户）
    platform: String             // 平台信息
  }
}
```

### 6.2 认证模块 (auth.service.js)

阶段一：认证模块负责用户登录和 session 创建。

```javascript
class AuthService {
  // 登录并创建 session
  async login(username, password, accountName)

  // 处理双因素认证
  async handleTwoFactor(username, password, twoFactorCode)

  // 登出并清理 session
  async logout(accountName)

  // 获取当前用户信息
  async getCurrentUser(session)

  // 验证凭证
  async verifyCredentials(username, password)

  // 通过 session 恢复登录（快速登录）
  async loginFromSession(accountName)
}
```

### 6.3 中间件模块

#### 6.3.1 Session 加载中间件 (session.middleware.js)

```javascript
// 阶段二：所有操作命令都需要通过此中间件加载 session
async function sessionLoader(req, res, next) {
  try {
    // 1. 确定要使用的账户
    const accountName = req.options.account || 'default'

    // 2. 加载 session
    const session = await sessionManager.loadSession(accountName)

    // 3. 验证 session 有效性
    const isValid = await sessionValidator.validate(session)

    if (!isValid) {
      // 尝试刷新 session
      const refreshed = await sessionManager.refreshSession(session)
      if (!refreshed) {
        throw new Error('Session 已过期，请重新登录')
      }
    }

    // 4. 将 session 附加到请求对象
    req.session = session
    req.accountName = accountName

    next()
  } catch (error) {
    // Session 不存在或无效
    console.error('认证失败，请先登录: insta login')
    process.exit(1)
  }
}
```

#### 6.3.2 认证中间件 (auth.middleware.js)

```javascript
// 检查用户是否已登录
async function requireAuth(req, res, next) {
  if (!req.session) {
    console.error('未登录，请先执行: insta login')
    process.exit(1)
  }
  next()
}
```

### 6.4 阶段二：业务服务模块

阶段二的所有业务服务都接收已加载的 session 作为参数。

#### 6.4.1 上传模块 (upload.service.js)

```javascript
class UploadService {
  // 上传照片
  async uploadPhoto(options)

  // 上传视频
  async uploadVideo(options)

  // 上传相册
  async uploadAlbum(options)

  // 上传 Story
  async uploadStory(options)

  // 图片预处理
  async preprocessImage(imagePath)

  // 视频预处理
  async preprocessVideo(videoPath)

  // 生成上传配置
  generateUploadConfig(options)
}
```

### 6.3 Feed 模块 (feed.service.js)

```javascript
class FeedService {
  // 获取用户 Feed
  async getUserFeed(username, options)

  // 获取自己的 Feed
  async getMyFeed(options)

  // 获取发现 Feed
  async getDiscoverFeed(options)

  // 获取帖子详情
  async getPostDetails(postId)

  // 点赞/取消点赞
  async likePost(postId)
  async unlikePost(postId)

  // 保存帖子
  async savePost(postId)
}
```

### 6.4 评论模块 (comment.service.js)

```javascript
class CommentService {
  // 获取评论列表
  async getComments(postId, options)

  // 发布评论
  async addComment(postId, text)

  // 回复评论
  async replyComment(postId, commentId, text)

  // 删除评论
  async deleteComment(postId, commentId)

  // 点赞评论
  async likeComment(commentId)

  // 获取评论回复
  async getReplies(commentId, options)
}
```

### 6.5 交互式 Shell 模块

```javascript
class InteractiveShell {
  // 启动交互式 shell
  async start()

  // 处理用户输入
  async handleInput(input)

  // 显示提示符
  displayPrompt()

  // 执行命令
  async executeCommand(command)

  // 自动补全
  autocomplete()

  // 命令历史
  history()

  // 退出 shell
  exit()
}
```

## 7. 两阶段使用流程

### 7.1 完整工作流程

```
┌─────────────────────────────────────────────────────────────┐
│                   首次使用流程                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. 安装工具                                                 │
│     $ npm install -g instagram-cli                          │
│                                                             │
│  2. 登录（阶段一）                                           │
│     $ insta login                                          │
│     ? Username: myusername                                  │
│     ? Password: ********                                    │
│     ✓ 登录成功！Session 已保存                               │
│                                                             │
│  3. 执行操作（阶段二）                                       │
│     $ insta upload photo ./pic.jpg --caption "测试"         │
│     $ insta feed me --limit 10                              │
│     $ insta comment list ABC123                             │
│                                                             │
│  4. 查看状态                                                │
│     $ insta whoami                                          │
│     $ insta session check                                   │
│                                                             │
│  5. 登出（可选）                                             │
│     $ insta logout                                          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 7.2 Session 自动管理

```bash
# 每次执行操作命令时，自动执行以下流程：

$ insta upload photo ./pic.jpg
  ↓
[中间件自动执行]
  ↓
1. 检查本地是否存在 session
2. 加载 session
3. 验证 session 有效性
4. 如果过期，尝试自动刷新
5. 刷新成功 → 继续执行
6. 刷新失败 → 提示重新登录
  ↓
[执行上传命令]
```

### 7.3 交互式 Shell 模式

```bash
# 启动交互式 shell（一次性登录，多次操作）

$ insta shell
  ↓
✓ 已加载 session: @myusername
insta>
  ↓
# 在 shell 中执行命令（无需重新认证）

insta> upload photo ./pic1.jpg --caption "照片1"
✓ 上传成功

insta> upload photo ./pic2.jpg --caption "照片2"
✓ 上传成功

insta> feed me --limit 5
... 显示 feed ...

insta> exit
✓ 已退出
```

### 7.4 多账户管理

```bash
# 登录多个账户
$ insta login --account personal
? Username: personal_user
✓ 已保存 session: personal

$ insta login --account work
? Username: work_user
✓ 已保存 session: work

# 查看所有 session
$ insta session list
  • personal (personal_user)
  • work (work_user)

# 使用特定账户执行操作
$ insta upload photo ./pic.jpg --account work
# 使用 work 账户上传

$ insta feed me --account personal
# 使用 personal 账户查看 feed

# 切换默认账户
$ insta session use work
# work 现在是默认账户
```

## 8. 数据模型设计

### 8.1 Session 模型 (已在 6.1.5 定义)

### 8.2 帖子模型 (Post)

```javascript
{
  id: String,                    // 帖子 ID
  type: 'photo' | 'video' | 'carousel',
  caption: String,                // 标题
  mediaUrls: [String],            // 媒体 URL 列表
  thumbnailUrl: String,           // 缩略图 URL
  likesCount: Number,             // 点赞数
  commentsCount: Number,          // 评论数
  location: {                     // 位置信息
    name: String,
    latitude: Number,
    longitude: Number
  },
  mentions: [String],             // @ 提及的用户
  hashtags: [String],             // # 话题标签
  createdAt: Date,                // 创建时间
  updatedAt: Date,                // 更新时间
  user: {                         // 作者信息
    id: String,
    username: String,
    fullName: String,
    profilePicUrl: String
  },
  isLiked: Boolean,               // 是否已点赞
  isSaved: Boolean                // 是否已保存
}
```

### 7.2 用户模型 (User)

```javascript
{
  id: String,
  username: String,
  fullName: String,
  biography: String,
  profilePicUrl: String,
  profilePicUrlHd: String,
  website: String,
  isPrivate: Boolean,
  isVerified: Boolean,
  followersCount: Number,
  followingCount: Number,
  postsCount: Number,
  media: [Post],                  // 最近帖子
  createdAt: Date
}
```

### 7.3 评论模型 (Comment)

```javascript
{
  id: String,
  postId: String,
  text: String,
  likesCount: Number,
  createdAt: Date,
  user: {
    id: String,
    username: String,
    profilePicUrl: String
  },
  replies: [Comment]              // 子评论（回复）
}
```

## 9. 配置管理

### 9.1 配置文件结构 (config/default.json)

```json
{
  "api": {
    "mode": "private",
    "timeout": 30000,
    "retries": 3
  },
  "session": {
    "dir": "~/.instagram-cli/sessions",
    "defaultAccount": "default",
    "encryption": {
      "enabled": true,
      "algorithm": "aes-256-gcm",
      "keyLength": 32
    },
    "autoRefresh": {
      "enabled": true,
      "interval": 3600000,
      "beforeExpire": 300000
    },
    "validation": {
      "onLoad": true,
      "onUse": false
    },
    "persistence": {
      "autoSave": true,
      "backup": {
        "enabled": true,
        "maxBackups": 5
      }
    }
  },
  "auth": {
    "twoFactor": {
      "enabled": true,
      "method": "sms"
    },
    "passwordPrompt": {
      "hidden": true,
      "confirm": false
    }
  },
  "upload": {
    "maxPhotoSize": 10485760,
    "maxVideoSize": 52428800,
    "supportedFormats": ["jpg", "jpeg", "png", "mp4", "mov"],
    "autoResize": true,
    "maxWidth": 1080,
    "maxHeight": 1080
  },
  "display": {
    "dateFormat": "YYYY-MM-DD HH:mm:ss",
    "tableStyle": "sharp",
    "colorEnabled": true
  },
  "cache": {
    "enabled": true,
    "path": "~/.instagram-cli/cache",
    "ttl": 86400000
  },
  "logging": {
    "level": "info",
    "file": "~/.instagram-cli/logs/app.log",
    "maxFiles": 7
  },
  "shell": {
    "historySize": 1000,
    "autocomplete": true,
    "syntaxHighlighting": true
  }
}
```

### 9.2 环境变量 (.env)

```bash
# Instagram 凭证（不推荐硬编码）
INSTAGRAM_USERNAME=your_username
INSTAGRAM_PASSWORD=your_password

# Official API 配置（如果使用官方 API）
INSTAGRAM_APP_ID=your_app_id
INSTAGRAM_APP_SECRET=your_app_secret
INSTAGRAM_REDIRECT_URI=http://localhost:3000/callback

# API 配置
API_MODE=private
API_TIMEOUT=30000

# 代理设置（可选）
HTTP_PROXY=http://proxy.example.com:8080
HTTPS_PROXY=http://proxy.example.com:8080
```

## 9. 错误处理

### 9.1 错误类型定义

```javascript
// 错误类型
const ErrorTypes = {
  AUTH_ERROR: 'AuthenticationError',
  NETWORK_ERROR: 'NetworkError',
  API_ERROR: 'APIError',
  FILE_ERROR: 'FileError',
  VALIDATION_ERROR: 'ValidationError',
  RATE_LIMIT_ERROR: 'RateLimitError'
}

// 错误处理类
class CLIError extends Error {
  constructor(type, message, details) {
    super(message)
    this.type = type
    this.details = details
  }
}
```

### 9.2 错误处理策略

- **认证错误**: 提示重新登录
- **网络错误**: 自动重试（最多3次）
- **API 限流**: 等待后重试
- **文件错误**: 提供明确的错误信息
- **验证错误**: 显示输入要求

## 10. 安全考虑

### 10.1 密码安全
- 不在命令行直接传递密码
- 使用交互式输入密码（隐藏显示）
- Session 信息加密存储
- 支持 2FA（双因素认证）

### 10.2 API 限流
- 实现请求速率限制
- 遵守 Instagram API 限制
- 自动退避策略

### 10.3 数据隐私
- 不上传敏感数据
- 本地缓存加密
- Session 安全存储

## 11. 测试策略

### 11.1 单元测试
- 使用 Jest 或 Mocha
- 测试所有 service 方法
- Mock API 响应

### 11.2 集成测试
- 端到端测试
- 使用测试账户
- 测试关键流程

### 11.3 手动测试
- 在沙盒环境测试
- 使用测试账户
- 避免频繁操作

## 12. 部署与发布

### 12.1 NPM 发布

```json
{
  "name": "instagram-cli",
  "version": "1.0.0",
  "description": "Instagram command-line interface tool",
  "main": "bin/insta.js",
  "bin": {
    "insta": "./bin/insta.js"
  },
  "keywords": ["instagram", "cli", "social-media"],
  "author": "Your Name",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/username/instagram-cli.git"
  }
}
```

### 12.2 安装方式

```bash
# 全局安装
npm install -g instagram-cli

# 或使用 npx（无需安装）
npx instagram-cli [command]
```

## 13. 使用示例

### 13.1 基本使用

```bash
# 1. 首次登录
insta login
# 交互式输入用户名和密码

# 2. 上传照片
insta upload photo ./photo.jpg --caption "美好的一天 ☀️"

# 3. 查看 Feed
insta feed me --limit 10

# 4. 查看评论
insta comment list ABC123 --limit 20

# 5. 发布评论
insta comment add ABC123 "太棒了！"

# 6. 查看统计
insta stats account
```

### 13.2 高级用法

```bash
# 批量上传（使用脚本）
for file in photos/*.jpg; do
  insta upload photo "$file" --caption "日常分享"
done

# 定时上传（使用 cron）
0 9 * * * insta upload photo ./morning.jpg --caption "早安"

# 数据导出
insta stats posts --days 30 --format csv --output report.csv
```

## 14. 开发路线图

### Phase 1: MVP (最小可行产品)
- [ ] 基础认证功能
- [ ] 照片上传
- [ ] Feed 查看
- [ ] 基本评论功能

### Phase 2: 核心功能
- [ ] 视频上传
- [ ] 相册/轮播
- [ ] Story 功能
- [ ] 用户关注功能

### Phase 3: 高级功能
- [ ] 数据统计
- [ ] 批量操作
- [ ] 定时发布
- [ ] 数据导出

### Phase 4: 优化
- [ ] 性能优化
- [ ] 错误处理完善
- [ ] 文档完善
- [ ] 测试覆盖

## 15. 常见问题 (FAQ)

**Q: 是否违反 Instagram 服务条款？**
A: 使用 Private API 可能违反服务条款，建议仅用于个人学习和测试，不要用于商业用途。

**Q: 账户会被封禁吗？**
A: 频繁使用可能被检测为异常行为，建议：
- 限制操作频率
- 不要自动化大规模操作
- 使用专用测试账户

**Q: 是否支持 2FA？**
A: 支持，将在后续版本实现。

**Q: 能否同时管理多个账户？**
A: 可以通过配置文件切换不同账户的 session。

## 16. 参考资料

- [Instagram Basic Display API](https://developers.facebook.com/docs/instagram-basic-display-api)
- [Instagram Graph API](https://developers.facebook.com/docs/instagram-api)
- [instagram-private-api](https://github.com/dilame/instagram-private-api)
- [Commander.js 文档](https://github.com/tj/commander.js)
- [Inquirer.js 文档](https://github.com/SBoudrias/Inquirer.js)

## 17. 许可证

MIT License - 仅供学习研究使用

---

**注意**: 本工具仅供学习和个人使用。使用时请遵守 Instagram 服务条款和相关法律法规。作者不对因使用本工具导致的任何问题负责。
