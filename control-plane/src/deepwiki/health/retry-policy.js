'use strict';

const { DeepWikiError, SEVERITY, getErrorCode } = require('../errors/error-codes');

const DEFAULT_POLICY = Object.freeze({
  maxRetries: 2,
  backoffMs: 1500,
  backoffFactor: 2,
  maxBackoffMs: 20 * 1000,
});

function classify(error) {
  if (error && error instanceof DeepWikiError) {
    return {
      code: error.code,
      severity: error.severity,
      retryable: error.severity === SEVERITY.RETRYABLE,
    };
  }
  if (error && typeof error === 'object' && error.code && getErrorCode(error.code)) {
    const entry = getErrorCode(error.code);
    return {
      code: error.code,
      severity: entry.severity,
      retryable: entry.severity === SEVERITY.RETRYABLE,
    };
  }
  // Unknown errors are conservatively classified as fatal (non-retryable) to avoid
  // burning LLM tokens / DB writes on genuine bugs.
  return {
    code: error && error.code ? String(error.code) : null,
    severity: SEVERITY.FATAL,
    retryable: false,
  };
}

function computeBackoffMs(attempt, policy = {}) {
  const base = Number(policy.backoffMs || DEFAULT_POLICY.backoffMs);
  const factor = Number(policy.backoffFactor || DEFAULT_POLICY.backoffFactor);
  const cap = Number(policy.maxBackoffMs || DEFAULT_POLICY.maxBackoffMs);
  const raw = base * Math.pow(factor, Math.max(0, attempt - 1));
  return Math.min(cap, raw);
}

/**
 * Execute `fn` with retry semantics driven by DW error code severity.
 *
 * @param {Function} fn async function to run
 * @param {{
 *   maxRetries?: number,
 *   backoffMs?: number,
 *   backoffFactor?: number,
 *   maxBackoffMs?: number,
 *   sleep?: (ms:number)=>Promise<any>,
 *   onAttempt?: (info:object)=>void,
 *   isRetryable?: (error:any)=>boolean,
 * }} opts
 */
async function executeWithRetry(fn, opts = {}) {
  const policy = {
    maxRetries: Number.isFinite(opts.maxRetries) ? opts.maxRetries : DEFAULT_POLICY.maxRetries,
    backoffMs: opts.backoffMs ?? DEFAULT_POLICY.backoffMs,
    backoffFactor: opts.backoffFactor ?? DEFAULT_POLICY.backoffFactor,
    maxBackoffMs: opts.maxBackoffMs ?? DEFAULT_POLICY.maxBackoffMs,
  };
  const sleep = typeof opts.sleep === 'function'
    ? opts.sleep
    : (ms) => new Promise((r) => setTimeout(r, ms));
  const overrideRetryable = typeof opts.isRetryable === 'function' ? opts.isRetryable : null;
  const maxAttempts = policy.maxRetries + 1;

  let attempt = 0;
  let lastError = null;

  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      const result = await fn({ attempt });
      if (typeof opts.onAttempt === 'function') {
        opts.onAttempt({ attempt, outcome: 'success' });
      }
      return { ok: true, attempts: attempt, result };
    } catch (error) {
      lastError = error;
      const classification = classify(error);
      const retryable = overrideRetryable ? Boolean(overrideRetryable(error)) : classification.retryable;
      if (typeof opts.onAttempt === 'function') {
        opts.onAttempt({
          attempt,
          outcome: 'failure',
          code: classification.code,
          severity: classification.severity,
          retryable,
        });
      }
      if (!retryable || attempt >= maxAttempts) {
        break;
      }
      const delay = computeBackoffMs(attempt, policy);
      await sleep(delay);
    }
  }
  throw lastError;
}

module.exports = {
  classify,
  computeBackoffMs,
  executeWithRetry,
  DEFAULT_POLICY,
};
