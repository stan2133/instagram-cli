'use strict';

const { assertHostPolicy, createAuthMiddleware, createApp } = require('../../daemon/server');

describe('daemon server security', () => {
  function createMockRes() {
    const res = {
      statusCode: 200,
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        this.body = payload;
        return this;
      },
    };
    return res;
  }

  function runGuard(headers, expectedAuth = 'test-auth-value') {
    const guard = createAuthMiddleware(expectedAuth);
    const req = {
      headers: headers || {},
    };
    const res = createMockRes();
    let nextCalled = false;
    guard(req, res, () => {
      nextCalled = true;
    });
    return {
      res,
      nextCalled,
    };
  }

  it('createApp requires auth token', () => {
    expect(() => createApp({ cwd: process.cwd() })).toThrow(/authToken/);
  });

  it('returns 401 for request without auth token', () => {
    const { res, nextCalled } = runGuard({});
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(401);
    expect(res.body?.ok).toBe(false);
    expect(String(res.body?.error || '')).toMatch(/missing daemon auth token/i);
  });

  it('returns 403 for invalid bearer token', () => {
    const { res, nextCalled } = runGuard({
      authorization: 'Bearer wrong-value',
    });
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(403);
    expect(res.body?.ok).toBe(false);
    expect(String(res.body?.error || '')).toMatch(/invalid daemon auth token/i);
  });

  it('accepts valid bearer token', () => {
    const { res, nextCalled } = runGuard({
      authorization: 'Bearer p0-fix-value',
    }, 'p0-fix-value');
    expect(nextCalled).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(null);
  });

  it('accepts x-ig-daemon-token header', () => {
    const { res, nextCalled } = runGuard({
      'x-ig-daemon-token': 'p0-fix-value',
    }, 'p0-fix-value');
    expect(nextCalled).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(null);
  });

  it('rejects non-loopback host unless allowRemote is explicitly enabled', () => {
    expect(() => assertHostPolicy('0.0.0.0', false)).toThrow(/IG_DAEMON_ALLOW_REMOTE=true/);
    expect(() => assertHostPolicy('0.0.0.0', true)).not.toThrow();
    expect(() => assertHostPolicy('127.0.0.1', false)).not.toThrow();
  });
});
