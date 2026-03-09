'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('../../daemon/runner', () => ({
  runCommand: jest.fn(),
  SUPPORTED_JOB_TYPES: [
    'search_users',
    'fetch_user_posts',
    'fetch_user_following',
    'fetch_user_profile_summary',
    'fetch_post_hot_comments',
    'fetch_user_hot_media',
    'download_hot_media_assets',
    'search_content_local',
    'go_home',
  ],
}));

const { runCommand } = require('../../daemon/runner');
const { JobManager } = require('../../daemon/job-manager');

function flushAsyncWork() {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('JobManager submission guard and pruning policy', () => {
  beforeEach(() => {
    runCommand.mockReset();
  });

  it('rejects unknown job type at submit time', () => {
    const manager = new JobManager({
      loginManager: { isAuthenticated: () => true },
    });

    expect(() => manager.submit('unknown_job_type', {})).toThrow(/不支持的 job type/);
    expect(manager.listJobs()).toHaveLength(0);
  });

  it('evicts oldest terminal job when maxJobs is exceeded', async () => {
    runCommand.mockImplementation(() => ({
      child: { killed: false, kill: jest.fn() },
      promise: Promise.resolve({
        ok: true,
        exitCode: 0,
        signal: '',
        logs: [],
        command: 'node',
        args: ['search-content-local.js'],
      }),
    }));

    const gcEvents = [];
    const manager = new JobManager({
      maxJobs: 2,
      loginManager: { isAuthenticated: () => true },
    });
    manager.on('gc', (event) => gcEvents.push(event));

    const job1 = manager.submit('search_content_local', { query: 'nike 1' });
    await flushAsyncWork();
    const job2 = manager.submit('search_content_local', { query: 'nike 2' });
    await flushAsyncWork();
    const job3 = manager.submit('search_content_local', { query: 'nike 3' });
    await flushAsyncWork();

    expect(manager.getJob(job1.id)).toBe(null);
    expect(manager.getJob(job2.id)).not.toBe(null);
    expect(manager.getJob(job3.id)).not.toBe(null);
    expect(manager.listJobs()).toHaveLength(2);
    expect(gcEvents.some((event) => event.removedCount >= 1)).toBe(true);
  });

  it('keeps queued/running jobs even when over maxJobs if no terminal job can be reclaimed', async () => {
    let resolveFirst;
    runCommand.mockImplementationOnce(() => ({
      child: { killed: false, kill: jest.fn() },
      promise: new Promise((resolve) => {
        resolveFirst = resolve;
      }),
    }));
    runCommand.mockImplementation(() => ({
      child: { killed: false, kill: jest.fn() },
      promise: Promise.resolve({
        ok: true,
        exitCode: 0,
        signal: '',
        logs: [],
        command: 'node',
        args: ['search-content-local.js'],
      }),
    }));

    const gcEvents = [];
    const manager = new JobManager({
      maxJobs: 1,
      loginManager: { isAuthenticated: () => true },
    });
    manager.on('gc', (event) => gcEvents.push(event));

    const job1 = manager.submit('search_content_local', { query: 'nike 1' });
    const job2 = manager.submit('search_content_local', { query: 'nike 2' });
    await flushAsyncWork();

    expect(manager.getJob(job1.id)).not.toBe(null);
    expect(manager.getJob(job2.id)).not.toBe(null);
    expect(manager.listJobs().length).toBeGreaterThan(1);
    expect(gcEvents.some((event) => event.reason === 'no-terminal-job-to-evict')).toBe(true);

    resolveFirst({
      ok: true,
      exitCode: 0,
      signal: '',
      logs: [],
      command: 'node',
      args: ['search-content-local.js'],
    });
    await flushAsyncWork();
  });

  it('inlines JSON output artifact into job result for daemon API consumers', async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'ig-daemon-job-manager-'));
    const outputRelPath = './logs/result.json';
    const outputAbsPath = path.resolve(cwd, outputRelPath);
    fs.mkdirSync(path.dirname(outputAbsPath), { recursive: true });
    fs.writeFileSync(outputAbsPath, JSON.stringify({ hits: [{ id: '1' }] }), 'utf8');

    runCommand.mockImplementation(() => ({
      child: { killed: false, kill: jest.fn() },
      promise: Promise.resolve({
        ok: true,
        exitCode: 0,
        signal: '',
        logs: [],
        command: 'node',
        args: ['search-content-local.js'],
      }),
    }));

    const manager = new JobManager({
      cwd,
      loginManager: { isAuthenticated: () => true },
    });
    const job = manager.submit('search_content_local', {
      query: 'nike',
      output: outputRelPath,
    });
    await flushAsyncWork();

    const latest = manager.getJob(job.id);
    expect(latest?.status).toBe('succeeded');
    expect(latest?.result?.output?.path).toBe(outputRelPath);
    expect(latest?.result?.output?.json?.hits?.length).toBe(1);
  });
});
