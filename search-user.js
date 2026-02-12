#!/usr/bin/env node

/**
 * Instagram User Search Script
 * 使用已登录的浏览器实例搜索用户
 */

const fs = require('fs');
const path = require('path');

// Session 存储路径
const SESSION_DIR = path.join(__dirname, '.instagram-cli', 'sessions');
const BROWSER_INFO_FILE = path.join(SESSION_DIR, 'browser-info.json');

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
 * 使用 Puppeteer 搜索 Instagram 用户
 */
async function searchUsers(query) {
  const puppeteer = require('puppeteer');

  console.log(`🔍 正在搜索用户: ${query}\n`);

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

      // 诊断：打印当前页面 URL
      const currentUrl = page.url();
      console.log(`📄 当前页面: ${currentUrl}\n`);

      // 如果页面是空白，导航到 Instagram
      if (currentUrl === 'about:blank' || !currentUrl.includes('instagram.com')) {
        console.log('🔄 页面为空，导航到 Instagram 主页...\n');
        await page.goto('https://www.instagram.com/', {
          waitUntil: 'networkidle2',
          timeout: 60000
        });
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

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

  try {
    // 先点击搜索图标，触发搜索框出现
    console.log('🔍 尝试点击搜索图标...\n');

    const searchIconSelectors = [
      'svg[aria-label="Search"]',
      'svg[aria-label="搜索"]',
      'button[aria-label="Search"]',
      'button[aria-label="搜索"]',
    ];

    let iconClicked = false;
    for (const selector of searchIconSelectors) {
      try {
        const icon = await page.$(selector);
        if (icon) {
          console.log(`✓ 找到搜索图标: ${selector}\n`);
          await icon.click();
          console.log('✓ 已点击搜索图标\n');
          iconClicked = true;
          await new Promise(resolve => setTimeout(resolve, 2000)); // 等待搜索框出现
          break;
        }
      } catch (e) {
        console.log(`✗ 选择器 ${selector} 未找到`);
        continue;
      }
    }

    if (!iconClicked) {
      console.log('⚠️  未找到搜索图标，可能搜索框已经显示\n');
    }

    // 在查找搜索框
    console.log('🔍 查找搜索框...\n');

    const searchSelectors = [
      'input[aria-label="Search"]',
      'input[aria-label="搜索"]',
      'input[aria-label*="Search"]',
      'input[aria-label*="搜索"]',
    ];

    let searchBox = null;
    let foundSelector = '';

    for (const selector of searchSelectors) {
      try {
        await page.waitForSelector(selector, { timeout: 3000 });
        searchBox = await page.$(selector);
        if (searchBox) {
          foundSelector = selector;
          console.log(`✓ 找到搜索框: ${selector}\n`);
          break;
        }
      } catch (e) {
        console.log(`✗ 选择器 ${selector} 未找到`);
        continue;
      }
    }

    if (searchBox) {
      console.log('✓ 输入搜索内容...\n');
      await searchBox.click();
      await new Promise(resolve => setTimeout(resolve, 500));
      await searchBox.click({ clickCount: 3 }); // 三击全选
      await page.keyboard.press('Backspace'); // 清空
      await page.type(foundSelector, query, { delay: 100 }); // 使用找到的选择器输入

      console.log(`✅ 已输入: "${query}"`);

      // 点击搜索图标或按钮触发搜索
      console.log('🔍 点击搜索图标触发搜索...\n');

      const searchTriggerSelectors = [
        'svg[aria-label="Search"]',
        'svg[aria-label="搜索"]',
        'button[aria-label="Search"]',
        'button[aria-label="搜索"]',
      ];

      let searchTriggered = false;
      for (const triggerSelector of searchTriggerSelectors) {
        try {
          const trigger = await page.$(triggerSelector);
          if (trigger) {
            await trigger.click();
            console.log(`✓ 已点击搜索按钮: ${triggerSelector}\n`);
            searchTriggered = true;
            break;
          }
        } catch (e) {
          continue;
        }
      }

      if (!searchTriggered) {
        console.log('⚠️  未找到搜索按钮，直接使用已输入的搜索内容\n');
      }

      console.log('⏳ 等待 4 秒让搜索结果加载...\n');
      await new Promise(resolve => setTimeout(resolve, 4000));

      // 从页面中提取搜索结果
      const results = await page.evaluate(() => {
        const users = [];

        // 查找搜索结果对话框
        const searchDialog = document.querySelector('[role="dialog"]');
        const searchContainer = searchDialog || document.body;

        // 查找所有 role="link" 的元素
        const userLinks = searchContainer.querySelectorAll('[role="link"]');

        userLinks.forEach((link) => {
          if (users.length >= 10) return;

          const href = link.getAttribute('href');

          // 只匹配用户主页链接 (格式: /username/)
          if (href && href.match(/^\/[^\/]+\/$/) && !href.includes('/')) {
            const username = href.replace(/\//g, '');

            // 获取头像图片
            let avatarUrl = '';
            const img = link.querySelector('img');
            if (img) {
              avatarUrl = img.src || img.getAttribute('data-src') || img.getAttribute('srcset') || '';
            }

            // 获取用户名显示文本
            const usernameEl = link.querySelector('span');
            const displayUsername = usernameEl ? usernameEl.textContent.trim() : username;

            // 检查是否已验证
            const verifiedBadge = link.querySelector('svg[aria-label="Verified"]');
            const isVerified = !!verifiedBadge;

            if (!users.find(u => u.username === username)) {
              users.push({
                username,
                displayName: displayUsername,
                profileUrl: `https://www.instagram.com${href}`,
                fullName: '',
                avatarUrl: avatarUrl || '',
                isVerified: isVerified
              });
            }
          }
        });

        return users;
      });

      console.log(`✅ 找到 ${results.length} 个用户:\n`);

      // 显示结果
      results.forEach((user, index) => {
        console.log(`${index + 1}. @${user.username}${user.isVerified ? ' ✓' : ''}`);
        if (user.fullName && user.fullName !== user.username) {
          console.log(`   全名: ${user.fullName}`);
        }
        console.log(`   头像: ${user.avatarUrl || '未获取到'}`);
        console.log(`   链接: ${user.profileUrl}`);
        console.log('');
      });

      return results;
    } else {
      console.log('❌ 未找到搜索框');
      return [];
    }

  } catch (error) {
    console.error('❌ 搜索出错:', error.message);
    throw error;
  } finally {
    // 不关闭浏览器，保持连接
    if (browser) {
      console.log('✅ 搜索完成，浏览器保持打开状态\n');
    }
  }
}

// 主函数
async function main() {
  const query = process.argv[2];

  if (!query) {
    console.log('使用方法: node search-user.js <搜索关键词>');
    console.log('示例: node search-user.js "coco"');
    console.log('\n注意: 请先运行 node login.js 登录并保持浏览器打开\n');
    process.exit(1);
  }

  try {
    await searchUsers(query);

  } catch (error) {
    console.error('搜索失败:', error);
    process.exit(1);
  }
}

// 运行
if (require.main === module) {
  main();
}

module.exports = { searchUsers };
