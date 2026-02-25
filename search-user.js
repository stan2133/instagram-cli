#!/usr/bin/env node

/**
 * Instagram User Search Script
 * 使用已登录的浏览器实例搜索用户
 */

'use strict';

const fs = require('fs');
const path = require('path');

const SESSION_DIR = path.join(__dirname, '.instagram-cli', 'sessions');
const BROWSER_INFO_FILE = path.join(SESSION_DIR, 'browser-info.json');
const INSTAGRAM_HOME = 'https://www.instagram.com/';
const DEFAULT_DEBUG_PORT = Number(process.env.DEBUG_PORT || 9222);
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

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
  console.log('  --debug-port <port>    回退连接调试端口 (默认 9222)');
  console.log('  --keep-connected       搜索完成后不主动断开浏览器连接');
  console.log('  -h, --help             查看帮助');
  console.log('');
  console.log('示例:');
  console.log('  node search-user.js "coco"');
  console.log('  node search-user.js "travel" --limit 20 --output ./search-results.json');
  console.log('  node search-user.js "nike" --debug-port 9333');
}

function parseCliArgs(argv) {
  const options = {
    query: '',
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

  try {
    const browser = await puppeteer.connect({
      browserURL: `http://127.0.0.1:${debugPort}`,
      defaultViewport: null,
    });
    console.log(`✅ 已通过 debug-port(${debugPort}) 连接到浏览器实例\n`);
    return browser;
  } catch (error) {
    errors.push(`debug-port(${debugPort}) 连接失败: ${error.message}`);
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

async function waitForSearchInput(page, timeoutMs = 12000) {
  const selectors = [
    'input[aria-label="Search"]',
    'input[aria-label="搜索"]',
    'input[aria-label*="Search"]',
    'input[aria-label*="搜索"]',
    'input[placeholder*="Search"]',
    'input[placeholder*="搜索"]',
  ];

  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    for (const selector of selectors) {
      const el = await page.$(selector);
      if (el) {
        return { selector, element: el };
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  return null;
}

async function inputSearchQuery(page, selector, query) {
  await page.click(selector);
  await new Promise((resolve) => setTimeout(resolve, 200));
  await page.click(selector, { clickCount: 3 });
  await page.keyboard.press('Backspace');
  await page.type(selector, query, { delay: 90 });
  await new Promise((resolve) => setTimeout(resolve, 1200));
}

async function extractSearchResults(page, limit) {
  const rawUsers = await page.evaluate((maxCount) => {
    const users = [];
    const seen = new Set();

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

    const anchors = Array.from(document.querySelectorAll('a[href]'));
    for (const anchor of anchors) {
      if (users.length >= maxCount) {
        break;
      }
      if (!isVisible(anchor)) {
        continue;
      }

      const href = anchor.getAttribute('href') || '';
      const m = href.match(/^\/([A-Za-z0-9._]+)\/$/);
      if (!m) {
        continue;
      }

      const username = m[1];
      const reserved = [
        'accounts', 'about', 'api', 'challenge', 'developer', 'direct', 'emails', 'explore',
        'graphql', 'legal', 'oauth', 'p', 'press', 'privacy', 'reel', 'reels', 'stories', 'tv', 'web',
      ];
      if (reserved.includes(username.toLowerCase())) {
        continue;
      }
      if (seen.has(username.toLowerCase())) {
        continue;
      }

      const img = anchor.querySelector('img');
      const spans = Array.from(anchor.querySelectorAll('span'))
        .map((el) => (el.textContent || '').trim())
        .filter(Boolean);
      const displayName = spans[0] || username;
      const fullName = spans.find((s, i) => i > 0 && s !== username) || '';

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
        avatarUrl: img?.src || img?.getAttribute('data-src') || '',
        isVerified: hasVerified,
      });
      seen.add(username.toLowerCase());
    }

    return users;
  }, limit);

  return normalizeExtractedUsers(rawUsers, limit);
}

async function searchUsers(query, options = {}) {
  const puppeteer = options.puppeteer || require('puppeteer');
  const limit = Number.isInteger(options.limit) ? options.limit : DEFAULT_LIMIT;
  const debugPort = parsePort(options.debugPort, DEFAULT_DEBUG_PORT);

  console.log(`🔍 正在搜索用户: ${query}`);
  console.log(`📌 结果上限: ${limit}\n`);

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

    const searchIconSelectors = [
      'a[href="/explore/search/"]',
      'svg[aria-label="Search"]',
      'svg[aria-label="搜索"]',
      'button[aria-label="Search"]',
      'button[aria-label="搜索"]',
    ];

    console.log('🔍 尝试打开搜索框...\n');
    const clickedSelector = await clickFirstVisible(page, searchIconSelectors);
    if (clickedSelector) {
      console.log(`✓ 已点击: ${clickedSelector}`);
      await new Promise((resolve) => setTimeout(resolve, 1200));
    } else {
      console.log('⚠️  未找到搜索图标，尝试直接定位搜索输入框');
    }

    const searchInput = await waitForSearchInput(page);
    if (!searchInput) {
      console.log('❌ 未找到搜索输入框');
      return [];
    }

    console.log(`✓ 找到搜索输入框: ${searchInput.selector}`);
    await inputSearchQuery(page, searchInput.selector, query);
    console.log(`✅ 已输入: "${query}"\n`);

    await page.keyboard.press('Enter').catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 3000));

    const results = await extractSearchResults(page, limit);
    console.log(`✅ 找到 ${results.length} 个用户:\n`);

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
  parsePort,
};
