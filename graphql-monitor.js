#!/usr/bin/env node

/**
 * Instagram GraphQL Monitor
 * 监听所有 Instagram GraphQL 请求并记录到文件
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

// 输出目录
const OUTPUT_DIR = path.join(__dirname, 'graphql-logs');
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

/**
 * 启动浏览器并开始监听
 */
async function startMonitor() {
  console.log('🚀 启动 GraphQL 监听器...\n');

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    ]
  });

  const page = await browser.newPage();

  // 设置请求拦截
  page.on('request', async (request) => {
    const url = request.url();

    // 只记录 GraphQL 请求
    if (url.includes('/graphql/query')) {
      const requestData = {
        method: request.method(),
        url: url,
        headers: request.headers(),
        postData: request.postData(),
      };

      // 保存到文件
      const timestamp = new Date().toISOString();
      const logFile = path.join(OUTPUT_DIR, `graphql-${timestamp}.json`);

      // 同时保存到当前日志文件（追加模式）
      const currentLogFile = path.join(OUTPUT_DIR, 'graphql-current.json');

      fs.writeFileSync(logFile, JSON.stringify(requestData, null, 2));
      fs.appendFileSync(currentLogFile, JSON.stringify(requestData, null, 2) + '\n');

      console.log(`📋 GraphQL 请求已记录`);
      console.log(`   URL: ${url}`);
      console.log(`   文件: ${path.basename(logFile)}`);
    }
  });

  // 访问 Instagram（使用 login.js 保存的 cookies）
  console.log('🌐 访问 Instagram...\n');

  // 加载 cookies
  const SESSION_DIR = path.join(__dirname, '.instagram-cli', 'sessions');
  const COOKIE_FILE = path.join(SESSION_DIR, 'cookies.json');

  if (fs.existsSync(COOKIE_FILE)) {
    const cookies = JSON.parse(fs.readFileSync(COOKIE_FILE, 'utf8'));
    console.log(`🍪 加载 ${cookies.length} 个 cookies`);

    // 分配 cookies 给页面
    await page.setCookie(...cookies.map(c => ({
      name: c.name,
      value: c.value,
      domain: c.domain || '.instagram.com',
      path: c.path || '/',
      secure: c.secure || true,
      httpOnly: c.httpOnly || false,
      sameSite: c.sameSite || false,
      expirationDate: c.expirationDate,
      size: c.session ? c.size : undefined
    })));
  } else {
    console.log('❌ 未找到 cookies 文件');
    console.log('请先运行: node login.js\n');
    process.exit(1);
  }

  console.log('✅ Cookies 已加载，导航到 Instagram\n');
  await page.goto('https://www.instagram.com/', {
    waitUntil: 'networkidle2',
    timeout: 60000
  });

  console.log('\n✅ GraphQL 监听器已启动！');
  console.log('═══════════════════════════════════════════');
  console.log('  监听中，会记录所有 GraphQL 请求到文件:');
  console.log(`   📁 请求日志: ${OUTPUT_DIR}/graphql-*.json`);
  console.log(`   📄 当前日志: ${OUTPUT_DIR}/graphql-current.json`);
  console.log('═════════════════════════════════════════\n');
  console.log('  💡 提示：按 Ctrl+C 停止监听');
  console.log('═══════════════════════════════════════\n');

  // 保持监听
  await new Promise(() => {});
}

// 启动监听
startMonitor().catch(err => {
  console.error('❌ 启动失败:', err.message);
  process.exit(1);
});
