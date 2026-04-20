'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  withStageTimeout,
  resolveTimeoutMs,
  DEFAULT_STAGE_TIMEOUT_MS,
  FALLBACK_TIMEOUT_MS,
} = require('../src/deepwiki/stage-timeout');

test('withStageTimeout resolves when fn finishes in time', async () => {
  const result = await withStageTimeout(
    async () => {
      await new Promise((r) => setTimeout(r, 5));
      return 'done';
    },
    { stageKey: 'fast_stage', timeoutMs: 1000 }
  );
  assert.equal(result, 'done');
});

test('withStageTimeout throws DW_E_STAGE_TIMEOUT when fn hangs', async () => {
  let onTimeoutSeen = null;
  await assert.rejects(
    () =>
      withStageTimeout(
        () => new Promise(() => {}),
        {
          stageKey: 'slow_stage',
          timeoutMs: 20,
          onTimeout: (info) => {
            onTimeoutSeen = info;
          },
        }
      ),
    (err) => {
      assert.equal(err.code, 'DW_E_STAGE_TIMEOUT');
      assert.equal(err.stageKey, 'slow_stage');
      assert.equal(err.timeoutMs, 20);
      return true;
    }
  );
  assert.deepEqual(onTimeoutSeen, { stageKey: 'slow_stage', timeoutMs: 20 });
});

test('withStageTimeout propagates thrown errors from fn', async () => {
  await assert.rejects(
    () => withStageTimeout(async () => { throw new Error('boom'); }, { stageKey: 'fail', timeoutMs: 100 }),
    /boom/
  );
});

test('resolveTimeoutMs honors env override DEEPWIKI_STAGE_TIMEOUT_MS_<STAGE>', () => {
  const prev = process.env.DEEPWIKI_STAGE_TIMEOUT_MS_FAKE_STAGE;
  process.env.DEEPWIKI_STAGE_TIMEOUT_MS_FAKE_STAGE = '123';
  try {
    assert.equal(resolveTimeoutMs('fake_stage'), 123);
  } finally {
    if (prev === undefined) delete process.env.DEEPWIKI_STAGE_TIMEOUT_MS_FAKE_STAGE;
    else process.env.DEEPWIKI_STAGE_TIMEOUT_MS_FAKE_STAGE = prev;
  }
});

test('resolveTimeoutMs honors global DEEPWIKI_STAGE_TIMEOUT_MS', () => {
  const prev = process.env.DEEPWIKI_STAGE_TIMEOUT_MS;
  process.env.DEEPWIKI_STAGE_TIMEOUT_MS = '77';
  try {
    assert.equal(resolveTimeoutMs('unknown_stage_xyz'), 77);
  } finally {
    if (prev === undefined) delete process.env.DEEPWIKI_STAGE_TIMEOUT_MS;
    else process.env.DEEPWIKI_STAGE_TIMEOUT_MS = prev;
  }
});

test('resolveTimeoutMs uses builtin default when no override', () => {
  const prev = process.env.DEEPWIKI_STAGE_TIMEOUT_MS;
  const prevPrefixed = process.env.DEEPWIKI_STAGE_TIMEOUT_MS_RAG_INGEST;
  delete process.env.DEEPWIKI_STAGE_TIMEOUT_MS;
  delete process.env.DEEPWIKI_STAGE_TIMEOUT_MS_RAG_INGEST;
  try {
    assert.equal(resolveTimeoutMs('rag_ingest'), DEFAULT_STAGE_TIMEOUT_MS.rag_ingest);
  } finally {
    if (prev !== undefined) process.env.DEEPWIKI_STAGE_TIMEOUT_MS = prev;
    if (prevPrefixed !== undefined) process.env.DEEPWIKI_STAGE_TIMEOUT_MS_RAG_INGEST = prevPrefixed;
  }
});

test('resolveTimeoutMs returns fallback for unknown stages without overrides', () => {
  const prev = process.env.DEEPWIKI_STAGE_TIMEOUT_MS;
  delete process.env.DEEPWIKI_STAGE_TIMEOUT_MS;
  try {
    assert.equal(resolveTimeoutMs('unknown_stage_abc'), FALLBACK_TIMEOUT_MS);
  } finally {
    if (prev !== undefined) process.env.DEEPWIKI_STAGE_TIMEOUT_MS = prev;
  }
});
