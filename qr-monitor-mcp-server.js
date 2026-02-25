#!/usr/bin/env node

'use strict';

const { createQrMonitorMcpServer } = require('./src/mcp/qr-monitor-mcp');

async function main() {
  const server = await createQrMonitorMcpServer({ rootDir: __dirname });
  server.start();
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`[qr-monitor-mcp] startup failed: ${String(error.message || error)}\n`);
    process.exit(1);
  });
}
