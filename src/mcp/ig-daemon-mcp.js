'use strict';

const PROTOCOL_VERSION = '2024-11-05';
const DEFAULT_DAEMON_URL = String(process.env.IG_DAEMON_URL || 'http://127.0.0.1:4060');

function toJsonText(value) {
  return JSON.stringify(value, null, 2);
}

function nowIso() {
  return new Date().toISOString();
}

class MCPError extends Error {
  constructor(message, code = -32000, data = null) {
    super(message);
    this.code = code;
    this.data = data;
  }
}

class FramedJsonRpcServer {
  constructor(dispatch) {
    this.dispatch = dispatch;
    this.buffer = Buffer.alloc(0);
  }

  start() {
    process.stdin.on('data', (chunk) => this.onData(chunk));
    process.stdin.on('error', (err) => this.logError(err));
    process.stdin.resume();
  }

  logError(err) {
    try {
      process.stderr.write(`[ig-daemon-mcp] ${String(err?.message || err)}\n`);
    } catch (_e) {
      // noop
    }
  }

  onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);

    while (true) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd < 0) {
        return;
      }

      const headerText = this.buffer.slice(0, headerEnd).toString('utf8');
      const contentLengthLine = headerText
        .split('\r\n')
        .find((line) => line.toLowerCase().startsWith('content-length:'));

      if (!contentLengthLine) {
        this.logError(new Error('Missing Content-Length header'));
        this.buffer = this.buffer.slice(headerEnd + 4);
        continue;
      }

      const lenStr = contentLengthLine.split(':')[1]?.trim() || '';
      const contentLength = Number(lenStr);
      if (!Number.isInteger(contentLength) || contentLength < 0) {
        this.logError(new Error(`Invalid Content-Length: ${lenStr}`));
        this.buffer = this.buffer.slice(headerEnd + 4);
        continue;
      }

      const messageStart = headerEnd + 4;
      const messageEnd = messageStart + contentLength;
      if (this.buffer.length < messageEnd) {
        return;
      }

      const payload = this.buffer.slice(messageStart, messageEnd).toString('utf8');
      this.buffer = this.buffer.slice(messageEnd);

      let message;
      try {
        message = JSON.parse(payload);
      } catch (error) {
        this.logError(new Error(`Invalid JSON payload: ${String(error?.message || error)}`));
        continue;
      }

      void this.handleMessage(message);
    }
  }

  async handleMessage(message) {
    if (!message || typeof message !== 'object') {
      return;
    }

    const hasId = Object.prototype.hasOwnProperty.call(message, 'id');

    try {
      const result = await this.dispatch(message);
      if (hasId) {
        this.send({
          jsonrpc: '2.0',
          id: message.id,
          result: result ?? {},
        });
      }
    } catch (error) {
      if (hasId) {
        this.send({
          jsonrpc: '2.0',
          id: message.id,
          error: {
            code: error.code || -32000,
            message: String(error.message || error),
            data: error.data || null,
          },
        });
      }
    }
  }

  send(obj) {
    const json = JSON.stringify(obj);
    const header = `Content-Length: ${Buffer.byteLength(json, 'utf8')}\r\n\r\n`;
    process.stdout.write(header + json);
  }
}

function normalizeDaemonUrl(rawUrl) {
  const input = String(rawUrl || DEFAULT_DAEMON_URL).trim();
  if (!input) {
    throw new MCPError('daemonUrl is required', -32602);
  }
  let url;
  try {
    url = new URL(input);
  } catch (_error) {
    throw new MCPError(`Invalid daemonUrl: ${input}`, -32602);
  }
  if (!/^https?:$/.test(url.protocol)) {
    throw new MCPError(`Unsupported daemonUrl protocol: ${url.protocol}`, -32602);
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
      throw new MCPError(message, -32010, {
        endpoint,
        method,
        status: response.status,
        response: data,
      });
    }

    if (data && data.ok === false) {
      throw new MCPError(String(data.error || 'daemon returned ok=false'), -32011, {
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
    if (error instanceof MCPError) {
      throw error;
    }
    const message = error?.name === 'AbortError'
      ? `daemon request timeout: ${method} ${endpoint}`
      : `daemon request failed: ${String(error?.message || error)}`;
    throw new MCPError(message, -32012, {
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
        throw new MCPError('type is required', -32602);
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
        throw new MCPError('jobId is required', -32602);
      }
      return callDaemon(daemonUrl, 'GET', `/v1/jobs/${encodeURIComponent(jobId)}`);
    }

    if (name === 'ig_job_cancel') {
      const jobId = String(input.jobId || '').trim();
      if (!jobId) {
        throw new MCPError('jobId is required', -32602);
      }
      return callDaemon(daemonUrl, 'POST', `/v1/jobs/${encodeURIComponent(jobId)}/cancel`);
    }

    throw new MCPError(`Unknown tool: ${name}`, -32601);
  }

  const server = new FramedJsonRpcServer(async (message) => {
    const { method, params } = message;

    if (method === 'initialize') {
      return {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {
          tools: { listChanged: false },
        },
        serverInfo: {
          name: 'ig-daemon-mcp',
          version: '0.1.0',
        },
      };
    }

    if (method === 'notifications/initialized') {
      return null;
    }

    if (method === 'ping') {
      return { ok: true, at: nowIso() };
    }

    if (method === 'tools/list') {
      return {
        tools: listToolDefinitions(),
      };
    }

    if (method === 'tools/call') {
      const toolName = String(params?.name || '');
      const payload = await handleToolCall(toolName, params?.arguments || {});
      return asToolResult(payload);
    }

    throw new MCPError(`Method not found: ${method}`, -32601);
  });

  return {
    start() {
      server.start();
    },
  };
}

module.exports = {
  createIgDaemonMcpServer,
};
