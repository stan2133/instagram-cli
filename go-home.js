#!/usr/bin/env node

/**
 * Navigate current browser session to Instagram home page.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const SESSION_DIR = path.join(__dirname, '.instagram-cli', 'sessions');
const BROWSER_INFO_FILE = path.join(SESSION_DIR, 'browser-info.json');
const INSTAGRAM_HOME = 'https://www.instagram.com/';
const DEFAULT_DEBUG_PORT = Number(process.env.DEBUG_PORT || 9222);

function parsePort(value, fallback = null) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    return fallback;
  }
  return parsed;
}

function printUsage() {
  console.log('使用方法: node go-home.js [options]');
  console.log('');
  console.log('Options:');
  console.log(`  --debug-port <port>      回退连接调试端口 (默认 ${DEFAULT_DEBUG_PORT})`);
  console.log('  --target-url <url>       目标首页 URL (默认 Instagram 首页)');
  console.log('  --output <file>          将结果保存为 JSON 文件');
  console.log('  --keep-connected         执行完成后不主动断开浏览器连接');
  console.log('  -h, --help               查看帮助');
}

function parseCliArgs(argv) {
  const options = {
    debugPort: DEFAULT_DEBUG_PORT,
    targetUrl: INSTAGRAM_HOME,
    output: '',
    keepConnected: false,
    help: false,
    error: '',
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '-h' || arg === '--help') {
      options.help = true;
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

    if (arg === '--target-url') {
      const value = argv[i + 1];
      if (!value) {
        options.error = '参数 --target-url 缺少值';
        return options;
      }
      options.targetUrl = value;
      i += 1;
      continue;
    }

    if (arg.startsWith('--target-url=')) {
      options.targetUrl = arg.slice('--target-url='.length);
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

    if (arg === '--keep-connected') {
      options.keepConnected = true;
      continue;
    }

    if (arg.startsWith('-')) {
      options.error = `未知参数: ${arg}`;
      return options;
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

function writeJsonFile(filePath, data) {
  const absolute = path.resolve(process.cwd(), filePath);
  const dir = path.dirname(absolute);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(absolute, JSON.stringify(data, null, 2), 'utf8');
  return absolute;
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

async function pickPage(browser) {
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

  return page;
}

function normalizeTargetUrl(targetUrl) {
  const raw = String(targetUrl || '').trim();
  if (!raw) {
    return INSTAGRAM_HOME;
  }
  return raw;
}

async function goHome(options) {
  const puppeteer = require('puppeteer');
  let browser = null;
  const targetUrl = normalizeTargetUrl(options.targetUrl);

  try {
    browser = await connectBrowser(puppeteer, options.debugPort);
    const page = await pickPage(browser);

    console.log(`📄 当前页面: ${page.url() || 'about:blank'}`);
    console.log(`🏠 跳转首页: ${targetUrl}\n`);

    await page.goto(targetUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await page.bringToFront();

    const result = {
      ok: true,
      targetUrl,
      currentUrl: page.url(),
      title: await page.title(),
      timestamp: new Date().toISOString(),
    };

    if (options.output) {
      const savedTo = writeJsonFile(options.output, result);
      console.log(`📁 结果已保存到: ${savedTo}`);
    }

    console.log('✅ 已回到首页');
    return result;
  } finally {
    if (browser && !options.keepConnected) {
      await browser.disconnect();
      console.log('\n✅ 执行完成，已断开浏览器连接');
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

  console.log('🧭 操作: 回到首页');
  console.log(`🔌 调试端口: ${options.debugPort}`);
  console.log(`🔗 目标 URL: ${options.targetUrl}`);
  if (options.output) {
    console.log(`📁 输出文件: ${options.output}`);
  }
  console.log('');

  try {
    await goHome(options);
  } catch (error) {
    console.error(`❌ 执行失败: ${String(error?.message || error)}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`❌ 未处理错误: ${String(error?.message || error)}`);
    process.exit(1);
  });
}
