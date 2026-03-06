'use strict';

const express = require('express');
const path = require('path');
const { randomBytes, timingSafeEqual } = require('crypto');
const { LoginManager } = require('./login-manager');
const { JobManager } = require('./job-manager');

function parsePort(value, fallback = 4060) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    return fallback;
  }
  return parsed;
}

function toBool(value, fallback = false) {
  if (value === undefined || value === null) {
    return fallback;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return fallback;
}

function normalizeHost(value, fallback = '127.0.0.1') {
  const raw = String(value || '').trim();
  return raw || fallback;
}

function isLoopbackHost(host) {
  const normalized = String(host || '').trim().toLowerCase();
  return normalized === '127.0.0.1'
    || normalized === '::1'
    || normalized === 'localhost';
}

function assertHostPolicy(host, allowRemote) {
  if (isLoopbackHost(host) || allowRemote === true) {
    return;
  }
  throw new Error(
    `拒绝绑定到非 loopback 地址 (${host})。如需远程访问，请显式设置 IG_DAEMON_ALLOW_REMOTE=true`
  );
}

function normalizeAuthToken(value) {
  return String(value || '').trim();
}

function resolveAuthToken(value) {
  const configured = normalizeAuthToken(value);
  if (configured) {
    return {
      token: configured,
      generated: false,
    };
  }
  return {
    token: randomBytes(24).toString('hex'),
    generated: true,
  };
}

function extractAuthTokenFromRequest(req) {
  const bearer = String(req.headers.authorization || '').trim();
  if (bearer.toLowerCase().startsWith('bearer ')) {
    const token = bearer.slice(7).trim();
    if (token) {
      return token;
    }
  }
  const custom = String(req.headers['x-ig-daemon-token'] || '').trim();
  if (custom) {
    return custom;
  }
  return '';
}

function tokenEquals(expected, actual) {
  const expectedBuf = Buffer.from(String(expected || ''), 'utf8');
  const actualBuf = Buffer.from(String(actual || ''), 'utf8');
  if (expectedBuf.length === 0 || expectedBuf.length !== actualBuf.length) {
    return false;
  }
  return timingSafeEqual(expectedBuf, actualBuf);
}

function createAuthMiddleware(expectedToken) {
  const expected = normalizeAuthToken(expectedToken);
  if (!expected) {
    throw new Error('鉴权 token 不能为空');
  }
  return (req, res, next) => {
    const provided = extractAuthTokenFromRequest(req);
    if (!provided) {
      res.status(401).json({
        ok: false,
        error: 'missing daemon auth token',
        hint: 'use Authorization: Bearer <token> or x-ig-daemon-token header',
      });
      return;
    }
    if (!tokenEquals(expected, provided)) {
      res.status(403).json({
        ok: false,
        error: 'invalid daemon auth token',
      });
      return;
    }
    next();
  };
}

function createApp(options = {}) {
  const cwd = options.cwd || process.cwd();
  const authToken = normalizeAuthToken(options.authToken);
  if (!authToken) {
    throw new Error('createApp requires authToken');
  }
  const loginManager = new LoginManager({ cwd });
  const jobManager = new JobManager({
    cwd,
    loginManager,
  });

  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/v1/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'ig-daemon',
      cwd,
      login: loginManager.getStatus(),
      queue: {
        jobs: jobManager.listJobs().length,
      },
      security: {
        authRequired: true,
        authHeader: 'Authorization: Bearer <token> or x-ig-daemon-token',
      },
      time: new Date().toISOString(),
    });
  });

  const authGuard = createAuthMiddleware(authToken);
  app.use('/v1/login', authGuard);
  app.use('/v1/jobs', authGuard);

  app.post('/v1/login/start', (req, res) => {
    try {
      const body = req.body || {};
      const status = loginManager.start({
        targetUrl: body.targetUrl || 'https://www.instagram.com',
        debugPort: parsePort(body.debugPort, 9222),
        chromePath: body.chromePath || '',
        hideOnAuthenticated: body.hideOnAuthenticated !== false,
      });
      res.json({
        ok: true,
        message: '登录进程已启动，请在浏览器人工登录后调用 /v1/login/confirm',
        status,
      });
    } catch (error) {
      res.status(400).json({
        ok: false,
        error: String(error.message || error || 'start login failed'),
      });
    }
  });

  app.get('/v1/login/status', (req, res) => {
    const tail = Math.max(10, Number(req.query.tail || 80) || 80);
    res.json({
      ok: true,
      status: loginManager.getStatus(),
      logs: loginManager.getLogs(tail),
    });
  });

  app.post('/v1/login/confirm', (_req, res) => {
    try {
      const status = loginManager.confirmLogin();
      res.json({
        ok: true,
        message: '已向登录进程发送回车确认',
        status,
      });
    } catch (error) {
      res.status(400).json({
        ok: false,
        error: String(error.message || error || 'confirm login failed'),
      });
    }
  });

  app.post('/v1/login/stop', (_req, res) => {
    try {
      const status = loginManager.stop();
      res.json({
        ok: true,
        status,
      });
    } catch (error) {
      res.status(400).json({
        ok: false,
        error: String(error.message || error || 'stop login failed'),
      });
    }
  });

  app.post('/v1/jobs', (req, res) => {
    try {
      const body = req.body || {};
      const job = jobManager.submit(body.type, body.params || {});
      res.json({
        ok: true,
        job,
      });
    } catch (error) {
      res.status(400).json({
        ok: false,
        error: String(error.message || error || 'submit job failed'),
      });
    }
  });

  app.get('/v1/jobs', (_req, res) => {
    res.json({
      ok: true,
      jobs: jobManager.listJobs(),
    });
  });

  app.get('/v1/jobs/:jobId', (req, res) => {
    const job = jobManager.getJob(req.params.jobId);
    if (!job) {
      res.status(404).json({
        ok: false,
        error: 'job not found',
      });
      return;
    }
    res.json({
      ok: true,
      job,
    });
  });

  app.post('/v1/jobs/:jobId/cancel', (req, res) => {
    try {
      const job = jobManager.cancel(req.params.jobId);
      res.json({
        ok: true,
        job,
      });
    } catch (error) {
      res.status(404).json({
        ok: false,
        error: String(error.message || error || 'cancel job failed'),
      });
    }
  });

  app.get('/', (_req, res) => {
    res.json({
      ok: true,
      service: 'ig-daemon',
      docs: {
        health: '/v1/health',
        loginStart: 'POST /v1/login/start',
        loginStatus: 'GET /v1/login/status',
        loginConfirm: 'POST /v1/login/confirm',
        loginStop: 'POST /v1/login/stop',
        jobsCreate: 'POST /v1/jobs',
        jobsList: 'GET /v1/jobs',
      },
    });
  });

  app.use((err, _req, res, _next) => {
    res.status(500).json({
      ok: false,
      error: String(err?.message || err || 'internal error'),
    });
  });

  return {
    app,
    loginManager,
    jobManager,
  };
}

function startServer(options = {}) {
  const cwd = options.cwd || process.cwd();
  const host = normalizeHost(options.host || process.env.IG_DAEMON_HOST, '127.0.0.1');
  const port = parsePort(options.port || process.env.IG_DAEMON_PORT, 4060);
  const allowRemote = toBool(options.allowRemote ?? process.env.IG_DAEMON_ALLOW_REMOTE, false);
  assertHostPolicy(host, allowRemote);
  const authTokenValue = options.authToken || process.env.IG_DAEMON_AUTH_TOKEN || process.env.IG_DAEMON_TOKEN;
  const auth = resolveAuthToken(authTokenValue);

  const { app, loginManager } = createApp({ cwd, authToken: auth.token });
  const server = app.listen(port, host, () => {
    const root = path.resolve(cwd);
    console.log(`IG daemon started at http://${host}:${port}`);
    console.log(`Workspace: ${root}`);
    console.log('Auth: enabled (Authorization: Bearer <token> / x-ig-daemon-token)');
    if (auth.generated) {
      console.log('[security] 未设置 IG_DAEMON_AUTH_TOKEN，已生成本进程临时 token：');
      console.log(`[security] IG_DAEMON_AUTH_TOKEN=${auth.token}`);
    }
    if (!isLoopbackHost(host)) {
      console.log('[security] IG_DAEMON_ALLOW_REMOTE=true 已启用，请确保网络边界与 token 管理');
    }
    console.log('Login flow: POST /v1/login/start -> 人工浏览器登录 -> POST /v1/login/confirm');
  });
  server.daemonAuthToken = auth.token;
  server.daemonAuthTokenGenerated = auth.generated;

  process.on('SIGINT', () => {
    loginManager.stop();
    server.close(() => {
      process.exit(0);
    });
  });

  return server;
}

if (require.main === module) {
  startServer();
}

module.exports = {
  assertHostPolicy,
  createApp,
  createAuthMiddleware,
  isLoopbackHost,
  normalizeHost,
  resolveAuthToken,
  startServer,
};
