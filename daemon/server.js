'use strict';

const express = require('express');
const path = require('path');
const { LoginManager } = require('./login-manager');
const { JobManager } = require('./job-manager');

function parsePort(value, fallback = 4060) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    return fallback;
  }
  return parsed;
}

function createApp(options = {}) {
  const cwd = options.cwd || process.cwd();
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
      time: new Date().toISOString(),
    });
  });

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
  const host = options.host || process.env.IG_DAEMON_HOST || '127.0.0.1';
  const port = parsePort(options.port || process.env.IG_DAEMON_PORT, 4060);

  const { app, loginManager } = createApp({ cwd });
  const server = app.listen(port, host, () => {
    const root = path.resolve(cwd);
    console.log(`IG daemon started at http://${host}:${port}`);
    console.log(`Workspace: ${root}`);
    console.log('Login flow: POST /v1/login/start -> 人工浏览器登录 -> POST /v1/login/confirm');
  });

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
  createApp,
  startServer,
};
