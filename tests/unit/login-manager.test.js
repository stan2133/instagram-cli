'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { LoginManager } = require('../../daemon/login-manager');

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ig-daemon-login-manager-'));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

describe('LoginManager persistence recovery', () => {
  test('restores authenticated session from persisted state when browser pid is alive', () => {
    const cwd = makeTmpDir();
    const sessionsDir = path.join(cwd, '.instagram-cli', 'sessions');
    const stateFile = path.join(sessionsDir, 'daemon-login-state.json');
    const browserInfoFile = path.join(sessionsDir, 'browser-info.json');

    writeJson(stateFile, {
      version: 1,
      state: {
        phase: 'authenticated',
        targetUrl: 'https://www.instagram.com',
        debugPort: 9222,
        chromePath: '',
        hideOnAuthenticated: true,
        startedAt: '2026-01-01T00:00:00.000Z',
        authenticatedAt: '2026-01-01T00:00:10.000Z',
      },
    });
    writeJson(browserInfoFile, {
      pid: process.pid,
      webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/browser/mock',
    });

    const manager = new LoginManager({ cwd });
    const status = manager.getStatus();

    expect(status.phase).toBe('authenticated');
    expect(status.sessionRecovered).toBe(true);
    expect(status.running).toBe(true);
    expect(manager.isAuthenticated()).toBe(true);
  });

  test('does not restore authenticated state when browser pid is not alive', () => {
    const cwd = makeTmpDir();
    const sessionsDir = path.join(cwd, '.instagram-cli', 'sessions');
    const stateFile = path.join(sessionsDir, 'daemon-login-state.json');
    const browserInfoFile = path.join(sessionsDir, 'browser-info.json');

    writeJson(stateFile, {
      version: 1,
      state: {
        phase: 'authenticated',
        targetUrl: 'https://www.instagram.com',
        debugPort: 9222,
      },
    });
    writeJson(browserInfoFile, {
      pid: 999999,
      webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/browser/mock',
    });

    const manager = new LoginManager({ cwd });
    const status = manager.getStatus();

    expect(status.phase).toBe('idle');
    expect(status.sessionRecovered).toBe(false);
    expect(status.running).toBe(false);
    expect(manager.isAuthenticated()).toBe(false);
  });

  test('stop() clears recovered session state when no child process is attached', () => {
    const cwd = makeTmpDir();
    const sessionsDir = path.join(cwd, '.instagram-cli', 'sessions');
    const stateFile = path.join(sessionsDir, 'daemon-login-state.json');
    const browserInfoFile = path.join(sessionsDir, 'browser-info.json');

    writeJson(stateFile, {
      version: 1,
      state: {
        phase: 'authenticated',
        targetUrl: 'https://www.instagram.com',
        debugPort: 9222,
      },
    });
    writeJson(browserInfoFile, {
      pid: process.pid,
      webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/browser/mock',
    });

    const manager = new LoginManager({ cwd });
    expect(manager.getStatus().sessionRecovered).toBe(true);

    const stopped = manager.stop();
    expect(stopped.phase).toBe('stopped');
    expect(stopped.sessionRecovered).toBe(false);
    expect(manager.isAuthenticated()).toBe(false);
  });
});

