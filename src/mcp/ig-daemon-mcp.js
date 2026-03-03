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

function toJsonText(value) {
  return JSON.stringify(value, null, 2);
}

function nowIso() {
  return new Date().toISOString();
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
        },
        required: ['type'],
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

  try {
    const response = await fetch(url, {
      method,
      headers: {
        'content-type': 'application/json',
      },
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

async function createIgDaemonMcpServer() {
  async function handleToolCall(name, args) {
    const input = args || {};
    const daemonUrl = normalizeDaemonUrl(input.daemonUrl);

    if (name === 'ig_health') {
      return callDaemon(daemonUrl, 'GET', '/v1/health');
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
      return callDaemon(daemonUrl, 'POST', '/v1/jobs', {
        type,
        params: input.params || {},
      });
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
      version: '0.2.0',
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
