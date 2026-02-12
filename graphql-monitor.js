#!/usr/bin/env node

/**
 * Instagram GraphQL Monitor
 * 监听所有 Instagram GraphQL 请求并记录到文件
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

// Session 存储路径
const SESSION_DIR = path.join(__dirname, '.instagram-cli', 'sessions');
const BROWSER_INFO_FILE = path.join(SESSION_DIR, 'browser-info.json');

// 输出目录
const OUTPUT_DIR = path.join(__dirname, 'graphql-logs');
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

/**
 * 连接到已运行的浏览器实例
 */
async function connectToExistingBrowser() {
  // 读取浏览器信息
  if (fs.existsSync(BROWSER_INFO_FILE)) {
    const browserInfo = JSON.parse(fs.readFileSync(BROWSER_INFO_FILE, 'utf8'));
    console.log('✓ 找到已运行的浏览器实例');
    console.log(`  WebSocket URL: ${browserInfo.webSocketDebuggerUrl}`);
    return browserInfo;
  }
  return null;
}

/**
 * 启动浏览器并开始监听
 */
async function startMonitor() {
  console.log('🚀 启动 GraphQL 监听器...\n');

  // 检查是否有已运行的浏览器
  const browserInfo = await connectToExistingBrowser();

  let browser;
  let page;

  if (browserInfo) {
    // 连接到现有浏览器
    try {
      browser = await puppeteer.connect({
        browserWSEndpoint: browserInfo.webSocketDebuggerUrl,
        defaultViewport: null,
      });
      console.log('✅ 已连接到现有浏览器实例\n');

      // 获取所有页面
      const pages = await browser.pages();
      page = pages[0]; // 使用第一个页面

      console.log(`📄 监听页面: ${page.url()}\n`);

    } catch (error) {
      console.log('⚠️  连接失败，请确保 login.js 正在运行');
      console.log(`   错误: ${error.message}\n`);
      process.exit(1);
    }
  } else {
    console.log('❌ 未找到已运行的浏览器');
    console.log('请先运行: node login.js');
    console.log('并在浏览器中完成登录\n');
    process.exit(1);
  }

  // 设置响应拦截
  page.on('response', async (response) => {
    const url = response.url();

    // 只记录 GraphQL 响应
    if (url.includes('/graphql/query')) {
      try {
        const responseData = {
          method: response.request().method(),
          url: url,
          status: response.status(),
          headers: response.headers(),
          requestData: response.request().postData(),
          responseData: await response.json(),
        };

        // 保存到文件
        const timestamp = new Date().toISOString();
        const logFile = path.join(OUTPUT_DIR, `graphql-${timestamp}.json`);

        // 同时保存到当前日志文件（追加模式）
        const currentLogFile = path.join(OUTPUT_DIR, 'graphql-current.json');

        fs.writeFileSync(logFile, JSON.stringify(responseData, null, 2));
        fs.appendFileSync(currentLogFile, JSON.stringify(responseData, null, 2) + '\n');

        console.log(`📋 GraphQL 响应已记录`);
        console.log(`   URL: ${url}`);
        console.log(`   状态: ${response.status()}`);
        console.log(`   文件: ${path.basename(logFile)}`);
      } catch (error) {
        console.log(`❌ 解析 GraphQL 响应失败: ${error.message}`);
      }
    }
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
