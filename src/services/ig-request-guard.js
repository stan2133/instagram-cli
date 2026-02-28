'use strict';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toInt(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    return fallback;
  }
  if (typeof min === 'number' && parsed < min) {
    return fallback;
  }
  if (typeof max === 'number' && parsed > max) {
    return fallback;
  }
  return parsed;
}

function parseBool(rawValue, fallback) {
  if (rawValue === undefined || rawValue === null || rawValue === '') {
    return fallback;
  }
  const value = String(rawValue).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(value)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(value)) {
    return false;
  }
  return fallback;
}

function getErrorText(error) {
  if (!error) {
    return '';
  }
  const text = String(error.message || error || '').trim();
  if (text) {
    return text;
  }
  return '';
}

function parseStatusFromText(text) {
  if (!text) {
    return 0;
  }
  const match = text.match(/\bstatus(?:=|:)\s*(\d{3})\b/i);
  if (!match) {
    return 0;
  }
  return Number(match[1]) || 0;
}

function hasRiskSignal(text, status) {
  const lower = String(text || '').toLowerCase();
  if ([401, 403, 429].includes(Number(status || 0))) {
    return true;
  }
  const patterns = [
    'challenge_required',
    'checkpoint_required',
    'feedback_required',
    'rate limit',
    'too many requests',
    'please wait a few minutes',
    'try again later',
    'temporarily blocked',
    'suspicious',
    'login_required',
  ];
  return patterns.some((p) => lower.includes(p));
}

function trimReason(text, maxLen = 220) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  if (!value) {
    return 'unknown';
  }
  if (value.length <= maxLen) {
    return value;
  }
  return `${value.slice(0, maxLen)}...`;
}

function isCircuitBreakerError(error) {
  const code = String(error?.code || '');
  return code === 'IG_CIRCUIT_OPEN' || code === 'IG_CIRCUIT_OPENED';
}

function createInstagramRequestGuard(rawOptions = {}) {
  const options = rawOptions || {};
  const scriptName = String(options.scriptName || 'unknown-script');

  const config = {
    minDelayMs: toInt(
      options.minDelayMs ?? process.env.IG_RATE_LIMIT_MIN_DELAY_MS,
      900,
      0,
      60000
    ),
    jitterMs: toInt(
      options.jitterMs ?? process.env.IG_RATE_LIMIT_JITTER_MS,
      600,
      0,
      60000
    ),
    enabled: parseBool(options.enabled ?? process.env.IG_RATE_LIMIT_ENABLED, true),
    breakerEnabled: parseBool(
      options.breakerEnabled ?? process.env.IG_CIRCUIT_BREAKER_ENABLED,
      true
    ),
    failureThreshold: toInt(
      options.failureThreshold ?? process.env.IG_CIRCUIT_BREAKER_FAILURE_THRESHOLD,
      3,
      1,
      100
    ),
    cooldownMs: toInt(
      options.cooldownMs ?? process.env.IG_CIRCUIT_BREAKER_COOLDOWN_MS,
      5 * 60 * 1000,
      1000,
      24 * 60 * 60 * 1000
    ),
    riskCooldownMs: toInt(
      options.riskCooldownMs ?? process.env.IG_CIRCUIT_BREAKER_RISK_COOLDOWN_MS,
      30 * 60 * 1000,
      1000,
      24 * 60 * 60 * 1000
    ),
  };

  let nextAllowedAt = Date.now();
  let openedUntil = 0;
  let openedReason = '';
  let consecutiveFailures = 0;

  function describe() {
    const ratePart = config.enabled
      ? `限速 ${config.minDelayMs}ms + 抖动0~${config.jitterMs}ms`
      : '限速关闭';
    const breakerPart = config.breakerEnabled
      ? `熔断 阈值=${config.failureThreshold}, 冷却=${Math.round(config.cooldownMs / 1000)}s, 风险冷却=${Math.round(config.riskCooldownMs / 1000)}s`
      : '熔断关闭';
    return `${ratePart}; ${breakerPart}`;
  }

  async function applyRateLimit() {
    if (!config.enabled) {
      return;
    }
    const jitter = config.jitterMs > 0
      ? Math.floor(Math.random() * (config.jitterMs + 1))
      : 0;
    const baseDelay = config.minDelayMs + jitter;
    const now = Date.now();
    const scheduled = Math.max(nextAllowedAt, now) + baseDelay;
    nextAllowedAt = scheduled;
    const waitMs = scheduled - now;
    if (waitMs > 0) {
      await sleep(waitMs);
    }
  }

  function ensureCircuitClosed(meta = {}) {
    if (!config.breakerEnabled) {
      return;
    }
    const now = Date.now();
    if (openedUntil <= now) {
      openedUntil = 0;
      openedReason = '';
      return;
    }
    const remainingMs = openedUntil - now;
    const remainingSec = Math.ceil(remainingMs / 1000);
    const endpoint = meta.url ? ` endpoint=${meta.url}` : '';
    const detail = openedReason ? ` 原因: ${openedReason}` : '';
    const error = new Error(
      `请求被熔断保护拦截(${scriptName})，剩余冷却 ${remainingSec}s.${detail}${endpoint}`
    );
    error.code = 'IG_CIRCUIT_OPEN';
    error.circuitOpenUntil = openedUntil;
    throw error;
  }

  function openCircuit(meta, reason, sourceError, cooldownMs) {
    if (!config.breakerEnabled) {
      return;
    }
    openedUntil = Date.now() + Math.max(1000, cooldownMs);
    openedReason = trimReason(reason);
    const seconds = Math.ceil(cooldownMs / 1000);
    const endpoint = meta.url ? ` endpoint=${meta.url}` : '';
    const error = new Error(
      `触发熔断保护(${scriptName})，冷却 ${seconds}s.${endpoint} 原因: ${openedReason}`
    );
    error.code = 'IG_CIRCUIT_OPENED';
    error.circuitOpenUntil = openedUntil;
    error.cause = sourceError;
    throw error;
  }

  async function run(meta, task) {
    const requestMeta = meta || {};
    ensureCircuitClosed(requestMeta);
    await applyRateLimit();

    try {
      const result = await task();
      consecutiveFailures = 0;
      return result;
    } catch (error) {
      const text = getErrorText(error);
      const status = Number(error?.status || 0) || parseStatusFromText(text);
      const risk = hasRiskSignal(text, status);
      consecutiveFailures += 1;

      if (risk) {
        openCircuit(requestMeta, text || `status=${status}`, error, config.riskCooldownMs);
      }

      if (config.breakerEnabled && consecutiveFailures >= config.failureThreshold) {
        openCircuit(
          requestMeta,
          text || `连续失败 ${consecutiveFailures} 次`,
          error,
          config.cooldownMs
        );
      }

      throw error;
    }
  }

  return {
    config,
    describe,
    run,
  };
}

module.exports = {
  createInstagramRequestGuard,
  isCircuitBreakerError,
};
