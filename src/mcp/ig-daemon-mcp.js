'use strict';

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} = require('@modelcontextprotocol/sdk/types.js');

const DEFAULT_DAEMON_URL = String(process.env.IG_DAEMON_URL || 'http://127.0.0.1:4060');
const DEFAULT_DAEMON_AUTH_TOKEN = String(process.env.IG_DAEMON_AUTH_TOKEN || process.env.IG_DAEMON_TOKEN || '').trim();
const DEFAULT_LOGIN_TARGET_URL = 'https://www.instagram.com';
const DEFAULT_DEBUG_PORT = 9222;
const DEFAULT_JOB_POLL_MS = 1200;
const DEFAULT_JOB_TIMEOUT_MS = 120000;
const SEARCH_USERS_LIMIT_CAP = 5;
const LOGIN_REQUIRED_PATTERNS = [
  '当前未认证登录',
  'not authenticated',
  'login required',
];

function toJsonText(value) {
  return JSON.stringify(value, null, 2);
}

function nowIso() {
  return new Date().toISOString();
}

function toPort(value, fallback = DEFAULT_DEBUG_PORT) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    return fallback;
  }
  return parsed;
}

function toPositiveInt(value, fallback, min = 1, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    return fallback;
  }
  if (parsed < min) {
    return min;
  }
  if (parsed > max) {
    return max;
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTerminalJobStatus(status) {
  return status === 'succeeded' || status === 'failed' || status === 'cancelled';
}

function isLoginRequiredError(error) {
  const msg = String(error?.message || '').toLowerCase();
  return LOGIN_REQUIRED_PATTERNS.some((pattern) => msg.includes(pattern.toLowerCase()));
}

function sanitizeFileToken(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'search';
}

function normalizeDaemonUrl(rawUrl) {
  const input = String(rawUrl || DEFAULT_DAEMON_URL).trim();
  if (!input) {
    throw new McpError(ErrorCode.InvalidParams, 'daemonUrl is required');
  }
  let url;
  try {
    url = new URL(input);
  } catch (_error) {
    throw new McpError(ErrorCode.InvalidParams, `Invalid daemonUrl: ${input}`);
  }
  if (!/^https?:$/.test(url.protocol)) {
    throw new McpError(ErrorCode.InvalidParams, `Unsupported daemonUrl protocol: ${url.protocol}`);
  }
  const normalized = `${url.protocol}//${url.host}`;
  return normalized.replace(/\/+$/, '');
}

function asToolResult(payload) {
  return {
    content: [
      {
        type: 'text',
        text: toJsonText(payload),
      },
    ],
    structuredContent: payload,
  };
}

function listToolDefinitions() {
  return [
    {
      name: 'ig_health',
      description: 'Check ig-daemon health and current login summary.',
      inputSchema: {
        type: 'object',
        properties: {
          daemonUrl: { type: 'string' },
        },
      },
    },
    {
      name: 'ig_login_ensure',
      description: 'Ensure login flow is ready: if not logged in, auto-start browser login for user.',
      inputSchema: {
        type: 'object',
        properties: {
          daemonUrl: { type: 'string' },
          targetUrl: { type: 'string' },
          debugPort: { type: 'number' },
          chromePath: { type: 'string' },
          hideOnAuthenticated: { type: 'boolean' },
          confirmIfReady: { type: 'boolean' },
          waitForAuthenticated: { type: 'boolean' },
          timeoutMs: { type: 'number' },
          pollMs: { type: 'number' },
        },
      },
    },
    {
      name: 'ig_login_start',
      description: 'Start login process (human must login in browser).',
      inputSchema: {
        type: 'object',
        properties: {
          daemonUrl: { type: 'string' },
          targetUrl: { type: 'string' },
          debugPort: { type: 'number' },
          chromePath: { type: 'string' },
          hideOnAuthenticated: { type: 'boolean' },
        },
      },
    },
    {
      name: 'ig_login_status',
      description: 'Get login status and recent login logs.',
      inputSchema: {
        type: 'object',
        properties: {
          daemonUrl: { type: 'string' },
          tail: { type: 'number' },
        },
      },
    },
    {
      name: 'ig_login_confirm',
      description: 'Confirm login completion (sends ENTER to login process).',
      inputSchema: {
        type: 'object',
        properties: {
          daemonUrl: { type: 'string' },
        },
      },
    },
    {
      name: 'ig_login_stop',
      description: 'Stop current login process.',
      inputSchema: {
        type: 'object',
        properties: {
          daemonUrl: { type: 'string' },
        },
      },
    },
    {
      name: 'ig_job_submit',
      description: 'Submit a daemon job. Requires authenticated login state.',
      inputSchema: {
        type: 'object',
        properties: {
          daemonUrl: { type: 'string' },
          type: { type: 'string' },
          params: { type: 'object' },
          wait: { type: 'boolean' },
          timeoutMs: { type: 'number' },
          pollMs: { type: 'number' },
          openLoginOnUnauthenticated: { type: 'boolean' },
          targetUrl: { type: 'string' },
          debugPort: { type: 'number' },
          chromePath: { type: 'string' },
          hideOnAuthenticated: { type: 'boolean' },
        },
        required: ['type'],
      },
    },
    {
      name: 'ig_search_users',
      description: 'Search Instagram users (hard cap 5). Automatically opens login browser flow if not authenticated.',
      inputSchema: {
        type: 'object',
        properties: {
          daemonUrl: { type: 'string' },
          query: { type: 'string' },
          limit: { type: 'number' },
          output: { type: 'string' },
          open: { type: 'string' },
          wait: { type: 'boolean' },
          timeoutMs: { type: 'number' },
          pollMs: { type: 'number' },
          openLoginOnUnauthenticated: { type: 'boolean' },
          targetUrl: { type: 'string' },
          debugPort: { type: 'number' },
          chromePath: { type: 'string' },
          hideOnAuthenticated: { type: 'boolean' },
        },
        required: ['query'],
      },
    },
    {
      name: 'ig_fetch_user_profile_summary',
      description: 'Fetch user profile summary and recent media preview.',
      inputSchema: {
        type: 'object',
        properties: {
          daemonUrl: { type: 'string' },
          target: { type: 'string' },
          limit: { type: 'number' },
          output: { type: 'string' },
          wait: { type: 'boolean' },
          timeoutMs: { type: 'number' },
          pollMs: { type: 'number' },
          openLoginOnUnauthenticated: { type: 'boolean' },
          targetUrl: { type: 'string' },
          debugPort: { type: 'number' },
          chromePath: { type: 'string' },
          hideOnAuthenticated: { type: 'boolean' },
        },
        required: ['target'],
      },
    },
    {
      name: 'ig_search_content_local',
      description: 'Search locally indexed Instagram content from logs and JSON artifacts.',
      inputSchema: {
        type: 'object',
        properties: {
          daemonUrl: { type: 'string' },
          query: { type: 'string' },
          target: { type: 'string' },
          mediaType: { type: 'string' },
          since: { type: 'string' },
          until: { type: 'string' },
          sort: { type: 'string' },
          limit: { type: 'number' },
          input: { type: 'array', items: { type: 'string' } },
          inputDir: { type: 'string' },
          indexFile: { type: 'string' },
          useIndexOnly: { type: 'boolean' },
          rebuildIndex: { type: 'boolean' },
          output: { type: 'string' },
          wait: { type: 'boolean' },
          timeoutMs: { type: 'number' },
          pollMs: { type: 'number' },
          openLoginOnUnauthenticated: { type: 'boolean' },
        },
        required: ['query'],
      },
    },
    {
      name: 'ig_job_list',
      description: 'List all daemon jobs.',
      inputSchema: {
        type: 'object',
        properties: {
          daemonUrl: { type: 'string' },
        },
      },
    },
    {
      name: 'ig_job_status',
      description: 'Get a single job status by jobId.',
      inputSchema: {
        type: 'object',
        properties: {
          daemonUrl: { type: 'string' },
          jobId: { type: 'string' },
        },
        required: ['jobId'],
      },
    },
    {
      name: 'ig_job_cancel',
      description: 'Cancel a queued/running job.',
      inputSchema: {
        type: 'object',
        properties: {
          daemonUrl: { type: 'string' },
          jobId: { type: 'string' },
        },
        required: ['jobId'],
      },
    },
  ];
}

async function callDaemon(baseUrl, method, endpoint, body) {
  const url = `${baseUrl}${endpoint}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  const headers = {
    'content-type': 'application/json',
  };
  if (DEFAULT_DAEMON_AUTH_TOKEN) {
    headers.authorization = `Bearer ${DEFAULT_DAEMON_AUTH_TOKEN}`;
  }

  try {
    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : {};
    } catch (_error) {
      data = { raw: text };
    }

    if (!response.ok) {
      const message = String(data?.error || data?.message || `daemon ${method} ${endpoint} failed (${response.status})`);
      throw new McpError(-32010, message, {
        endpoint,
        method,
        status: response.status,
        response: data,
      });
    }

    if (data && data.ok === false) {
      throw new McpError(-32011, String(data.error || 'daemon returned ok=false'), {
        endpoint,
        method,
        response: data,
      });
    }

    return {
      at: nowIso(),
      daemonUrl: baseUrl,
      endpoint,
      method,
      ...data,
    };
  } catch (error) {
    if (error instanceof McpError) {
      throw error;
    }
    const message = error?.name === 'AbortError'
      ? `daemon request timeout: ${method} ${endpoint}`
      : `daemon request failed: ${String(error?.message || error)}`;
    throw new McpError(-32012, message, {
      endpoint,
      method,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function getLoginStatus(baseUrl, tail = 80) {
  const n = toPositiveInt(tail, 80, 1, 500);
  return callDaemon(baseUrl, 'GET', `/v1/login/status?tail=${n}`);
}

async function startLoginIfNeeded(baseUrl, input = {}, phase = '') {
  const normalizedPhase = String(phase || '').trim();
  if (!['idle', 'stopped', 'error', ''].includes(normalizedPhase)) {
    return {
      started: false,
      reason: 'login-already-in-progress',
    };
  }

  const body = {
    targetUrl: String(input.targetUrl || DEFAULT_LOGIN_TARGET_URL),
    debugPort: toPort(input.debugPort, DEFAULT_DEBUG_PORT),
    chromePath: String(input.chromePath || ''),
    // keep browser visible by default to let user login manually
    hideOnAuthenticated: toBool(input.hideOnAuthenticated, false),
  };

  try {
    const loginStart = await callDaemon(baseUrl, 'POST', '/v1/login/start', body);
    return {
      started: true,
      reason: 'login-started',
      loginStart,
    };
  } catch (error) {
    if (!String(error?.message || '').includes('登录进程已在运行')) {
      throw error;
    }
    return {
      started: false,
      reason: 'login-process-already-running',
    };
  }
}

async function ensureLoginFlow(baseUrl, input = {}) {
  let statusResp = await getLoginStatus(baseUrl, 80);
  let status = statusResp.status || {};

  if (status.phase === 'authenticated') {
    return {
      ok: true,
      authenticated: true,
      action: 'already-authenticated',
      status,
      logs: statusResp.logs || [],
      at: nowIso(),
    };
  }

  if (toBool(input.confirmIfReady, false) && status.canConfirm === true) {
    await callDaemon(baseUrl, 'POST', '/v1/login/confirm');
    statusResp = await getLoginStatus(baseUrl, 80);
    status = statusResp.status || {};
    if (status.phase === 'authenticated') {
      return {
        ok: true,
        authenticated: true,
        action: 'confirmed-and-authenticated',
        status,
        logs: statusResp.logs || [],
        at: nowIso(),
      };
    }
  }

  const startResult = await startLoginIfNeeded(baseUrl, input, status.phase);
  if (startResult.started) {
    statusResp = await getLoginStatus(baseUrl, 80);
    status = statusResp.status || {};
  }

  const waitForAuthenticated = toBool(input.waitForAuthenticated, false);
  if (waitForAuthenticated) {
    const timeoutMs = toPositiveInt(input.timeoutMs, DEFAULT_JOB_TIMEOUT_MS, 1000, 600000);
    const pollMs = toPositiveInt(input.pollMs, DEFAULT_JOB_POLL_MS, 200, 10000);
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      statusResp = await getLoginStatus(baseUrl, 40);
      status = statusResp.status || {};
      if (status.phase === 'authenticated') {
        return {
          ok: true,
          authenticated: true,
          action: startResult.started ? 'started-and-authenticated' : 'authenticated-after-wait',
          status,
          logs: statusResp.logs || [],
          wait: {
            enabled: true,
            timeoutMs,
            pollMs,
          },
          at: nowIso(),
        };
      }
      await sleep(pollMs);
    }
  }

  return {
    ok: true,
    authenticated: false,
    requiresManualLogin: true,
    action: startResult.started ? 'login-started-waiting-manual' : 'waiting-manual-login',
    message: '未检测到已登录会话。已打开（或保持）浏览器登录流程，请在浏览器完成登录后调用 ig_login_confirm。',
    status,
    logs: statusResp.logs || [],
    loginStart: startResult.loginStart || null,
    at: nowIso(),
  };
}

async function waitForJobTerminal(baseUrl, jobId, options = {}) {
  const timeoutMs = toPositiveInt(options.timeoutMs, DEFAULT_JOB_TIMEOUT_MS, 1000, 600000);
  const pollMs = toPositiveInt(options.pollMs, DEFAULT_JOB_POLL_MS, 200, 10000);
  const deadline = Date.now() + timeoutMs;
  let attempts = 0;

  while (Date.now() < deadline) {
    attempts += 1;
    const statusResp = await callDaemon(baseUrl, 'GET', `/v1/jobs/${encodeURIComponent(jobId)}`);
    const status = String(statusResp?.job?.status || '');
    if (isTerminalJobStatus(status)) {
      return {
        statusResp,
        wait: {
          enabled: true,
          timeoutMs,
          pollMs,
          attempts,
          finishedAt: nowIso(),
        },
      };
    }
    await sleep(pollMs);
  }

  throw new McpError(-32013, `job wait timeout: ${jobId}`, {
    jobId,
    timeoutMs,
    pollMs,
  });
}

async function submitJobWithOptions(baseUrl, type, params, options = {}) {
  const wait = toBool(options.wait, false);
  const openLoginOnUnauthenticated = toBool(options.openLoginOnUnauthenticated, true);

  let submitResp;
  try {
    submitResp = await callDaemon(baseUrl, 'POST', '/v1/jobs', {
      type,
      params: params || {},
    });
  } catch (error) {
    if (!openLoginOnUnauthenticated || !isLoginRequiredError(error)) {
      throw error;
    }
    const ensureResp = await ensureLoginFlow(baseUrl, {
      targetUrl: options.targetUrl || DEFAULT_LOGIN_TARGET_URL,
      debugPort: options.debugPort || params?.debugPort || DEFAULT_DEBUG_PORT,
      chromePath: options.chromePath || '',
      hideOnAuthenticated: toBool(options.hideOnAuthenticated, false),
      confirmIfReady: false,
      waitForAuthenticated: false,
    });
    return {
      ok: false,
      submitted: false,
      requiresManualLogin: true,
      message: '当前未认证，已自动发起浏览器登录流程。请完成人工登录并调用 ig_login_confirm 后重试作业提交。',
      login: ensureResp,
      at: nowIso(),
    };
  }

  if (!wait) {
    return {
      ...submitResp,
      wait: {
        enabled: false,
      },
    };
  }

  const jobId = String(submitResp?.job?.id || '').trim();
  if (!jobId) {
    throw new McpError(-32014, 'job id missing in submit response');
  }

  const terminal = await waitForJobTerminal(baseUrl, jobId, {
    timeoutMs: options.timeoutMs,
    pollMs: options.pollMs,
  });

  return {
    ...submitResp,
    job: terminal.statusResp.job,
    terminal: terminal.statusResp.job,
    wait: terminal.wait,
    at: nowIso(),
  };
}

function getJobOutputJson(payload = {}) {
  const output = payload?.job?.result?.output;
  if (!output || typeof output !== 'object') {
    return null;
  }
  if (output.tooLarge) {
    return null;
  }
  if (output.error) {
    return null;
  }
  return output.json ?? null;
}

function readUsersFromJobResult(payload = {}) {
  const value = getJobOutputJson(payload);
  if (Array.isArray(value)) {
    return value;
  }
  if (Array.isArray(value?.users)) {
    return value.users;
  }
  return [];
}

function readObjectFromJobResult(payload = {}) {
  const value = getJobOutputJson(payload);
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value;
  }
  if (Array.isArray(value)) {
    return {
      items: value,
    };
  }
  return {};
}

function sanitizeUsernameToken(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/^@+/, '')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'user';
}

function sanitizeSortToken(text) {
  const normalized = String(text || '')
    .toLowerCase()
    .replace(/[^a-z]+/g, '')
    .slice(0, 20) || 'relevance';
  if (normalized === 'relevance' || normalized === 'recent' || normalized === 'engagement') {
    return normalized;
  }
  return 'relevance';
}

function normalizeInputPathArray(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item || '').trim())
      .filter(Boolean);
  }
  const single = String(value || '').trim();
  if (!single) {
    return [];
  }
  return [single];
}

async function createIgDaemonMcpServer() {
  async function handleToolCall(name, args) {
    const input = args || {};
    const daemonUrl = normalizeDaemonUrl(input.daemonUrl);

    if (name === 'ig_health') {
      return callDaemon(daemonUrl, 'GET', '/v1/health');
    }

    if (name === 'ig_login_ensure') {
      return ensureLoginFlow(daemonUrl, {
        targetUrl: input.targetUrl,
        debugPort: input.debugPort,
        chromePath: input.chromePath,
        hideOnAuthenticated: input.hideOnAuthenticated,
        confirmIfReady: input.confirmIfReady,
        waitForAuthenticated: input.waitForAuthenticated,
        timeoutMs: input.timeoutMs,
        pollMs: input.pollMs,
      });
    }

    if (name === 'ig_login_start') {
      return callDaemon(daemonUrl, 'POST', '/v1/login/start', {
        targetUrl: input.targetUrl,
        debugPort: input.debugPort,
        chromePath: input.chromePath,
        hideOnAuthenticated: input.hideOnAuthenticated,
      });
    }

    if (name === 'ig_login_status') {
      const tail = Number(input.tail);
      const qs = Number.isInteger(tail) && tail > 0 ? `?tail=${tail}` : '';
      return callDaemon(daemonUrl, 'GET', `/v1/login/status${qs}`);
    }

    if (name === 'ig_login_confirm') {
      return callDaemon(daemonUrl, 'POST', '/v1/login/confirm');
    }

    if (name === 'ig_login_stop') {
      return callDaemon(daemonUrl, 'POST', '/v1/login/stop');
    }

    if (name === 'ig_job_submit') {
      const type = String(input.type || '').trim();
      if (!type) {
        throw new McpError(ErrorCode.InvalidParams, 'type is required');
      }
      return submitJobWithOptions(daemonUrl, type, input.params || {}, {
        wait: input.wait,
        timeoutMs: input.timeoutMs,
        pollMs: input.pollMs,
        openLoginOnUnauthenticated: input.openLoginOnUnauthenticated,
        targetUrl: input.targetUrl,
        debugPort: input.debugPort,
        chromePath: input.chromePath,
        hideOnAuthenticated: input.hideOnAuthenticated,
      });
    }

    if (name === 'ig_search_users') {
      const query = String(input.query || '').trim();
      if (!query) {
        throw new McpError(ErrorCode.InvalidParams, 'query is required');
      }
      const limit = Math.min(
        toPositiveInt(input.limit, SEARCH_USERS_LIMIT_CAP, 1, SEARCH_USERS_LIMIT_CAP),
        SEARCH_USERS_LIMIT_CAP
      );
      const output = String(input.output || `./logs/search-${sanitizeFileToken(query)}-${Date.now()}.json`);
      const submitResp = await submitJobWithOptions(
        daemonUrl,
        'search_users',
        {
          query,
          limit,
          output,
          open: input.open,
          debugPort: input.debugPort,
        },
        {
          wait: input.wait === undefined ? true : input.wait,
          timeoutMs: input.timeoutMs,
          pollMs: input.pollMs,
          openLoginOnUnauthenticated: input.openLoginOnUnauthenticated,
          targetUrl: input.targetUrl,
          debugPort: input.debugPort,
          chromePath: input.chromePath,
          hideOnAuthenticated: input.hideOnAuthenticated,
        }
      );

      if (submitResp.requiresManualLogin) {
        return submitResp;
      }

      const users = readUsersFromJobResult(submitResp);
      return {
        ...submitResp,
        query,
        limit,
        output,
        users,
        userCount: users.length,
      };
    }

    if (name === 'ig_fetch_user_profile_summary') {
      const target = String(input.target || '').trim();
      if (!target) {
        throw new McpError(ErrorCode.InvalidParams, 'target is required');
      }
      const limit = toPositiveInt(input.limit, 6, 1, 30);
      const output = String(
        input.output || `./logs/profile-summary-${sanitizeUsernameToken(target)}-${Date.now()}.json`
      );

      const submitResp = await submitJobWithOptions(
        daemonUrl,
        'fetch_user_profile_summary',
        {
          target,
          limit,
          output,
          debugPort: input.debugPort,
        },
        {
          wait: input.wait === undefined ? true : input.wait,
          timeoutMs: input.timeoutMs,
          pollMs: input.pollMs,
          openLoginOnUnauthenticated: input.openLoginOnUnauthenticated,
          targetUrl: input.targetUrl,
          debugPort: input.debugPort,
          chromePath: input.chromePath,
          hideOnAuthenticated: input.hideOnAuthenticated,
        }
      );

      if (submitResp.requiresManualLogin) {
        return submitResp;
      }

      const data = readObjectFromJobResult(submitResp);
      const profileSummary = data.profileSummary && typeof data.profileSummary === 'object'
        ? data.profileSummary
        : null;
      const recentMediaPreview = Array.isArray(data.recentMediaPreview)
        ? data.recentMediaPreview
        : [];

      return {
        ...submitResp,
        target,
        limit,
        output,
        profileSummary,
        recentMediaPreview,
        previewCount: recentMediaPreview.length,
      };
    }

    if (name === 'ig_search_content_local') {
      const query = String(input.query || '').trim();
      if (!query) {
        throw new McpError(ErrorCode.InvalidParams, 'query is required');
      }
      const limit = toPositiveInt(input.limit, 20, 1, 300);
      const sort = sanitizeSortToken(input.sort || 'relevance');
      const output = String(
        input.output || `./logs/content-local-${sanitizeFileToken(query)}-${Date.now()}.json`
      );

      const submitResp = await submitJobWithOptions(
        daemonUrl,
        'search_content_local',
        {
          query,
          target: input.target,
          mediaType: input.mediaType,
          since: input.since,
          until: input.until,
          sort,
          limit,
          input: normalizeInputPathArray(input.input),
          inputDir: input.inputDir,
          indexFile: input.indexFile,
          useIndexOnly: toBool(input.useIndexOnly, false),
          rebuildIndex: toBool(input.rebuildIndex, false),
          output,
        },
        {
          wait: input.wait === undefined ? true : input.wait,
          timeoutMs: input.timeoutMs,
          pollMs: input.pollMs,
          openLoginOnUnauthenticated: input.openLoginOnUnauthenticated === undefined
            ? false
            : input.openLoginOnUnauthenticated,
        }
      );

      if (submitResp.requiresManualLogin) {
        return submitResp;
      }

      const data = readObjectFromJobResult(submitResp);
      const hits = Array.isArray(data.hits) ? data.hits : [];

      return {
        ...submitResp,
        query,
        sort,
        limit,
        output,
        hits,
        hitCount: hits.length,
        totalMatchedRecords: Number(data?.meta?.totalMatchedRecords || hits.length),
        index: data?.index || null,
        filters: data?.filters || null,
      };
    }

    if (name === 'ig_job_list') {
      return callDaemon(daemonUrl, 'GET', '/v1/jobs');
    }

    if (name === 'ig_job_status') {
      const jobId = String(input.jobId || '').trim();
      if (!jobId) {
        throw new McpError(ErrorCode.InvalidParams, 'jobId is required');
      }
      return callDaemon(daemonUrl, 'GET', `/v1/jobs/${encodeURIComponent(jobId)}`);
    }

    if (name === 'ig_job_cancel') {
      const jobId = String(input.jobId || '').trim();
      if (!jobId) {
        throw new McpError(ErrorCode.InvalidParams, 'jobId is required');
      }
      return callDaemon(daemonUrl, 'POST', `/v1/jobs/${encodeURIComponent(jobId)}/cancel`);
    }

    throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
  }

  const server = new Server(
    {
      name: 'ig-daemon-mcp',
      version: '0.4.0',
    },
    {
      capabilities: {
        tools: { listChanged: false },
      },
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: listToolDefinitions(),
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const toolName = String(request?.params?.name || '');
    const payload = await handleToolCall(toolName, request?.params?.arguments || {});
    return asToolResult(payload);
  });

  return {
    async start() {
      const transport = new StdioServerTransport();
      await server.connect(transport);
    },
  };
}

module.exports = {
  createIgDaemonMcpServer,
};
