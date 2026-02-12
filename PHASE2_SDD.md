# 🎯 阶段二：操作阶段 - Software Design Document

## 📋 文档信息

- **版本**: 1.0.0
- **日期**: 2026-02-10
- **作者**: Claude
- **状态**: 草稿 - 待确认

---

## 1. 概述

### 1.1 目标

在阶段一（登录认证）完成的基础上，实现Instagram的核心操作功能，使用户能够通过CLI完成日常Instagram操作。

### 1.2 范围

阶段二包含以下核心功能模块：

1. **内容上传** - 照片/视频上传到Instagram
2. **Feed管理** - 查看主页Feed、搜索内容
3. **评论系统** - 查看、发布、删除评论
4. **用户管理** - 关注/取关、查看用户资料
5. **Story功能** - 上传和查看Story
6. **数据统计** - 账号数据分析

### 1.3 设计原则

- ✅ **简单优先** - 先实现核心功能，再扩展高级特性
- ✅ **TDD开发** - 测试驱动开发，先写测试再实现
- ✅ **错误友好** - 清晰的错误信息和恢复建议
- ✅ **渐进增强** - 基础功能→高级功能→优化

---

## 2. 架构设计

### 2.1 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                        CLI Interface                        │
│                    (Commander + Inquirer)                   │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                      Command Layer                          │
│  ┌──────────┬──────────┬──────────┬──────────┬──────────┐  │
│  │  Upload  │  Feed    │ Comment  │  User    │  Story   │  │
│  │ Commands │ Commands │ Commands │ Commands │ Commands │  │
│  └──────────┴──────────┴──────────┴──────────┴──────────┘  │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                    Service Layer                            │
│  ┌──────────┬──────────┬──────────┬──────────┬──────────┐  │
│  │  Media   │   Feed   │ Comment  │  User    │  Story   │  │
│  │ Service  │ Service  │ Service  │ Service  │ Service  │  │
│  └──────────┴──────────┴──────────┴──────────┴──────────┘  │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                     API Layer                               │
│              (instagram-private-api)                        │
│  ┌──────────┬──────────┬──────────┬──────────┬──────────┐  │
│  │  Upload  │   Feed   │ Comment  │  User    │  Story   │  │
│  │    API   │   API    │   API    │   API    │   API    │  │
│  └──────────┴──────────┴──────────┴──────────┴──────────┘  │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                   Session Manager                           │
│              (from Phase 1)                                 │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
                    [Instagram]
```

### 2.2 目录结构

```
src/
├── commands/
│   ├── media.ts           # 媒体上传命令
│   ├── feed.ts            # Feed相关命令
│   ├── comment.ts         # 评论相关命令
│   ├── user.ts            # 用户相关命令
│   ├── story.ts           # Story相关命令
│   └── analytics.ts       # 统计分析命令
│
├── services/
│   ├── media.service.ts   # 媒体上传服务
│   ├── feed.service.ts    # Feed服务
│   ├── comment.service.ts # 评论服务
│   ├── user.service.ts    # 用户服务
│   ├── story.service.ts   # Story服务
│   └── analytics.service.ts # 统计服务
│
├── api/
│   ├── instagram.client.ts # Instagram API客户端
│   └── api.wrapper.ts      # API封装和错误处理
│
├── models/
│   ├── media.types.ts      # 媒体相关类型定义
│   ├── feed.types.ts       # Feed相关类型定义
│   └── comment.types.ts    # 评论相关类型定义
│
└── utils/
    ├── media.helpers.ts    # 媒体处理工具
    ├── validators.ts       # 输入验证
    └── formatters.ts       # 输出格式化
```

---

## 3. 功能模块详细设计

### 3.1 模块1：媒体上传 (Media Upload)

#### 3.1.1 功能描述
- 上传照片到Instagram
- 上传视频到Instagram
- 支持添加caption
- 支持添加位置
- 支持标签用户

#### 3.1.2 CLI命令

```bash
# 上传照片
insta photo upload <file> [options]

# 上传视频
insta video upload <file> [options]

# 选项：
  -c, --caption <text>      添加说明文字
  -l, --location <place>    添加位置
  -t, --tag <user>          @提及用户（可多个）
  --first-comment <text>    首条评论
  --schedule <time>         定时发布
```

#### 3.1.3 使用示例

```bash
# 基础上传
insta photo upload photo.jpg

# 带说明上传
insta photo upload photo.jpg -c "Beautiful sunset!"

# 完整选项
insta photo upload photo.jpg \
  -c "Amazing view at #paris" \
  -l "Paris, France" \
  -t @john \
  --first-comment "What do you think?"

# 上传视频
insta video upload video.mp4 -c "My new vlog!"
```

#### 3.1.4 数据流

```
[用户输入] → [验证文件] → [处理媒体] → [上传Instagram] → [返回结果]
    │            │             │              │              │
    │            ▼             ▼              ▼              ▼
  文件路径     检查存在      调整大小       API调用      显示URL
              检查格式      压缩质量                      媒体ID
              检查大小      生成缩略图
```

#### 3.1.5 Service接口

```typescript
interface MediaService {
  uploadPhoto(params: {
    file: string;
    caption?: string;
    location?: string;
    taggedUsers?: string[];
    firstComment?: string;
  }): Promise<UploadResult>;

  uploadVideo(params: {
    file: string;
    caption?: string;
    thumbnail?: string;
    location?: string;
  }): Promise<UploadResult>;

  deleteMedia(mediaId: string): Promise<void>;
}
```

---

### 3.2 模块2：Feed管理 (Feed Management)

#### 3.2.1 功能描述
- 查看主页Feed
- 搜索hashtag
- 搜索用户
- 查看趋势内容

#### 3.2.2 CLI命令

```bash
# 查看主页Feed
insta feed [options]

# 按标签搜索
insta feed hashtag <tag> [options]

# 搜索用户
insta feed user <username> [options]

# 选项：
  -n, --count <number>      显示数量（默认：20）
  -o, --offset <number>     跳过前N条
  --json                    输出JSON格式
```

#### 3.2.3 使用示例

```bash
# 查看最新Feed
insta feed

# 查看50条
insta feed -n 50

# 搜索标签
insta feed hashtag travel

# 查看特定用户帖子
insta feed user nationalgeographic
```

#### 3.2.4 数据模型

```typescript
interface FeedItem {
  id: string;
  type: 'photo' | 'video' | 'carousel';
  caption?: string;
  imageUrl: string;
  videoUrl?: string;
  likesCount: number;
  commentsCount: number;
  timestamp: Date;
  author: {
    username: string;
    fullName: string;
    profilePicUrl: string;
  };
}
```

---

### 3.3 模块3：评论系统 (Comments)

#### 3.3.1 功能描述
- 查看帖子评论
- 发布评论
- 删除自己的评论
- 回复评论

#### 3.3.2 CLI命令

```bash
# 查看评论
insta comments <media-id> [options]

# 发布评论
insta comment post <media-id> <text>

# 删除评论
insta comment delete <comment-id>

# 回复评论
insta comment reply <comment-id> <text>

# 选项：
  -n, --count <number>      显示数量
```

#### 3.3.3 使用示例

```bash
# 查看评论
insta comments ABC_123

# 发布评论
insta comment post ABC_123 "Great shot! 📸"

# 回复评论
insta comment reply XYZ_789 "Thanks!"

# 删除评论
insta comment delete CMT_456
```

---

### 3.4 模块4：用户管理 (User Management)

#### 3.4.1 功能描述
- 关注用户
- 取关用户
- 查看用户资料
- 查看粉丝列表
- 查看关注列表

#### 3.4.2 CLI命令

```bash
# 查看用户资料
insta user profile <username>

# 关注用户
insta user follow <username>

# 取关用户
insta user unfollow <username>

# 查看粉丝
insta user followers [username]

# 查看关注
insta user following [username]
```

#### 3.4.3 使用示例

```bash
# 查看资料
insta user profile john

# 关注
insta user follow john

# 取关
insta user unfollow john

# 查看粉丝列表
insta user followers john
```

---

### 3.5 模块5：Story功能 (Stories)

#### 3.5.1 功能描述
- 上传照片Story
- 上传视频Story
- 查看用户的Story

#### 3.5.2 CLI命令

```bash
# 上传Story
insta story upload <file> [options]

# 查看Story
insta story view <username>

# 选项：
  -c, --caption <text>      添加文字/贴纸
  -t, --duration <seconds>  显示时长（图片）
```

#### 3.5.3 使用示例

```bash
# 上传照片Story
insta story upload photo.jpg

# 上传带文字的Story
insta story upload photo.jpg -c "Good morning!"

# 查看某人的Story
insta story view john
```

---

### 3.6 模块6：数据分析 (Analytics)

#### 3.6.1 功能描述
- 查看账号统计
- 查看帖子表现
- 导出数据

#### 3.6.2 CLI命令

```bash
# 账号统计
insta stats account

# 帖子分析
insta stats post <media-id>

# 导出数据
insta stats export [options]

# 选项：
  --format <json|csv>       导出格式
  --output <file>           输出文件
```

---

## 4. API层设计

### 4.1 Instagram API客户端

```typescript
class InstagramClient {
  private session: SessionData;

  constructor(session: SessionData);

  // Media API
  async uploadPhoto(options: PhotoUploadOptions): Promise<MediaUploadResult>;
  async uploadVideo(options: VideoUploadOptions): Promise<MediaUploadResult>;

  // Feed API
  async getFeed(options?: FeedOptions): Promise<FeedItem[]>;
  async getHashtagFeed(tag: string): Promise<FeedItem[]>;
  async getUserFeed(username: string): Promise<FeedItem[]>;

  // Comment API
  async getComments(mediaId: string): Promise<Comment[]>;
  async addComment(mediaId: string, text: string): Promise<Comment>;
  async deleteComment(commentId: string): Promise<void>;

  // User API
  async getUserProfile(username: string): Promise<UserProfile>;
  async follow(userId: string): Promise<void>;
  async unfollow(userId: string): Promise<void>;
  async getFollowers(userId: string): Promise<User[]>;
  async getFollowing(userId: string): Promise<User[]>;

  // Story API
  async uploadStory(options: StoryUploadOptions): Promise<void>;
  async getUserStories(userId: string): Promise<Story[]>;

  // 错误处理
  private handleError(error: any): never;
}
```

### 4.2 错误处理策略

```typescript
class InstagramApiError extends Error {
  code: string;
  retryable: boolean;

  constructor(message: string, code: string, retryable: boolean = false);
}

// 错误类型
enum ErrorCode {
  SESSION_EXPIRED = 'SESSION_EXPIRED',
  RATE_LIMITED = 'RATE_LIMITED',
  INVALID_MEDIA = 'INVALID_MEDIA',
  NETWORK_ERROR = 'NETWORK_ERROR',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
}
```

---

## 5. 实现计划

### Phase 2.1 - 核心功能（优先级：高）

**Week 1: 基础设施**
- [ ] 搭建API层（instagram-private-api集成）
- [ ] 实现InstagramClient
- [ ] 添加错误处理机制
- [ ] 编写API层测试

**Week 2-3: 媒体上传**
- [ ] 实现照片上传功能
- [ ] 实现视频上传功能
- [ ] 媒体处理工具（压缩、调整大小）
- [ ] 完整的上传测试套件

**Week 3-4: Feed和评论**
- [ ] 实现Feed查看功能
- [ ] 实现hashtag搜索
- [ ] 实现评论CRUD
- [ ] 用户资料查看

### Phase 2.2 - 高级功能（优先级：中）

**Week 5-6: 用户和Story**
- [ ] 关注/取关功能
- [ ] 粉丝列表查看
- [ ] Story上传
- [ ] Story查看

**Week 7: 数据分析**
- [ ] 账号统计
- [ ] 帖子分析
- [ ] 数据导出

### Phase 2.3 - 优化和完善（优先级：低）

**Week 8:**
- [ ] 性能优化
- [ ] 错误信息改进
- [ ] 文档完善
- [ ] 示例和教程

---

## 6. 测试策略

### 6.1 测试金字塔

```
       ┌────────────┐
       │  E2E测试   │  少量关键流程
       ├────────────┤
       │ 集成测试   │  API交互测试
       ├────────────┤
       │  单元测试   │  大量业务逻辑
       └────────────┘
```

### 6.2 测试覆盖率目标

- **单元测试**: ≥ 80%
- **集成测试**: ≥ 60%
- **关键流程**: 100%

### 6.3 测试用例示例

```typescript
describe('MediaService', () => {
  describe('uploadPhoto', () => {
    it('should upload a valid photo file', async () => {
      const result = await mediaService.uploadPhoto({
        file: 'test/fixtures/photo.jpg',
        caption: 'Test photo'
      });
      expect(result.mediaId).toBeDefined();
      expect(result.url).toContain('instagram.com');
    });

    it('should reject non-image files', async () => {
      await expect(
        mediaService.uploadPhoto({ file: 'test.doc' })
      ).rejects.toThrow('Invalid media format');
    });

    it('should handle network errors gracefully', async () => {
      // Mock network failure
      await expect(
        mediaService.uploadPhoto({ file: 'photo.jpg' })
      ).rejects.toThrow(InstagramApiError);
    });
  });
});
```

---

## 7. 依赖更新

### 7.1 新增依赖

```json
{
  "dependencies": {
    "instagram-private-api": "^1.0.0",  // Instagram API
    "sharp": "^0.33.0",                 // 图片处理
    "ffprobe": "^1.0.0",                // 视频信息
    "axios": "^1.6.0",                  // HTTP客户端
    "form-data": "^4.0.0"               // 文件上传
  },
  "devDependencies": {
    "@types/sharp": "^0.33.0",
    "@types/axios": "^1.6.0"
  }
}
```

---

## 8. 配置和常量

### 8.1 配置文件

```typescript
// src/config/media.config.ts
export const MEDIA_CONFIG = {
  PHOTO: {
    MAX_SIZE: 10 * 1024 * 1024,  // 10MB
    SUPPORTED_FORMATS: ['jpg', 'jpeg', 'png', 'webp'],
    MAX_WIDTH: 1080,
    MAX_HEIGHT: 1080,
    QUALITY: 85
  },
  VIDEO: {
    MAX_SIZE: 100 * 1024 * 1024,  // 100MB
    SUPPORTED_FORMATS: ['mp4', 'mov'],
    MAX_DURATION: 60,  // seconds
    MAX_WIDTH: 1080,
    MAX_HEIGHT: 1920
  }
};
```

---

## 9. 输出格式设计

### 9.1 表格输出

```bash
$ insta feed

┌─────────────────────────────────────────────────────────┐
│  Recent Feed                                             │
├─────────────────────────────────────────────────────────┤
│  📸 @john_doe                                           │
│  Beautiful sunset at the beach! 🌅                      │
│  ❤️ 1,234  💬 56  👀 3,456                             │
│  https://instagram.com/p/ABC123/                        │
├─────────────────────────────────────────────────────────┤
│  📸 @jane_smith                                         │
│  Morning coffee vibes ☕                                 │
│  ❤️ 892  💬 23  👀 1,234                               │
│  https://instagram.com/p/DEF456/                        │
└─────────────────────────────────────────────────────────┘
```

### 9.2 JSON输出

```bash
$ insta feed --json
{
  "items": [
    {
      "id": "ABC123",
      "author": "john_doe",
      "caption": "Beautiful sunset!",
      "likes": 1234,
      "comments": 56,
      "url": "https://instagram.com/p/ABC123/"
    }
  ]
}
```

---

## 10. 性能考虑

### 10.1 优化策略

- **并发控制**: 限制同时上传数量
- **缓存策略**: 缓存用户资料信息
- **流式处理**: 大文件分块上传
- **进度显示**: 长时间操作显示进度条

### 10.2 限流处理

```typescript
class RateLimiter {
  async throttle(): Promise<void>;
  async canProceed(): Promise<boolean>;
}
```

---

## 11. 安全考虑

### 11.1 Session安全

- Session文件权限: `0600`
- 不在日志中显示敏感信息
- Session过期自动刷新

### 11.2 输入验证

- 文件路径验证
- Caption长度限制（2200字符）
- 用户名格式验证
- 防止注入攻击

---

## 12. 用户体验

### 12.1 交互式输入

```bash
$ insta photo upload

? Select photo: (use arrow keys)
❯ photo1.jpg
  photo2.jpg
  photo3.png

? Add a caption: Beautiful sunset!

? Add location?
❯ No
  Yes

✅ Uploading...
█████████████████████████ 100%

✅ Photo uploaded successfully!
🔗 https://instagram.com/p/ABC123/
```

### 12.2 进度显示

```bash
$ insta video upload video.mp4

📤 Uploading video...
⏳ Processing: ████████████████░░░░ 70% (1.2MB / 1.7MB)
```

---

## 13. 文档计划

### 13.1 用户文档

- `README.md` - 快速开始
- `COMMANDS.md` - 所有命令参考
- `EXAMPLES.md` - 使用示例
- `FAQ.md` - 常见问题

### 13.2 开发文档

- `CONTRIBUTING.md` - 贡献指南
- `ARCHITECTURE.md` - 架构说明
- `API.md` - API文档
- `TESTING.md` - 测试指南

---

## 14. 下一步行动

### ✅ 当前需要确认

1. **功能优先级** - 是否同意上述功能优先级？
2. **技术选型** - instagram-private-api 是否合适？
3. **命令设计** - CLI命令命名是否满意？
4. **实现计划** - 8周计划是否可行？

### 📋 确认后的第一步

1. 搭建API层基础框架
2. 实现InstagramClient
3. 编写第一个功能：照片上传

---

## 15. 附录

### 15.1 参考资料

- [instagram-private-api文档](https://github.com/dilame/instagram-private-api)
- [Instagram官方API](https://developers.facebook.com/docs/instagram)
- [Commander.js文档](https://github.com/tj/commander.js)
- [Inquirer.js文档](https://github.com/SBoudrias/Inquirer.js)

### 15.2 变更历史

| 版本 | 日期 | 变更内容 |
|------|------|---------|
| 1.0.0 | 2026-02-10 | 初始版本 |

---

## 🤔 请确认

请仔细阅读以上SDD文档，并告诉我：

1. ✅ 同意 / ❌ 不同意 - 整体设计方向
2. ✅ 同意 / ❌ 不同意 - 功能模块划分
3. ✅ 同意 / ❌ 不同意 - CLI命令设计
4. ✅ 同意 / ❌ 不同意 - 技术栈选择
5. ✅ 同意 / ❌ 不同意 - 实现优先级
6. 💬 其他建议或修改意见

**确认后我们将立即开始实现！** 🚀
