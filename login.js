#!/usr/bin/env node

/**
 * Simple Instagram Login Script
 * 使用 Puppeteer 打开浏览器登录 Instagram
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// Session 存储路径
const SESSION_DIR = path.join(__dirname, '.instagram-cli', 'sessions');
const COOKIE_FILE = path.join(SESSION_DIR, 'cookies.json');

// 确保 session 目录存在
if (!fs.existsSync(SESSION_DIR)) {
  fs.mkdirSync(SESSION_DIR, { recursive: true });
}

/**
 * 保存 cookies 到文件
 */
function saveCookies(cookies) {
  fs.writeFileSync(COOKIE_FILE, JSON.stringify(cookies, null, 2));
  console.log(`✅ Cookies 已保存到: ${COOKIE_FILE}`);
}

/**
 * 登录 Instagram
 */
async function login() {
  let browser;
  try {
    console.log('\n🌐 启动 Chrome 浏览器...\n');

    // 启动浏览器
    browser = await puppeteer.launch({
      headless: false, // 显示浏览器窗口
      defaultViewport: null,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--remote-debugging-port=9222', // 启用远程调试端口
      ]
    });

    const page = await browser.newPage();

    // 设置 user agent
    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    console.log('📱 打开 Instagram 登录页面...\n');
    console.log('═══════════════════════════════════════════════════════');
    console.log('  请在浏览器中完成以下步骤:');
    console.log('═══════════════════════════════════════════════════════');
    console.log('');
    console.log('  1. 点击 "Log In" 按钮');
    console.log('  2. 输入你的用户名和密码');
    console.log('  3. 如果需要，完成双重验证 (2FA)');
    console.log('  4. 等待看到你的主页/Feed');
    console.log('');
    console.log('  ⏳ 慢慢来，不着急！');
    console.log('');
    console.log('  → 登录成功后回到这里按 ENTER 键');
    console.log('');
    console.log('═══════════════════════════════════════════════════════\n');

    // 访问 Instagram
    await page.goto('https://www.instagram.com/', {
      waitUntil: 'networkidle2',
      timeout: 60000
    });

    console.log('⏳ 等待你完成登录...\n');

    // 等待用户按 Enter
    await waitForEnter();

    console.log('✓ 检测到登录! 等待页面加载...\n');

    // 等待页面加载
    await new Promise(resolve => setTimeout(resolve, 3000));

    // 获取所有 cookies
    console.log('🍪 提取 session cookies...\n');
    const cookies = await page.cookies();

    // 检查是否成功登录（有 sessionid）
    const sessionId = cookies.find(c => c.name === 'sessionid');
    if (!sessionId) {
      console.error('❌ 未找到 sessionid cookie，登录可能失败');
      console.log('请确保你已经成功登录并看到主页');
      await browser.close();
      process.exit(1);
    }

    // 保存 cookies
    saveCookies(cookies);

    // 保存浏览器连接信息
    const browserInfo = {
      webSocketDebuggerUrl: `ws://127.0.0.1:${browser.wsEndpoint()?.split(':').pop()}`,
    pid: browser.process()?.pid
    };

    // 确保 session 目录存在
    if (!fs.existsSync(SESSION_DIR)) {
      fs.mkdirSync(SESSION_DIR, { recursive: true });
    }

    // 保存浏览器信息供其他脚本使用
    const browserInfoFile = path.join(SESSION_DIR, 'browser-info.json');
    fs.writeFileSync(browserInfoFile, JSON.stringify(browserInfo, null, 2));

    console.log(`\n📋 浏览器连接信息已保存`);
    console.log(`  文件: ${browserInfoFile}\n`);

    // 显示登录信息
    console.log('\n✅ 登录成功!\n');
    console.log('═══════════════════════════════════════════════════════');
    console.log('  Session 信息:');
    console.log('═══════════════════════════════════════════════════════');
    console.log(`  Session ID: ${sessionId.value.substring(0, 20)}...`);
    console.log(`  过期时间: ${new Date(sessionId.expires * 1000).toLocaleString()}`);
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

// 主函数
async function main() {
  await login();
}

// 运行
if (require.main === module) {
  main();
}

module.exports = { login };
