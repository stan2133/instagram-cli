#!/usr/bin/env node

/**
 * QR Monitor Server
 * 实时监听抖音登录弹窗中的二维码并通过 HTTP/SSE 输出
 */

const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const PORT = Number(process.env.QR_MONITOR_PORT || 3999);
const DEBUG_PORT = Number(process.env.DEBUG_PORT || 9222);
const TARGET_DOMAIN = (process.env.TARGET_DOMAIN || 'douyin.com').toLowerCase();
const POLL_INTERVAL_MS = Number(process.env.QR_POLL_MS || 1000);

const SESSION_DIR = path.join(__dirname, '.instagram-cli', 'sessions');
const LOG_DIR = path.join(__dirname, 'logs');
const CURRENT_QR_FILE = path.join(LOG_DIR, 'qr-current.png');

const LOGIN_BUTTON_KEYWORDS = ['登录', '登錄', '登入', 'login', 'log in', 'sign in'];
const QR_TAB_KEYWORDS = ['扫码登录', '二维码登录', 'qr login', 'scan login'];
const QR_EXPIRED_KEYWORDS = ['二维码已失效', '已过期', 'expired', '失效'];
const QR_REFRESH_KEYWORDS = ['刷新', '点击刷新', '重新获取', '重试', 'refresh'];
const QR_HINT_KEYWORDS = ['扫码', '二维码', 'qr', 'qrcode', 'scan'];
const MIN_QR_SCORE = Number(process.env.QR_MIN_SCORE || 6);

const SITE_KEYWORD_OVERRIDES = {
  'jianying.com': {
    loginButtonKeywords: ['登录', '注册', '开启', '立即开启', '开启创作', '开始创作', '马上体验'],
    qrTabKeywords: ['扫码登录', '二维码登录', '扫码', '二维码', '抖音扫码登录'],
    qrHintKeywords: ['扫码', '二维码', 'qr', 'qrcode', 'scan'],
  },
};

const clients = new Set();

let browser = null;
let monitorBusy = false;
const siteKeywords = getSiteKeywords(TARGET_DOMAIN);

const state = {
  status: 'starting',
  message: 'Monitor starting...',
  connected: false,
  pageUrl: '',
  targetDomain: TARGET_DOMAIN,
  lastError: '',
  lastUpdateAt: new Date().toISOString(),
  qrAvailable: false,
  qrHash: '',
  qrDataUrl: '',
  qrFile: '',
};

function ensureDirs() {
  if (!fs.existsSync(SESSION_DIR)) {
    fs.mkdirSync(SESSION_DIR, { recursive: true });
  }
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

function mergeKeywords(primary, fallback) {
  const merged = [...(primary || []), ...(fallback || [])];
  return Array.from(new Set(merged.filter(Boolean)));
}

function getSiteKeywords(domain) {
  const clean = (domain || '').replace(/^www\./, '').toLowerCase();
  for (const [key, config] of Object.entries(SITE_KEYWORD_OVERRIDES)) {
    if (clean.includes(key) || key.includes(clean)) {
      return {
        loginButtonKeywords: mergeKeywords(config.loginButtonKeywords, LOGIN_BUTTON_KEYWORDS),
        qrTabKeywords: mergeKeywords(config.qrTabKeywords, QR_TAB_KEYWORDS),
        qrHintKeywords: mergeKeywords(config.qrHintKeywords, QR_HINT_KEYWORDS),
      };
    }
  }
  return {
    loginButtonKeywords: LOGIN_BUTTON_KEYWORDS,
    qrTabKeywords: QR_TAB_KEYWORDS,
    qrHintKeywords: QR_HINT_KEYWORDS,
  };
}

function getPublicState() {
  return {
    status: state.status,
    message: state.message,
    connected: state.connected,
    pageUrl: state.pageUrl,
    targetDomain: state.targetDomain,
    qrAvailable: state.qrAvailable,
    qrFile: state.qrFile,
    lastError: state.lastError,
    lastUpdateAt: state.lastUpdateAt,
  };
}

function updateState(patch) {
  Object.assign(state, patch, { lastUpdateAt: new Date().toISOString() });
}

function sendSseEvent(res, event, payload) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function broadcast(event, payload) {
  for (const res of clients) {
    sendSseEvent(res, event, payload);
  }
}

function broadcastStatus() {
  broadcast('status', getPublicState());
}

function toTimestampFilename() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `qr-${yyyy}${mm}${dd}-${hh}${mi}${ss}.png`;
}

function localIps() {
  const nets = os.networkInterfaces();
  const ips = [];
  for (const key of Object.keys(nets)) {
    for (const addr of nets[key] || []) {
      if (addr.family === 'IPv4' && !addr.internal) {
        ips.push(addr.address);
      }
    }
  }
  return ips;
}

async function connectBrowser() {
  if (browser && browser.connected) {
    return browser;
  }

  try {
    browser = await puppeteer.connect({
      browserURL: `http://127.0.0.1:${DEBUG_PORT}`,
      defaultViewport: null,
    });
    browser.on('disconnected', () => {
      browser = null;
      updateState({
        connected: false,
        status: 'waiting_browser',
        message: `Browser disconnected, waiting on port ${DEBUG_PORT}`,
      });
      broadcastStatus();
    });
    updateState({
      connected: true,
      status: 'connected',
      message: `Connected to browser on port ${DEBUG_PORT}`,
      lastError: '',
    });
    broadcastStatus();
  } catch (error) {
    updateState({
      connected: false,
      status: 'waiting_browser',
      message: `Waiting for browser debug port ${DEBUG_PORT}...`,
      lastError: String(error.message || error),
    });
    broadcastStatus();
  }

  return browser;
}

async function getTargetPage() {
  if (!browser || !browser.connected) {
    return null;
  }

  const pages = await browser.pages();
  if (!pages.length) {
    return null;
  }

  const preferred = pages.find((p) => p.url().toLowerCase().includes(TARGET_DOMAIN));
  if (preferred) {
    return preferred;
  }

  const nonBlank = pages.find((p) => !p.url().startsWith('about:blank'));
  return nonBlank || pages[0];
}

async function hasLoginModal(page) {
  const modal = await page.$('.douyin_login_new_class');
  if (modal) {
    await modal.dispose();
    return true;
  }
  return false;
}

async function hasLoginButton(page, keywords = LOGIN_BUTTON_KEYWORDS) {
  return page.evaluate((inputKeywords) => {
    const needles = inputKeywords.map((k) => k.toLowerCase());
    const normalize = (text) => (text || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const isVisible = (el) => {
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return (
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        rect.width > 28 &&
        rect.height > 16 &&
        rect.bottom > 0 &&
        rect.right > 0 &&
        rect.top < window.innerHeight &&
        rect.left < window.innerWidth
      );
    };

    const nodes = Array.from(document.querySelectorAll('button, a, [role="button"], div, span'));
    for (const node of nodes) {
      const text = normalize(node.innerText || node.textContent);
      if (!text || text.length > 32) {
        continue;
      }
      if (!needles.some((n) => text.includes(n))) {
        continue;
      }
      const target = node.closest('button, a, [role="button"]') || node;
      if (target instanceof HTMLElement && isVisible(target)) {
        return true;
      }
    }
    return false;
  }, keywords);
}

async function clickByKeywords(page, keywords) {
  return page.evaluate((inputKeywords) => {
    const needles = inputKeywords.map((k) => k.toLowerCase());
    const normalize = (text) => (text || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const isVisible = (el) => {
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return (
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        rect.width > 28 &&
        rect.height > 16 &&
        rect.bottom > 0 &&
        rect.right > 0 &&
        rect.top < window.innerHeight &&
        rect.left < window.innerWidth
      );
    };

    const nodes = Array.from(document.querySelectorAll('button, a, [role="button"], div, span'));
    for (const node of nodes) {
      const text = normalize(node.innerText || node.textContent);
      if (!text || text.length > 60) {
        continue;
      }
      if (!needles.some((n) => text.includes(n))) {
        continue;
      }

      const target = node.closest('button, a, [role="button"]') || node;
      if (!(target instanceof HTMLElement) || !isVisible(target)) {
        continue;
      }

      target.click();
      return {
        clicked: true,
        text: text.slice(0, 80),
        tag: target.tagName.toLowerCase(),
      };
    }

    return { clicked: false };
  }, keywords);
}

async function ensureLoginModalOpen(page) {
  if (await hasLoginModal(page)) {
    return true;
  }

  const clickRes = await clickByKeywords(page, siteKeywords.loginButtonKeywords);
  if (clickRes.clicked) {
    updateState({
      status: 'waiting_login_modal',
      message: `Clicked login button <${clickRes.tag}> ${clickRes.text}`,
    });
    broadcastStatus();
    await new Promise((resolve) => setTimeout(resolve, 1200));
    return hasLoginModal(page);
  }

  return false;
}

async function ensureQrTab(page) {
  const switched = await clickByKeywords(page, siteKeywords.qrTabKeywords);
  if (switched.clicked) {
    updateState({
      status: 'waiting_qr',
      message: `Switched to QR tab: ${switched.text}`,
    });
    broadcastStatus();
    await new Promise((resolve) => setTimeout(resolve, 800));
  }
}

async function refreshExpiredQr(page) {
  const expired = await page.evaluate((expiredKeywords, refreshKeywords) => {
    const normalize = (text) => (text || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const hasAny = (text, words) => words.some((w) => text.includes(w.toLowerCase()));
    const bodyText = normalize(document.body?.innerText || '');
    if (!hasAny(bodyText, expiredKeywords)) {
      return { refreshed: false };
    }

    const nodes = Array.from(document.querySelectorAll('button, a, [role="button"], span, div'));
    for (const node of nodes) {
      const text = normalize(node.innerText || node.textContent);
      if (!text || !hasAny(text, refreshKeywords)) {
        continue;
      }
      const target = node.closest('button, a, [role="button"]') || node;
      if (target instanceof HTMLElement) {
        target.click();
        return { refreshed: true, text: text.slice(0, 40) };
      }
    }

    return { refreshed: false };
  }, QR_EXPIRED_KEYWORDS, QR_REFRESH_KEYWORDS);

  if (expired.refreshed) {
    updateState({
      status: 'refreshing_qr',
      message: `QR expired, clicked refresh: ${expired.text || ''}`,
    });
    broadcastStatus();
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

async function findBestQrElement(page) {
  const candidates = await page.$$('img, canvas');
  let best = null;
  let bestScore = -1;

  for (const candidate of candidates) {
    const meta = await candidate.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      const parentText = (el.parentElement?.innerText || '').replace(/\s+/g, ' ').trim().toLowerCase();
      const src = el.tagName.toLowerCase() === 'img' ? (el.getAttribute('src') || '') : '';
      return {
        width: rect.width,
        height: rect.height,
        x: rect.x,
        y: rect.y,
        viewportW: window.innerWidth,
        viewportH: window.innerHeight,
        visible: style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0',
        src,
        parentText,
        ancestorText: (() => {
          let txt = '';
          let cur = el.parentElement;
          for (let i = 0; i < 4 && cur; i += 1) {
            txt += ` ${cur.innerText || ''}`;
            cur = cur.parentElement;
          }
          return txt.replace(/\s+/g, ' ').trim().toLowerCase();
        })(),
        tag: el.tagName.toLowerCase(),
      };
    });

    if (!meta.visible || meta.width < 90 || meta.height < 90 || meta.width > 420 || meta.height > 420) {
      await candidate.dispose();
      continue;
    }

    const ratio = meta.width / meta.height;
    if (ratio < 0.8 || ratio > 1.25) {
      await candidate.dispose();
      continue;
    }

    let score = 0;
    if (meta.src.startsWith('data:image/')) {
      score += 6;
    }
    if (meta.src.toLowerCase().includes('qr') || meta.src.toLowerCase().includes('qrcode')) {
      score += 4;
    }
    if (siteKeywords.qrHintKeywords.some((k) => meta.parentText.includes(k))) {
      score += 3;
    }
    if (siteKeywords.qrHintKeywords.some((k) => meta.ancestorText.includes(k))) {
      score += 2;
    }
    if (meta.tag === 'canvas') {
      score += 2;
    }
    // Prefer center-ish area where login QR is usually shown.
    const centerX = meta.viewportW / 2;
    const centerY = meta.viewportH / 2;
    const qrCenterX = meta.x + meta.width / 2;
    const qrCenterY = meta.y + meta.height / 2;
    const dist = Math.hypot(qrCenterX - centerX, qrCenterY - centerY);
    score += Math.max(0, 3 - dist / 260);
    score += Math.max(0, 2 - Math.abs(meta.width - meta.height) / 40);

    if (score > bestScore) {
      if (best) {
        await best.dispose();
      }
      best = candidate;
      bestScore = score;
    } else {
      await candidate.dispose();
    }
  }

  if (bestScore < MIN_QR_SCORE) {
    if (best) {
      await best.dispose();
    }
    return null;
  }

  return best;
}

async function captureAndPublishQr(page) {
  const qrElement = await findBestQrElement(page);
  if (!qrElement) {
    updateState({
      status: 'waiting_qr',
      message: 'Waiting for QR code in login popup...',
      qrAvailable: false,
      qrHash: '',
      qrDataUrl: '',
      qrFile: '',
    });
    broadcastStatus();
    return;
  }

  const buffer = await qrElement.screenshot({ type: 'png' });
  await qrElement.dispose();

  const hash = crypto.createHash('sha256').update(buffer).digest('hex');
  const changed = hash !== state.qrHash;

  updateState({
    status: 'qr_ready',
    message: changed ? 'New QR code captured' : 'QR code is up to date',
    qrAvailable: true,
    qrHash: hash,
    qrDataUrl: `data:image/png;base64,${buffer.toString('base64')}`,
    qrFile: CURRENT_QR_FILE,
    lastError: '',
  });

  fs.writeFileSync(CURRENT_QR_FILE, buffer);
  if (changed) {
    fs.writeFileSync(path.join(LOG_DIR, toTimestampFilename()), buffer);
    broadcast('qr', {
      ...getPublicState(),
      qrDataUrl: state.qrDataUrl,
    });
  }
  broadcastStatus();
}

async function monitorTick() {
  if (monitorBusy) {
    return;
  }
  monitorBusy = true;

  try {
    await connectBrowser();
    if (!browser || !browser.connected) {
      return;
    }

    const page = await getTargetPage();
    if (!page) {
      updateState({
        status: 'waiting_page',
        message: 'Connected, but no active page found',
      });
      broadcastStatus();
      return;
    }

    updateState({
      pageUrl: page.url(),
    });

    const hasModal = await ensureLoginModalOpen(page);
    if (!hasModal) {
      const hasLogin = await hasLoginButton(page, siteKeywords.loginButtonKeywords);
      if (hasLogin) {
        updateState({
          status: 'waiting_login_modal',
          message: 'Login button detected, trying to locate QR on page',
        });
      } else {
        updateState({
          status: 'logged_in',
          message: 'No login popup detected; account may already be logged in',
        });
      }
      broadcastStatus();
      // Continue anyway: some sites (e.g. Taobao) use dedicated login pages with QR instead of modal.
    }

    await ensureQrTab(page);
    await refreshExpiredQr(page);
    await captureAndPublishQr(page);
  } catch (error) {
    updateState({
      status: 'error',
      message: 'Monitor loop failed',
      lastError: String(error.message || error),
    });
    broadcastStatus();
  } finally {
    monitorBusy = false;
  }
}

function createApp() {
  const app = express();
  app.use(cors());

  app.get('/api/status', (_req, res) => {
    res.json(getPublicState());
  });

  app.get('/api/qr/current', (_req, res) => {
    res.json({
      ...getPublicState(),
      qrDataUrl: state.qrDataUrl || null,
    });
  });

  app.get('/api/qr/image', (_req, res) => {
    if (!fs.existsSync(CURRENT_QR_FILE)) {
      res.status(404).json({ error: 'QR image not ready' });
      return;
    }
    res.sendFile(CURRENT_QR_FILE);
  });

  app.get('/api/qr/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    clients.add(res);
    sendSseEvent(res, 'status', getPublicState());
    if (state.qrDataUrl) {
      sendSseEvent(res, 'qr', {
        ...getPublicState(),
        qrDataUrl: state.qrDataUrl,
      });
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
    <h2>Douyin Login QR</h2>
    <div class="meta">Endpoint: <code>/api/qr/stream</code></div>
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

  return app;
}

async function main() {
  ensureDirs();

  const app = createApp();
  app.listen(PORT, () => {
    const ips = localIps();
    console.log(`QR Monitor listening on http://127.0.0.1:${PORT}/qr`);
    for (const ip of ips) {
      console.log(`LAN access: http://${ip}:${PORT}/qr`);
    }
    console.log(`Expect browser debug port at 127.0.0.1:${DEBUG_PORT}`);
  });

  setInterval(() => {
    void monitorTick();
  }, POLL_INTERVAL_MS);
  void monitorTick();

  process.on('SIGINT', async () => {
    console.log('\nShutting down QR monitor...');
    try {
      if (browser && browser.connected) {
        await browser.disconnect();
      }
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
