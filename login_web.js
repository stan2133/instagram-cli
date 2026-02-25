#!/usr/bin/env node

/**
 * Universal Web Login Script
 * 使用 Puppeteer 打开浏览器登录任意网站
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// Session 存储路径
const SESSION_DIR = path.join(__dirname, '.instagram-cli', 'sessions');
const DEFAULT_DEBUG_PORT = Number(process.env.DEBUG_PORT || 9222);

// 网站配置
const SITE_CONFIGS = {
  'instagram.com': {
    authCookieName: 'sessionid',
    loginIndicators: ['[role="button"]', 'nav'],
  },
  'twitter.com': {
    authCookieName: 'auth_token',
    loginIndicators: ['[data-testid="userNav"]'],
  },
  'github.com': {
    authCookieName: 'logged_in',
    loginIndicators: ['[data-test-selector="profile"]'],
  },
  'jianying.com': {
    authCookieName: null,
    loginIndicators: [],
    loginButtonKeywords: ['登录', '注册', '开启', '立即开启', '开启创作', '开始创作', '马上体验'],
    qrTabKeywords: ['扫码登录', '二维码登录', '扫码快捷登录', '扫码', '二维码'],
    qrHintKeywords: ['扫码', '二维码', 'qr', 'qrcode', 'scan'],
  }
};

const LOGIN_BUTTON_KEYWORDS = [
  '登录',
  '登錄',
  '登入',
  'login',
  'log in',
  'sign in',
];

const QR_CODE_SELECTORS = [
  'img[src*="qrcode"]',
  'img[src*="qr"]',
  'img[alt*="二维码"]',
  'img[alt*="QR"]',
  'canvas[class*="qr"]',
  'canvas[id*="qr"]',
  '[class*="qrcode"] img',
  '[class*="qr-code"] img',
  '[data-e2e*="qrcode"] img',
];

const QR_CONTAINER_KEYWORDS = [
  '二维码',
  '扫码',
  'scan',
  'qr code',
  'qrcode',
];

const QR_TAB_KEYWORDS = [
  '扫码登录',
  '二维码登录',
  'qr login',
  'scan login',
];

function parsePort(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    return null;
  }
  return n;
}

function printUsage() {
  console.log('使用方法: node login_web.js <URL> [--debug-port <port>]');
  console.log('');
  console.log('示例:');
  console.log('  node login_web.js https://www.instagram.com');
  console.log('  node login_web.js https://www.taobao.com --debug-port 9222');
  console.log('  DEBUG_PORT=9333 node login_web.js https://www.douyin.com');
  console.log('');
  console.log('注意: 登录后浏览器将保持打开状态，以便其他脚本使用');
  console.log('      按 Ctrl+C 关闭浏览器和退出程序\n');
}

function parseCliOptions(argv) {
  const options = {
    targetUrl: '',
    debugPort: DEFAULT_DEBUG_PORT,
    help: false,
    error: '',
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg === '--debug-port' || arg === '-p') {
      const value = argv[i + 1];
      if (!value) {
        options.error = '参数 --debug-port 缺少端口值';
        return options;
      }
      const parsed = parsePort(value);
      if (!parsed) {
        options.error = `无效端口: ${value}`;
        return options;
      }
      options.debugPort = parsed;
      i += 1;
      continue;
    }
    if (arg.startsWith('--debug-port=')) {
      const parsed = parsePort(arg.slice('--debug-port='.length));
      if (!parsed) {
        options.error = `无效端口: ${arg.slice('--debug-port='.length)}`;
        return options;
      }
      options.debugPort = parsed;
      continue;
    }
    if (arg.startsWith('-')) {
      options.error = `未知参数: ${arg}`;
      return options;
    }
    if (!options.targetUrl) {
      options.targetUrl = arg;
      continue;
    }
    options.error = `多余参数: ${arg}`;
    return options;
  }

  return options;
}

function mergeKeywords(primary, fallback) {
  const merged = [...(primary || []), ...(fallback || [])];
  return Array.from(new Set(merged.filter(Boolean)));
}

// 确保 session 目录存在
if (!fs.existsSync(SESSION_DIR)) {
  fs.mkdirSync(SESSION_DIR, { recursive: true });
}

function toFileSafeDomain(domain) {
  return domain.replace(/[^a-zA-Z0-9.-]/g, '').replace(/\./g, '-');
}

async function isElementVisible(element) {
  return element.evaluate((el) => {
    const style = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return (
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      style.opacity !== '0' &&
      rect.width > 24 &&
      rect.height > 24
    );
  });
}

/**
 * 自动检测并点击登录按钮
 */
async function tryAutoClickLoginButton(page, inputKeywords = LOGIN_BUTTON_KEYWORDS) {
  const keywords = inputKeywords.map((keyword) => keyword.toLowerCase());
  const clickResult = await page.evaluate((needles) => {
    const normalize = (text) => (text || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const matchesLoginText = (text) => {
      if (!text || text.length > 40) {
        return false;
      }
      return needles.some((needle) => text.includes(needle));
    };
    const isLikelyActionElement = (el) => {
      if (!(el instanceof HTMLElement)) {
        return false;
      }
      const tag = el.tagName.toLowerCase();
      if (tag === 'button' || tag === 'a') {
        return true;
      }
      if (el.getAttribute('role') === 'button') {
        return true;
      }
      if (el.getAttribute('onclick') || el.getAttribute('tabindex')) {
        return true;
      }
      const style = window.getComputedStyle(el);
      return style.cursor === 'pointer';
    };
    const isVisible = (el) => {
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return (
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        rect.width > 30 &&
        rect.height > 16 &&
        rect.width < Math.min(window.innerWidth * 0.7, 420) &&
        rect.height < 120 &&
        rect.bottom > 0 &&
        rect.right > 0 &&
        rect.top < window.innerHeight &&
        rect.left < window.innerWidth
      );
    };
    const getClickable = (el) => el.closest('button, a, [role="button"]') || el;
    const primaryCandidates = Array.from(document.querySelectorAll('button, a, [role="button"], input[type="button"], input[type="submit"]'));
    const fallbackCandidates = Array.from(document.querySelectorAll('div, span'));
    const candidates = [...primaryCandidates, ...fallbackCandidates];

    for (const node of candidates) {
      const text = normalize(node.innerText || node.textContent);
      if (!matchesLoginText(text)) {
        continue;
      }

      const target = getClickable(node);
      if (!(target instanceof HTMLElement) || !isLikelyActionElement(target) || !isVisible(target)) {
        continue;
      }

      target.click();
      return { clicked: true, text: text.slice(0, 80), tag: target.tagName.toLowerCase() };
    }

    return { clicked: false };
  }, keywords);

  return clickResult;
}

async function findQrElement(page) {
  // Domain-specific first: prefer finding QR inside login popup on Douyin.
  const douyinModal = await page.$('.douyin_login_new_class');
  if (douyinModal) {
    const popupCandidates = await douyinModal.$$('img, canvas');
    let best = null;
    let bestScore = -1;

    for (const candidate of popupCandidates) {
      const meta = await candidate.evaluate((el) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        const parentText = (el.parentElement?.innerText || '').replace(/\s+/g, ' ').trim().toLowerCase();
        const src = el.tagName.toLowerCase() === 'img' ? (el.getAttribute('src') || '') : '';
        return {
          width: rect.width,
          height: rect.height,
          visible: style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0',
          src,
          parentText,
        };
      });

      if (!meta.visible || meta.width < 120 || meta.height < 120 || meta.width > 360 || meta.height > 360) {
        continue;
      }

      const ratio = meta.width / meta.height;
      if (ratio < 0.8 || ratio > 1.25) {
        continue;
      }

      let score = 0;
      if (meta.src.startsWith('data:image/')) {
        score += 5;
      }
      if (meta.src.toLowerCase().includes('qr') || meta.src.toLowerCase().includes('qrcode')) {
        score += 4;
      }
      if (meta.parentText.includes('扫码') || meta.parentText.includes('二维码') || meta.parentText.includes('scan')) {
        score += 3;
      }
      score += Math.max(0, 2 - Math.abs(meta.width - meta.height) / 40);

      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      } else {
        await candidate.dispose();
      }
    }

    await douyinModal.dispose();
    if (best) {
      return { element: best, source: 'douyin-popup-candidate' };
    }
  }

  for (const selector of QR_CODE_SELECTORS) {
    const element = await page.$(selector);
    if (!element) {
      continue;
    }

    const visible = await isElementVisible(element).catch(() => false);
    if (visible) {
      return { element, source: `selector:${selector}` };
    }
  }

  const qrContainerHandle = await page.evaluateHandle((keywords) => {
    const normalize = (text) => (text || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const isVisible = (el) => {
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return (
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        rect.width > 80 &&
        rect.height > 80
      );
    };

    const containers = Array.from(document.querySelectorAll('dialog, section, aside, div'));
    for (const container of containers) {
      const text = normalize(container.innerText || container.textContent);
      if (!text || !keywords.some((keyword) => text.includes(keyword))) {
        continue;
      }

      if (!isVisible(container)) {
        continue;
      }

      const qrCandidate = container.querySelector('img, canvas');
      if (qrCandidate && isVisible(qrCandidate)) {
        return qrCandidate;
      }
    }

    return null;
  }, QR_CONTAINER_KEYWORDS);

  const qrContainerElement = qrContainerHandle.asElement();
  if (qrContainerElement) {
    return { element: qrContainerElement, source: 'container-text' };
  }

  await qrContainerHandle.dispose();
  return null;
}

async function trySwitchToQrTab(page, inputKeywords = QR_TAB_KEYWORDS) {
  const keywords = inputKeywords.map((keyword) => keyword.toLowerCase());
  const result = await page.evaluate((needles) => {
    const normalize = (text) => (text || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const isVisible = (el) => {
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return (
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        rect.width > 28 &&
        rect.height > 16 &&
        rect.bottom > 0 &&
        rect.right > 0 &&
        rect.top < window.innerHeight &&
        rect.left < window.innerWidth
      );
    };

    const candidates = Array.from(document.querySelectorAll('button, a, [role="button"], div, span'));
    for (const node of candidates) {
      const text = normalize(node.innerText || node.textContent);
      if (!text || !needles.some((needle) => text.includes(needle))) {
        continue;
      }

      const target = node.closest('button, a, [role="button"]') || node;
      if (!(target instanceof HTMLElement) || !isVisible(target)) {
        continue;
      }

      target.click();
      return { switched: true, text: text.slice(0, 80) };
    }

    return { switched: false };
  }, keywords);

  return result;
}

/**
 * 检测二维码并保存图片
 */
async function tryCaptureLoginQrCode(page, domain) {
  const maxAttempts = 20;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const found = await findQrElement(page);
    if (found && found.element) {
      const qrPath = path.join(SESSION_DIR, `login-qr-${toFileSafeDomain(domain)}-${Date.now()}.png`);
      await found.element.screenshot({ path: qrPath });
      await found.element.dispose();
      return { qrPath, source: found.source };
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return null;
}

/**
 * 打开页面后自动处理登录入口和二维码
 */
async function autoHandleLoginEntry(page, domain, config = {}) {
  const loginKeywords = mergeKeywords(config.loginButtonKeywords, LOGIN_BUTTON_KEYWORDS);
  const qrTabKeywords = mergeKeywords(config.qrTabKeywords, QR_TAB_KEYWORDS);

  console.log('🤖 尝试自动点击登录按钮...');
  const clickResult = await tryAutoClickLoginButton(page, loginKeywords);

  if (!clickResult.clicked) {
    console.log('⚠️  未自动找到登录按钮，请手动点击登录。');
    return null;
  }

  if (clickResult.tag) {
    console.log(`✓ 已自动点击登录入口: <${clickResult.tag}> ${clickResult.text}`);
  } else {
    console.log(`✓ 已自动点击登录入口: ${clickResult.text}`);
  }
  try {
    await page.waitForNavigation({
      waitUntil: 'networkidle2',
      timeout: 8000,
    });
    console.log('✓ 已检测到登录入口触发页面跳转');
  } catch (_error) {
    // No navigation is also acceptable (e.g. modal popup in same page).
  }
  await new Promise((resolve) => setTimeout(resolve, 1500));

  let switched;
  try {
    switched = await trySwitchToQrTab(page, qrTabKeywords);
  } catch (error) {
    if ((error.message || '').includes('Execution context was destroyed')) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      switched = await trySwitchToQrTab(page, qrTabKeywords).catch(() => ({ switched: false }));
    } else {
      throw error;
    }
  }
  if (switched && switched.switched) {
    console.log(`✓ 已切换到二维码登录: ${switched.text}`);
    await new Promise((resolve) => setTimeout(resolve, 1200));
  }

  console.log('🔍 检测是否出现二维码登录弹窗...');
  let qrResult;
  try {
    qrResult = await tryCaptureLoginQrCode(page, domain);
  } catch (error) {
    if ((error.message || '').includes('Execution context was destroyed')) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      qrResult = await tryCaptureLoginQrCode(page, domain).catch(() => null);
    } else {
      throw error;
    }
  }
  if (!qrResult) {
    console.log('⚠️  未检测到二维码弹窗，你可以手动切换到二维码登录。');
    return null;
  }

  console.log(`✅ 二维码已保存: ${qrResult.qrPath}`);
  console.log(`   检测来源: ${qrResult.source}`);
  return qrResult;
}

/**
 * 验证 URL
 */
function validateUrl(targetUrl) {
  try {
    const parsed = new URL(targetUrl);
    if (!parsed.protocol.match(/^https?:$/)) {
      return null;
    }
    return parsed;
  } catch (error) {
    return null;
  }
}

/**
 * 从 URL 提取域名
 */
function extractDomain(targetUrl) {
  return new URL(targetUrl).hostname;
}

/**
 * 获取网站配置
 */
function getSiteConfig(domain) {
  // 移除 www. 前缀
  const cleanDomain = domain.replace(/^www\./, '');

  // 精确匹配
  if (SITE_CONFIGS[cleanDomain]) {
    return SITE_CONFIGS[cleanDomain];
  }

  // 部分匹配（例如：www.instagram.com 匹配 instagram.com）
  for (const [key, config] of Object.entries(SITE_CONFIGS)) {
    if (cleanDomain.includes(key) || key.includes(cleanDomain)) {
      return config;
    }
  }

  // 返回默认配置
  return {
    authCookieName: null, // 不强制要求特定 cookie
    loginIndicators: [],
  };
}

/**
 * 保存 cookies 到文件（基于域名）
 */
function saveCookies(cookies, domain) {
  const filename = `cookies-${domain.replace(/\./g, '-')}.json`;
  const cookieFile = path.join(SESSION_DIR, filename);

  fs.writeFileSync(cookieFile, JSON.stringify(cookies, null, 2));
  console.log(`✅ Cookies 已保存到: ${cookieFile}`);

  return cookieFile;
}

/**
 * 检测登录状态
 */
async function detectLoginStatus(page, targetUrl, config) {
  const domain = extractDomain(targetUrl);

  // 方法 1: Cookie 检测
  console.log('🔍 检测登录状态 (Cookie 检测)...');
  const cookies = await page.cookies();

  // 如果配置了特定的认证 cookie，检查它是否存在
  if (config.authCookieName) {
    const authCookie = cookies.find(c => c.name === config.authCookieName);
    if (authCookie) {
      console.log(`✓ 找到认证 cookie: ${authCookie.name}`);
      return {
        success: true,
        method: 'cookie',
        cookieName: authCookie.name,
        cookieValue: authCookie.value.substring(0, 20) + '...'
      };
    }
  }

  // 通用 Cookie 检测：查找包含 session/auth/token 的 cookie
  const authCookies = cookies.filter(c =>
    c.name.toLowerCase().includes('session') ||
    c.name.toLowerCase().includes('auth') ||
    c.name.toLowerCase().includes('token') ||
    c.name.toLowerCase().includes('sid')
  );

  if (authCookies.length > 0) {
    console.log(`✓ 找到 ${authCookies.length} 个可能的认证 cookie:`);
    authCookies.forEach(c => {
      console.log(`  - ${c.name}`);
    });
    return {
      success: true,
      method: 'cookie-guess',
      cookies: authCookies.map(c => c.name)
    };
  }

  // 方法 2: URL 变化检测
  console.log('⚠️  未找到认证 cookie，尝试 URL 变化检测...');
  const currentUrl = page.url();
  if (currentUrl !== targetUrl && currentUrl.includes(domain)) {
    console.log(`✓ URL 已变化: ${currentUrl}`);
    return {
      success: true,
      method: 'url-change',
      url: currentUrl
    };
  }

  // 方法 3: DOM 元素检测（如果配置了）
  if (config.loginIndicators && config.loginIndicators.length > 0) {
    console.log('⚠️  尝试 DOM 元素检测...');
    for (const selector of config.loginIndicators) {
      try {
        const element = await page.$(selector);
        if (element) {
          console.log(`✓ 找到登录指示器: ${selector}`);
          return {
            success: true,
            method: 'dom-element',
            selector: selector
          };
        }
      } catch (e) {
        // 继续尝试下一个选择器
      }
    }
  }

  // 所有检测方法都失败
  return {
    success: false,
    method: 'none',
    message: '无法确定登录状态'
  };
}

/**
 * 登录网站
 */
async function login(targetUrl, options = {}) {
  let browser;
  try {
    // 验证 URL
    const parsedUrl = validateUrl(targetUrl);
    if (!parsedUrl) {
      console.error('❌ 无效的 URL');
      console.log('请提供有效的 HTTP/HTTPS URL');
      console.log('示例: node login_web.js https://www.instagram.com');
      process.exit(1);
    }

    const domain = extractDomain(targetUrl);
    const config = getSiteConfig(domain);
    const debugPort = parsePort(options.debugPort || DEFAULT_DEBUG_PORT);
    if (!debugPort) {
      throw new Error(`无效调试端口: ${options.debugPort}`);
    }

    console.log('\n🌐 启动 Chrome 浏览器...\n');
    console.log(`📍 目标网站: ${domain}`);
    console.log(`🧩 调试端口: ${debugPort}`);
    if (config.authCookieName) {
      console.log(`🔑 认证 Cookie: ${config.authCookieName}`);
    } else {
      console.log(`🔑 认证方式: 通用检测`);
    }
    console.log('');

    // 启动浏览器
    browser = await puppeteer.launch({
      headless: false, // 显示浏览器窗口
      defaultViewport: null,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        `--remote-debugging-port=${debugPort}`, // 启用远程调试端口
      ]
    });

    const pages = await browser.pages();
    const page = pages[0];

    // 设置 user agent
    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    console.log('📱 打开登录页面...\n');
    console.log('═══════════════════════════════════════════════════════');
    console.log('  请在浏览器中完成以下步骤:');
    console.log('═══════════════════════════════════════════════════════');
    console.log('');
    console.log('  1. 在页面中找到登录按钮/链接');
    console.log('  2. 输入你的用户名和密码');
    console.log('  3. 如果需要，完成双重验证 (2FA)');
    console.log('  4. 等待看到登录后的页面');
    console.log('');
    console.log('  ⏳ 慢慢来，不着急！');
    console.log('');
    console.log('  → 登录成功后回到这里按 ENTER 键');
    console.log('');
    console.log('═══════════════════════════════════════════════════════\n');

    // 访问目标网站
    await page.goto(targetUrl, {
      waitUntil: 'networkidle2',
      timeout: 60000
    });

    // 自动点击登录并尝试保存二维码
    await autoHandleLoginEntry(page, domain, config);

    console.log('⏳ 等待你完成登录...\n');

    // 等待用户按 Enter
    await waitForEnter();

    console.log('✓ 检测到登录! 等待页面加载...\n');

    // 等待页面加载
    await new Promise(resolve => setTimeout(resolve, 3000));

    // 检测登录状态
    const loginStatus = await detectLoginStatus(page, targetUrl, config);

    if (!loginStatus.success) {
      console.error('❌ 登录状态检测失败');
      console.log('请确保你已经成功登录并看到登录后的页面');
      console.log(`检测方法: ${loginStatus.method}`);
      console.log(`消息: ${loginStatus.message}`);
      await browser.close();
      process.exit(1);
    }

    console.log(`\n✅ 登录成功! (检测方式: ${loginStatus.method})\n`);

    // 获取所有 cookies
    console.log('🍪 提取 session cookies...\n');
    const cookies = await page.cookies();

    // 保存 cookies
    saveCookies(cookies, domain);

    // 保存浏览器连接信息
    const browserInfo = {
      webSocketDebuggerUrl: `ws://127.0.0.1:${browser.wsEndpoint()?.split(':').pop()}`,
      pid: browser.process()?.pid
    };

    // 保存浏览器信息供其他脚本使用
    const browserInfoFile = path.join(SESSION_DIR, 'browser-info.json');
    fs.writeFileSync(browserInfoFile, JSON.stringify(browserInfo, null, 2));

    console.log(`\n📋 浏览器连接信息已保存`);
    console.log(`  文件: ${browserInfoFile}\n`);

    // 生成 MCP 配置
    generateMCPConfig(domain, debugPort);

    // 显示登录信息
    console.log('═══════════════════════════════════════════════════════');
    console.log('  Session 信息:');
    console.log('═══════════════════════════════════════════════════════');
    console.log(`  网站: ${domain}`);
    console.log(`  Cookies 数量: ${cookies.length}`);
    if (loginStatus.method === 'cookie' || loginStatus.method === 'cookie-guess') {
      if (loginStatus.cookieName) {
        console.log(`  认证 Cookie: ${loginStatus.cookieName}`);
      }
      if (loginStatus.cookies) {
        console.log(`  可能的认证 Cookies: ${loginStatus.cookies.join(', ')}`);
      }
    }
    console.log('═══════════════════════════════════════════════════════\n');

    console.log('🎉 现在你可以使用搜索功能了!');
    console.log('在新的终端窗口运行: node search-user.js "搜索关键词"\n');

    console.log('═══════════════════════════════════════════════════════');
    console.log('  浏览器将保持打开状态');
    console.log('  Cookies 已保存，可以随时使用搜索功能');
    console.log('  按 Ctrl+C 关闭浏览器和退出程序');
    console.log('═══════════════════════════════════════════════════════\n');

    // 保持进程运行，不关闭浏览器
    await keepProcessAlive(browser);

  } catch (error) {
    console.error('❌ 登录出错:', error.message);
    if (browser) {
      await browser.close();
    }
    process.exit(1);
  }
}

/**
 * 保持进程活跃
 */
async function keepProcessAlive(browser) {
  return new Promise((resolve) => {
    // 监听退出信号
    process.on('SIGINT', async () => {
      console.log('\n\n👋 正在关闭浏览器...');
      await browser.close();
      console.log('✅ 浏览器已关闭');
      process.exit(0);
    });

    // 保持进程运行
    console.log('⏳ 进程运行中... (按 Ctrl+C 退出)\n');
  });
}

/**
 * 等待用户按 Enter
 */
function waitForEnter() {
  return new Promise((resolve) => {
    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);

    process.stdin.once('keypress', (str, key) => {
      if (key.name === 'return' || key.name === 'enter') {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        resolve();
      }
    });
  });
}

/**
 * 生成 MCP 配置文件
 */
function generateMCPConfig(domain, debugPort) {
  console.log('🔧 生成 MCP 配置文件...\n');

  const mcpConfig = {
    mcpServers: {
      puppeteer: {
        command: "npx",
        args: ["-y", "puppeteer-mcp-server"],
        env: {
          DEBUG_PORT: String(debugPort)
        }
      }
    }
  };

  const configDir = process.platform === 'darwin'
    ? path.join(process.env.HOME, 'Library/Application Support/Claude')
    : path.join(process.env.APPDATA || '', 'Claude');

  const cursorConfigDir = process.platform === 'darwin'
    ? path.join(process.env.HOME, '.cursor')
    : path.join(process.env.USERPROFILE || '', '.cursor');

  const mcpConfigFile = path.join(SESSION_DIR, 'mcp-config.json');
  fs.writeFileSync(mcpConfigFile, JSON.stringify(mcpConfig, null, 2));

  console.log('═══════════════════════════════════════════════════════');
  console.log('  🔗 MCP 服务器配置');
  console.log('═══════════════════════════════════════════════════════\n');

  console.log('📝 配置文件已生成:');
  console.log(`   ${mcpConfigFile}\n`);

  console.log('📋 puppeteer-mcp-server 已配置:');
  console.log(`   调试端口: ${debugPort}`);
  console.log(`   目标网站: ${domain}\n`);

  console.log('📘 下一步：将配置添加到 Claude Desktop 或 Cursor\n');

  console.log('═══════════════════════════════════════════════════════');
  console.log('  方法 1: Claude Desktop (macOS)');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  配置文件: ${configDir}/claude_desktop_config.json\n`);
  console.log('  复制以下内容到配置文件:\n');
  console.log(JSON.stringify(mcpConfig, null, 2));
  console.log('');

  console.log('═══════════════════════════════════════════════════════');
  console.log('  方法 2: Cursor (macOS/Windows/Linux)');
  console.log('═══════════════════════════════════════════════════════');
  console.log('  Cursor 自动读取 ~/.cursorrules 或项目根目录的配置\n');
  console.log('  复制以下内容到项目根目录的 mcp_config.json:\n');
  console.log(JSON.stringify(mcpConfig, null, 2));
  console.log('');

  console.log('═══════════════════════════════════════════════════════');
  console.log('  🚀 可用的 MCP 工具');
  console.log('═══════════════════════════════════════════════════════');
  const tools = [
    { name: 'puppeteer_connect_active_tab', desc: '连接到当前浏览器标签页' },
    { name: 'puppeteer_navigate', desc: '导航到新 URL' },
    { name: 'puppeteer_screenshot', desc: '截图当前页面' },
    { name: 'puppeteer_click', desc: '点击页面元素' },
    { name: 'puppeteer_fill', desc: '填写表单字段' },
    { name: 'puppeteer_evaluate', desc: '执行 JavaScript 代码' },
    { name: 'puppeteer_hover', desc: '悬停在元素上' },
    { name: 'puppeteer_select', desc: '选择下拉菜单' },
  ];

  tools.forEach((tool, index) => {
    console.log(`  ${index + 1}. ${tool.name.padEnd(35)} - ${tool.desc}`);
  });
  console.log('═══════════════════════════════════════════════════════\n');

  console.log('💡 提示：');
  console.log('   1. 确保已安装 puppeteer-mcp-server:');
  console.log('      npm install -g puppeteer-mcp-server');
  console.log('');
  console.log('   2. 重启 Claude Desktop 或 Cursor');
  console.log('');
  console.log('   3. 在对话中使用 MCP 工具:');
  console.log('      "使用 puppeteer_connect_active_tab 连接到当前页面"');
  console.log('      "使用 puppeteer_screenshot 截图"');
  console.log('      "使用 puppeteer_evaluate 执行 JavaScript"');
  console.log('');
}

// 主函数
async function main() {
  const options = parseCliOptions(process.argv.slice(2));
  const targetUrl = options.targetUrl;

  if (options.help) {
    printUsage();
    process.exit(0);
  }

  if (options.error) {
    console.error(`❌ ${options.error}\n`);
    printUsage();
    process.exit(1);
  }

  if (!targetUrl) {
    printUsage();
    process.exit(1);
  }

  await login(targetUrl, { debugPort: options.debugPort });
}

// 运行
if (require.main === module) {
  main();
}

module.exports = { login };
