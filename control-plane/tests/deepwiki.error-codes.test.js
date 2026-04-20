'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ERROR_CODES,
  SEVERITY,
  DeepWikiError,
  getErrorCode,
  isKnownErrorCode,
  listErrorCodes,
  wrapError,
} = require('../src/deepwiki/errors/error-codes');

test('error codes registry exposes expected core entries', () => {
  const keys = Object.keys(ERROR_CODES);
  for (const required of [
    'DW_E_KB_UNREACHABLE',
    'DW_E_DB_WRITE_FAIL',
    'DW_E_REPO_UNREADABLE',
    'DW_E_BRANCH_MISSING',
    'DW_E_STAGE_TIMEOUT',
    'DW_E_PREFLIGHT_FAILED',
  ]) {
    assert.ok(keys.includes(required), `missing error code: ${required}`);
    const entry = ERROR_CODES[required];
    assert.equal(entry.code, required);
    assert.ok(Object.values(SEVERITY).includes(entry.severity));
    assert.ok(entry.message_zh && entry.message_zh.length > 0);
    assert.ok(entry.remediation_zh && entry.remediation_zh.length > 0);
  }
});

test('isKnownErrorCode / getErrorCode / listErrorCodes behave', () => {
  assert.equal(isKnownErrorCode('DW_E_KB_UNREACHABLE'), true);
  assert.equal(isKnownErrorCode('NOT_A_CODE'), false);
  assert.equal(getErrorCode('NOT_A_CODE'), null);
  assert.equal(listErrorCodes().length, Object.keys(ERROR_CODES).length);
});

test('DeepWikiError carries code / severity / remediation', () => {
  const err = new DeepWikiError('DW_E_STAGE_TIMEOUT', 'wiki_authoring > 10s', { stageKey: 'wiki_authoring' });
  assert.equal(err.code, 'DW_E_STAGE_TIMEOUT');
  assert.equal(err.severity, SEVERITY.RETRYABLE);
  assert.match(err.message, /stage execution timeout|stage .* exceeded|阶段执行超时/);
  assert.equal(err.detail, 'wiki_authoring > 10s');
  assert.equal(err.stageKey, 'wiki_authoring');
  const json = err.toJSON();
  assert.equal(json.code, 'DW_E_STAGE_TIMEOUT');
  assert.equal(json.severity, SEVERITY.RETRYABLE);
  assert.ok(json.remediation_zh);
});

test('DeepWikiError falls back gracefully for unknown code', () => {
  const err = new DeepWikiError('DW_E_UNKNOWN_WHATEVER', 'boom');
  assert.equal(err.severity, SEVERITY.FATAL);
  assert.equal(err.remediation_zh, null);
});

test('wrapError returns DeepWikiError as-is; coerces plain Error', () => {
  const original = new DeepWikiError('DW_E_KB_UNREACHABLE', 'abc');
  assert.equal(wrapError(original), original);

  const coerced = wrapError(new Error('boom'));
  assert.equal(coerced instanceof DeepWikiError, true);
  assert.equal(coerced.code, 'DW_E_PREFLIGHT_FAILED');
  assert.equal(coerced.detail, 'boom');
});
