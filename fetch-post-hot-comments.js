#!/usr/bin/env node

/**
 * Instagram Post Hot Comments Fetch Script
 * 在已登录 Instagram 浏览器会话下，抓取指定帖子的热评数据
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { createInstagramRequestGuard } = require('./src/services/ig-request-guard');

const SESSION_DIR = path.join(__dirname, '.instagram-cli', 'sessions');
const BROWSER_INFO_FILE = path.join(SESSION_DIR, 'browser-info.json');
const INSTAGRAM_HOME = 'https://www.instagram.com/';
const DEFAULT_DEBUG_PORT = Number(process.env.DEBUG_PORT || 9222);
const DEFAULT_LIMIT = 20;
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
  console.log('使用方法: node fetch-post-hot-comments.js <postUrl|shortcode> [options]');
  console.log('');
  console.log('Options:');
  console.log(`  --limit <n>            返回热评上限 (默认 ${DEFAULT_LIMIT}，最大 ${MAX_LIMIT})`);
  console.log('  --min-likes <n>        最小点赞数过滤 (默认 0)');
  console.log('  --include-replies      包含每条评论的预览回复');
  console.log('  --output <file>        将结果保存为 JSON 文件');
  console.log('  --debug-port <port>    回退连接调试端口 (默认 9222)');
  console.log('  --keep-connected       执行完成后不主动断开浏览器连接');
  console.log('  -h, --help             查看帮助');
  console.log('');
  console.log('示例:');
  console.log('  node fetch-post-hot-comments.js "https://www.instagram.com/p/DVEQd9PjhJH/"');
  console.log('  node fetch-post-hot-comments.js "DVEQd9PjhJH" --limit 50 --output ./logs/hot-comments.json');
}

function parseCliArgs(argv) {
  const options = {
    target: '',
    limit: DEFAULT_LIMIT,
    minLikes: 0,
    includeReplies: false,
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

    if (arg === '--min-likes') {
      const value = argv[i + 1];
      if (!value) {
        options.error = '参数 --min-likes 缺少值';
        return options;
      }
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < 0) {
        options.error = 'min-likes 必须是 >= 0 的整数';
        return options;
      }
      options.minLikes = parsed;
      i += 1;
      continue;
    }

    if (arg.startsWith('--min-likes=')) {
      const parsed = Number(arg.slice('--min-likes='.length));
      if (!Number.isInteger(parsed) || parsed < 0) {
        options.error = 'min-likes 必须是 >= 0 的整数';
        return options;
      }
      options.minLikes = parsed;
      continue;
    }

    if (arg === '--include-replies') {
      options.includeReplies = true;
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
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  return page;
}

function normalizePostTarget(target) {
  const raw = String(target || '').trim();
  if (!raw) {
    return { error: '缺少 post URL 或 shortcode' };
  }

  // Shortcode
  if (/^[A-Za-z0-9_-]{5,}$/.test(raw)) {
    return {
      shortcode: raw,
      postType: 'p',
      postUrl: `${INSTAGRAM_HOME}p/${raw}/`,
    };
  }

  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  let url;
  try {
    url = new URL(withProtocol);
  } catch (_error) {
    return { error: `无效地址: ${raw}` };
  }

  if (!url.hostname.toLowerCase().includes('instagram.com')) {
    return { error: `不是 Instagram 地址: ${raw}` };
  }

  // 支持:
  // /p/<shortcode>/
  // /reel/<shortcode>/
  // /<username>/p/<shortcode>/
  // /<username>/reel/<shortcode>/
  const m = url.pathname.match(/^\/(?:[A-Za-z0-9._]+\/)?(p|reel|tv)\/([A-Za-z0-9_-]+)\/?/i);
  if (!m) {
    return { error: `无法识别 post 链接: ${raw}` };
  }

  const postType = m[1].toLowerCase() === 'reel' ? 'reel' : 'p';
  const shortcode = m[2];
  return {
    shortcode,
    postType,
    postUrl: `${INSTAGRAM_HOME}${postType}/${shortcode}/`,
  };
}

async function openPostAndEnsureLoggedIn(page, postUrl) {
  await page.goto(postUrl, {
    waitUntil: 'networkidle2',
    timeout: 60000,
  });
  await new Promise((resolve) => setTimeout(resolve, 1200));

  if (page.url().includes('/accounts/login')) {
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
        textHead: text.slice(0, 300),
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
    throw new Error(`请求失败(${apiUrl}) status=${payload.status}: ${payload.textHead || `${payload.status} ${payload.statusText}`}`);
  }
  if (!payload.json || typeof payload.json !== 'object') {
    throw new Error(`接口返回非 JSON: ${apiUrl}`);
  }

  return payload.json;
}

async function resolveMediaPkFromCurrentPage(page) {
  return page.evaluate(() => {
    const iosUrl =
      document.querySelector('meta[property="al:ios:url"]')?.getAttribute('content') ||
      '';
    const ogUrl =
      document.querySelector('meta[property="og:url"]')?.getAttribute('content') ||
      '';
    const ownerUserId =
      document.querySelector('meta[name="instapp:owner_user_id"]')?.getAttribute('content') ||
      document.querySelector('meta[property="instapp:owner_user_id"]')?.getAttribute('content') ||
      '';
    const title =
      document.querySelector('meta[property="og:title"]')?.getAttribute('content') ||
      '';
    const description =
      document.querySelector('meta[property="og:description"]')?.getAttribute('content') ||
      '';

    let mediaPk = '';
    const iosMatch = iosUrl.match(/instagram:\/\/media\?id=(\d+)/);
    if (iosMatch) {
      mediaPk = iosMatch[1];
    }

    if (!mediaPk) {
      const html = document.documentElement.innerHTML;
      const m = html.match(/"media_id":"(\d+)"/);
      if (m) {
        mediaPk = m[1];
      }
    }

    return {
      mediaPk,
      ogUrl,
      ownerUserId: String(ownerUserId || ''),
      title,
      description,
    };
  });
}

function normalizeReply(raw) {
  const created = Number(raw?.created_at || raw?.created_at_utc || 0);
  const user = raw?.user || {};
  return {
    commentPk: String(raw?.pk || ''),
    text: String(raw?.text || '').trim(),
    likeCount: Number(raw?.comment_like_count || 0),
    createdAtUnix: created,
    createdAt: created > 0 ? new Date(created * 1000).toISOString() : '',
    ownerUsername: String(user?.username || ''),
    ownerIsVerified: Boolean(user?.is_verified),
  };
}

function computeHotScore(comment, nowUnix = Math.floor(Date.now() / 1000)) {
  const ageHours = Math.max(0, (nowUnix - Number(comment.createdAtUnix || 0)) / 3600);
  const likePart = Number(comment.likeCount || 0);
  const replyPart = Number(comment.replyCount || 0) * 20;
  const rankedPart = comment.isRankedComment ? 70 : 0;
  const verifiedPart = comment.ownerIsVerified ? 35 : 0;
  const authorPart = comment.ownerIsPostAuthor ? 120 : 0;
  const apiRankPart = Math.max(0, 40 - Number(comment.apiRank || 0));
  const decay = ageHours * 0.35;
  return likePart + replyPart + rankedPart + verifiedPart + authorPart + apiRankPart - decay;
}

function normalizeComment(raw, postOwnerUsername, postOwnerUserId, includeReplies, apiRank) {
  const user = raw?.user || {};
  const created = Number(raw?.created_at || raw?.created_at_utc || 0);
  const ownerUsername = String(user?.username || '').trim();
  const ownerUserPk = String(user?.pk || '').trim();
  const replies = includeReplies && Array.isArray(raw?.preview_child_comments)
    ? raw.preview_child_comments.map((reply) => normalizeReply(reply))
    : [];
  const replyCount = Number(raw?.child_comment_count || replies.length || 0);

  const normalized = {
    apiRank,
    commentPk: String(raw?.pk || ''),
    commentId: String(raw?.pk || ''),
    text: String(raw?.text || '').trim(),
    likeCount: Number(raw?.comment_like_count || 0),
    replyCount,
    createdAtUnix: created,
    createdAt: created > 0 ? new Date(created * 1000).toISOString() : '',
    ownerUsername,
    ownerIsVerified: Boolean(user?.is_verified),
    ownerIsPostAuthor:
      (ownerUserPk && postOwnerUserId && ownerUserPk === postOwnerUserId) ||
      (ownerUsername && postOwnerUsername && ownerUsername.toLowerCase() === postOwnerUsername.toLowerCase()),
    isRankedComment: Boolean(raw?.is_ranked_comment),
    isPinned: Boolean(raw?.is_pinned_comment),
    replies,
  };

  normalized.score = computeHotScore(normalized);
  return normalized;
}

function rankHotComments(comments) {
  const list = Array.isArray(comments) ? [...comments] : [];
  list.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    if (b.likeCount !== a.likeCount) {
      return b.likeCount - a.likeCount;
    }
    if (b.replyCount !== a.replyCount) {
      return b.replyCount - a.replyCount;
    }
    return b.createdAtUnix - a.createdAtUnix;
  });

  return list.map((item, idx) => ({
    rank: idx + 1,
    ...item,
    score: Number(item.score.toFixed(3)),
  }));
}

function normalizePostFromMedia(item, fallbackUrl) {
  const mediaTypeNum = Number(item?.media_type || 1);
  const mediaType = mediaTypeNum === 2 ? 'video' : mediaTypeNum === 8 ? 'carousel' : 'image';
  const code = String(item?.code || '').trim();
  const route = mediaTypeNum === 2 ? 'reel' : 'p';
  const taken = Number(item?.taken_at || 0);
  const owner = item?.user || {};

  return {
    shortcode: code,
    postUrl: code ? `${INSTAGRAM_HOME}${route}/${code}/` : fallbackUrl,
    mediaPk: String(item?.pk || ''),
    mediaId: String(item?.id || ''),
    mediaType,
    ownerUsername: String(owner?.username || ''),
    ownerUserId: String(owner?.pk || ''),
    caption: String(item?.caption?.text || '').trim(),
    likeCount: Number(item?.like_count || 0),
    commentCount: Number(item?.comment_count || 0),
    takenAtUnix: taken,
    takenAt: taken > 0 ? new Date(taken * 1000).toISOString() : '',
  };
}

async function fetchCommentsForMedia(page, mediaPk, postMeta, options) {
  const limit = options.limit;
  const includeReplies = Boolean(options.includeReplies);
  const minLikes = Number(options.minLikes || 0);
  const requestGuard = options.requestGuard;

  const comments = [];
  const seen = new Set();
  let cursor = '';
  let apiRank = 0;

  while (comments.length < limit && apiRank < 1200) {
    const qs = new URLSearchParams({
      can_support_threading: 'true',
      permalink_enabled: 'false',
      sort_order: 'popular',
    });
    if (cursor) {
      qs.set('min_id', cursor);
    }

    const url = `/api/v1/media/${encodeURIComponent(mediaPk)}/comments/?${qs.toString()}`;
    const data = await fetchJsonInPage(page, url, requestGuard);
    const list = Array.isArray(data?.comments) ? data.comments : [];
    if (!list.length) {
      break;
    }

    for (const raw of list) {
      apiRank += 1;
      const pk = String(raw?.pk || '').trim();
      if (!pk || seen.has(pk)) {
        continue;
      }
      seen.add(pk);
      const item = normalizeComment(
        raw,
        postMeta.ownerUsername,
        postMeta.ownerUserId,
        includeReplies,
        apiRank
      );

      if (item.likeCount < minLikes) {
        continue;
      }

      comments.push(item);
      if (comments.length >= limit) {
        break;
      }
    }

    const nextCursor = String(data?.next_min_id || data?.next_max_id || '').trim();
    if (!nextCursor || nextCursor === cursor) {
      break;
    }
    cursor = nextCursor;
  }

  return rankHotComments(comments).slice(0, limit);
}

async function fetchPostHotComments(target, options = {}) {
  const puppeteer = options.puppeteer || require('puppeteer');
  const limit = Number.isInteger(options.limit) ? options.limit : DEFAULT_LIMIT;
  const minLikes = Number.isInteger(options.minLikes) ? options.minLikes : 0;
  const debugPort = parsePort(options.debugPort, DEFAULT_DEBUG_PORT);
  const normalized = normalizePostTarget(target);
  if (normalized.error) {
    throw new Error(normalized.error);
  }

  console.log(`🎯 目标帖子: ${normalized.postUrl}`);
  console.log(`📌 热评上限: ${limit}`);
  console.log(`🔎 最小点赞过滤: ${minLikes}\n`);
  const requestGuard = createInstagramRequestGuard({
    scriptName: 'fetch-post-hot-comments',
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
    await openPostAndEnsureLoggedIn(page, normalized.postUrl);

    const resolved = await resolveMediaPkFromCurrentPage(page);
    if (!resolved.mediaPk) {
      throw new Error('无法从页面解析 mediaPk，请确认链接有效且当前账号有访问权限');
    }

    const mediaInfoJson = await fetchJsonInPage(
      page,
      `/api/v1/media/${encodeURIComponent(resolved.mediaPk)}/info/`,
      requestGuard
    );
    const mediaItem = mediaInfoJson?.items?.[0];
    if (!mediaItem) {
      throw new Error('未获取到帖子详情数据');
    }

    const postMeta = normalizePostFromMedia(mediaItem, normalized.postUrl);
    const hotComments = await fetchCommentsForMedia(page, resolved.mediaPk, postMeta, {
      limit,
      minLikes,
      includeReplies: options.includeReplies,
      requestGuard,
    });

    const result = {
      post: postMeta,
      hotComments,
      meta: {
        capturedAt: new Date().toISOString(),
        requestedLimit: limit,
        actualCount: hotComments.length,
        minLikes,
        includeReplies: Boolean(options.includeReplies),
        sortMode: 'popular_with_local_score',
      },
    };

    console.log(`✅ 帖子: ${result.post.postUrl}`);
    console.log(`✅ 抓取到 ${result.hotComments.length} 条热评\n`);

    return result;
  } finally {
    if (browser && !options.keepConnected) {
      await browser.disconnect();
      console.log('✅ 执行完成，已断开浏览器连接\n');
    } else if (browser) {
      console.log('✅ 执行完成，保持浏览器连接\n');
    }
  }
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
    const data = await fetchPostHotComments(options.target, {
      limit: options.limit,
      minLikes: options.minLikes,
      includeReplies: options.includeReplies,
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
  normalizePostTarget,
  computeHotScore,
  normalizeComment,
  rankHotComments,
  fetchPostHotComments,
};
