#!/usr/bin/env node

/**
 * Instagram User Hot Media Fetch Script
 * 基于最近帖子数据，计算并输出某个账号最热的 reels 和 posts 地址
 */

'use strict';

const fs = require('fs');
const path = require('path');

const { fetchUserPosts } = require('./fetch-user-posts');

const DEFAULT_SCAN_LIMIT = 60;
const MAX_SCAN_LIMIT = 200;
const DEFAULT_TOP_REELS = 5;
const DEFAULT_TOP_POSTS = 5;
const MAX_TOP_LIMIT = 50;

function printUsage() {
  console.log('使用方法: node fetch-user-hot-media.js <Instagram账号URL|username> [options]');
  console.log('');
  console.log('Options:');
  console.log(`  --scan-limit <n>       扫描帖子数量上限 (默认 ${DEFAULT_SCAN_LIMIT}，最大 ${MAX_SCAN_LIMIT})`);
  console.log(`  --top-reels <n>        输出最热 reels 数量 (默认 ${DEFAULT_TOP_REELS}，最大 ${MAX_TOP_LIMIT})`);
  console.log(`  --top-posts <n>        输出最热 posts 数量 (默认 ${DEFAULT_TOP_POSTS}，最大 ${MAX_TOP_LIMIT})`);
  console.log('  --fast                 轻量模式：每条帖子仅保留主媒体，减少处理时间');
  console.log('  --output <file>        将结果保存为 JSON 文件');
  console.log('  --debug-port <port>    回退连接调试端口 (默认 9222)');
  console.log('  --keep-connected       执行完成后不主动断开浏览器连接');
  console.log('  -h, --help             查看帮助');
  console.log('');
  console.log('示例:');
  console.log('  node fetch-user-hot-media.js "nike"');
  console.log('  node fetch-user-hot-media.js "https://www.instagram.com/nike/" --scan-limit 120 --top-reels 10 --top-posts 10 --output ./logs/nike-hot-media.json');
}

function parseCliArgs(argv) {
  const options = {
    target: '',
    scanLimit: DEFAULT_SCAN_LIMIT,
    topReels: DEFAULT_TOP_REELS,
    topPosts: DEFAULT_TOP_POSTS,
    fast: false,
    output: '',
    debugPort: 9222,
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

    if (arg === '--scan-limit') {
      const value = argv[i + 1];
      if (!value) {
        options.error = '参数 --scan-limit 缺少值';
        return options;
      }
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_SCAN_LIMIT) {
        options.error = `scan-limit 必须是 1~${MAX_SCAN_LIMIT} 的整数`;
        return options;
      }
      options.scanLimit = parsed;
      i += 1;
      continue;
    }

    if (arg.startsWith('--scan-limit=')) {
      const parsed = Number(arg.slice('--scan-limit='.length));
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_SCAN_LIMIT) {
        options.error = `scan-limit 必须是 1~${MAX_SCAN_LIMIT} 的整数`;
        return options;
      }
      options.scanLimit = parsed;
      continue;
    }

    if (arg === '--top-reels') {
      const value = argv[i + 1];
      if (!value) {
        options.error = '参数 --top-reels 缺少值';
        return options;
      }
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_TOP_LIMIT) {
        options.error = `top-reels 必须是 1~${MAX_TOP_LIMIT} 的整数`;
        return options;
      }
      options.topReels = parsed;
      i += 1;
      continue;
    }

    if (arg.startsWith('--top-reels=')) {
      const parsed = Number(arg.slice('--top-reels='.length));
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_TOP_LIMIT) {
        options.error = `top-reels 必须是 1~${MAX_TOP_LIMIT} 的整数`;
        return options;
      }
      options.topReels = parsed;
      continue;
    }

    if (arg === '--top-posts') {
      const value = argv[i + 1];
      if (!value) {
        options.error = '参数 --top-posts 缺少值';
        return options;
      }
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_TOP_LIMIT) {
        options.error = `top-posts 必须是 1~${MAX_TOP_LIMIT} 的整数`;
        return options;
      }
      options.topPosts = parsed;
      i += 1;
      continue;
    }

    if (arg.startsWith('--top-posts=')) {
      const parsed = Number(arg.slice('--top-posts='.length));
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_TOP_LIMIT) {
        options.error = `top-posts 必须是 1~${MAX_TOP_LIMIT} 的整数`;
        return options;
      }
      options.topPosts = parsed;
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

    if (arg === '--fast') {
      options.fast = true;
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
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
        options.error = 'debug-port 必须是有效端口号';
        return options;
      }
      options.debugPort = parsed;
      i += 1;
      continue;
    }

    if (arg.startsWith('--debug-port=')) {
      const parsed = Number(arg.slice('--debug-port='.length));
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
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

function isReelPost(post) {
  const productType = String(post?.productType || '').toLowerCase();
  if (productType === 'clips') {
    return true;
  }
  return String(post?.postUrl || '').includes('/reel/');
}

function computeMediaHotScore(post, nowUnix = Math.floor(Date.now() / 1000)) {
  const likePart = Number(post?.likeCount || 0);
  const commentPart = Number(post?.commentCount || 0) * 8;
  const viewPart = Math.max(Number(post?.viewCount || 0), Number(post?.playCount || 0)) * 0.15;
  const pinnedPart = post?.isPinned ? 60 : 0;
  const captionPart = post?.caption ? 5 : 0;

  const takenAtUnix = Number(post?.takenAtUnix || 0);
  const ageHours = takenAtUnix > 0 ? Math.max(0, (nowUnix - takenAtUnix) / 3600) : 0;
  const decay = ageHours * 0.12;

  return likePart + commentPart + viewPart + pinnedPart + captionPart - decay;
}

function toHotEntry(post, rank, nowUnix = Math.floor(Date.now() / 1000)) {
  const score = computeMediaHotScore(post, nowUnix);
  return {
    rank,
    shortcode: String(post?.shortcode || ''),
    postUrl: String(post?.postUrl || ''),
    mediaType: String(post?.mediaType || ''),
    productType: String(post?.productType || ''),
    likeCount: Number(post?.likeCount || 0),
    commentCount: Number(post?.commentCount || 0),
    viewCount: Number(post?.viewCount || 0),
    playCount: Number(post?.playCount || 0),
    isPinned: Boolean(post?.isPinned),
    takenAt: String(post?.takenAt || ''),
    takenAtUnix: Number(post?.takenAtUnix || 0),
    score: Number(score.toFixed(3)),
  };
}

function rankHotMedia(posts, nowUnix = Math.floor(Date.now() / 1000)) {
  const items = Array.isArray(posts) ? posts : [];
  const scored = items.map((post) => ({
    ...post,
    __score: computeMediaHotScore(post, nowUnix),
  }));

  scored.sort((a, b) => {
    if (b.__score !== a.__score) {
      return b.__score - a.__score;
    }
    if (b.likeCount !== a.likeCount) {
      return Number(b.likeCount || 0) - Number(a.likeCount || 0);
    }
    if (b.commentCount !== a.commentCount) {
      return Number(b.commentCount || 0) - Number(a.commentCount || 0);
    }
    return Number(b.takenAtUnix || 0) - Number(a.takenAtUnix || 0);
  });

  return scored.map((item, idx) => toHotEntry(item, idx + 1, nowUnix));
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

async function fetchUserHotMedia(target, options = {}) {
  const startedAtMs = Date.now();
  const scanLimit = Number.isInteger(options.scanLimit) ? options.scanLimit : DEFAULT_SCAN_LIMIT;
  const topReels = Number.isInteger(options.topReels) ? options.topReels : DEFAULT_TOP_REELS;
  const topPosts = Number.isInteger(options.topPosts) ? options.topPosts : DEFAULT_TOP_POSTS;
  const fast = options.fast === true;

  console.log(`🎯 目标账号: ${target}`);
  console.log(`📌 扫描帖子上限: ${scanLimit}`);
  console.log(`🔥 输出 reels 数量: ${topReels}`);
  console.log(`🔥 输出 posts 数量: ${topPosts}`);
  console.log(`⚡ 轻量模式: ${fast ? '开启（仅主媒体）' : '关闭'}\n`);

  const fetchStartedAtMs = Date.now();
  const fetched = await fetchUserPosts(target, {
    limit: scanLimit,
    debugPort: options.debugPort,
    keepConnected: options.keepConnected,
    includeAllMedia: !fast,
    puppeteer: options.puppeteer,
  });
  const fetchPostsMs = Date.now() - fetchStartedAtMs;

  const rankStartedAtMs = Date.now();
  const ranked = rankHotMedia(fetched.posts || []);
  const topReelItems = ranked
    .filter((post) => isReelPost(post))
    .slice(0, topReels)
    .map((item, idx) => ({ ...item, rank: idx + 1 }));
  const topPostItems = ranked
    .filter((post) => !isReelPost(post))
    .slice(0, topPosts)
    .map((item, idx) => ({ ...item, rank: idx + 1 }));
  const rankAndSliceMs = Date.now() - rankStartedAtMs;
  const totalMs = Date.now() - startedAtMs;

  const output = {
    profile: fetched.profile,
    topReels: topReelItems,
    topPosts: topPostItems,
    topReelUrls: topReelItems.map((item) => item.postUrl).filter(Boolean),
    topPostUrls: topPostItems.map((item) => item.postUrl).filter(Boolean),
    meta: {
      capturedAt: new Date().toISOString(),
      scanLimit,
      scannedCount: Array.isArray(fetched.posts) ? fetched.posts.length : 0,
      requestedTopReels: topReels,
      requestedTopPosts: topPosts,
      actualTopReels: topReelItems.length,
      actualTopPosts: topPostItems.length,
      mode: fast ? 'fast' : 'full',
      scoreModel: 'like + comment*8 + max(view,play)*0.15 + pinned + recency_decay',
      timing: {
        fetchPostsMs,
        rankAndSliceMs,
        totalMs,
      },
    },
  };

  console.log(`✅ reels 地址数: ${output.topReelUrls.length}`);
  console.log(`✅ posts 地址数: ${output.topPostUrls.length}`);
  console.log(`⏱️ 耗时: 抓取 ${fetchPostsMs}ms / 排序 ${rankAndSliceMs}ms / 总计 ${totalMs}ms\n`);

  return output;
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
    const data = await fetchUserHotMedia(options.target, {
      scanLimit: options.scanLimit,
      topReels: options.topReels,
      topPosts: options.topPosts,
      fast: options.fast,
      output: options.output,
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
  parseCliArgs,
  isReelPost,
  computeMediaHotScore,
  rankHotMedia,
  fetchUserHotMedia,
};
