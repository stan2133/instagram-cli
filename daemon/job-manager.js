'use strict';

const { EventEmitter } = require('events');
const { randomUUID } = require('crypto');
const fs = require('fs');
const path = require('path');
const { runCommand, SUPPORTED_JOB_TYPES } = require('./runner');

const TERMINAL_STATUSES = new Set(['succeeded', 'failed', 'cancelled']);

function appendWithCap(arr, value, cap) {
  arr.push(value);
  if (arr.length > cap) {
    arr.splice(0, arr.length - cap);
  }
}

class JobManager extends EventEmitter {
  constructor(options = {}) {
    super();
    this.cwd = options.cwd || process.cwd();
    this.maxJobs = Number(options.maxJobs || 200);
    this.maxLogs = Number(options.maxLogs || 1200);
    this.maxInlineOutputBytes = Number(options.maxInlineOutputBytes || 2 * 1024 * 1024);
    this.loginManager = options.loginManager;
    this.supportedJobTypes = new Set(Array.isArray(options.supportedJobTypes) && options.supportedJobTypes.length
      ? options.supportedJobTypes
      : SUPPORTED_JOB_TYPES);
    this.jobs = [];
    this.jobsById = new Map();
    this.queue = [];
    this.active = null;
  }

  _requiresAuthenticatedSession(jobType) {
    return String(jobType || '').trim() !== 'search_content_local';
  }

  _snapshot(job) {
    return {
      id: job.id,
      type: job.type,
      params: job.params,
      status: job.status,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      error: job.error,
      result: job.result,
      logs: job.logs,
    };
  }

  _isSupportedJobType(jobType) {
    return this.supportedJobTypes.has(String(jobType || '').trim());
  }

  _buildOutputArtifact(params = {}) {
    const outputPath = String(params.output || '').trim();
    if (!outputPath) {
      return null;
    }

    const absolutePath = path.isAbsolute(outputPath)
      ? outputPath
      : path.resolve(this.cwd, outputPath);
    const artifact = {
      path: outputPath,
      absolutePath,
      exists: false,
      sizeBytes: 0,
      tooLarge: false,
      json: null,
      error: '',
    };

    try {
      if (!fs.existsSync(absolutePath)) {
        return artifact;
      }
      artifact.exists = true;
      const stat = fs.statSync(absolutePath);
      artifact.sizeBytes = Number(stat.size || 0);
      if (artifact.sizeBytes > this.maxInlineOutputBytes) {
        artifact.tooLarge = true;
        return artifact;
      }
      const raw = fs.readFileSync(absolutePath, 'utf8');
      artifact.json = JSON.parse(raw);
      return artifact;
    } catch (error) {
      artifact.error = String(error?.message || error || 'read output artifact failed');
      return artifact;
    }
  }

  _reclaimFinishedJobs() {
    if (this.jobs.length <= this.maxJobs) {
      return;
    }

    const overflowBefore = this.jobs.length - this.maxJobs;
    const removable = [];
    for (const item of this.jobs) {
      if (TERMINAL_STATUSES.has(item.status)) {
        removable.push(item.id);
        if (removable.length >= overflowBefore) {
          break;
        }
      }
    }

    if (removable.length === 0) {
      this.emit('gc', {
        at: new Date().toISOString(),
        removedCount: 0,
        overflowBefore,
        overflowAfter: overflowBefore,
        reason: 'no-terminal-job-to-evict',
      });
      return;
    }

    const removableSet = new Set(removable);
    this.jobs = this.jobs.filter((job) => !removableSet.has(job.id));
    for (const jobId of removableSet) {
      this.jobsById.delete(jobId);
      const idx = this.queue.indexOf(jobId);
      if (idx >= 0) {
        this.queue.splice(idx, 1);
      }
    }

    const overflowAfter = Math.max(0, this.jobs.length - this.maxJobs);
    this.emit('gc', {
      at: new Date().toISOString(),
      removedCount: removable.length,
      removedJobIds: removable,
      overflowBefore,
      overflowAfter,
      reason: overflowAfter > 0 ? 'not-enough-terminal-jobs-to-evict' : 'terminal-jobs-evicted',
    });
  }

  _storeJob(job) {
    this.jobs.push(job);
    this.jobsById.set(job.id, job);
    this._reclaimFinishedJobs();
  }

  getJob(jobId) {
    const job = this.jobsById.get(jobId);
    return job ? this._snapshot(job) : null;
  }

  listJobs() {
    return this.jobs
      .slice()
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .map((job) => this._snapshot(job));
  }

  submit(type, params = {}) {
    const normalizedType = String(type || '').trim();
    if (!normalizedType) {
      throw new Error('缺少 job type');
    }
    if (!this._isSupportedJobType(normalizedType)) {
      throw new Error(`不支持的 job type: ${normalizedType}`);
    }

    if (this._requiresAuthenticatedSession(normalizedType) && (!this.loginManager || !this.loginManager.isAuthenticated())) {
      throw new Error('当前未认证登录，请先完成 /v1/login/start + /v1/login/confirm');
    }

    const job = {
      id: randomUUID(),
      type: normalizedType,
      params: params || {},
      status: 'queued',
      createdAt: new Date().toISOString(),
      startedAt: '',
      finishedAt: '',
      error: '',
      result: null,
      logs: [],
      cancelRequested: false,
      child: null,
    };

    this._storeJob(job);
    this.queue.push(job.id);
    this._schedule();
    return this._snapshot(job);
  }

  cancel(jobId) {
    const job = this.jobsById.get(jobId);
    if (!job) {
      throw new Error('job 不存在');
    }

    if (job.status === 'queued') {
      job.status = 'cancelled';
      job.finishedAt = new Date().toISOString();
      const index = this.queue.indexOf(job.id);
      if (index >= 0) {
        this.queue.splice(index, 1);
      }
      return this._snapshot(job);
    }

    if (job.status === 'running' && job.child && !job.child.killed) {
      job.cancelRequested = true;
      job.child.kill('SIGTERM');
      setTimeout(() => {
        if (job.child && !job.child.killed) {
          job.child.kill('SIGKILL');
        }
      }, 5000).unref();
      return this._snapshot(job);
    }

    return this._snapshot(job);
  }

  async _schedule() {
    if (this.active) {
      return;
    }

    const jobId = this.queue.shift();
    if (!jobId) {
      return;
    }
    const job = this.jobsById.get(jobId);
    if (!job || job.status !== 'queued') {
      this._schedule();
      return;
    }

    if (this._requiresAuthenticatedSession(job.type) && (!this.loginManager || !this.loginManager.isAuthenticated())) {
      job.status = 'failed';
      job.finishedAt = new Date().toISOString();
      job.error = '执行前登录状态失效，请重新登录';
      this._schedule();
      return;
    }

    this.active = job;
    job.status = 'running';
    job.startedAt = new Date().toISOString();

    try {
      const { child, promise } = runCommand(job.type, job.params, {
        cwd: this.cwd,
        maxLogLines: this.maxLogs,
      });
      job.child = child;
      const result = await promise;
      job.logs = result.logs;
      if (job.cancelRequested) {
        job.status = 'cancelled';
        job.error = '任务已取消';
      } else if (result.ok) {
        const output = this._buildOutputArtifact(job.params);
        job.status = 'succeeded';
        job.result = {
          command: result.command,
          args: result.args,
          exitCode: result.exitCode,
          output,
        };
      } else {
        const output = this._buildOutputArtifact(job.params);
        job.status = 'failed';
        job.error = `脚本退出码 ${result.exitCode}${result.signal ? ` (${result.signal})` : ''}`;
        job.result = {
          command: result.command,
          args: result.args,
          exitCode: result.exitCode,
          signal: result.signal,
          output,
        };
      }
    } catch (error) {
      job.status = 'failed';
      job.error = String(error?.message || error || 'unknown error');
      appendWithCap(job.logs, `[runner] ${job.error}`, this.maxLogs);
    } finally {
      job.child = null;
      job.finishedAt = new Date().toISOString();
      this.active = null;
      this.emit('job', this._snapshot(job));
      this._schedule();
    }
  }
}

module.exports = {
  JobManager,
};
