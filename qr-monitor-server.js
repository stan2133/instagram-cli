#!/usr/bin/env node

/**
 * QR Monitor HTTP Server
 * 兼容现有 HTTP + SSE 接口，内部复用 QRMonitorCore
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const { QRMonitorManager, parsePort, localIps } = require('./src/qr/monitor-core');

function printUsage() {
  console.log('使用方法: node qr-monitor-server.js [options]');
  console.log('');
  console.log('可选参数:');
  console.log('  --target-domain <domain>   指定监控网站域名 (默认 douyin.com)');
  console.log('  --port <port>              监听端口 (默认 3999)');
  console.log('  --debug-port <port>        浏览器调试端口 (默认 9222)');
  console.log('  --qr-file <filename>       当前二维码文件名 (默认按端口自动区分)');
  console.log('  -h, --help                 显示帮助');
  console.log('');
  console.log('示例:');
  console.log('  node qr-monitor-server.js --target-domain taobao.com --port 4001 --debug-port 9222');
  console.log('  node qr-monitor-server.js --target-domain douyin.com --port 4002 --debug-port 9333');
}

function parseCliOptions(argv) {
  const options = {
    targetDomain: '',
    monitorPort: '',
    debugPort: '',
    qrFile: '',
    help: false,
    error: '',
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg === '--target-domain') {
      options.targetDomain = argv[i + 1] || '';
      if (!options.targetDomain) {
        options.error = '参数 --target-domain 缺少域名';
        return options;
      }
      i += 1;
      continue;
    }
    if (arg.startsWith('--target-domain=')) {
      options.targetDomain = arg.slice('--target-domain='.length);
      continue;
    }
    if (arg === '--port') {
      options.monitorPort = argv[i + 1] || '';
      if (!options.monitorPort) {
        options.error = '参数 --port 缺少端口值';
        return options;
      }
      i += 1;
      continue;
    }
    if (arg.startsWith('--port=')) {
      options.monitorPort = arg.slice('--port='.length);
      continue;
    }
    if (arg === '--debug-port') {
      options.debugPort = argv[i + 1] || '';
      if (!options.debugPort) {
        options.error = '参数 --debug-port 缺少端口值';
        return options;
      }
      i += 1;
      continue;
    }
    if (arg.startsWith('--debug-port=')) {
      options.debugPort = arg.slice('--debug-port='.length);
      continue;
    }
    if (arg === '--qr-file') {
      options.qrFile = argv[i + 1] || '';
      if (!options.qrFile) {
        options.error = '参数 --qr-file 缺少文件名';
        return options;
      }
      i += 1;
      continue;
    }
    if (arg.startsWith('--qr-file=')) {
      options.qrFile = arg.slice('--qr-file='.length);
      continue;
    }

    options.error = `未知参数: ${arg}`;
    return options;
  }

  return options;
}

function sendSseEvent(res, event, payload) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

async function main() {
  const cliOptions = parseCliOptions(process.argv.slice(2));
  if (cliOptions.help) {
    printUsage();
    process.exit(0);
  }
  if (cliOptions.error) {
    console.error(`❌ ${cliOptions.error}\n`);
    printUsage();
    process.exit(1);
  }

  const monitorPort = parsePort(cliOptions.monitorPort || process.env.QR_MONITOR_PORT, 3999);
  const debugPort = parsePort(cliOptions.debugPort || process.env.DEBUG_PORT, 9222);
  const targetDomain = (cliOptions.targetDomain || process.env.TARGET_DOMAIN || 'douyin.com').toLowerCase();

  const manager = new QRMonitorManager({ rootDir: __dirname });
  const session = await manager.startSession({
    targetDomain,
    monitorPort,
    debugPort,
    pollIntervalMs: Number(process.env.QR_POLL_MS || 1000),
    qrMaxAgeMs: Number(process.env.QR_MAX_AGE_MS || 45000),
    qrRefreshCooldownMs: Number(process.env.QR_REFRESH_COOLDOWN_MS || 3500),
    minQrScore: Number(process.env.QR_MIN_SCORE || 6),
    qrFile: cliOptions.qrFile || process.env.QR_CURRENT_FILENAME,
  });

  const app = express();
  const clients = new Set();
  app.use(cors());

  function broadcast(event, payload) {
    for (const res of clients) {
      sendSseEvent(res, event, payload);
    }
  }

  session.on('status', (payload) => {
    broadcast('status', payload);
  });
  session.on('qr', (payload) => {
    broadcast('qr', payload);
  });

  app.get('/api/status', (_req, res) => {
    res.json(session.getPublicState());
  });

  app.get('/api/qr/current', (_req, res) => {
    res.json(session.getCurrentQrPayload());
  });

  app.get('/api/qr/image', (_req, res) => {
    const qr = session.getCurrentQrPayload();
    if (!qr.qrFile) {
      res.status(404).json({ error: 'QR image not ready' });
      return;
    }
    res.sendFile(path.resolve(qr.qrFile));
  });

  app.get('/api/qr/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    clients.add(res);
    sendSseEvent(res, 'status', session.getPublicState());

    const current = session.getCurrentQrPayload();
    if (current.qrDataUrl) {
      sendSseEvent(res, 'qr', current);
    }

    const heartbeat = setInterval(() => {
      res.write(': heartbeat\n\n');
    }, 15000);

    req.on('close', () => {
      clearInterval(heartbeat);
      clients.delete(res);
      res.end();
    });
  });

  app.post('/api/refresh', async (_req, res) => {
    try {
      const result = await session.requestRefresh(true);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: String(error.message || error) });
    }
  });

  app.get('/qr', (_req, res) => {
    res.type('html').send(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>QR Monitor</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 20px; color: #111; }
      .meta { margin-bottom: 12px; font-size: 14px; color: #444; }
      .status { margin: 8px 0; padding: 8px 10px; background: #f4f4f4; border-radius: 8px; display: inline-block; }
      img { width: 320px; height: 320px; object-fit: contain; border: 1px solid #ddd; border-radius: 8px; background: #fff; }
      .hint { margin-top: 10px; font-size: 12px; color: #666; }
    </style>
  </head>
  <body>
    <h2>${targetDomain} Login QR</h2>
    <div class="meta">Endpoint: <code>/api/qr/stream</code></div>
    <div class="meta">Session: <code>${session.sessionId}</code></div>
    <div class="meta">Monitor: <code>${monitorPort}</code> · Debug: <code>${debugPort}</code></div>
    <div id="status" class="status">Connecting...</div>
    <div><img id="qr" alt="QR code" /></div>
    <div class="hint">QR 会自动刷新。若显示过期，服务会自动尝试点击刷新。</div>
    <script>
      const statusEl = document.getElementById('status');
      const qrEl = document.getElementById('qr');

      function updateStatus(data) {
        statusEl.textContent = '[' + data.status + '] ' + (data.message || '');
      }

      function updateQr(data) {
        if (data.qrDataUrl) {
          qrEl.src = data.qrDataUrl;
        }
      }

      fetch('/api/qr/current')
        .then((r) => r.json())
        .then((data) => {
          updateStatus(data);
          updateQr(data);
        })
        .catch(() => {});

      const es = new EventSource('/api/qr/stream');
      es.addEventListener('status', (event) => {
        try { updateStatus(JSON.parse(event.data)); } catch (_) {}
      });
      es.addEventListener('qr', (event) => {
        try {
          const data = JSON.parse(event.data);
          updateStatus(data);
          updateQr(data);
        } catch (_) {}
      });
    </script>
  </body>
</html>`);
  });

  app.listen(monitorPort, () => {
    const ips = localIps();
    console.log(`QR Monitor listening on http://127.0.0.1:${monitorPort}/qr`);
    for (const ip of ips) {
      console.log(`LAN access: http://${ip}:${monitorPort}/qr`);
    }
    console.log(`Target domain: ${targetDomain}`);
    console.log(`Expect browser debug port at 127.0.0.1:${debugPort}`);
    console.log(`Current QR file: ${session.getCurrentQrPayload().qrFile || '(pending)'}`);
  });

  process.on('SIGINT', async () => {
    console.log('\nShutting down QR monitor...');
    try {
      await manager.stopAll();
    } catch (_error) {
      // noop
    }
    process.exit(0);
  });
}

if (require.main === module) {
  main().catch((error) => {
    console.error('Failed to start QR monitor:', error.message || error);
    process.exit(1);
  });
}
