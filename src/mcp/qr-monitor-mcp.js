'use strict';

const { QRMonitorManager, parsePort } = require('../qr/monitor-core');

const PROTOCOL_VERSION = '2024-11-05';

function toJsonText(value) {
  return JSON.stringify(value, null, 2);
}

function nowIso() {
  return new Date().toISOString();
}

function makeResourceUris(sessionId) {
  const encoded = encodeURIComponent(sessionId);
  return {
    statusUri: `qr://sessions/${encoded}/status`,
    imageLatestUri: `qr://sessions/${encoded}/image/latest`,
    imageCurrentUri: `qr://sessions/${encoded}/image/current`,
  };
}

class FramedJsonRpcServer {
  constructor(dispatch) {
    this.dispatch = dispatch;
    this.buffer = Buffer.alloc(0);
  }

  start() {
    process.stdin.on('data', (chunk) => this.onData(chunk));
    process.stdin.on('error', (err) => {
      this.logError(err);
    });
    process.stdin.resume();
  }

  logError(err) {
    try {
      process.stderr.write(`[qr-monitor-mcp] ${String(err.message || err)}\n`);
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
      } catch (err) {
        this.logError(new Error(`Invalid JSON payload: ${String(err.message || err)}`));
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

class MCPError extends Error {
  constructor(message, code = -32000, data = null) {
    super(message);
    this.code = code;
    this.data = data;
  }
}

function requireSession(manager, sessionId) {
  const session = manager.getSession(sessionId);
  if (!session) {
    throw new MCPError(`Session not found: ${sessionId}`, -32001, { reason: 'SESSION_NOT_FOUND' });
  }
  return session;
}

function parseSessionUri(uri) {
  const exactSessions = 'qr://sessions';
  if (uri === exactSessions) {
    return { type: 'sessions' };
  }

  const statusMatch = uri.match(/^qr:\/\/sessions\/([^/]+)\/status$/);
  if (statusMatch) {
    return { type: 'status', sessionId: decodeURIComponent(statusMatch[1]) };
  }

  const imageLatestMatch = uri.match(/^qr:\/\/sessions\/([^/]+)\/image\/latest$/);
  if (imageLatestMatch) {
    return { type: 'image_latest', sessionId: decodeURIComponent(imageLatestMatch[1]) };
  }

  const imageCurrentMatch = uri.match(/^qr:\/\/sessions\/([^/]+)\/image\/current$/);
  if (imageCurrentMatch) {
    return { type: 'image_current', sessionId: decodeURIComponent(imageCurrentMatch[1]) };
  }

  const imageHistoryMatch = uri.match(/^qr:\/\/sessions\/([^/]+)\/image\/history\/([^/]+)$/);
  if (imageHistoryMatch) {
    return {
      type: 'image_history',
      sessionId: decodeURIComponent(imageHistoryMatch[1]),
      hash: decodeURIComponent(imageHistoryMatch[2]),
    };
  }

  return { type: 'invalid' };
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
      name: 'qr_monitor_start',
      description: 'Start a QR monitor session for a target domain and browser debug port.',
      inputSchema: {
        type: 'object',
        properties: {
          sessionId: { type: 'string' },
          targetDomain: { type: 'string' },
          debugPort: { type: 'number' },
          monitorPort: { type: 'number' },
          pollMs: { type: 'number' },
          maxAgeMs: { type: 'number' },
          refreshCooldownMs: { type: 'number' },
          qrFile: { type: 'string' },
        },
        required: ['targetDomain', 'debugPort'],
      },
    },
    {
      name: 'qr_monitor_stop',
      description: 'Stop a QR monitor session.',
      inputSchema: {
        type: 'object',
        properties: {
          sessionId: { type: 'string' },
        },
        required: ['sessionId'],
      },
    },
    {
      name: 'qr_monitor_list',
      description: 'List all QR monitor sessions.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'qr_monitor_status',
      description: 'Get status for a QR monitor session.',
      inputSchema: {
        type: 'object',
        properties: {
          sessionId: { type: 'string' },
        },
        required: ['sessionId'],
      },
    },
    {
      name: 'qr_monitor_get_current',
      description: 'Get current QR payload (including dataUrl) for a session.',
      inputSchema: {
        type: 'object',
        properties: {
          sessionId: { type: 'string' },
        },
        required: ['sessionId'],
      },
    },
    {
      name: 'qr_monitor_refresh',
      description: 'Request QR refresh for a session.',
      inputSchema: {
        type: 'object',
        properties: {
          sessionId: { type: 'string' },
          force: { type: 'boolean' },
        },
        required: ['sessionId'],
      },
    },
  ];
}

function listResources(manager) {
  const resources = [
    {
      uri: 'qr://sessions',
      name: 'QR Sessions',
      mimeType: 'application/json',
      description: 'List of QR monitor sessions.',
    },
  ];

  for (const session of manager.listSessions()) {
    const { statusUri, imageLatestUri, imageCurrentUri } = makeResourceUris(session.sessionId);
    resources.push(
      {
        uri: statusUri,
        name: `QR Session Status (${session.sessionId})`,
        mimeType: 'application/json',
      },
      {
        uri: imageLatestUri,
        name: `QR Latest Image (${session.sessionId})`,
        mimeType: 'image/png',
      },
      {
        uri: imageCurrentUri,
        name: `QR Current Payload (${session.sessionId})`,
        mimeType: 'application/json',
      }
    );
  }

  return resources;
}

async function createQrMonitorMcpServer(options = {}) {
  const manager = new QRMonitorManager({ rootDir: options.rootDir || process.cwd() });

  async function handleToolCall(name, args) {
    const input = args || {};

    if (name === 'qr_monitor_start') {
      const targetDomain = String(input.targetDomain || '').trim().toLowerCase();
      const debugPort = parsePort(input.debugPort, NaN);
      if (!targetDomain) {
        throw new MCPError('targetDomain is required', -32602);
      }
      if (!Number.isInteger(debugPort)) {
        throw new MCPError('debugPort is required and must be a valid port', -32602);
      }

      const session = await manager.startSession({
        sessionId: input.sessionId,
        targetDomain,
        debugPort,
        monitorPort: parsePort(input.monitorPort, 3999),
        pollIntervalMs: Number(input.pollMs || 1000),
        qrMaxAgeMs: Number(input.maxAgeMs || 45000),
        qrRefreshCooldownMs: Number(input.refreshCooldownMs || 3500),
        qrFile: input.qrFile,
      });

      return {
        startedAt: nowIso(),
        ...session.getPublicState(),
        resources: makeResourceUris(session.sessionId),
      };
    }

    if (name === 'qr_monitor_stop') {
      const sessionId = String(input.sessionId || '');
      if (!sessionId) {
        throw new MCPError('sessionId is required', -32602);
      }
      const stopped = await manager.stopSession(sessionId);
      return { sessionId, stopped, at: nowIso() };
    }

    if (name === 'qr_monitor_list') {
      const sessions = manager.listSessions().map((item) => ({
        ...item,
        resources: makeResourceUris(item.sessionId),
      }));
      return { count: sessions.length, sessions };
    }

    if (name === 'qr_monitor_status') {
      const sessionId = String(input.sessionId || '');
      const session = requireSession(manager, sessionId);
      return session.getPublicState();
    }

    if (name === 'qr_monitor_get_current') {
      const sessionId = String(input.sessionId || '');
      const session = requireSession(manager, sessionId);
      return session.getCurrentQrPayload();
    }

    if (name === 'qr_monitor_refresh') {
      const sessionId = String(input.sessionId || '');
      const force = Boolean(input.force);
      const session = requireSession(manager, sessionId);
      const result = await session.requestRefresh(force);
      return {
        sessionId,
        refreshed: true,
        force,
        ...result,
      };
    }

    throw new MCPError(`Unknown tool: ${name}`, -32601);
  }

  async function handleResourceRead(uri) {
    const parsed = parseSessionUri(uri);

    if (parsed.type === 'sessions') {
      const sessions = manager.listSessions().map((item) => ({
        ...item,
        resources: makeResourceUris(item.sessionId),
      }));
      return {
        contents: [
          {
            uri,
            mimeType: 'application/json',
            text: toJsonText({ count: sessions.length, sessions }),
          },
        ],
      };
    }

    if (parsed.type === 'status') {
      const session = requireSession(manager, parsed.sessionId);
      return {
        contents: [
          {
            uri,
            mimeType: 'application/json',
            text: toJsonText(session.getPublicState()),
          },
        ],
      };
    }

    if (parsed.type === 'image_current') {
      const session = requireSession(manager, parsed.sessionId);
      return {
        contents: [
          {
            uri,
            mimeType: 'application/json',
            text: toJsonText(session.getCurrentQrPayload()),
          },
        ],
      };
    }

    if (parsed.type === 'image_latest') {
      const session = requireSession(manager, parsed.sessionId);
      const qrPayload = session.getCurrentQrPayload();
      const buffer = session.getCurrentQrBuffer();
      if (!buffer) {
        throw new MCPError('QR image not ready', -32004, { reason: 'QR_NOT_READY', sessionId: parsed.sessionId });
      }
      return {
        contents: [
          {
            uri,
            mimeType: 'image/png',
            blob: buffer.toString('base64'),
          },
          {
            uri: `${uri}#meta`,
            mimeType: 'application/json',
            text: toJsonText({
              sessionId: parsed.sessionId,
              hash: qrPayload.hash,
              capturedAt: qrPayload.capturedAt,
              ageSec: qrPayload.qrAgeSec,
              targetDomain: qrPayload.targetDomain,
            }),
          },
        ],
      };
    }

    if (parsed.type === 'image_history') {
      const session = requireSession(manager, parsed.sessionId);
      const file = session.getHistoryFileByHash(parsed.hash);
      if (!file) {
        throw new MCPError('QR history image not found', -32004, {
          reason: 'QR_FILE_MISSING',
          sessionId: parsed.sessionId,
          hash: parsed.hash,
        });
      }
      const buffer = require('fs').readFileSync(file);
      return {
        contents: [
          {
            uri,
            mimeType: 'image/png',
            blob: buffer.toString('base64'),
          },
        ],
      };
    }

    throw new MCPError(`Invalid resource URI: ${uri}`, -32002, { reason: 'INVALID_RESOURCE_URI' });
  }

  const server = new FramedJsonRpcServer(async (message) => {
    const { method, params } = message;

    if (method === 'initialize') {
      return {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {
          tools: { listChanged: false },
          resources: { subscribe: false, listChanged: false },
        },
        serverInfo: {
          name: 'qr-monitor-mcp',
          version: '1.0.0',
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
      const toolName = params?.name;
      const payload = await handleToolCall(toolName, params?.arguments || {});
      return asToolResult(payload);
    }

    if (method === 'resources/list') {
      return {
        resources: listResources(manager),
      };
    }

    if (method === 'resources/read') {
      const uri = String(params?.uri || '');
      if (!uri) {
        throw new MCPError('uri is required', -32602);
      }
      return handleResourceRead(uri);
    }

    throw new MCPError(`Method not found: ${method}`, -32601);
  });

  process.on('SIGINT', async () => {
    await manager.stopAll();
    process.exit(0);
  });
  process.on('SIGTERM', async () => {
    await manager.stopAll();
    process.exit(0);
  });

  return {
    start() {
      server.start();
    },
    manager,
  };
}

module.exports = {
  createQrMonitorMcpServer,
};
