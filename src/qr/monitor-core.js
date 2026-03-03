'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const puppeteer = require('puppeteer');

const LOGIN_BUTTON_KEYWORDS = ['登录', '登錄', '登入', 'login', 'log in', 'sign in'];
const QR_TAB_KEYWORDS = ['扫码登录', '二维码登录', 'qr login', 'scan login'];
const QR_EXPIRED_KEYWORDS = ['二维码已失效', '已过期', 'expired', '失效'];
const QR_REFRESH_KEYWORDS = ['刷新', '点击刷新', '重新获取', '重试', 'refresh'];
const QR_HINT_KEYWORDS = ['扫码', '二维码', 'qr', 'qrcode', 'scan'];

const SITE_KEYWORD_OVERRIDES = {
  'jianying.com': {
    loginButtonKeywords: ['登录', '注册', '开启', '立即开启', '开启创作', '开始创作', '马上体验'],
    qrTabKeywords: ['扫码登录', '二维码登录', '扫码', '二维码', '抖音扫码登录'],
    qrHintKeywords: ['扫码', '二维码', 'qr', 'qrcode', 'scan'],
  },
};

function toFileSafeToken(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^www\./, '')
    .replace(/[^a-z0-9.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'site';
}

function parsePort(value, fallback) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    return fallback;
  }
  return parsed;
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

function toTimestampFilename(targetDomain, monitorPort) {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `qr-${toFileSafeToken(targetDomain)}-${monitorPort}-${yyyy}${mm}${dd}-${hh}${mi}${ss}.png`;
}

function buildDefaultQrFilename(targetDomain, monitorPort) {
  if (monitorPort === 3999) {
    return 'qr-current.png';
  }
  return `qr-current-${toFileSafeToken(targetDomain)}-${monitorPort}.png`;
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

function createSessionId(targetDomain) {
  const safeDomain = toFileSafeToken(targetDomain).slice(0, 32);
  const suffix = (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`).slice(0, 12);
  return `${safeDomain}-${suffix}`;
}

class QRMonitorSession extends EventEmitter {
  constructor(options = {}) {
    super();

    const rootDir = options.rootDir || process.cwd();
    this.sessionId = options.sessionId || createSessionId(options.targetDomain || 'douyin.com');
    this.targetDomain = (options.targetDomain || 'douyin.com').toLowerCase();
    this.monitorPort = parsePort(options.monitorPort, 3999);
    this.debugPort = parsePort(options.debugPort, 9222);

    this.pollIntervalMs = Number(options.pollIntervalMs || 1000);
    this.qrMaxAgeMs = Number(options.qrMaxAgeMs || 45000);
    this.qrRefreshCooldownMs = Number(options.qrRefreshCooldownMs || 3500);
    this.minQrScore = Number(options.minQrScore || 6);

    this.sessionDir = options.sessionDir || path.join(rootDir, '.instagram-cli', 'sessions');
    this.logDir = options.logDir || path.join(rootDir, 'logs');

    const defaultQrFile = buildDefaultQrFilename(this.targetDomain, this.monitorPort);
    const qrFileName = options.qrFile || defaultQrFile;
    this.currentQrFile = path.isAbsolute(qrFileName) ? qrFileName : path.join(this.logDir, qrFileName);

    this.siteKeywords = getSiteKeywords(this.targetDomain);

    this.browser = null;
    this.monitorBusy = false;
    this.intervalRef = null;
    this.forceRefreshRequested = false;

    this.state = {
      status: 'starting',
      message: 'Monitor starting...',
      connected: false,
      pageUrl: '',
      targetDomain: this.targetDomain,
      monitorPort: this.monitorPort,
      debugPort: this.debugPort,
      lastError: '',
      lastUpdateAt: new Date().toISOString(),
      qrAvailable: false,
      qrHash: '',
      qrDataUrl: '',
      qrFile: '',
      qrCapturedAt: 0,
      qrAgeMs: 0,
      lastRefreshAttemptAt: 0,
      refreshCount: 0,
    };

    this.qrHistory = new Map();
  }

  ensureDirs() {
    if (!fs.existsSync(this.sessionDir)) {
      fs.mkdirSync(this.sessionDir, { recursive: true });
    }
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  updateState(patch) {
    Object.assign(this.state, patch, { lastUpdateAt: new Date().toISOString() });
    this.emit('status', this.getPublicState());
  }

  getPublicState() {
    const qrAgeMs = this.state.qrCapturedAt ? Math.max(0, Date.now() - this.state.qrCapturedAt) : 0;
    return {
      sessionId: this.sessionId,
      status: this.state.status,
      message: this.state.message,
      connected: this.state.connected,
      monitorPort: this.monitorPort,
      debugPort: this.debugPort,
      pageUrl: this.state.pageUrl,
      targetDomain: this.state.targetDomain,
      qrAvailable: this.state.qrAvailable,
      qrFile: this.state.qrFile,
      qrAgeMs,
      qrAgeSec: Math.floor(qrAgeMs / 1000),
      refreshCount: this.state.refreshCount,
      lastError: this.state.lastError,
      lastUpdateAt: this.state.lastUpdateAt,
    };
  }

  getCurrentQrPayload() {
    return {
      ...this.getPublicState(),
      hash: this.state.qrHash || null,
      capturedAt: this.state.qrCapturedAt ? new Date(this.state.qrCapturedAt).toISOString() : null,
      qrDataUrl: this.state.qrDataUrl || null,
    };
  }

  getCurrentQrBuffer() {
    if (!this.state.qrFile || !fs.existsSync(this.state.qrFile)) {
      return null;
    }
    return fs.readFileSync(this.state.qrFile);
  }

  getHistoryFileByHash(hash) {
    const file = this.qrHistory.get(hash);
    if (!file || !fs.existsSync(file)) {
      return null;
    }
    return file;
  }

  listHistory() {
    return Array.from(this.qrHistory.entries()).map(([hash, file]) => ({ hash, file }));
  }

  async start() {
    this.ensureDirs();
    this.intervalRef = setInterval(() => {
      void this.monitorTick();
    }, this.pollIntervalMs);
    void this.monitorTick();
    return this;
  }

  async stop() {
    if (this.intervalRef) {
      clearInterval(this.intervalRef);
      this.intervalRef = null;
    }
    try {
      if (this.browser && this.browser.connected) {
        await this.browser.disconnect();
      }
    } catch (_error) {
      // noop
    }
    this.browser = null;
    this.updateState({
      connected: false,
      status: 'stopped',
      message: 'Session stopped',
    });
  }

  async requestRefresh(force = false) {
    this.forceRefreshRequested = force ? 'force' : 'manual';
    await this.monitorTick();
    return {
      requested: true,
      force: Boolean(force),
      ...this.getPublicState(),
    };
  }

  async connectBrowser() {
    if (this.browser && this.browser.connected) {
      return this.browser;
    }

    const browserUrlCandidates = [
      `http://127.0.0.1:${this.debugPort}`,
      `http://localhost:${this.debugPort}`,
      `http://[::1]:${this.debugPort}`,
    ];
    const errors = [];

    try {
      for (const browserURL of browserUrlCandidates) {
        try {
          this.browser = await puppeteer.connect({
            browserURL,
            defaultViewport: null,
          });
          break;
        } catch (error) {
          errors.push(`${browserURL}: ${String(error?.message || error)}`);
        }
      }

      if (!this.browser) {
        throw new Error(errors.join(' | '));
      }
      this.browser.on('disconnected', () => {
        this.browser = null;
        this.updateState({
          connected: false,
          status: 'waiting_browser',
          message: `Browser disconnected, waiting on port ${this.debugPort}`,
        });
      });
      this.updateState({
        connected: true,
        status: 'connected',
        message: `Connected to browser on port ${this.debugPort}`,
        lastError: '',
      });
    } catch (error) {
      this.updateState({
        connected: false,
        status: 'waiting_browser',
        message: `Waiting for browser debug port ${this.debugPort}...`,
        lastError: String(error?.message || error),
      });
    }

    return this.browser;
  }

  async getTargetPage() {
    if (!this.browser || !this.browser.connected) {
      return null;
    }

    const pages = await this.browser.pages();
    if (!pages.length) {
      return null;
    }

    const preferred = pages.find((p) => p.url().toLowerCase().includes(this.targetDomain));
    if (preferred) {
      return preferred;
    }

    const nonBlank = pages.find((p) => !p.url().startsWith('about:blank'));
    return nonBlank || pages[0];
  }

  async hasLoginModal(page) {
    const modal = await page.$('.douyin_login_new_class');
    if (modal) {
      await modal.dispose();
      return true;
    }
    return false;
  }

  async hasLoginButton(page, keywords = LOGIN_BUTTON_KEYWORDS) {
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

  async clickByKeywords(page, keywords) {
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

  async ensureLoginModalOpen(page) {
    if (await this.hasLoginModal(page)) {
      return true;
    }

    const clickRes = await this.clickByKeywords(page, this.siteKeywords.loginButtonKeywords);
    if (clickRes.clicked) {
      this.updateState({
        status: 'waiting_login_modal',
        message: `Clicked login button <${clickRes.tag}> ${clickRes.text}`,
      });
      await new Promise((resolve) => setTimeout(resolve, 1200));
      return this.hasLoginModal(page);
    }

    return false;
  }

  async ensureQrTab(page) {
    const switched = await this.clickByKeywords(page, this.siteKeywords.qrTabKeywords);
    if (switched.clicked) {
      this.updateState({
        status: 'waiting_qr',
        message: `Switched to QR tab: ${switched.text}`,
      });
      await new Promise((resolve) => setTimeout(resolve, 800));
    }
  }

  async hasExpiredQrText(page) {
    return page.evaluate((expiredKeywords) => {
      const normalize = (text) => (text || '').replace(/\s+/g, ' ').trim().toLowerCase();
      const bodyText = normalize(document.body?.innerText || '');
      return expiredKeywords.some((word) => bodyText.includes(word.toLowerCase()));
    }, QR_EXPIRED_KEYWORDS);
  }

  canAttemptRefresh(force = false) {
    if (force) {
      this.state.lastRefreshAttemptAt = Date.now();
      return true;
    }
    const now = Date.now();
    if (now - this.state.lastRefreshAttemptAt < this.qrRefreshCooldownMs) {
      return false;
    }
    this.state.lastRefreshAttemptAt = now;
    return true;
  }

  async tryClickQrRefreshControl(page, force = false) {
    return page.evaluate((expiredKeywords, refreshKeywords, forceRefresh) => {
      const normalize = (text) => (text || '').replace(/\s+/g, ' ').trim().toLowerCase();
      const hasAny = (text, words) => words.some((w) => text.includes(w.toLowerCase()));
      const isVisible = (el) => {
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return (
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          style.opacity !== '0' &&
          rect.width > 16 &&
          rect.height > 12 &&
          rect.bottom > 0 &&
          rect.right > 0 &&
          rect.top < window.innerHeight &&
          rect.left < window.innerWidth
        );
      };

      const textNodes = Array.from(document.querySelectorAll('button, a, [role="button"], span, div'))
        .filter((node) => node instanceof HTMLElement)
        .map((node) => {
          const text = normalize(node.innerText || node.textContent);
          return { node, text };
        })
        .filter((item) => item.text && item.text.length <= 60);

      const expiredNodes = textNodes.filter((item) => hasAny(item.text, expiredKeywords));
      if (!forceRefresh && expiredNodes.length === 0) {
        return { clicked: false, reason: 'not_expired' };
      }

      const searchRoots = [];
      for (const item of expiredNodes) {
        const root = item.node.closest('section, article, form, dialog, div') || item.node;
        if (root && !searchRoots.includes(root)) {
          searchRoots.push(root);
        }
      }
      if (forceRefresh || searchRoots.length === 0) {
        searchRoots.push(document.body);
      }

      for (const root of searchRoots) {
        const candidates = Array.from(root.querySelectorAll('button, a, [role="button"], span, div'))
          .filter((node) => node instanceof HTMLElement);
        for (const node of candidates) {
          const text = normalize(node.innerText || node.textContent);
          if (!text || text.length > 40 || !hasAny(text, refreshKeywords)) {
            continue;
          }
          const target = node.closest('button, a, [role="button"]') || node;
          if (!(target instanceof HTMLElement) || !isVisible(target)) {
            continue;
          }
          target.click();
          return { clicked: true, text: text.slice(0, 40), reason: forceRefresh ? 'forced' : 'expired' };
        }
      }

      return { clicked: false, reason: expiredNodes.length > 0 ? 'expired_no_button' : 'no_button' };
    }, QR_EXPIRED_KEYWORDS, QR_REFRESH_KEYWORDS, force);
  }

  async refreshExpiredQr(page, reason = 'expired_text', force = false) {
    if (!this.canAttemptRefresh(force)) {
      return false;
    }

    const refreshResult = await this.tryClickQrRefreshControl(page, reason === 'stale_age' || force);
    if (refreshResult.clicked) {
      this.state.refreshCount += 1;
      this.updateState({
        status: 'refreshing_qr',
        message: `Refreshing QR (${reason}): ${refreshResult.text || 'button clicked'}`,
      });
      await new Promise((resolve) => setTimeout(resolve, 1000));
      return true;
    }

    const switched = await this.clickByKeywords(page, this.siteKeywords.qrTabKeywords);
    if (switched.clicked) {
      this.state.refreshCount += 1;
      this.updateState({
        status: 'refreshing_qr',
        message: `Refreshing QR by re-opening QR tab: ${switched.text}`,
      });
      await new Promise((resolve) => setTimeout(resolve, 1000));
      return true;
    }

    return false;
  }

  async findBestQrElement(page) {
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
      if (this.siteKeywords.qrHintKeywords.some((k) => meta.parentText.includes(k))) {
        score += 3;
      }
      if (this.siteKeywords.qrHintKeywords.some((k) => meta.ancestorText.includes(k))) {
        score += 2;
      }
      if (meta.tag === 'canvas') {
        score += 2;
      }

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

    if (bestScore < this.minQrScore) {
      if (best) {
        await best.dispose();
      }
      return null;
    }

    return best;
  }

  async captureAndPublishQr(page) {
    const qrElement = await this.findBestQrElement(page);
    if (!qrElement) {
      this.updateState({
        status: 'waiting_qr',
        message: 'Waiting for QR code in login popup...',
        qrAvailable: false,
        qrHash: '',
        qrDataUrl: '',
        qrFile: '',
        qrCapturedAt: 0,
        qrAgeMs: 0,
      });
      return { found: false, changed: false };
    }

    const buffer = await qrElement.screenshot({ type: 'png' });
    await qrElement.dispose();

    const hash = crypto.createHash('sha256').update(buffer).digest('hex');
    const changed = hash !== this.state.qrHash;

    this.updateState({
      status: 'qr_ready',
      message: changed ? 'New QR code captured' : 'QR code is up to date',
      qrAvailable: true,
      qrHash: hash,
      qrDataUrl: `data:image/png;base64,${buffer.toString('base64')}`,
      qrFile: this.currentQrFile,
      qrCapturedAt: changed ? Date.now() : this.state.qrCapturedAt || Date.now(),
      qrAgeMs: changed ? 0 : Math.max(0, Date.now() - (this.state.qrCapturedAt || Date.now())),
      lastError: '',
    });

    fs.writeFileSync(this.currentQrFile, buffer);

    if (changed) {
      const historyFile = path.join(this.logDir, toTimestampFilename(this.targetDomain, this.monitorPort));
      fs.writeFileSync(historyFile, buffer);
      this.qrHistory.set(hash, historyFile);
      this.emit('qr', this.getCurrentQrPayload());
    }

    return { found: true, changed };
  }

  async monitorTick() {
    if (this.monitorBusy) {
      return;
    }
    this.monitorBusy = true;

    try {
      await this.connectBrowser();
      if (!this.browser || !this.browser.connected) {
        return;
      }

      const page = await this.getTargetPage();
      if (!page) {
        this.updateState({
          status: 'waiting_page',
          message: 'Connected, but no active page found',
        });
        return;
      }

      this.updateState({ pageUrl: page.url() });

      const hasModal = await this.ensureLoginModalOpen(page);
      if (!hasModal) {
        const hasLogin = await this.hasLoginButton(page, this.siteKeywords.loginButtonKeywords);
        if (hasLogin) {
          this.updateState({
            status: 'waiting_login_modal',
            message: 'Login button detected, trying to locate QR on page',
          });
        } else {
          this.updateState({
            status: 'logged_in',
            message: 'No login popup detected; account may already be logged in',
          });
        }
      }

      await this.ensureQrTab(page);

      if (this.forceRefreshRequested) {
        const force = this.forceRefreshRequested === 'force';
        await this.refreshExpiredQr(page, force ? 'force_refresh' : 'manual_refresh', force);
        this.forceRefreshRequested = false;
        await this.captureAndPublishQr(page);
        return;
      }

      if (await this.hasExpiredQrText(page)) {
        await this.refreshExpiredQr(page, 'expired_text');
      }

      const captureResult = await this.captureAndPublishQr(page);
      if (captureResult.found && this.state.qrCapturedAt) {
        const ageMs = Date.now() - this.state.qrCapturedAt;
        if (ageMs > this.qrMaxAgeMs) {
          this.updateState({
            status: 'stale_qr',
            message: `QR older than ${Math.floor(this.qrMaxAgeMs / 1000)}s, auto refreshing...`,
            qrAgeMs: ageMs,
          });
          const refreshed = await this.refreshExpiredQr(page, 'stale_age');
          if (refreshed) {
            await this.captureAndPublishQr(page);
          }
        }
      }
    } catch (error) {
      this.updateState({
        status: 'error',
        message: 'Monitor loop failed',
        lastError: String(error.message || error),
      });
    } finally {
      this.monitorBusy = false;
    }
  }
}

class QRMonitorManager extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = options;
    this.sessions = new Map();
  }

  createSessionOptions(options = {}) {
    const targetDomain = (options.targetDomain || this.options.targetDomain || 'douyin.com').toLowerCase();
    const monitorPort = parsePort(options.monitorPort ?? this.options.monitorPort, 3999);
    const debugPort = parsePort(options.debugPort ?? this.options.debugPort, 9222);
    const sessionId = options.sessionId || createSessionId(targetDomain);

    const rootDir = options.rootDir || this.options.rootDir || process.cwd();
    const logDir = options.logDir || this.options.logDir || path.join(rootDir, 'logs');
    const sessionDir = options.sessionDir || this.options.sessionDir || path.join(rootDir, '.instagram-cli', 'sessions');

    return {
      sessionId,
      targetDomain,
      monitorPort,
      debugPort,
      pollIntervalMs: options.pollIntervalMs ?? this.options.pollIntervalMs ?? 1000,
      qrMaxAgeMs: options.qrMaxAgeMs ?? this.options.qrMaxAgeMs ?? 45000,
      qrRefreshCooldownMs: options.qrRefreshCooldownMs ?? this.options.qrRefreshCooldownMs ?? 3500,
      minQrScore: options.minQrScore ?? this.options.minQrScore ?? 6,
      rootDir,
      logDir,
      sessionDir,
      qrFile: options.qrFile,
    };
  }

  async startSession(options = {}) {
    const sessionOptions = this.createSessionOptions(options);
    if (this.sessions.has(sessionOptions.sessionId)) {
      throw new Error(`Session already exists: ${sessionOptions.sessionId}`);
    }

    const session = new QRMonitorSession(sessionOptions);
    session.on('status', (payload) => {
      this.emit('status', payload);
    });
    session.on('qr', (payload) => {
      this.emit('qr', payload);
    });

    this.sessions.set(session.sessionId, session);
    await session.start();
    return session;
  }

  getSession(sessionId) {
    return this.sessions.get(sessionId) || null;
  }

  listSessions() {
    return Array.from(this.sessions.values()).map((session) => session.getPublicState());
  }

  async stopSession(sessionId) {
    const session = this.getSession(sessionId);
    if (!session) {
      return false;
    }
    await session.stop();
    this.sessions.delete(sessionId);
    return true;
  }

  async stopAll() {
    const ids = Array.from(this.sessions.keys());
    for (const id of ids) {
      await this.stopSession(id);
    }
  }
}

module.exports = {
  QRMonitorSession,
  QRMonitorManager,
  parsePort,
  toFileSafeToken,
  buildDefaultQrFilename,
  localIps,
};
