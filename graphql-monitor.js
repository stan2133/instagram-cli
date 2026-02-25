#!/usr/bin/env node

/**
 * Instagram GraphQL Monitor
 * 监听 Instagram GraphQL 请求并记录到文件
 */

'use strict';

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const SESSION_DIR = path.join(__dirname, '.instagram-cli', 'sessions');
const BROWSER_INFO_FILE = path.join(SESSION_DIR, 'browser-info.json');

const DEFAULT_OUTPUT_DIR = path.join(__dirname, 'graphql-logs');
const DEFAULT_DEBUG_PORT = Number(process.env.DEBUG_PORT || 9222);
const DEFAULT_URL_KEYWORD = '/graphql/query';

function parsePort(value, fallback = null) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    return fallback;
  }
  return parsed;
}

function printUsage() {
  console.log('使用方法: node graphql-monitor.js [options]');
  console.log('');
  console.log('Options:');
  console.log('  --output-dir <dir>      日志输出目录 (默认 graphql-logs)');
  console.log('  --debug-port <port>     回退连接调试端口 (默认 9222)');
  console.log('  --url-keyword <text>    请求 URL 过滤关键词 (默认 /graphql/query)');
  console.log('  --max-body-kb <n>       单条响应文本最大记录 KB (默认 512)');
  console.log('  -h, --help              查看帮助');
}

function parseCliArgs(argv) {
  const options = {
    outputDir: DEFAULT_OUTPUT_DIR,
    debugPort: DEFAULT_DEBUG_PORT,
    urlKeyword: DEFAULT_URL_KEYWORD,
    maxBodyKb: 512,
    help: false,
    error: '',
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '-h' || arg === '--help') {
      options.help = true;
      continue;
    }

    if (arg === '--output-dir') {
      const val = argv[i + 1];
      if (!val) {
        options.error = '参数 --output-dir 缺少值';
        return options;
      }
      options.outputDir = val;
      i += 1;
      continue;
    }

    if (arg.startsWith('--output-dir=')) {
      options.outputDir = arg.slice('--output-dir='.length);
      continue;
    }

    if (arg === '--debug-port') {
      const val = argv[i + 1];
      if (!val) {
        options.error = '参数 --debug-port 缺少值';
        return options;
      }
      const parsed = parsePort(val, null);
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

    if (arg === '--url-keyword') {
      const val = argv[i + 1];
      if (!val) {
        options.error = '参数 --url-keyword 缺少值';
        return options;
      }
      options.urlKeyword = val;
      i += 1;
      continue;
    }

    if (arg.startsWith('--url-keyword=')) {
      options.urlKeyword = arg.slice('--url-keyword='.length);
      continue;
    }

    if (arg === '--max-body-kb') {
      const val = argv[i + 1];
      if (!val) {
        options.error = '参数 --max-body-kb 缺少值';
        return options;
      }
      const parsed = Number(val);
      if (!Number.isInteger(parsed) || parsed < 16 || parsed > 10240) {
        options.error = 'max-body-kb 必须是 16~10240 的整数';
        return options;
      }
      options.maxBodyKb = parsed;
      i += 1;
      continue;
    }

    if (arg.startsWith('--max-body-kb=')) {
      const parsed = Number(arg.slice('--max-body-kb='.length));
      if (!Number.isInteger(parsed) || parsed < 16 || parsed > 10240) {
        options.error = 'max-body-kb 必须是 16~10240 的整数';
        return options;
      }
      options.maxBodyKb = parsed;
      continue;
    }

    options.error = `未知参数: ${arg}`;
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

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function safeTimestampForFile(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

function buildLogFilePath(outputDir, count, date = new Date()) {
  const stamp = safeTimestampForFile(date);
  return path.join(outputDir, `graphql-${stamp}-${count}.json`);
}

function parseGraphqlMeta(url, postData) {
  let docId = '';
  let queryHash = '';
  let operationName = '';

  try {
    const u = new URL(url);
    docId = u.searchParams.get('doc_id') || '';
    queryHash = u.searchParams.get('query_hash') || '';
    operationName = u.searchParams.get('fb_api_req_friendly_name') || '';

    const vars = u.searchParams.get('variables');
    if (!operationName && vars) {
      try {
        const parsed = JSON.parse(vars);
        if (parsed && typeof parsed === 'object' && typeof parsed.search_query === 'string') {
          operationName = `search:${parsed.search_query}`;
        }
      } catch (_err) {
        // noop
      }
    }
  } catch (_err) {
    // noop
  }

  if (postData) {
    try {
      const form = new URLSearchParams(postData);
      docId = docId || form.get('doc_id') || '';
      queryHash = queryHash || form.get('query_hash') || '';
      operationName = operationName || form.get('fb_api_req_friendly_name') || '';
    } catch (_err) {
      // noop
    }
  }

  return {
    docId,
    queryHash,
    operationName,
  };
}

function parseResponseBody(text, maxBytes) {
  const raw = typeof text === 'string' ? text : '';
  const tooLarge = Buffer.byteLength(raw, 'utf8') > maxBytes;
  const trimmed = tooLarge
    ? Buffer.from(raw, 'utf8').subarray(0, maxBytes).toString('utf8')
    : raw;

  let json = null;
  try {
    json = JSON.parse(trimmed);
  } catch (_error) {
    json = null;
  }

  return {
    isTruncated: tooLarge,
    text: trimmed,
    json,
  };
}

async function connectToBrowser(debugPort) {
  const errors = [];
  const browserInfo = safeReadJsonFile(BROWSER_INFO_FILE);

  if (browserInfo?.webSocketDebuggerUrl) {
    console.log('✓ 找到已运行的浏览器实例信息');
    console.log(`  WebSocket URL: ${browserInfo.webSocketDebuggerUrl}`);
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

async function pickMonitorPage(browser) {
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

  const url = page.url();
  console.log(`📄 监听页面: ${url || 'about:blank'}\n`);

  return page;
}

async function startMonitor(options = {}) {
  const outputDir = path.isAbsolute(options.outputDir)
    ? options.outputDir
    : path.join(process.cwd(), options.outputDir || DEFAULT_OUTPUT_DIR);
  const debugPort = parsePort(options.debugPort, DEFAULT_DEBUG_PORT);
  const urlKeyword = options.urlKeyword || DEFAULT_URL_KEYWORD;
  const maxBodyBytes = Math.max(16, Number(options.maxBodyKb || 512)) * 1024;

  ensureDir(outputDir);

  console.log('🚀 启动 GraphQL 监听器...\n');
  console.log(`📁 输出目录: ${outputDir}`);
  console.log(`🔎 URL 过滤: ${urlKeyword}`);
  console.log(`📦 最大响应记录: ${Math.floor(maxBodyBytes / 1024)} KB\n`);

  const browser = await connectToBrowser(debugPort);
  const page = await pickMonitorPage(browser);

  let logCount = 0;
  const currentLogFile = path.join(outputDir, 'graphql-current.ndjson');

  const onResponse = async (response) => {
    const url = response.url();
    if (!url.includes(urlKeyword)) {
      return;
    }

    try {
      const request = response.request();
      const postData = request.postData() || '';
      const bodyText = await response.text();
      const parsedBody = parseResponseBody(bodyText, maxBodyBytes);
      const meta = parseGraphqlMeta(url, postData);

      logCount += 1;
      const record = {
        capturedAt: new Date().toISOString(),
        count: logCount,
        pageUrl: page.url(),
        method: request.method(),
        url,
        status: response.status(),
        headers: response.headers(),
        requestData: postData,
        meta,
        response: {
          isJson: Boolean(parsedBody.json),
          isTruncated: parsedBody.isTruncated,
          bodyJson: parsedBody.json,
          bodyText: parsedBody.json ? '' : parsedBody.text,
          bodyLength: Buffer.byteLength(bodyText, 'utf8'),
        },
      };

      const logFile = buildLogFilePath(outputDir, logCount);
      fs.writeFileSync(logFile, JSON.stringify(record, null, 2));
      fs.appendFileSync(currentLogFile, JSON.stringify(record) + '\n');

      console.log(`📋 GraphQL 响应已记录 #${logCount}`);
      console.log(`   URL: ${url}`);
      console.log(`   状态: ${response.status()}`);
      if (meta.operationName || meta.docId || meta.queryHash) {
        console.log(`   Meta: op=${meta.operationName || '-'} doc_id=${meta.docId || '-'} hash=${meta.queryHash || '-'}`);
      }
      console.log(`   文件: ${path.basename(logFile)}\n`);
    } catch (error) {
      console.log(`❌ 记录 GraphQL 响应失败: ${error.message}`);
    }
  };

  page.on('response', onResponse);

  console.log('✅ GraphQL 监听器已启动');
  console.log('═══════════════════════════════════════════');
  console.log(`  请求日志: ${outputDir}/graphql-*.json`);
  console.log(`  汇总日志: ${currentLogFile}`);
  console.log('  按 Ctrl+C 停止监听');
  console.log('═══════════════════════════════════════════\n');

  const stop = async () => {
    page.off('response', onResponse);
    try {
      await browser.disconnect();
    } catch (_error) {
      // noop
    }
  };

  return {
    stop,
    getState() {
      return {
        outputDir,
        currentLogFile,
        urlKeyword,
        debugPort,
        logCount,
      };
    },
  };
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

  let controller;
  try {
    controller = await startMonitor(options);
  } catch (error) {
    console.error('❌ 启动失败:', error.message || error);
    process.exit(1);
  }

  const shutdown = async () => {
    console.log('\n👋 正在停止 GraphQL 监听...');
    try {
      await controller.stop();
    } catch (_error) {
      // noop
    }
    console.log('✅ 监听已停止');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await new Promise(() => {});
}

if (require.main === module) {
  main();
}

module.exports = {
  parseCliArgs,
  parsePort,
  safeTimestampForFile,
  buildLogFilePath,
  parseGraphqlMeta,
  parseResponseBody,
  startMonitor,
};
