'use strict';

const { EventEmitter } = require('events');
const { spawn } = require('child_process');

function parsePort(value, fallback = 9222) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
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
    };
    this.logs = [];
    this.child = null;
  }

  getStatus() {
    return {
      ...this.state,
      running: Boolean(this.child && !this.child.killed),
    };
  }

  getLogs(limit = 120) {
    const n = Math.max(1, Number(limit) || 120);
    return this.logs.slice(-n);
  }

  isAuthenticated() {
    const running = Boolean(this.child && !this.child.killed);
    return running && this.state.phase === 'authenticated';
  }

  _setState(patch) {
    this.state = {
      ...this.state,
      ...patch,
    };
    this.emit('state', this.getStatus());
  }

  _appendLog(source, line) {
    const entry = `${new Date().toISOString()} [${source}] ${line}`;
    appendWithCap(this.logs, entry, this.maxLogs);
    this.emit('log', entry);
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
      this.child = null;
      this._setState({
        phase: this.state.phase === 'stopping' ? 'stopped' : this.state.phase,
        pid: 0,
        stoppedAt: new Date().toISOString(),
        exitCode: code,
        signal: signal || '',
        awaitingManualConfirm: false,
        canConfirm: false,
        note: this.state.phase === 'authenticated'
          ? '登录进程已退出'
          : this.state.note,
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
        note: '登录进程未运行',
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
