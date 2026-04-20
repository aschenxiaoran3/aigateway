'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  classify,
  computeBackoffMs,
  executeWithRetry,
  DEFAULT_POLICY,
} = require('../src/deepwiki/health/retry-policy');
const { DeepWikiError } = require('../src/deepwiki/errors/error-codes');

test('classify tags DeepWikiError by severity', () => {
  const retry = classify(new DeepWikiError('DW_E_KB_UNREACHABLE', 'boom'));
  assert.equal(retry.retryable, true);
  assert.equal(retry.severity, 'retryable');

  const fatal = classify(new DeepWikiError('DW_E_DB_WRITE_FAIL', 'db'));
  assert.equal(fatal.retryable, false);
  assert.equal(fatal.severity, 'fatal');
});

test('classify recognizes known code on plain objects', () => {
  const out = classify({ code: 'DW_E_STAGE_TIMEOUT' });
  assert.equal(out.retryable, true);
});

test('classify treats unknown errors as fatal', () => {
  const out = classify(new Error('random'));
  assert.equal(out.retryable, false);
  assert.equal(out.severity, 'fatal');
});

test('computeBackoffMs applies exponential growth capped at max', () => {
  const policy = { backoffMs: 100, backoffFactor: 2, maxBackoffMs: 350 };
  assert.equal(computeBackoffMs(1, policy), 100);
  assert.equal(computeBackoffMs(2, policy), 200);
  assert.equal(computeBackoffMs(3, policy), 350); // capped (400 -> 350)
});

test('executeWithRetry retries retryable errors up to maxRetries', async () => {
  const events = [];
  let calls = 0;
  const result = await executeWithRetry(
    async () => {
      calls += 1;
      if (calls < 3) throw new DeepWikiError('DW_E_KB_UNREACHABLE', `miss ${calls}`);
      return 'ok';
    },
    {
      maxRetries: 3,
      sleep: async () => {},
      onAttempt: (info) => events.push(info),
    }
  );
  assert.equal(result.ok, true);
  assert.equal(result.attempts, 3);
  assert.equal(result.result, 'ok');
  assert.equal(events.length, 3);
  assert.equal(events[0].outcome, 'failure');
  assert.equal(events[1].outcome, 'failure');
  assert.equal(events[2].outcome, 'success');
});

test('executeWithRetry aborts on fatal error without retrying', async () => {
  let calls = 0;
  await assert.rejects(
    () => executeWithRetry(
      async () => {
        calls += 1;
        throw new DeepWikiError('DW_E_DB_WRITE_FAIL', 'dead');
      },
      { maxRetries: 5, sleep: async () => {} }
    ),
    (err) => {
      assert.equal(err.code, 'DW_E_DB_WRITE_FAIL');
      return true;
    }
  );
  assert.equal(calls, 1);
});

test('executeWithRetry throws last error after exhausting retries', async () => {
  let calls = 0;
  await assert.rejects(
    () => executeWithRetry(
      async () => {
        calls += 1;
        throw new DeepWikiError('DW_E_KB_UNREACHABLE', `attempt ${calls}`);
      },
      { maxRetries: 2, sleep: async () => {} }
    ),
    (err) => {
      assert.equal(err.code, 'DW_E_KB_UNREACHABLE');
      return true;
    }
  );
  assert.equal(calls, 3); // 1 + 2 retries
});

test('executeWithRetry respects custom isRetryable override', async () => {
  let calls = 0;
  const result = await executeWithRetry(
    async () => {
      calls += 1;
      if (calls < 2) throw new Error('flaky');
      return 'done';
    },
    {
      maxRetries: 3,
      sleep: async () => {},
      isRetryable: (err) => err && err.message === 'flaky',
    }
  );
  assert.equal(result.ok, true);
  assert.equal(result.attempts, 2);
});

test('DEFAULT_POLICY is frozen', () => {
  assert.equal(Object.isFrozen(DEFAULT_POLICY), true);
});
