#!/usr/bin/env node

/**
 * Instagram User Search Script
 * 使用 Puppeteer 搜索 Instagram 用户并返回前10条结果
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

// Session 存储路径
const SESSION_DIR = path.join(__dirname, '.instagram-cli', 'sessions');
const COOKIE_FILE = path.join(SESSION_DIR, 'cookies.json');

/**
 * 加载已保存的 cookies
 */
function loadCookies() {
  if (fs.existsSync(COOKIE_FILE)) {
    const cookiesData = fs.readFileSync(COOKIE_FILE, 'utf8');
    return JSON.parse(cookiesData);
  }
  return [];
}

/**
 * 使用 Puppeteer 搜索 Instagram 用户
 */
async function searchUsers(query) {
  let browser;
  try {
    console.log(`🔍 正在搜索用户: ${query}`);

    // 启动浏览器
    browser = await puppeteer.launch({
      headless: false, // 显示浏览器窗口
      defaultViewport: null,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-web-security',
      ]
    });

    const page = await browser.newPage();

    // 设置 user agent
    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    // 加载已保存的 cookies
    const cookies = loadCookies();
    if (cookies.length > 0) {
      console.log('🍪 加载已保存的登录状态...');
      await page.setCookie(...cookies);
    }

    // 访问 Instagram 搜索页面
    const searchUrl = `https://www.instagram.com/results/web_search/?search_query=${encodeURIComponent(query)}`;
    console.log(`🌐 访问搜索页面...`);

    await page.goto(searchUrl, {
      waitUntil: 'networkidle2',
      timeout: 60000
    });

    // 等待页面加载
    await new Promise(resolve => setTimeout(resolve, 3000));

    // 尝试查找搜索结果
    const results = await page.evaluate(() => {
      const users = [];

      // Instagram 的搜索结果通常在以下结构中
      // 尝试多种选择器
      const selectors = [
        'div[role="dialog"] a',
        'div[role="listitem"] a',
        'a[href*="/"]',
      ];

      for (const selector of selectors) {
        const elements = document.querySelectorAll(selector);
        if (elements.length > 0) {
          elements.forEach((el, index) => {
            if (index >= 10) return; // 只取前10条

            const href = el.getAttribute('href');

            // 获取头像图片
            let avatarUrl = '';
            const img = el.querySelector('img');
            if (img) {
              avatarUrl = img.src || img.getAttribute('data-src') || '';
            }

            const username = el.querySelector('span')?.textContent?.trim() ||
                           el.textContent?.trim() ||
                           '';

            // 过滤出用户链接（格式：/username/）
            if (href && href.match(/^\/[^\/]+\/$/) && username) {
              // 避免重复
              if (!users.find(u => u.username === username.replace('@', ''))) {
                users.push({
                  username: username.replace('@', ''),
                  profileUrl: `https://www.instagram.com${href}`,
                  fullName: el.getAttribute('title') || '',
                  avatarUrl: avatarUrl || ''
                });
              }
            }
          });

          if (users.length > 0) break;
        }
      }

      return users;
    });

    // 如果上述方法没有找到结果，尝试另一种方法
    if (results.length === 0) {
      console.log('⚠️  使用替代方法搜索...');

      // 访问主页并使用搜索框
      await page.goto('https://www.instagram.com/', {
        waitUntil: 'networkidle2',
        timeout: 60000
      });

      await new Promise(resolve => setTimeout(resolve, 2000));

      // 点击搜索框
      const searchBoxSelectors = [
        'input[placeholder*="Search"]',
        'input[placeholder*="搜索"]',
        'input[type="text"]',
      ];

      for (const selector of searchBoxSelectors) {
        try {
          await page.waitForSelector(selector, { timeout: 5000 });
          await page.click(selector);
          await page.type(selector, query, { delay: 100 });
          await new Promise(resolve => setTimeout(resolve, 3000));

          // 获取搜索结果
          const searchResults = await page.evaluate(() => {
            const users = [];
            const links = document.querySelectorAll('a[href*="/"]');

            links.forEach((link) => {
              if (users.length >= 10) return;

              const href = link.getAttribute('href');
              if (href && href.match(/^\/[^\/]+\/$/)) {
                const username = href.replace(/\//g, '');

                // 获取头像图片
                let avatarUrl = '';
                const img = link.querySelector('img');
                if (img) {
                  avatarUrl = img.src || img.getAttribute('data-src') || '';
                }

                if (!users.find(u => u.username === username)) {
                  users.push({
                    username,
                    profileUrl: `https://www.instagram.com${href}`,
                    fullName: '',
                    avatarUrl: avatarUrl || ''
                  });
                }
              }
            });

            return users;
          });

          if (searchResults.length > 0) {
            results.push(...searchResults);
            break;
          }
        } catch (e) {
          console.log(`尝试选择器 ${selector} 失败`);
          continue;
        }
      }
    }

    // 限制返回前10条结果
    const topResults = results.slice(0, 10);

    console.log(`\n✅ 找到 ${topResults.length} 个用户:\n`);

    // 显示结果
    topResults.forEach((user, index) => {
      console.log(`${index + 1}. @${user.username}`);
      console.log(`   全名: ${user.fullName || '未提供'}`);
      console.log(`   头像: ${user.avatarUrl || '未获取到'}`);
      console.log(`   链接: ${user.profileUrl}`);
      console.log('');
    });

    return topResults;

  } catch (error) {
    console.error('❌ 搜索出错:', error.message);
    throw error;
  } finally {
    if (browser) {
      console.log('\n按 Ctrl+C 关闭浏览器...');
      // 不自动关闭浏览器，让用户可以查看
      // await browser.close();
    }
  }
}

// 主函数
async function main() {
  const query = process.argv[2];

  if (!query) {
    console.log('使用方法: node search-user.js <搜索关键词>');
    console.log('示例: node search-user.js "coco"');
    process.exit(1);
  }

  try {
    const results = await searchUsers(query);

    // 保存结果到文件
    const outputFile = path.join(__dirname, `search-results-${Date.now()}.json`);
    fs.writeFileSync(outputFile, JSON.stringify(results, null, 2));
    console.log(`\n📁 结果已保存到: ${outputFile}`);

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
