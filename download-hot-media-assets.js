#!/usr/bin/env node

/**
 * Instagram Hot Media Assets Downloader
 * 从 fetch-user-hot-media 输出文件中读取帖子 URL，下载全部媒体到本地并生成 metadata
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');
const { spawn } = require('child_process');
const { pipeline } = require('stream/promises');
const {
  createInstagramRequestGuard,
  isCircuitBreakerError,
} = require('./src/services/ig-request-guard');

const SESSION_DIR = path.join(__dirname, '.instagram-cli', 'sessions');
const BROWSER_INFO_FILE = path.join(SESSION_DIR, 'browser-info.json');
const INSTAGRAM_HOME = 'https://www.instagram.com/';
const DEFAULT_DEBUG_PORT = Number(process.env.DEBUG_PORT || 9222);
const DEFAULT_CONCURRENCY = 2;
const DEFAULT_RETRY = 3;
const DEFAULT_TIMEOUT = 60000;
const DEFAULT_OUTPUT_DIR = './downloads';
const IG_WEB_APP_ID = '936619743392459';
const DEFAULT_PROXY = String(
  process.env.HTTPS_PROXY ||
  process.env.https_proxy ||
  process.env.HTTP_PROXY ||
  process.env.http_proxy ||
  process.env.ALL_PROXY ||
  process.env.all_proxy ||
  ''
).trim();

function parsePort(value, fallback = null) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    return fallback;
  }
  return parsed;
}

function parsePositiveInt(value, min, max) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    return null;
  }
  return parsed;
}

function printUsage() {
  console.log('使用方法: node download-hot-media-assets.js --input <hotMediaJson> [options]');
  console.log('');
  console.log('Options:');
  console.log('  --input <file>         fetch-user-hot-media 输出 JSON 文件');
  console.log(`  --output-dir <dir>     下载输出目录 (默认 ${DEFAULT_OUTPUT_DIR})`);
  console.log(`  --concurrency <n>      下载并发数 (默认 ${DEFAULT_CONCURRENCY}，范围 1~8)`);
  console.log(`  --retry <n>            单文件重试次数 (默认 ${DEFAULT_RETRY}，范围 0~10)`);
  console.log(`  --timeout <ms>         下载超时毫秒 (默认 ${DEFAULT_TIMEOUT})`);
  console.log('  --max-posts <n>        仅处理前 n 个帖子(调试用，默认全部)');
  console.log('  --debug-port <port>    回退连接调试端口 (默认 9222)');
  console.log('  --proxy <url>          下载代理，如 http://127.0.0.1:7890 或 socks5://127.0.0.1:7890');
  console.log('  --overwrite            覆盖已存在文件 (默认跳过已存在文件)');
  console.log('  --no-cover             视频不下载封面图');
  console.log('  --keep-connected       执行完成后不主动断开浏览器连接');
  console.log('  -h, --help             查看帮助');
  console.log('');
  console.log('示例:');
  console.log('  node download-hot-media-assets.js --input ./logs/test-hot-media-nike.json');
  console.log('  node download-hot-media-assets.js --input ./logs/test-hot-media-nike.json --output-dir ./downloads --concurrency 2 --retry 3');
}

function maskProxyUrl(rawProxyUrl) {
  try {
    const url = new URL(rawProxyUrl);
    if (url.password) {
      url.password = '***';
    }
    return url.toString();
  } catch (_error) {
    return rawProxyUrl;
  }
}

function parseProxyConfig(proxyInput) {
  const raw = String(proxyInput || '').trim();
  if (!raw) {
    return {
      raw: '',
      masked: '',
      curlProxy: '',
      axiosProxy: null,
      protocol: '',
    };
  }

  const withScheme = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(raw) ? raw : `http://${raw}`;
  let proxyUrl;
  try {
    proxyUrl = new URL(withScheme);
  } catch (_error) {
    throw new Error(`proxy 格式无效: ${raw}`);
  }

  const protocol = proxyUrl.protocol.toLowerCase();
  const supported = ['http:', 'https:', 'socks:', 'socks5:', 'socks5h:', 'socks4:', 'socks4a:'];
  if (!supported.includes(protocol)) {
    throw new Error(`proxy 协议不支持: ${protocol}`);
  }
  if (!proxyUrl.hostname) {
    throw new Error('proxy 缺少主机名');
  }
  if (proxyUrl.port) {
    const port = parsePort(proxyUrl.port, null);
    if (!port) {
      throw new Error('proxy 端口无效');
    }
  }

  let axiosProxy = null;
  if (protocol === 'http:' || protocol === 'https:') {
    axiosProxy = {
      protocol: protocol.slice(0, -1),
      host: proxyUrl.hostname,
      port: proxyUrl.port
        ? Number(proxyUrl.port)
        : (protocol === 'https:' ? 443 : 80),
    };
    if (proxyUrl.username || proxyUrl.password) {
      axiosProxy.auth = {
        username: decodeURIComponent(proxyUrl.username || ''),
        password: decodeURIComponent(proxyUrl.password || ''),
      };
    }
  }

  return {
    raw: withScheme,
    masked: maskProxyUrl(withScheme),
    curlProxy: withScheme,
    axiosProxy,
    protocol: protocol.slice(0, -1),
  };
}

function parseCliArgs(argv) {
  const options = {
    input: '',
    outputDir: DEFAULT_OUTPUT_DIR,
    concurrency: DEFAULT_CONCURRENCY,
    retry: DEFAULT_RETRY,
    timeout: DEFAULT_TIMEOUT,
    maxPosts: 0,
    debugPort: DEFAULT_DEBUG_PORT,
    proxy: DEFAULT_PROXY,
    overwrite: false,
    includeCover: true,
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

    if (arg === '--input') {
      const value = argv[i + 1];
      if (!value) {
        options.error = '参数 --input 缺少文件路径';
        return options;
      }
      options.input = value;
      i += 1;
      continue;
    }

    if (arg.startsWith('--input=')) {
      options.input = arg.slice('--input='.length);
      continue;
    }

    if (arg === '--output-dir') {
      const value = argv[i + 1];
      if (!value) {
        options.error = '参数 --output-dir 缺少目录路径';
        return options;
      }
      options.outputDir = value;
      i += 1;
      continue;
    }

    if (arg.startsWith('--output-dir=')) {
      options.outputDir = arg.slice('--output-dir='.length);
      continue;
    }

    if (arg === '--concurrency') {
      const value = argv[i + 1];
      if (!value) {
        options.error = '参数 --concurrency 缺少值';
        return options;
      }
      const parsed = parsePositiveInt(value, 1, 8);
      if (parsed === null) {
        options.error = 'concurrency 必须是 1~8 的整数';
        return options;
      }
      options.concurrency = parsed;
      i += 1;
      continue;
    }

    if (arg.startsWith('--concurrency=')) {
      const parsed = parsePositiveInt(arg.slice('--concurrency='.length), 1, 8);
      if (parsed === null) {
        options.error = 'concurrency 必须是 1~8 的整数';
        return options;
      }
      options.concurrency = parsed;
      continue;
    }

    if (arg === '--retry') {
      const value = argv[i + 1];
      if (!value) {
        options.error = '参数 --retry 缺少值';
        return options;
      }
      const parsed = parsePositiveInt(value, 0, 10);
      if (parsed === null) {
        options.error = 'retry 必须是 0~10 的整数';
        return options;
      }
      options.retry = parsed;
      i += 1;
      continue;
    }

    if (arg.startsWith('--retry=')) {
      const parsed = parsePositiveInt(arg.slice('--retry='.length), 0, 10);
      if (parsed === null) {
        options.error = 'retry 必须是 0~10 的整数';
        return options;
      }
      options.retry = parsed;
      continue;
    }

    if (arg === '--timeout') {
      const value = argv[i + 1];
      if (!value) {
        options.error = '参数 --timeout 缺少值';
        return options;
      }
      const parsed = parsePositiveInt(value, 1000, 300000);
      if (parsed === null) {
        options.error = 'timeout 必须是 1000~300000 的整数';
        return options;
      }
      options.timeout = parsed;
      i += 1;
      continue;
    }

    if (arg.startsWith('--timeout=')) {
      const parsed = parsePositiveInt(arg.slice('--timeout='.length), 1000, 300000);
      if (parsed === null) {
        options.error = 'timeout 必须是 1000~300000 的整数';
        return options;
      }
      options.timeout = parsed;
      continue;
    }

    if (arg === '--max-posts') {
      const value = argv[i + 1];
      if (!value) {
        options.error = '参数 --max-posts 缺少值';
        return options;
      }
      const parsed = parsePositiveInt(value, 1, 1000);
      if (parsed === null) {
        options.error = 'max-posts 必须是 1~1000 的整数';
        return options;
      }
      options.maxPosts = parsed;
      i += 1;
      continue;
    }

    if (arg.startsWith('--max-posts=')) {
      const parsed = parsePositiveInt(arg.slice('--max-posts='.length), 1, 1000);
      if (parsed === null) {
        options.error = 'max-posts 必须是 1~1000 的整数';
        return options;
      }
      options.maxPosts = parsed;
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

    if (arg === '--proxy') {
      const value = argv[i + 1];
      if (!value) {
        options.error = '参数 --proxy 缺少值';
        return options;
      }
      options.proxy = value;
      i += 1;
      continue;
    }

    if (arg.startsWith('--proxy=')) {
      options.proxy = arg.slice('--proxy='.length);
      continue;
    }

    if (arg === '--overwrite') {
      options.overwrite = true;
      continue;
    }

    if (arg === '--no-cover') {
      options.includeCover = false;
      continue;
    }

    if (arg === '--keep-connected') {
      options.keepConnected = true;
      continue;
    }

    if (!arg.startsWith('-') && !options.input) {
      options.input = arg;
      continue;
    }

    if (arg.startsWith('-')) {
      options.error = `未知参数: ${arg}`;
      return options;
    }

    options.error = `多余参数: ${arg}`;
    return options;
  }

  if (!options.input && !options.help) {
    options.error = '缺少参数 --input';
  }
  if (!options.error) {
    try {
      parseProxyConfig(options.proxy);
    } catch (error) {
      options.error = error.message || String(error);
    }
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

function isValidInstagramPostUrl(raw) {
  const value = String(raw || '').trim();
  if (!value) {
    return false;
  }
  try {
    const url = new URL(value);
    if (!url.hostname.toLowerCase().includes('instagram.com')) {
      return false;
    }
    return /^\/(?:[A-Za-z0-9._]+\/)?(p|reel|tv)\/[A-Za-z0-9_-]+\/?/i.test(url.pathname);
  } catch (_error) {
    return false;
  }
}

function normalizeInputPayload(payload) {
  const data = payload || {};
  const profile = data.profile || {};
  const username = String(profile.username || 'unknown').trim() || 'unknown';
  const capturedAt = String(data?.meta?.capturedAt || new Date().toISOString()).trim();

  const rawUrls = [];
  if (Array.isArray(data.topReelUrls)) {
    rawUrls.push(...data.topReelUrls);
  }
  if (Array.isArray(data.topPostUrls)) {
    rawUrls.push(...data.topPostUrls);
  }
  if (Array.isArray(data.topReels)) {
    rawUrls.push(...data.topReels.map((item) => item?.postUrl));
  }
  if (Array.isArray(data.topPosts)) {
    rawUrls.push(...data.topPosts.map((item) => item?.postUrl));
  }

  const seen = new Set();
  const postUrls = [];
  for (const raw of rawUrls) {
    const value = String(raw || '').trim();
    if (!isValidInstagramPostUrl(value)) {
      continue;
    }
    const key = value.replace(/\/+$/, '').toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    postUrls.push(value.endsWith('/') ? value : `${value}/`);
  }

  return {
    profile: {
      id: String(profile.id || ''),
      username,
      url: String(profile.url || ''),
      fullName: String(profile.fullName || ''),
      isPrivate: Boolean(profile.isPrivate),
      isVerified: Boolean(profile.isVerified),
    },
    capturedAt,
    postUrls,
  };
}

function sanitizePathSegment(value, fallback = 'unknown') {
  const raw = String(value || '').trim();
  const clean = raw.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '');
  return clean || fallback;
}

function normalizeCapturedAtForPath(rawCapturedAt) {
  const parsed = new Date(rawCapturedAt);
  const value = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  return value.toISOString().replace(/[:.]/g, '-');
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeJsonFile(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatErrorMessage(error) {
  if (!error) {
    return 'unknown error';
  }

  if (Array.isArray(error.errors) && error.errors.length) {
    return error.errors
      .map((item) => String(item?.message || item || '').trim())
      .filter(Boolean)
      .join(' | ') || String(error?.message || error);
  }

  if (error.response?.status) {
    return `HTTP ${error.response.status} ${error.response.statusText || ''}`.trim();
  }

  if (error.code && error.message) {
    return `${error.code}: ${error.message}`;
  }

  return String(error.message || error);
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
    await sleep(1200);
  }

  return page;
}

async function openPostAndEnsureLoggedIn(page, postUrl) {
  await page.goto(postUrl, {
    waitUntil: 'networkidle2',
    timeout: 90000,
  });
  await sleep(1200);

  const currentUrl = page.url();
  if (currentUrl.includes('/accounts/login')) {
    throw new Error('当前会话未登录 Instagram，请先运行 node login.js 完成登录');
  }
}

function buildApiHeaders() {
  return {
    'x-requested-with': 'XMLHttpRequest',
    'x-ig-app-id': IG_WEB_APP_ID,
    accept: '*/*',
  };
}

async function fetchJsonInPage(page, apiUrl, requestGuard) {
  const runRequest = async () => page.evaluate(async (url, headers) => {
    try {
      const res = await fetch(url, {
        method: 'GET',
        credentials: 'include',
        headers,
      });
      const text = await res.text();
      let json = null;
      try {
        json = JSON.parse(text);
      } catch (_error) {
        json = null;
      }
      return {
        ok: res.ok,
        status: res.status,
        statusText: res.statusText,
        json,
        textHead: text.slice(0, 320),
      };
    } catch (error) {
      return {
        ok: false,
        status: 0,
        statusText: '',
        json: null,
        textHead: String(error?.message || error || ''),
      };
    }
  }, apiUrl, buildApiHeaders());

  const payload = requestGuard
    ? await requestGuard.run({ url: apiUrl, method: 'GET' }, runRequest)
    : await runRequest();

  if (!payload.ok) {
    throw new Error(`请求失败(${apiUrl}) status=${payload.status}: ${payload.textHead || `${payload.status} ${payload.statusText}`}`);
  }
  if (!payload.json || typeof payload.json !== 'object') {
    throw new Error(`接口返回非 JSON: ${apiUrl}`);
  }

  return payload.json;
}

async function resolveMediaPkFromCurrentPage(page) {
  return page.evaluate(() => {
    const iosUrl =
      document.querySelector('meta[property="al:ios:url"]')?.getAttribute('content') ||
      '';

    let mediaPk = '';
    const iosMatch = iosUrl.match(/instagram:\/\/media\?id=(\d+)/);
    if (iosMatch) {
      mediaPk = iosMatch[1];
    }

    if (!mediaPk) {
      const html = document.documentElement.innerHTML;
      const m = html.match(/"media_id":"(\d+)"/);
      if (m) {
        mediaPk = m[1];
      }
    }

    return { mediaPk };
  });
}

function mapMediaType(item) {
  const mediaType = Number(item?.media_type || 1);
  if (mediaType === 2) {
    return 'video';
  }
  if (mediaType === 8) {
    return 'carousel';
  }
  return 'image';
}

function pickBestVideoUrl(videoVersions) {
  const versions = Array.isArray(videoVersions) ? videoVersions : [];
  if (!versions.length) {
    return '';
  }

  const sorted = [...versions].sort((a, b) => {
    const as = Number(a?.width || 0) * Number(a?.height || 0);
    const bs = Number(b?.width || 0) * Number(b?.height || 0);
    if (bs !== as) {
      return bs - as;
    }
    return Number(b?.type || 0) - Number(a?.type || 0);
  });

  return String(sorted[0]?.url || '').trim();
}

function pickBestImageUrl(candidates) {
  const list = Array.isArray(candidates) ? candidates : [];
  if (!list.length) {
    return '';
  }

  const sorted = [...list].sort((a, b) => {
    const as = Number(a?.width || 0) * Number(a?.height || 0);
    const bs = Number(b?.width || 0) * Number(b?.height || 0);
    return bs - as;
  });

  return String(sorted[0]?.url || '').trim();
}

function inferExtFromUrl(rawUrl, fallbackExt) {
  try {
    const pathname = new URL(rawUrl).pathname || '';
    const ext = path.extname(pathname).toLowerCase().replace('.', '');
    if (/^[a-z0-9]{2,6}$/.test(ext)) {
      return ext;
    }
  } catch (_error) {
    // ignore
  }
  return fallbackExt;
}

function makeMediaEntry(base, item) {
  return {
    postUrl: base.postUrl,
    shortcode: base.shortcode,
    mediaPk: base.mediaPk,
    mediaId: base.mediaId,
    postMediaType: base.postMediaType,
    productType: base.productType,
    ownerUsername: base.ownerUsername,
    kind: item.kind,
    index: item.index,
    sourceUrl: item.sourceUrl,
    ext: item.ext,
  };
}

function mapMediaEntries(mediaItem, postUrl, options = {}) {
  const includeCover = options.includeCover !== false;
  const mediaPk = String(mediaItem?.pk || '');
  const mediaId = String(mediaItem?.id || '');
  const shortcode = String(mediaItem?.code || '').trim();
  const productType = String(mediaItem?.product_type || '').trim();
  const ownerUsername = String(mediaItem?.user?.username || '').trim();
  const postMediaType = mapMediaType(mediaItem);

  const base = {
    postUrl,
    shortcode,
    mediaPk,
    mediaId,
    postMediaType,
    productType,
    ownerUsername,
  };

  const out = [];
  const push = (kind, index, sourceUrl, fallbackExt) => {
    const url = String(sourceUrl || '').trim();
    if (!url) {
      return;
    }
    out.push(makeMediaEntry(base, {
      kind,
      index,
      sourceUrl: url,
      ext: inferExtFromUrl(url, fallbackExt),
    }));
  };

  if (Number(mediaItem?.media_type || 0) === 8 && Array.isArray(mediaItem?.carousel_media)) {
    mediaItem.carousel_media.forEach((child, idx) => {
      const itemIndex = idx + 1;
      const videoUrl = pickBestVideoUrl(child?.video_versions);
      const imageUrl = pickBestImageUrl(child?.image_versions2?.candidates);
      const childType = Number(child?.media_type || 1);

      if (videoUrl) {
        push('carousel_video', itemIndex, videoUrl, 'mp4');
      }
      if (imageUrl && (childType !== 2 || includeCover)) {
        push(childType === 2 ? 'carousel_cover' : 'carousel_image', itemIndex, imageUrl, 'jpg');
      }
    });
  } else {
    const mediaTypeNum = Number(mediaItem?.media_type || 1);
    const videoUrl = pickBestVideoUrl(mediaItem?.video_versions);
    const imageUrl = pickBestImageUrl(mediaItem?.image_versions2?.candidates);

    if (mediaTypeNum === 2 && videoUrl) {
      push('video', 1, videoUrl, 'mp4');
      if (includeCover && imageUrl) {
        push('cover', 1, imageUrl, 'jpg');
      }
    } else if (imageUrl) {
      push('image', 1, imageUrl, 'jpg');
    }
  }

  const dedup = [];
  const seen = new Set();
  for (const item of out) {
    const key = `${item.kind}|${item.index}|${item.sourceUrl}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    dedup.push(item);
  }

  return dedup;
}

function buildFilename(seq, entry) {
  const seqText = String(seq).padStart(3, '0');
  const shortcode = sanitizePathSegment(entry.shortcode || 'unknown', 'unknown');
  const kind = sanitizePathSegment(entry.kind || 'media', 'media');
  const idx = parsePositiveInt(entry.index, 1, 9999) || 1;
  const ext = sanitizePathSegment(entry.ext || 'bin', 'bin').toLowerCase();
  return `${seqText}_${shortcode}_${kind}_${idx}.${ext}`;
}

async function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', resolve);
    stream.on('error', reject);
  });
  return hash.digest('hex');
}

async function downloadFile(url, destPath, options) {
  const timeout = options.timeout;
  const overwrite = Boolean(options.overwrite);
  const proxyConfig = options.proxyConfig || {
    raw: '',
    curlProxy: '',
    axiosProxy: null,
  };

  if (!overwrite && fs.existsSync(destPath)) {
    const stat = fs.statSync(destPath);
    if (stat.size > 0) {
      return {
        skipped: true,
        bytes: stat.size,
        sha256: await sha256File(destPath),
      };
    }
  }

  ensureDir(path.dirname(destPath));
  const partPath = `${destPath}.part`;

  const writeAndFinalize = async (sourceStream) => {
    await pipeline(sourceStream, fs.createWriteStream(partPath));
    fs.renameSync(partPath, destPath);
    const stat = fs.statSync(destPath);
    return {
      skipped: false,
      bytes: stat.size,
      sha256: await sha256File(destPath),
    };
  };

  const downloadViaCurl = () => new Promise((resolve, reject) => {
    const maxSeconds = Math.max(15, Math.ceil(timeout / 1000));
    const connectSeconds = Math.min(30, maxSeconds);
    const args = [
      '-L',
      '--fail',
      '--silent',
      '--show-error',
      '--max-time',
      String(maxSeconds),
      '--connect-timeout',
      String(connectSeconds),
      '-A',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      '-e',
      INSTAGRAM_HOME,
      '-o',
      partPath,
      url,
    ];
    if (proxyConfig.curlProxy) {
      args.unshift(proxyConfig.curlProxy);
      args.unshift('--proxy');
    }

    const child = spawn('curl', args, {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';

    child.stderr.on('data', (chunk) => {
      stderr += String(chunk || '');
    });

    child.on('error', (error) => {
      reject(error);
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(stderr.trim() || `curl exit code ${code}`));
      }
    });
  });

  const axiosDisabledByProxy = Boolean(proxyConfig.raw && !proxyConfig.axiosProxy);
  try {
    if (axiosDisabledByProxy) {
      throw new Error('当前代理协议仅支持 curl 下载');
    }
    if (fs.existsSync(partPath)) {
      fs.unlinkSync(partPath);
    }

    const response = await axios({
      method: 'GET',
      url,
      responseType: 'stream',
      timeout,
      maxRedirects: 5,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Referer: INSTAGRAM_HOME,
      },
      proxy: proxyConfig.axiosProxy || false,
      validateStatus: (status) => status >= 200 && status < 400,
    });

    return await writeAndFinalize(response.data);
  } catch (axiosError) {
    if (fs.existsSync(partPath)) {
      fs.unlinkSync(partPath);
    }

    try {
      await downloadViaCurl();
      const stat = fs.statSync(partPath);
      if (!stat.size) {
        throw new Error('curl 下载结果为空文件');
      }
      fs.renameSync(partPath, destPath);
      const destStat = fs.statSync(destPath);
      return {
        skipped: false,
        bytes: destStat.size,
        sha256: await sha256File(destPath),
      };
    } catch (curlError) {
      if (fs.existsSync(partPath)) {
        fs.unlinkSync(partPath);
      }
      throw new Error(`axios失败(${formatErrorMessage(axiosError)}); curl失败(${formatErrorMessage(curlError)})`);
    }
  }
}

async function downloadWithRetry(url, destPath, options) {
  const retry = options.retry;
  let lastError = null;

  for (let attempt = 1; attempt <= retry + 1; attempt += 1) {
    try {
      return await downloadFile(url, destPath, options);
    } catch (error) {
      lastError = error;
      if (attempt <= retry) {
        const waitMs = Math.min(5000, 300 * 2 ** (attempt - 1));
        await sleep(waitMs);
      }
    }
  }

  throw lastError || new Error('下载失败');
}

async function runPool(items, concurrency, worker) {
  if (!Array.isArray(items) || !items.length) {
    return;
  }

  let cursor = 0;
  const workers = [];
  const count = Math.max(1, Math.min(concurrency, items.length));

  for (let i = 0; i < count; i += 1) {
    workers.push((async () => {
      while (true) {
        const current = cursor;
        cursor += 1;
        if (current >= items.length) {
          break;
        }
        await worker(items[current], current);
      }
    })());
  }

  await Promise.all(workers);
}

async function fetchMediaItemByPostUrl(page, postUrl, requestGuard) {
  await openPostAndEnsureLoggedIn(page, postUrl);

  const resolved = await resolveMediaPkFromCurrentPage(page);
  if (!resolved.mediaPk) {
    throw new Error('无法从页面解析 mediaPk');
  }

  const info = await fetchJsonInPage(
    page,
    `/api/v1/media/${encodeURIComponent(resolved.mediaPk)}/info/`,
    requestGuard
  );
  const item = info?.items?.[0];
  if (!item) {
    throw new Error('未获取到 media info');
  }

  return item;
}

function createOutputPaths(baseOutputDir) {
  const mediaDir = path.join(baseOutputDir, 'media');
  const metadataPath = path.join(baseOutputDir, 'metadata.json');
  const errorsPath = path.join(baseOutputDir, 'errors.json');
  return { mediaDir, metadataPath, errorsPath };
}

async function downloadHotMediaAssets(options = {}) {
  const puppeteer = options.puppeteer || require('puppeteer');
  const proxyConfig = parseProxyConfig(options.proxy);
  const requestGuard = createInstagramRequestGuard({
    scriptName: 'download-hot-media-assets',
  });

  const inputPath = path.isAbsolute(options.input)
    ? options.input
    : path.join(process.cwd(), options.input);
  const inputData = safeReadJsonFile(inputPath);
  if (!inputData) {
    throw new Error(`输入文件不存在或 JSON 解析失败: ${inputPath}`);
  }

  const normalized = normalizeInputPayload(inputData);
  if (!normalized.postUrls.length) {
    throw new Error('输入文件中未找到可用的帖子 URL(topReelUrls/topPostUrls)');
  }

  const postUrls = options.maxPosts > 0
    ? normalized.postUrls.slice(0, options.maxPosts)
    : normalized.postUrls;

  const username = sanitizePathSegment(normalized.profile.username, 'unknown');
  const capturedAtSeg = normalizeCapturedAtForPath(normalized.capturedAt);
  const baseOutputDir = path.join(
    path.isAbsolute(options.outputDir)
      ? options.outputDir
      : path.join(process.cwd(), options.outputDir),
    'instagram',
    username,
    capturedAtSeg
  );
  const { mediaDir, metadataPath, errorsPath } = createOutputPaths(baseOutputDir);

  ensureDir(mediaDir);

  console.log(`🎯 目标账号: @${normalized.profile.username}`);
  console.log(`📌 输入文件: ${inputPath}`);
  console.log(`📌 帖子数量: ${postUrls.length}`);
  console.log(`📁 输出目录: ${baseOutputDir}`);
  console.log(`⚙️  并发: ${options.concurrency}, 重试: ${options.retry}, 超时: ${options.timeout}ms\n`);
  console.log(`🛡️ 请求防护: ${requestGuard.describe()}\n`);
  if (proxyConfig.masked) {
    console.log(`🌐 下载代理: ${proxyConfig.masked}\n`);
  }

  let browser;
  try {
    browser = await connectBrowser(puppeteer, options.debugPort);
  } catch (error) {
    console.log('❌ 无法连接到已登录浏览器');
    console.log('请先运行 login.js 并完成登录，例如:');
    console.log('  node login.js\n');
    throw error;
  }

  const startedAt = new Date().toISOString();
  const errors = [];
  const posts = [];
  const tasks = [];

  try {
    const page = await pickInstagramPage(browser);
    let globalSeq = 1;

    for (let idx = 0; idx < postUrls.length; idx += 1) {
      const postUrl = postUrls[idx];
      const progress = `[${idx + 1}/${postUrls.length}]`;

      try {
        console.log(`${progress} 解析帖子: ${postUrl}`);
        const mediaItem = await fetchMediaItemByPostUrl(page, postUrl, requestGuard);
        const mediaEntries = mapMediaEntries(mediaItem, postUrl, {
          includeCover: options.includeCover,
        });

        const postRecord = {
          rank: idx + 1,
          postUrl,
          shortcode: String(mediaItem?.code || ''),
          mediaPk: String(mediaItem?.pk || ''),
          mediaId: String(mediaItem?.id || ''),
          mediaType: mapMediaType(mediaItem),
          productType: String(mediaItem?.product_type || ''),
          ownerUsername: String(mediaItem?.user?.username || ''),
          takenAt: Number(mediaItem?.taken_at || 0) > 0
            ? new Date(Number(mediaItem.taken_at) * 1000).toISOString()
            : '',
          itemCount: mediaEntries.length,
          status: 'resolved',
          items: [],
        };

        if (!mediaEntries.length) {
          postRecord.status = 'no_media';
          posts.push(postRecord);
          errors.push({
            stage: 'resolve_media_entries',
            postUrl,
            message: '未解析到可下载媒体 URL',
          });
          continue;
        }

        for (const mediaEntry of mediaEntries) {
          const fileName = buildFilename(globalSeq, mediaEntry);
          const absolutePath = path.join(mediaDir, fileName);
          const relativePath = path.join('media', fileName).replace(/\\/g, '/');

          const itemRecord = {
            seq: globalSeq,
            kind: mediaEntry.kind,
            index: mediaEntry.index,
            sourceUrl: mediaEntry.sourceUrl,
            fileName,
            localPath: relativePath,
            ext: mediaEntry.ext,
            status: 'pending',
            bytes: 0,
            sha256: '',
            skipped: false,
            error: '',
          };

          postRecord.items.push(itemRecord);
          tasks.push({
            postUrl,
            shortcode: postRecord.shortcode,
            sourceUrl: mediaEntry.sourceUrl,
            absolutePath,
            itemRecord,
          });
          globalSeq += 1;
        }

        posts.push(postRecord);
      } catch (error) {
        if (isCircuitBreakerError(error)) {
          throw error;
        }
        posts.push({
          rank: idx + 1,
          postUrl,
          status: 'failed',
          error: String(error?.message || error || ''),
          items: [],
        });
        errors.push({
          stage: 'resolve_post',
          postUrl,
          message: String(error?.message || error || ''),
        });
      }
    }

    console.log(`\n📦 待下载媒体数: ${tasks.length}\n`);

    let successCount = 0;
    let failedCount = 0;
    let skippedCount = 0;

    await runPool(tasks, options.concurrency, async (task, idx) => {
      try {
        const result = await downloadWithRetry(task.sourceUrl, task.absolutePath, {
          timeout: options.timeout,
          retry: options.retry,
          overwrite: options.overwrite,
          proxyConfig,
        });

        task.itemRecord.status = result.skipped ? 'skipped' : 'downloaded';
        task.itemRecord.bytes = result.bytes;
        task.itemRecord.sha256 = result.sha256;
        task.itemRecord.skipped = Boolean(result.skipped);

        if (result.skipped) {
          skippedCount += 1;
          console.log(`⏭️  [${idx + 1}/${tasks.length}] 已存在，跳过: ${task.itemRecord.fileName}`);
        } else {
          successCount += 1;
          console.log(`✅ [${idx + 1}/${tasks.length}] 下载完成: ${task.itemRecord.fileName}`);
        }
      } catch (error) {
        failedCount += 1;
        const message = formatErrorMessage(error);
        task.itemRecord.status = 'failed';
        task.itemRecord.error = message;

        errors.push({
          stage: 'download_file',
          postUrl: task.postUrl,
          shortcode: task.shortcode,
          sourceUrl: task.sourceUrl,
          fileName: task.itemRecord.fileName,
          message,
        });

        console.log(`❌ [${idx + 1}/${tasks.length}] 下载失败: ${task.itemRecord.fileName}`);
      }
    });

    const finishedAt = new Date().toISOString();
    const metadata = {
      sourceFile: inputPath,
      profile: normalized.profile,
      capturedAt: normalized.capturedAt,
      startedAt,
      finishedAt,
      options: {
        outputDir: baseOutputDir,
        concurrency: options.concurrency,
        retry: options.retry,
        timeout: options.timeout,
        maxPosts: options.maxPosts,
        includeCover: options.includeCover,
        overwrite: options.overwrite,
        proxy: proxyConfig.masked,
      },
      summary: {
        requestedPostCount: postUrls.length,
        resolvedPostCount: posts.filter((post) => post.status === 'resolved').length,
        failedPostCount: posts.filter((post) => post.status === 'failed').length,
        mediaCount: tasks.length,
        successCount,
        skippedCount,
        failedCount,
      },
      posts,
    };

    writeJsonFile(metadataPath, metadata);
    writeJsonFile(errorsPath, errors);

    console.log('\n🎉 下载任务完成');
    console.log(`✅ 成功: ${successCount}`);
    console.log(`⏭️  跳过: ${skippedCount}`);
    console.log(`❌ 失败: ${failedCount}`);
    console.log(`📄 元数据: ${metadataPath}`);
    console.log(`📄 错误清单: ${errorsPath}`);

    return {
      baseOutputDir,
      metadataPath,
      errorsPath,
      summary: metadata.summary,
    };
  } finally {
    if (browser && !options.keepConnected) {
      await browser.disconnect();
      console.log('✅ 执行完成，已断开浏览器连接\n');
    } else if (browser) {
      console.log('✅ 执行完成，保持浏览器连接\n');
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

  try {
    await downloadHotMediaAssets(options);
  } catch (error) {
    console.error('❌ 下载失败:', formatErrorMessage(error));
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  parsePort,
  parseCliArgs,
  parseProxyConfig,
  normalizeInputPayload,
  isValidInstagramPostUrl,
  mapMediaEntries,
  buildFilename,
  downloadHotMediaAssets,
};
