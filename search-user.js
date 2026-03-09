#!/usr/bin/env node

/**
 * Instagram User Search Script
 * 使用已登录的浏览器实例搜索用户
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { createInstagramRequestGuard } = require('./src/services/ig-request-guard');

const SESSION_DIR = path.join(__dirname, '.instagram-cli', 'sessions');
const BROWSER_INFO_FILE = path.join(SESSION_DIR, 'browser-info.json');
const INSTAGRAM_HOME = 'https://www.instagram.com/';
const DEFAULT_DEBUG_PORT = Number(process.env.DEBUG_PORT || 9222);
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
const SEARCH_TEXT_HINTS = [
  'search',
  '搜索',
  'buscar',
  'rechercher',
  'suche',
  'zoeken',
  '検索',
  '찾기',
];
const SEARCH_NEGATIVE_HINTS = [
  'comment',
  '评论',
  '留言',
  'message',
  '消息',
  'reply',
];
const SEARCH_ICON_SELECTORS = [
  'a[href="/explore/search/"]',
  'a[href="/search/"]',
  'svg[aria-label="Search"]',
  'svg[aria-label="搜索"]',
  'svg[aria-label*="Search"]',
  'svg[aria-label*="搜索"]',
  'button[aria-label="Search"]',
  'button[aria-label="搜索"]',
  'button[aria-label*="Search"]',
  'button[aria-label*="搜索"]',
];
const SEARCH_INPUT_SELECTORS = [
  'input[aria-label="Search"]',
  'input[aria-label="搜索"]',
  'input[aria-label*="Search"]',
  'input[aria-label*="搜索"]',
  'input[placeholder*="Search"]',
  'input[placeholder*="搜索"]',
  'input[name="queryBox"]',
  'input[role="searchbox"]',
  '[role="dialog"] input[type="text"]',
  '[role="dialog"] input[type="search"]',
  'nav input[type="text"]',
  'header input[type="text"]',
];

const RESERVED_PROFILE_PATHS = new Set([
  'accounts',
  'about',
  'api',
  'challenge',
  'developer',
  'direct',
  'emails',
  'explore',
  'graphql',
  'legal',
  'oauth',
  'p',
  'press',
  'privacy',
  'reel',
  'reels',
  'stories',
  'tv',
  'web',
]);

function parsePort(value, fallback = null) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    return fallback;
  }
  return parsed;
}

function printUsage() {
  console.log('使用方法: node search-user.js <搜索关键词> [options]');
  console.log('');
  console.log('Options:');
  console.log('  --limit <n>            返回结果上限 (默认 10，最大 50)');
  console.log('  --output <file>        将结果保存为 JSON 文件');
  console.log('  --open <index|user>    从搜索结果中按序号或用户名跳转');
  console.log('  --debug-port <port>    回退连接调试端口 (默认 9222)');
  console.log('  --keep-connected       搜索完成后不主动断开浏览器连接');
  console.log('  -h, --help             查看帮助');
  console.log('');
  console.log('示例:');
  console.log('  node search-user.js "coco"');
  console.log('  node search-user.js "travel" --limit 20 --output ./search-results.json');
  console.log('  node search-user.js "coco" --open 2');
  console.log('  node search-user.js "coco" --open cocogauff');
  console.log('  node search-user.js "nike" --debug-port 9333');
}

function parseCliArgs(argv) {
  const options = {
    query: '',
    limit: DEFAULT_LIMIT,
    output: '',
    open: '',
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

    if (arg === '--open') {
      const value = argv[i + 1];
      if (!value) {
        options.error = '参数 --open 缺少值';
        return options;
      }
      options.open = value;
      i += 1;
      continue;
    }

    if (arg.startsWith('--open=')) {
      options.open = arg.slice('--open='.length);
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

    if (!options.query) {
      options.query = arg;
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isSearchLikeText(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return SEARCH_TEXT_HINTS.some((hint) => normalized.includes(hint));
}

function isNegativeInputHint(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return SEARCH_NEGATIVE_HINTS.some((hint) => normalized.includes(hint));
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

function isProfilePath(href) {
  if (!href || typeof href !== 'string') {
    return null;
  }

  const normalized = href.trim();
  if (!/^\/[A-Za-z0-9._]+\/$/.test(normalized)) {
    return null;
  }

  const username = normalized.slice(1, -1);
  if (!username || RESERVED_PROFILE_PATHS.has(username.toLowerCase())) {
    return null;
  }

  return username;
}

function normalizeExtractedUsers(rawUsers, limit = DEFAULT_LIMIT) {
  const list = Array.isArray(rawUsers) ? rawUsers : [];
  const seen = new Set();
  const results = [];

  for (const user of list) {
    const username = String(user?.username || '').trim();
    if (!username || seen.has(username.toLowerCase())) {
      continue;
    }

    seen.add(username.toLowerCase());
    results.push({
      username,
      displayName: String(user?.displayName || username).trim() || username,
      profileUrl: String(user?.profileUrl || `${INSTAGRAM_HOME}${username}/`).trim(),
      fullName: String(user?.fullName || '').trim(),
      avatarUrl: String(user?.avatarUrl || '').trim(),
      isVerified: Boolean(user?.isVerified),
    });

    if (results.length >= limit) {
      break;
    }
  }

  return results;
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
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  return page;
}

async function navigateToInstagramHome(page, reason) {
  const message = reason ? `🔄 ${reason}` : '🔄 导航到 Instagram 主页...';
  console.log(`${message}\n`);
  await page.goto(INSTAGRAM_HOME, {
    waitUntil: 'networkidle2',
    timeout: 60000,
  });
  await sleep(1200);
}

function isInstagramLoginUrl(url) {
  const value = String(url || '');
  return /instagram\.com\/accounts\/(login|onetap)/i.test(value);
}

async function assertInstagramAuthenticated(page) {
  const currentUrl = String(page.url() || '');
  if (isInstagramLoginUrl(currentUrl)) {
    throw new Error('auth_required: 当前处于登录页，请先在浏览器完成人工登录');
  }

  const loginForm = await page.$('input[name="username"], input[name="password"], form[action*="/accounts/login"]');
  if (loginForm) {
    throw new Error('auth_required: 检测到登录表单，请先在浏览器完成人工登录');
  }
}

async function clickFirstVisible(page, selectors) {
  for (const selector of selectors) {
    try {
      const handle = await page.$(selector);
      if (!handle) {
        continue;
      }
      const visible = await handle.evaluate((el) => {
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return (
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          style.opacity !== '0' &&
          rect.width > 8 &&
          rect.height > 8
        );
      });
      if (!visible) {
        continue;
      }

      await handle.click();
      return selector;
    } catch (_error) {
      // Try next selector
    }
  }

  return '';
}

async function isUsableSearchInputHandle(handle) {
  if (!handle) {
    return false;
  }
  try {
    return handle.evaluate((el, searchHints, negativeHints) => {
      if (!(el instanceof HTMLInputElement)) {
        return false;
      }
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      if (
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        style.opacity === '0' ||
        rect.width <= 8 ||
        rect.height <= 8
      ) {
        return false;
      }
      if (el.disabled || el.readOnly) {
        return false;
      }
      const type = String(el.type || '').toLowerCase();
      if (type === 'hidden' || type === 'password') {
        return false;
      }

      const ariaLabel = String(el.getAttribute('aria-label') || '').toLowerCase();
      const placeholder = String(el.getAttribute('placeholder') || '').toLowerCase();
      const name = String(el.getAttribute('name') || '').toLowerCase();
      const role = String(el.getAttribute('role') || '').toLowerCase();
      const values = [ariaLabel, placeholder, name];
      if (values.some((value) => negativeHints.some((hint) => value.includes(hint)))) {
        return false;
      }

      const positiveByHint = values.some((value) => searchHints.some((hint) => value.includes(hint)));
      if (positiveByHint || name === 'querybox' || role === 'searchbox') {
        return true;
      }

      return Boolean(el.closest('nav') || el.closest('header') || el.closest('[role="dialog"]'));
    }, SEARCH_TEXT_HINTS, SEARCH_NEGATIVE_HINTS);
  } catch (_error) {
    return false;
  }
}

async function waitForSearchInput(page, timeoutMs = 12000) {
  const selectors = SEARCH_INPUT_SELECTORS;

  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    for (const selector of selectors) {
      const el = await page.$(selector);
      if (el && await isUsableSearchInputHandle(el)) {
        return { selector, element: el };
      }
    }
    await sleep(250);
  }

  return null;
}

async function inputSearchQuery(page, selector, query) {
  await page.click(selector);
  await sleep(200);
  await page.click(selector, { clickCount: 3 });
  await page.keyboard.press('Backspace');
  await page.type(selector, query, { delay: 90 });
  await sleep(1200);
}

function mergeUniqueUsers(target, batch, limit, seen) {
  for (const user of batch) {
    const key = String(user?.username || '').trim().toLowerCase();
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    target.push(user);
    if (target.length >= limit) {
      break;
    }
  }
}

async function extractVisibleUsersFromDialog(page, limit) {
  return page.evaluate((maxCount) => {
    const users = [];
    const seen = new Set();
    const ignoredTexts = new Set(['主页', '搜索', 'reels', '探索', '通知', '消息']);
    const reserved = new Set([
      'accounts', 'about', 'api', 'challenge', 'developer', 'direct', 'emails', 'explore',
      'graphql', 'legal', 'oauth', 'p', 'press', 'privacy', 'reel', 'reels', 'stories', 'tv', 'web',
    ]);

    const isVisible = (el) => {
      if (!(el instanceof HTMLElement)) {
        return false;
      }
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return (
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        style.opacity !== '0' &&
        rect.width > 10 &&
        rect.height > 10
      );
    };

    const searchDialog = document.querySelector('[role="dialog"]');
    const searchContainer = searchDialog || document.body;
    const anchors = Array.from(searchContainer.querySelectorAll('a[href]'));
    for (const anchor of anchors) {
      if (users.length >= maxCount) {
        break;
      }
      if (!isVisible(anchor)) {
        continue;
      }
      if (anchor.closest('nav')) {
        continue;
      }

      const href = anchor.getAttribute('href') || '';
      const m = href.match(/^\/([A-Za-z0-9._]+)\/$/);
      if (!m) {
        continue;
      }

      const username = m[1];
      const key = username.toLowerCase();
      if (reserved.has(key) || seen.has(key)) {
        continue;
      }

      const img = anchor.querySelector('img');
      if (!img) {
        continue;
      }

      const spans = Array.from(anchor.querySelectorAll('span'))
        .map((el) => (el.textContent || '').trim())
        .filter((text) => text && !ignoredTexts.has(text.toLowerCase()));
      const displayName =
        spans.find((text) => text.toLowerCase() === key) ||
        username;
      const fullName = spans.find((text) => text !== displayName) || '';

      const hasVerified = Boolean(
        anchor.querySelector('svg[aria-label="Verified"]') ||
        anchor.querySelector('svg[title="Verified"]') ||
        anchor.querySelector('svg[aria-label*="认证"]')
      );

      users.push({
        username,
        displayName,
        fullName,
        profileUrl: `https://www.instagram.com/${username}/`,
        avatarUrl: img.src || img.getAttribute('data-src') || '',
        isVerified: hasVerified,
      });
      seen.add(key);
    }

    return users;
  }, limit);
}

async function scrollSearchResults(page) {
  return page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]');
    const root = dialog || document.body;

    const candidates = [root, ...Array.from(root.querySelectorAll('*'))];
    const scrollable = candidates.find((el) => {
      if (!(el instanceof HTMLElement)) {
        return false;
      }
      const style = window.getComputedStyle(el);
      if (style.overflowY === 'hidden') {
        return false;
      }
      return el.scrollHeight - el.clientHeight > 20;
    });

    if (!scrollable || !(scrollable instanceof HTMLElement)) {
      const before = window.scrollY;
      window.scrollBy(0, 420);
      return window.scrollY > before;
    }

    const before = scrollable.scrollTop;
    const delta = Math.max(320, Math.floor(scrollable.clientHeight * 0.85));
    scrollable.scrollBy(0, delta);
    return scrollable.scrollTop > before + 4;
  });
}

async function fetchSearchUsersByApi(page, query, limit, requestGuard) {
  const runRequest = async () => page.evaluate(async (keyword, maxCount) => {
    try {
      const url = `/api/v1/web/search/topsearch/?context=blended&query=${encodeURIComponent(keyword)}&count=${maxCount}`;
      const res = await fetch(url, {
        method: 'GET',
        credentials: 'include',
        headers: {
          'x-requested-with': 'XMLHttpRequest',
        },
      });

      const text = await res.text();
      let data = null;
      try {
        data = JSON.parse(text);
      } catch (_error) {
        data = null;
      }

      if (!res.ok) {
        return {
          ok: false,
          status: res.status,
          statusText: res.statusText,
          textHead: text.slice(0, 280),
          users: [],
        };
      }

      const list = Array.isArray(data?.users) ? data.users : [];
      const users = [];
      for (const item of list) {
        const u = item?.user || {};
        const username = String(u.username || '').trim();
        if (!username) {
          continue;
        }

        const fullNameParts = [];
        if (typeof u.full_name === 'string' && u.full_name.trim()) {
          fullNameParts.push(u.full_name.trim());
        }
        if (typeof item?.social_context === 'string' && item.social_context.trim()) {
          fullNameParts.push(item.social_context.trim());
        }

        users.push({
          username,
          displayName: username,
          fullName: fullNameParts.join(' • '),
          profileUrl: `https://www.instagram.com/${username}/`,
          avatarUrl: String(u.profile_pic_url || '').trim(),
          isVerified: Boolean(u.is_verified),
        });

        if (users.length >= maxCount) {
          break;
        }
      }

      return {
        ok: true,
        status: res.status,
        statusText: res.statusText,
        textHead: '',
        users,
      };
    } catch (error) {
      return {
        ok: false,
        status: 0,
        statusText: '',
        textHead: String(error?.message || error || ''),
        users: [],
      };
    }
  }, query, limit);

  try {
    const payload = requestGuard
      ? await requestGuard.run({
        url: `/api/v1/web/search/topsearch/?query=${encodeURIComponent(query)}`,
        method: 'GET',
      }, runRequest)
      : await runRequest();

    if (!payload.ok) {
      throw new Error(`搜索接口请求失败 status=${payload.status}: ${payload.textHead || payload.statusText}`);
    }

    return Array.isArray(payload.users) ? payload.users : [];
  } catch (error) {
    console.log(`⚠️  搜索 API 回退到页面解析: ${error.message || error}`);
    return [];
  }
}

async function extractSearchResults(page, query, limit, requestGuard) {
  const maxRounds = Math.max(4, Math.ceil(limit / 2) + 4);
  const users = [];
  const seen = new Set();
  let noChangeRounds = 0;

  for (let round = 0; round < maxRounds; round += 1) {
    const beforeCount = users.length;
    const batch = await extractVisibleUsersFromDialog(page, limit);
    mergeUniqueUsers(users, batch, limit, seen);

    if (users.length >= limit) {
      break;
    }

    const didScroll = await scrollSearchResults(page);
    await new Promise((resolve) => setTimeout(resolve, 700));

    if (users.length === beforeCount || !didScroll) {
      noChangeRounds += 1;
    } else {
      noChangeRounds = 0;
    }

    if (noChangeRounds >= 3) {
      break;
    }
  }

  if (users.length < limit) {
    const apiUsers = await fetchSearchUsersByApi(page, query, limit, requestGuard);
    mergeUniqueUsers(users, apiUsers, limit, seen);
  }

  return normalizeExtractedUsers(users, limit);
}

function pickTargetUser(results, openTarget) {
  if (!openTarget) {
    return null;
  }
  const list = Array.isArray(results) ? results : [];
  if (!list.length) {
    return null;
  }

  const raw = String(openTarget).trim();
  if (!raw) {
    return null;
  }

  if (/^\d+$/.test(raw)) {
    const index = Number(raw) - 1;
    if (index >= 0 && index < list.length) {
      return list[index];
    }
    return null;
  }

  const target = raw.replace(/^@/, '').toLowerCase();
  return list.find((u) => String(u.username || '').toLowerCase() === target) || null;
}

async function openTargetProfile(page, user) {
  if (!user?.profileUrl) {
    return false;
  }
  await page.goto(user.profileUrl, {
    waitUntil: 'networkidle2',
    timeout: 60000,
  });
  await sleep(1200);
  return true;
}

async function tryOpenSearchInput(page) {
  const clickedSelector = await clickFirstVisible(page, SEARCH_ICON_SELECTORS);
  if (clickedSelector) {
    console.log(`✓ 已点击: ${clickedSelector}`);
    await sleep(1000);
  } else {
    console.log('⚠️  未找到搜索入口，尝试直接定位搜索输入框');
  }

  const searchInput = await waitForSearchInput(page, 9000);
  return {
    clickedSelector,
    searchInput,
  };
}

async function resolveSearchInputWithFallback(page) {
  console.log('🔍 尝试打开搜索框...\n');
  let result = await tryOpenSearchInput(page);
  if (result.searchInput) {
    return result.searchInput;
  }

  console.log('⚠️  当前页面未找到搜索输入框，重置到主页后重试一次');
  await navigateToInstagramHome(page, '重置到 Instagram 主页...');
  await assertInstagramAuthenticated(page);

  result = await tryOpenSearchInput(page);
  if (result.searchInput) {
    return result.searchInput;
  }

  throw new Error('ui_selector_miss: 未找到搜索输入框（已执行主页重试）');
}

async function searchUsers(query, options = {}) {
  const puppeteer = options.puppeteer || require('puppeteer');
  const limit = Number.isInteger(options.limit) ? options.limit : DEFAULT_LIMIT;
  const debugPort = parsePort(options.debugPort, DEFAULT_DEBUG_PORT);

  console.log(`🔍 正在搜索用户: ${query}`);
  console.log(`📌 结果上限: ${limit}\n`);
  const requestGuard = createInstagramRequestGuard({
    scriptName: 'search-user',
  });
  console.log(`🛡️ 请求防护: ${requestGuard.describe()}\n`);

  let browser;
  try {
    browser = await connectBrowser(puppeteer, debugPort);
  } catch (error) {
    console.log('❌ 无法连接到已登录浏览器');
    console.log('请先运行 login_web.js 并完成登录，例如:');
    console.log('  node login_web.js https://www.instagram.com --debug-port 9222\n');
    throw error;
  }

  try {
    const page = await pickInstagramPage(browser);
    await assertInstagramAuthenticated(page);
    const searchInput = await resolveSearchInputWithFallback(page);

    console.log(`✓ 找到搜索输入框: ${searchInput.selector}`);
    await inputSearchQuery(page, searchInput.selector, query);
    console.log(`✅ 已输入: "${query}"\n`);

    await page.keyboard.press('Enter').catch(() => {});
    await sleep(3000);

    const results = await extractSearchResults(page, query, limit, requestGuard);
    console.log(`✅ 找到 ${results.length} 个用户:\n`);

    if (results.length < limit) {
      console.log(`ℹ️  实际结果少于上限(${limit})，这通常由 Instagram 搜索接口当前返回条数决定。\n`);
    }

    results.forEach((user, index) => {
      console.log(`${index + 1}. @${user.username}${user.isVerified ? ' ✓' : ''}`);
      if (user.fullName) {
        console.log(`   全名: ${user.fullName}`);
      }
      console.log(`   显示名: ${user.displayName}`);
      console.log(`   链接: ${user.profileUrl}`);
      console.log(`   头像: ${user.avatarUrl || '未获取到'}`);
      console.log('');
    });

    if (options.open) {
      const targetUser = pickTargetUser(results, options.open);
      if (!targetUser) {
        console.log(`⚠️  未找到可跳转目标: ${options.open}`);
      } else {
        console.log(`🚀 正在跳转到: @${targetUser.username}`);
        await openTargetProfile(page, targetUser);
        console.log(`✅ 已打开: ${targetUser.profileUrl}\n`);
      }
    }

    return results;
  } finally {
    if (browser && !options.keepConnected) {
      await browser.disconnect();
      console.log('✅ 搜索完成，已断开浏览器连接\n');
    } else if (browser) {
      console.log('✅ 搜索完成，保持浏览器连接\n');
    }
  }
}

function saveResults(results, outputFile) {
  if (!outputFile) {
    return '';
  }

  const absPath = path.isAbsolute(outputFile)
    ? outputFile
    : path.join(process.cwd(), outputFile);

  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, JSON.stringify(results, null, 2));
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
  if (!options.query) {
    printUsage();
    process.exit(1);
  }

  try {
    const results = await searchUsers(options.query, {
      limit: options.limit,
      open: options.open,
      debugPort: options.debugPort,
      keepConnected: options.keepConnected,
    });

    if (options.output) {
      const outputPath = saveResults(results, options.output);
      console.log(`📁 结果已保存到: ${outputPath}`);
    }
  } catch (error) {
    console.error('❌ 搜索失败:', error.message || error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  searchUsers,
  parseCliArgs,
  isProfilePath,
  normalizeExtractedUsers,
  pickTargetUser,
  isSearchLikeText,
  parsePort,
};
