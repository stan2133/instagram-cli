'use strict';

const { EventEmitter } = require('events');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const SESSION_DIR = path.join('.instagram-cli', 'sessions');
const LOGIN_STATE_FILE = 'daemon-login-state.json';
const BROWSER_INFO_FILE = 'browser-info.json';
const DEFAULT_RECOVERY_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function parsePort(value, fallback = 9222) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    return fallback;
  }
  return parsed;
}

function parseDuration(value, fallback = DEFAULT_RECOVERY_MAX_AGE_MS) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 60 * 1000) {
    return fallback;
  }
  return parsed;
}

function appendWithCap(arr, value, cap) {
  arr.push(value);
  if (arr.length > cap) {
    arr.splice(0, arr.length - cap);
  }
}

function safeReadJsonFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_error) {
    return null;
  }
}

function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
}

function parseIsoMs(value) {
  if (!value) {
    return 0;
  }
  const ms = Date.parse(String(value));
  return Number.isFinite(ms) ? ms : 0;
}

function normalizeHostname(rawUrl) {
  const value = String(rawUrl || '').trim();
  if (!value) {
    return '';
  }
  try {
    return new URL(value).hostname.replace(/^www\./i, '').toLowerCase();
  } catch (_error) {
    return '';
  }
}

function isPidAlive(pid) {
  const n = Number(pid);
  if (!Number.isInteger(n) || n <= 0) {
    return false;
  }
  try {
    process.kill(n, 0);
    return true;
  } catch (_error) {
    return false;
  }
}

function validateRecoveryFingerprint(persistedState, browserInfo, debugPort, recoveryMaxAgeMs) {
  const wsEndpoint = String(browserInfo?.webSocketDebuggerUrl || '').trim();
  if (!wsEndpoint) {
    return { ok: false, reason: 'browser-info 缺少 webSocketDebuggerUrl' };
  }

  const endpointPort = parseDebugPortFromWsEndpoint(wsEndpoint, debugPort);
  if (endpointPort !== debugPort) {
    return {
      ok: false,
      reason: `debug port mismatch: expected ${debugPort}, got ${endpointPort}`,
    };
  }

  const persistedPid = Number(persistedState?.pid || 0);
  const browserPid = Number(browserInfo?.pid || 0);
  if (persistedPid > 0 && browserPid > 0 && persistedPid !== browserPid) {
    return {
      ok: false,
      reason: `pid mismatch: state=${persistedPid} browserInfo=${browserPid}`,
    };
  }

  const persistedTargetHost = normalizeHostname(persistedState?.targetUrl);
  const browserTargetHost = normalizeHostname(browserInfo?.targetUrl);
  if (persistedTargetHost && browserTargetHost && persistedTargetHost !== browserTargetHost) {
    return {
      ok: false,
      reason: `target host mismatch: state=${persistedTargetHost} browserInfo=${browserTargetHost}`,
    };
  }

  const now = Date.now();
  const authenticatedAtMs = parseIsoMs(persistedState?.authenticatedAt);
  if (authenticatedAtMs > 0 && now - authenticatedAtMs > recoveryMaxAgeMs) {
    return {
      ok: false,
      reason: `recovery window expired for authenticatedAt: ${persistedState?.authenticatedAt}`,
    };
  }

  const savedAtMs = parseIsoMs(browserInfo?.savedAt);
  if (savedAtMs > 0 && now - savedAtMs > recoveryMaxAgeMs) {
    return {
      ok: false,
      reason: `recovery window expired for browser-info savedAt: ${browserInfo?.savedAt}`,
    };
  }

  return { ok: true };
}

function parseDebugPortFromWsEndpoint(endpoint, fallback = 9222) {
  const raw = String(endpoint || '').trim();
  if (!raw) {
    return fallback;
  }
  try {
    const parsed = new URL(raw);
    const port = Number(parsed.port || fallback);
    return parsePort(port, fallback);
  } catch (_error) {
    return fallback;
  }
}

function createLinePump(onLine) {
  let buffer = '';
  return (chunk) => {
    buffer += String(chunk || '');
    while (true) {
      const idx = buffer.indexOf('\n');
      if (idx < 0) {
        break;
      }
      const line = buffer.slice(0, idx).replace(/\r/g, '');
      buffer = buffer.slice(idx + 1);
      onLine(line);
    }
  };
}

class LoginManager extends EventEmitter {
  constructor(options = {}) {
    super();
    this.cwd = options.cwd || process.cwd();
    this.maxLogs = Number(options.maxLogs || 600);
    this.sessionDir = options.sessionDir || path.join(this.cwd, SESSION_DIR);
    this.stateFile = options.stateFile || path.join(this.sessionDir, LOGIN_STATE_FILE);
    this.browserInfoFile = options.browserInfoFile || path.join(this.sessionDir, BROWSER_INFO_FILE);
    this.recoveryMaxAgeMs = parseDuration(
      options.recoveryMaxAgeMs ?? process.env.IG_DAEMON_RECOVERY_MAX_AGE_MS,
      DEFAULT_RECOVERY_MAX_AGE_MS
    );
    this.state = {
      phase: 'idle',
      targetUrl: '',
      debugPort: 9222,
      chromePath: '',
      hideOnAuthenticated: true,
      pid: 0,
      startedAt: '',
      authenticatedAt: '',
      stoppedAt: '',
      lastError: '',
      exitCode: null,
      signal: '',
      awaitingManualConfirm: false,
      canConfirm: false,
      note: '',
      sessionRecovered: false,
    };
    this.logs = [];
    this.child = null;
    this._restoreFromDisk();
  }

  getStatus() {
    const processRunning = Boolean(this.child && !this.child.killed);
    return {
      ...this.state,
      running: processRunning || this.state.sessionRecovered === true,
    };
  }

  getLogs(limit = 120) {
    const n = Math.max(1, Number(limit) || 120);
    return this.logs.slice(-n);
  }

  isAuthenticated() {
    const processRunning = Boolean(this.child && !this.child.killed);
    return this.state.phase === 'authenticated' && (processRunning || this.state.sessionRecovered === true);
  }

  _setState(patch) {
    this.state = {
      ...this.state,
      ...patch,
    };
    this._persistState();
    this.emit('state', this.getStatus());
  }

  _appendLog(source, line) {
    const entry = `${new Date().toISOString()} [${source}] ${line}`;
    appendWithCap(this.logs, entry, this.maxLogs);
    this.emit('log', entry);
  }

  _persistState() {
    const payload = {
      version: 1,
      updatedAt: new Date().toISOString(),
      state: {
        phase: this.state.phase,
        targetUrl: this.state.targetUrl,
        debugPort: this.state.debugPort,
        chromePath: this.state.chromePath,
        hideOnAuthenticated: this.state.hideOnAuthenticated,
        pid: this.state.pid,
        startedAt: this.state.startedAt,
        authenticatedAt: this.state.authenticatedAt,
        stoppedAt: this.state.stoppedAt,
        lastError: this.state.lastError,
        exitCode: this.state.exitCode,
        signal: this.state.signal,
        awaitingManualConfirm: this.state.awaitingManualConfirm,
        canConfirm: this.state.canConfirm,
        note: this.state.note,
        sessionRecovered: this.state.sessionRecovered,
      },
    };
    try {
      ensureDir(this.stateFile);
      fs.writeFileSync(this.stateFile, JSON.stringify(payload, null, 2), 'utf8');
    } catch (_error) {
      // ignore persistence failures
    }
  }

  _restoreFromDisk() {
    const persisted = safeReadJsonFile(this.stateFile);
    const nextState = persisted?.state || null;
    if (!nextState || nextState.phase !== 'authenticated') {
      return;
    }

    if (!this._restoreFromBrowserInfoSync('已从持久化状态恢复登录会话', nextState)) {
      return;
    }

    const restoredAt = new Date().toISOString();
    appendWithCap(
      this.logs,
      `${restoredAt} [system] restored authenticated session from ${this.stateFile}`,
      this.maxLogs
    );
  }

  _restoreFromBrowserInfoSync(note, persistedState = null) {
    const browserInfo = safeReadJsonFile(this.browserInfoFile);
    const browserPid = Number(browserInfo?.pid || persistedState?.pid || 0);
    if (!isPidAlive(browserPid)) {
      this._appendLog('system', `跳过恢复会话：PID 不可用 (${browserPid || 0})`);
      return false;
    }

    const debugPort = parsePort(
      persistedState?.debugPort || this.state.debugPort || parseDebugPortFromWsEndpoint(browserInfo?.webSocketDebuggerUrl, 9222),
      9222
    );
    const fingerprint = validateRecoveryFingerprint(
      persistedState,
      browserInfo,
      debugPort,
      this.recoveryMaxAgeMs
    );
    if (!fingerprint.ok) {
      this._appendLog('system', `跳过恢复会话：${fingerprint.reason}`);
      return false;
    }

    this.state = {
      ...this.state,
      phase: 'authenticated',
      targetUrl: String(persistedState?.targetUrl || this.state.targetUrl || 'https://www.instagram.com'),
      debugPort,
      chromePath: String(persistedState?.chromePath || this.state.chromePath || ''),
      hideOnAuthenticated: persistedState?.hideOnAuthenticated !== false,
      pid: browserPid,
      startedAt: String(persistedState?.startedAt || this.state.startedAt || ''),
      authenticatedAt: String(persistedState?.authenticatedAt || this.state.authenticatedAt || new Date().toISOString()),
      stoppedAt: '',
      lastError: '',
      exitCode: null,
      signal: '',
      awaitingManualConfirm: false,
      canConfirm: false,
      note: String(note || '已恢复登录会话'),
      sessionRecovered: true,
    };
    this._persistState();
    this.emit('state', this.getStatus());
    return true;
  }

  _bindOutput(child) {
    const onStdoutLine = (line) => {
      if (!line) {
        return;
      }
      this._appendLog('stdout', line);

      if (line.includes('登录成功后回到这里按 ENTER 键')) {
        this._setState({
          phase: 'waiting_manual_login',
          awaitingManualConfirm: true,
          canConfirm: true,
          note: '请在浏览器完成人工登录后调用 /v1/login/confirm',
        });
      }

      if (line.includes('⏳ 等待你完成登录')) {
        this._setState({
          phase: 'waiting_manual_login',
          awaitingManualConfirm: true,
          canConfirm: true,
        });
      }

      if (line.includes('✅ 登录成功!')) {
        this._setState({
          phase: 'authenticated',
          authenticatedAt: new Date().toISOString(),
          awaitingManualConfirm: false,
          canConfirm: false,
          note: '会话已认证，可提交任务',
          sessionRecovered: false,
        });
      }
    };

    const onStderrLine = (line) => {
      if (!line) {
        return;
      }
      this._appendLog('stderr', line);
      if (line.includes('❌ 登录出错')) {
        this._setState({
          phase: 'error',
          lastError: line,
        });
      }
    };

    child.stdout.on('data', createLinePump(onStdoutLine));
    child.stderr.on('data', createLinePump(onStderrLine));
  }

  start(options = {}) {
    if (this.child && !this.child.killed) {
      throw new Error('登录进程已在运行');
    }

    const targetUrl = String(options.targetUrl || 'https://www.instagram.com').trim();
    const debugPort = parsePort(options.debugPort, 9222);
    const chromePath = String(options.chromePath || '').trim();
    const hideOnAuthenticated = options.hideOnAuthenticated !== false;

    const args = ['login_web.js', targetUrl, '--debug-port', String(debugPort)];
    if (chromePath) {
      args.push('--chrome-path', chromePath);
    }
    if (hideOnAuthenticated) {
      args.push('--hide-on-auth');
    } else {
      args.push('--no-hide-on-auth');
    }

    const child = spawn('node', args, {
      cwd: this.cwd,
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.child = child;
    this.logs = [];
    this._setState({
      phase: 'starting',
      targetUrl,
      debugPort,
      chromePath,
      hideOnAuthenticated,
      pid: Number(child.pid || 0),
      startedAt: new Date().toISOString(),
      authenticatedAt: '',
      stoppedAt: '',
      lastError: '',
      exitCode: null,
      signal: '',
      awaitingManualConfirm: false,
      canConfirm: false,
      note: '浏览器启动中',
      sessionRecovered: false,
    });
    this._bindOutput(child);

    child.on('error', (error) => {
      this._appendLog('stderr', String(error.message || error || 'spawn error'));
      this._setState({
        phase: 'error',
        lastError: String(error.message || error || 'spawn error'),
      });
    });

    child.on('exit', (code, signal) => {
      const prevPhase = this.state.phase;
      this.child = null;
      if (prevPhase === 'stopping') {
        this._setState({
          phase: 'stopped',
          pid: 0,
          stoppedAt: new Date().toISOString(),
          exitCode: code,
          signal: signal || '',
          awaitingManualConfirm: false,
          canConfirm: false,
          note: '登录进程已停止',
          sessionRecovered: false,
        });
        return;
      }

      if (this._restoreFromBrowserInfoSync('登录进程退出，已切换为恢复会话')) {
        return;
      }

      this._setState({
        phase: 'stopped',
        pid: 0,
        stoppedAt: new Date().toISOString(),
        exitCode: code,
        signal: signal || '',
        awaitingManualConfirm: false,
        canConfirm: false,
        note: prevPhase === 'authenticated' ? '登录进程已退出，会话不可用' : this.state.note,
        sessionRecovered: false,
      });
    });

    return this.getStatus();
  }

  confirmLogin() {
    if (!this.child || this.child.killed) {
      throw new Error('登录进程未运行');
    }
    if (!this.state.canConfirm) {
      throw new Error('当前状态无需确认回车');
    }
    this.child.stdin.write('\n');
    this._setState({
      phase: 'confirming',
      canConfirm: false,
      awaitingManualConfirm: false,
      note: '已发送确认回车，等待登录检测',
    });
    return this.getStatus();
  }

  stop() {
    if (!this.child || this.child.killed) {
      this._setState({
        phase: 'stopped',
        pid: 0,
        stoppedAt: new Date().toISOString(),
        awaitingManualConfirm: false,
        canConfirm: false,
        sessionRecovered: false,
        note: this.state.sessionRecovered ? '已清除恢复会话状态' : '登录进程未运行',
      });
      return this.getStatus();
    }

    const child = this.child;
    this._setState({
      phase: 'stopping',
      note: '正在停止登录进程',
    });

    child.kill('SIGINT');
    setTimeout(() => {
      if (!child.killed) {
        child.kill('SIGKILL');
      }
    }, 5000).unref();

    return this.getStatus();
  }
}

module.exports = {
  LoginManager,
};
