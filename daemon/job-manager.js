'use strict';

const { EventEmitter } = require('events');
const { randomUUID } = require('crypto');
const { runCommand } = require('./runner');

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
    this.loginManager = options.loginManager;
    this.jobs = [];
    this.jobsById = new Map();
    this.queue = [];
    this.active = null;
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

  _storeJob(job) {
    this.jobs.push(job);
    this.jobsById.set(job.id, job);
    if (this.jobs.length > this.maxJobs) {
      const removed = this.jobs.splice(0, this.jobs.length - this.maxJobs);
      for (const item of removed) {
        this.jobsById.delete(item.id);
        const idx = this.queue.indexOf(item.id);
        if (idx >= 0) {
          this.queue.splice(idx, 1);
        }
      }
    }
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
    if (!this.loginManager || !this.loginManager.isAuthenticated()) {
      throw new Error('当前未认证登录，请先完成 /v1/login/start + /v1/login/confirm');
    }

    const job = {
      id: randomUUID(),
      type: String(type || '').trim(),
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
    if (!job.type) {
      throw new Error('缺少 job type');
    }

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

    if (!this.loginManager || !this.loginManager.isAuthenticated()) {
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
        job.status = 'succeeded';
        job.result = {
          command: result.command,
          args: result.args,
          exitCode: result.exitCode,
        };
      } else {
        job.status = 'failed';
        job.error = `脚本退出码 ${result.exitCode}${result.signal ? ` (${result.signal})` : ''}`;
        job.result = {
          command: result.command,
          args: result.args,
          exitCode: result.exitCode,
          signal: result.signal,
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
