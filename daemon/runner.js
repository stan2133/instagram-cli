'use strict';

const { spawn } = require('child_process');

function parsePort(value, fallback = 9222) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    return fallback;
  }
  return parsed;
}

function pushOption(args, key, value) {
  if (value === undefined || value === null || value === '') {
    return;
  }
  args.push(`--${key}`, String(value));
}

function pushFlag(args, key, enabled) {
  if (enabled) {
    args.push(`--${key}`);
  }
}

function buildCommand(jobType, params = {}) {
  const debugPort = parsePort(params.debugPort, 9222);
  const keepConnected = params.keepConnected === true;

  switch (jobType) {
    case 'search_users': {
      const query = String(params.query || '').trim();
      if (!query) {
        throw new Error('search_users 缺少 query');
      }
      const rawLimit = Number(params.limit);
      const limit = Number.isInteger(rawLimit) && rawLimit > 0
        ? Math.min(rawLimit, 5)
        : 5;
      const args = ['search-user.js', query];
      args.push('--limit', String(limit));
      pushOption(args, 'output', params.output);
      pushOption(args, 'open', params.open);
      pushOption(args, 'debug-port', debugPort);
      pushFlag(args, 'keep-connected', keepConnected);
      return { command: 'node', args };
    }
    case 'fetch_user_posts': {
      const target = String(params.target || '').trim();
      if (!target) {
        throw new Error('fetch_user_posts 缺少 target');
      }
      const args = ['fetch-user-posts.js', target];
      pushOption(args, 'limit', params.limit);
      pushOption(args, 'output', params.output);
      pushOption(args, 'debug-port', debugPort);
      pushFlag(args, 'keep-connected', keepConnected);
      return { command: 'node', args };
    }
    case 'fetch_user_following': {
      const target = String(params.target || '').trim();
      if (!target) {
        throw new Error('fetch_user_following 缺少 target');
      }
      const args = ['fetch-user-following.js', target];
      pushOption(args, 'limit', params.limit);
      pushOption(args, 'output', params.output);
      pushOption(args, 'debug-port', debugPort);
      pushFlag(args, 'keep-connected', keepConnected);
      return { command: 'node', args };
    }
    case 'fetch_post_hot_comments': {
      const target = String(params.target || '').trim();
      if (!target) {
        throw new Error('fetch_post_hot_comments 缺少 target');
      }
      const args = ['fetch-post-hot-comments.js', target];
      pushOption(args, 'limit', params.limit);
      pushOption(args, 'min-likes', params.minLikes);
      pushFlag(args, 'include-replies', params.includeReplies === true);
      pushOption(args, 'output', params.output);
      pushOption(args, 'debug-port', debugPort);
      pushFlag(args, 'keep-connected', keepConnected);
      return { command: 'node', args };
    }
    case 'fetch_user_hot_media': {
      const target = String(params.target || '').trim();
      if (!target) {
        throw new Error('fetch_user_hot_media 缺少 target');
      }
      const args = ['fetch-user-hot-media.js', target];
      pushOption(args, 'scan-limit', params.scanLimit);
      pushOption(args, 'top-reels', params.topReels);
      pushOption(args, 'top-posts', params.topPosts);
      pushOption(args, 'output', params.output);
      pushOption(args, 'debug-port', debugPort);
      pushFlag(args, 'keep-connected', keepConnected);
      return { command: 'node', args };
    }
    case 'download_hot_media_assets': {
      const input = String(params.input || '').trim();
      if (!input) {
        throw new Error('download_hot_media_assets 缺少 input');
      }
      const args = ['download-hot-media-assets.js', '--input', input];
      pushOption(args, 'output-dir', params.outputDir);
      pushOption(args, 'concurrency', params.concurrency);
      pushOption(args, 'retry', params.retry);
      pushOption(args, 'timeout', params.timeout);
      pushOption(args, 'max-posts', params.maxPosts);
      pushOption(args, 'debug-port', debugPort);
      pushOption(args, 'proxy', params.proxy);
      pushFlag(args, 'overwrite', params.overwrite === true);
      if (params.includeCover === false) {
        args.push('--no-cover');
      }
      pushFlag(args, 'keep-connected', keepConnected);
      return { command: 'node', args };
    }
    case 'go_home': {
      const args = ['go-home.js'];
      pushOption(args, 'target-url', params.targetUrl);
      pushOption(args, 'output', params.output);
      pushOption(args, 'debug-port', debugPort);
      pushFlag(args, 'keep-connected', keepConnected);
      return { command: 'node', args };
    }
    default:
      throw new Error(`不支持的 job type: ${jobType}`);
  }
}

function createLinePump(onLine) {
  let buffer = '';
  return (chunk) => {
    buffer += String(chunk || '');
    while (true) {
      const index = buffer.indexOf('\n');
      if (index < 0) {
        break;
      }
      const line = buffer.slice(0, index).replace(/\r/g, '');
      buffer = buffer.slice(index + 1);
      onLine(line);
    }
  };
}

function runCommand(jobType, params, options = {}) {
  const cwd = options.cwd || process.cwd();
  const env = options.env || process.env;
  const maxLogLines = Number(options.maxLogLines || 1000);
  const commandSpec = buildCommand(jobType, params);
  const logLines = [];

  let child = null;
  let settled = false;

  const resultPromise = new Promise((resolve, reject) => {
    child = spawn(commandSpec.command, commandSpec.args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const appendLine = (source, line) => {
      const value = `[${source}] ${line}`;
      logLines.push(value);
      if (logLines.length > maxLogLines) {
        logLines.splice(0, logLines.length - maxLogLines);
      }
    };

    const stdoutPump = createLinePump((line) => appendLine('stdout', line));
    const stderrPump = createLinePump((line) => appendLine('stderr', line));

    child.stdout.on('data', stdoutPump);
    child.stderr.on('data', stderrPump);

    child.on('error', (error) => {
      if (settled) {
        return;
      }
      settled = true;
      reject(error);
    });

    child.on('exit', (code, signal) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve({
        ok: code === 0,
        exitCode: Number(code || 0),
        signal: signal || '',
        logs: logLines,
        command: commandSpec.command,
        args: commandSpec.args,
      });
    });
  });

  return {
    child,
    promise: resultPromise,
  };
}

module.exports = {
  buildCommand,
  runCommand,
};
