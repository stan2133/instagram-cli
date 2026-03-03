#!/usr/bin/env node

'use strict';

const { createIgDaemonMcpServer } = require('./src/mcp/ig-daemon-mcp');

async function main() {
  const server = await createIgDaemonMcpServer();
  await server.start();
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`[ig-daemon-mcp] startup failed: ${String(error?.message || error)}\n`);
    process.exit(1);
  });
}
