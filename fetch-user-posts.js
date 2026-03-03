#!/usr/bin/env node

/**
 * Instagram User Posts Fetch Script
 * 在已登录的 Instagram 浏览器会话下，按账号主页 URL 拉取帖子信息
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { createInstagramRequestGuard } = require('./src/services/ig-request-guard');

const SESSION_DIR = path.join(__dirname, '.instagram-cli', 'sessions');
const BROWSER_INFO_FILE = path.join(SESSION_DIR, 'browser-info.json');
const INSTAGRAM_HOME = 'https://www.instagram.com/';
const DEFAULT_DEBUG_PORT = Number(process.env.DEBUG_PORT || 9222);
const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 200;
const IG_WEB_APP_ID = '936619743392459';

function parsePort(value, fallback = null) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    return fallback;
  }
  return parsed;
}

function printUsage() {
  console.log('使用方法: node fetch-user-posts.js <Instagram账号URL|username> [options]');
  console.log('');
  console.log('Options:');
  console.log(`  --limit <n>            返回帖子上限 (默认 ${DEFAULT_LIMIT}，最大 ${MAX_LIMIT})`);
  console.log('  --output <file>        将结果保存为 JSON 文件');
  console.log('  --debug-port <port>    回退连接调试端口 (默认 9222)');
  console.log('  --keep-connected       执行完成后不主动断开浏览器连接');
  console.log('  -h, --help             查看帮助');
  console.log('');
  console.log('示例:');
  console.log('  node fetch-user-posts.js "https://www.instagram.com/nike/"');
  console.log('  node fetch-user-posts.js "nike" --limit 24 --output ./logs/nike-posts.json');
  console.log('  node fetch-user-posts.js "@nike" --debug-port 9333');
}

function parseCliArgs(argv) {
  const options = {
    target: '',
    limit: DEFAULT_LIMIT,
    output: '',
    keepConnected: false,
    debugPort: DEFAULT_DEBUG_PORT,
    help: false,
    error: '',
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '-h' || arg === '--help') {
      options.help = true;
      continue;
    }

    if (arg === '--limit') {
      const value = argv[i + 1];
      if (!value) {
        options.error = '参数 --limit 缺少值';
        return options;
      }
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_LIMIT) {
        options.error = `limit 必须是 1~${MAX_LIMIT} 的整数`;
        return options;
      }
      options.limit = parsed;
      i += 1;
      continue;
    }

    if (arg.startsWith('--limit=')) {
      const parsed = Number(arg.slice('--limit='.length));
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_LIMIT) {
        options.error = `limit 必须是 1~${MAX_LIMIT} 的整数`;
        return options;
      }
      options.limit = parsed;
      continue;
    }

    if (arg === '--output' || arg === '--json') {
      const value = argv[i + 1];
      if (!value) {
        options.error = '参数 --output 缺少文件路径';
        return options;
      }
      options.output = value;
      i += 1;
      continue;
    }

    if (arg.startsWith('--output=')) {
      options.output = arg.slice('--output='.length);
      continue;
    }

    if (arg === '--debug-port') {
      const value = argv[i + 1];
      if (!value) {
        options.error = '参数 --debug-port 缺少值';
        return options;
      }
      const parsed = parsePort(value, null);
      if (!parsed) {
        options.error = 'debug-port 必须是有效端口号';
        return options;
      }
      options.debugPort = parsed;
      i += 1;
      continue;
    }

    if (arg.startsWith('--debug-port=')) {
      const parsed = parsePort(arg.slice('--debug-port='.length), null);
      if (!parsed) {
        options.error = 'debug-port 必须是有效端口号';
        return options;
      }
      options.debugPort = parsed;
      continue;
    }

    if (arg === '--keep-connected') {
      options.keepConnected = true;
      continue;
    }

    if (arg.startsWith('-')) {
      options.error = `未知参数: ${arg}`;
      return options;
    }

    if (!options.target) {
      options.target = arg;
      continue;
    }

    options.error = `多余参数: ${arg}`;
    return options;
  }

  return options;
}

function safeReadJsonFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_error) {
    return null;
  }
}

async function connectToExistingBrowserInfo() {
  const browserInfo = safeReadJsonFile(BROWSER_INFO_FILE);
  if (!browserInfo || !browserInfo.webSocketDebuggerUrl) {
    return null;
  }

  console.log('✓ 找到已运行的浏览器实例信息');
  console.log(`  WebSocket URL: ${browserInfo.webSocketDebuggerUrl}`);
  return browserInfo;
}

async function connectBrowser(puppeteer, debugPort) {
  const errors = [];
  const browserInfo = await connectToExistingBrowserInfo();

  if (browserInfo?.webSocketDebuggerUrl) {
    try {
      const browser = await puppeteer.connect({
        browserWSEndpoint: browserInfo.webSocketDebuggerUrl,
        defaultViewport: null,
      });
      console.log('✅ 已通过 WebSocket 连接到浏览器实例\n');
      return browser;
    } catch (error) {
      errors.push(`WebSocket 连接失败: ${error.message}`);
    }
  }

  const browserUrlCandidates = [
    `http://127.0.0.1:${debugPort}`,
    `http://localhost:${debugPort}`,
    `http://[::1]:${debugPort}`,
  ];

  for (const browserURL of browserUrlCandidates) {
    try {
      const browser = await puppeteer.connect({
        browserURL,
        defaultViewport: null,
      });
      console.log(`✅ 已通过 debug-port(${debugPort}) 连接到浏览器实例 (${browserURL})\n`);
      return browser;
    } catch (error) {
      errors.push(`${browserURL} 连接失败: ${error.message}`);
    }
  }

  throw new Error(errors.join(' | '));
}

async function pickInstagramPage(browser) {
  const pages = await browser.pages();

  let page = pages.find((p) => p.url().includes('instagram.com'));
  if (!page) {
    page = pages.find((p) => p.url() && !p.url().startsWith('about:blank'));
  }
  if (!page) {
    page = pages[0] || null;
  }
  if (!page) {
    page = await browser.newPage();
  }

  const currentUrl = page.url();
  console.log(`📄 当前页面: ${currentUrl || 'about:blank'}\n`);

  if (!currentUrl || currentUrl === 'about:blank' || !currentUrl.includes('instagram.com')) {
    console.log('🔄 页面不在 Instagram，导航到主页...\n');
    await page.goto(INSTAGRAM_HOME, {
      waitUntil: 'networkidle2',
      timeout: 60000,
    });
    await new Promise((resolve) => setTimeout(resolve, 1200));
  }

  return page;
}

function normalizeTarget(target) {
  const raw = String(target || '').trim();
  if (!raw) {
    return { error: '缺少账号 URL 或用户名' };
  }

  if (/^@[A-Za-z0-9._]+$/.test(raw)) {
    const username = raw.slice(1);
    return {
      username,
      profileUrl: `${INSTAGRAM_HOME}${username}/`,
    };
  }

  if (/^[A-Za-z0-9._]+$/.test(raw)) {
    return {
      username: raw,
      profileUrl: `${INSTAGRAM_HOME}${raw}/`,
    };
  }

  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  let url;
  try {
    url = new URL(withProtocol);
  } catch (_error) {
    return { error: `无效地址: ${raw}` };
  }

  const host = url.hostname.toLowerCase();
  if (!host.includes('instagram.com')) {
    return { error: `不是 Instagram 地址: ${raw}` };
  }

  const parts = url.pathname.split('/').filter(Boolean);
  if (!parts.length) {
    return { error: `无法从 URL 识别用户名: ${raw}` };
  }

  const username = parts[0];
  if (!/^[A-Za-z0-9._]+$/.test(username)) {
    return { error: `用户名格式不合法: ${username}` };
  }

  return {
    username,
    profileUrl: `${INSTAGRAM_HOME}${username}/`,
  };
}

async function ensureLoggedInAtProfile(page, profileUrl) {
  await page.goto(profileUrl, {
    waitUntil: 'networkidle2',
    timeout: 60000,
  });
  await new Promise((resolve) => setTimeout(resolve, 1500));

  const currentUrl = page.url();
  if (currentUrl.includes('/accounts/login')) {
    throw new Error('当前会话未登录 Instagram，请先运行 node login.js 完成登录');
  }
}

function buildApiHeaders() {
  return {
    'x-requested-with': 'XMLHttpRequest',
    'x-ig-app-id': IG_WEB_APP_ID,
    accept: '*/*',
  };
}

async function fetchJsonInPage(page, apiUrl, requestGuard) {
  const runRequest = async () => page.evaluate(async (url, headers) => {
    try {
      const res = await fetch(url, {
        method: 'GET',
        credentials: 'include',
        headers,
      });
      const text = await res.text();
      let json = null;
      try {
        json = JSON.parse(text);
      } catch (_error) {
        json = null;
      }
      return {
        ok: res.ok,
        status: res.status,
        statusText: res.statusText,
        json,
        textHead: text.slice(0, 280),
      };
    } catch (error) {
      return {
        ok: false,
        status: 0,
        statusText: '',
        json: null,
        textHead: String(error?.message || error || ''),
      };
    }
  }, apiUrl, buildApiHeaders());

  const payload = requestGuard
    ? await requestGuard.run({ url: apiUrl, method: 'GET' }, runRequest)
    : await runRequest();

  if (!payload.ok) {
    const reason = payload.textHead || `${payload.status} ${payload.statusText}`;
    throw new Error(`请求失败(${apiUrl}) status=${payload.status}: ${reason}`);
  }
  if (!payload.json || typeof payload.json !== 'object') {
    throw new Error(`接口返回非 JSON: ${apiUrl}`);
  }

  return payload.json;
}

function parseProfileFromApi(user, profileUrl) {
  const postsCount = Number(user?.media_count) ||
    Number(user?.edge_owner_to_timeline_media?.count) ||
    0;
  const followersCount = Number(user?.follower_count) ||
    Number(user?.edge_followed_by?.count) ||
    0;
  const followingCount = Number(user?.following_count) ||
    Number(user?.edge_follow?.count) ||
    0;
  const bioLinks = Array.isArray(user?.bio_links)
    ? user.bio_links
      .map((item) => String(item?.url || item?.lynx_url || '').trim())
      .filter(Boolean)
    : [];

  return {
    id: String(user?.id || ''),
    url: profileUrl,
    username: String(user?.username || ''),
    fullName: String(user?.full_name || ''),
    biography: String(user?.biography || ''),
    externalUrl: String(user?.external_url || ''),
    bioLinks,
    isPrivate: Boolean(user?.is_private),
    isVerified: Boolean(user?.is_verified),
    postsCount,
    followersCount,
    followingCount,
    profilePicUrl: String(user?.profile_pic_url_hd || user?.profile_pic_url || ''),
  };
}

function mapMediaType(item) {
  const mediaType = Number(item?.media_type);
  if (mediaType === 8) {
    return 'carousel';
  }
  if (mediaType === 2) {
    return 'video';
  }
  return 'image';
}

function resolvePostPathPrefix(item) {
  const productType = String(item?.product_type || '').toLowerCase();
  if (productType === 'clips') {
    return 'reel';
  }
  if (productType === 'igtv') {
    return 'tv';
  }
  return 'p';
}

function pickPrimaryMediaUrl(item) {
  const imageUrl = String(item?.image_versions2?.candidates?.[0]?.url || '');
  const videoUrl = String(item?.video_versions?.[0]?.url || '');
  if (videoUrl) {
    return videoUrl;
  }
  return imageUrl;
}

function extractMediaUrls(item) {
  const out = [];
  const pushIf = (v) => {
    const url = String(v || '').trim();
    if (url && !out.includes(url)) {
      out.push(url);
    }
  };

  if (Array.isArray(item?.carousel_media) && item.carousel_media.length) {
    for (const media of item.carousel_media) {
      pushIf(media?.video_versions?.[0]?.url);
      pushIf(media?.image_versions2?.candidates?.[0]?.url);
    }
    return out;
  }

  pushIf(item?.video_versions?.[0]?.url);
  pushIf(item?.image_versions2?.candidates?.[0]?.url);
  return out;
}

function normalizePost(item, username) {
  const shortcode = String(item?.code || '').trim();
  const mediaType = mapMediaType(item);
  const pathPrefix = resolvePostPathPrefix(item);
  const postUrl = shortcode ? `${INSTAGRAM_HOME}${username}/${pathPrefix}/${shortcode}/` : '';
  const ts = Number(item?.taken_at || 0);
  const caption = String(item?.caption?.text || '').trim();

  return {
    id: String(item?.id || ''),
    pk: String(item?.pk || ''),
    shortcode,
    postUrl,
    mediaType,
    productType: String(item?.product_type || ''),
    caption,
    likeCount: Number(item?.like_count || 0),
    commentCount: Number(item?.comment_count || 0),
    takenAt: ts > 0 ? new Date(ts * 1000).toISOString() : '',
    takenAtUnix: ts > 0 ? ts : 0,
    thumbnailUrl: String(item?.image_versions2?.candidates?.[0]?.url || ''),
    primaryMediaUrl: pickPrimaryMediaUrl(item),
    mediaUrls: extractMediaUrls(item),
    isPinned: Boolean(item?.is_pinned),
    hasAudio: Boolean(item?.has_audio),
    playCount: Number(item?.play_count || 0),
    viewCount: Number(item?.view_count || 0),
  };
}

async function fetchProfileAndPosts(page, username, limit, requestGuard) {
  const profileJson = await fetchJsonInPage(
    page,
    `/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`,
    requestGuard
  );

  const user = profileJson?.data?.user;
  if (!user) {
    throw new Error(`未获取到账号信息: @${username}`);
  }

  const profileUrl = `${INSTAGRAM_HOME}${user.username || username}/`;
  const profile = parseProfileFromApi(user, profileUrl);
  const userId = profile.id;
  if (!userId) {
    throw new Error(`缺少用户 ID: @${profile.username || username}`);
  }

  const allItems = [];
  let maxId = '';
  let pageNo = 0;

  while (allItems.length < limit && pageNo < 40) {
    const remaining = Math.max(1, limit - allItems.length);
    const count = Math.min(12, remaining);
    const query = maxId
      ? `/api/v1/feed/user/${encodeURIComponent(userId)}/?count=${count}&max_id=${encodeURIComponent(maxId)}`
      : `/api/v1/feed/user/${encodeURIComponent(userId)}/?count=${count}`;
    const feedJson = await fetchJsonInPage(page, query, requestGuard);
    const items = Array.isArray(feedJson?.items) ? feedJson.items : [];

    if (!items.length) {
      break;
    }

    allItems.push(...items);
    pageNo += 1;

    const more = Boolean(feedJson?.more_available);
    const nextMaxId = String(feedJson?.next_max_id || '').trim();
    if (!more || !nextMaxId) {
      break;
    }
    maxId = nextMaxId;
  }

  const posts = allItems
    .slice(0, limit)
    .map((item) => normalizePost(item, profile.username || username))
    .filter((post) => post.shortcode);

  return {
    profile,
    posts,
  };
}

function saveResults(data, outputFile) {
  if (!outputFile) {
    return '';
  }

  const absPath = path.isAbsolute(outputFile)
    ? outputFile
    : path.join(process.cwd(), outputFile);

  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, JSON.stringify(data, null, 2));
  return absPath;
}

async function fetchUserPosts(target, options = {}) {
  const puppeteer = options.puppeteer || require('puppeteer');
  const limit = Number.isInteger(options.limit) ? options.limit : DEFAULT_LIMIT;
  const debugPort = parsePort(options.debugPort, DEFAULT_DEBUG_PORT);
  const normalized = normalizeTarget(target);
  if (normalized.error) {
    throw new Error(normalized.error);
  }

  console.log(`🎯 目标账号: @${normalized.username}`);
  console.log(`📌 帖子上限: ${limit}\n`);
  const requestGuard = createInstagramRequestGuard({
    scriptName: 'fetch-user-posts',
  });
  console.log(`🛡️ 请求防护: ${requestGuard.describe()}\n`);

  let browser;
  try {
    browser = await connectBrowser(puppeteer, debugPort);
  } catch (error) {
    console.log('❌ 无法连接到已登录浏览器');
    console.log('请先运行 login.js 并完成登录，例如:');
    console.log('  node login.js\n');
    throw error;
  }

  try {
    const page = await pickInstagramPage(browser);
    await ensureLoggedInAtProfile(page, normalized.profileUrl);

    const result = await fetchProfileAndPosts(page, normalized.username, limit, requestGuard);
    const output = {
      profile: result.profile,
      posts: result.posts,
      meta: {
        capturedAt: new Date().toISOString(),
        requestedLimit: limit,
        actualCount: result.posts.length,
      },
    };

    console.log(`✅ 账号: @${output.profile.username}`);
    console.log(`✅ 抓取到 ${output.posts.length} 条帖子`);
    if (output.posts.length < limit) {
      console.log(`ℹ️  返回少于上限(${limit})，可能是账号实际帖子数量或权限限制`);
    }
    console.log('');

    return output;
  } finally {
    if (browser && !options.keepConnected) {
      await browser.disconnect();
      console.log('✅ 执行完成，已断开浏览器连接\n');
    } else if (browser) {
      console.log('✅ 执行完成，保持浏览器连接\n');
    }
  }
}

async function main() {
  const options = parseCliArgs(process.argv.slice(2));

  if (options.help) {
    printUsage();
    process.exit(0);
  }
  if (options.error) {
    console.error(`❌ ${options.error}\n`);
    printUsage();
    process.exit(1);
  }
  if (!options.target) {
    printUsage();
    process.exit(1);
  }

  try {
    const data = await fetchUserPosts(options.target, {
      limit: options.limit,
      debugPort: options.debugPort,
      keepConnected: options.keepConnected,
    });

    if (options.output) {
      const outputPath = saveResults(data, options.output);
      console.log(`📁 结果已保存到: ${outputPath}`);
    } else {
      console.log(JSON.stringify(data, null, 2));
    }
  } catch (error) {
    console.error('❌ 抓取失败:', error.message || error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  parsePort,
  parseCliArgs,
  normalizeTarget,
  mapMediaType,
  resolvePostPathPrefix,
  normalizePost,
  fetchUserPosts,
};
