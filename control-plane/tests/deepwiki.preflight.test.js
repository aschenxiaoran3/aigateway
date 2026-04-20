'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  runPreflight,
  probeKnowledgeBase,
  probeKnowledgeBaseVenv,
  probeDatabase,
  probeRepoAccess,
  probeBranchExists,
  probeLlmEndpoint,
  probeConfigDrift,
  formatFailuresAsError,
} = require('../src/deepwiki/preflight');

function withEnv(overrides, run) {
  const previous = {};
  for (const [key, value] of Object.entries(overrides)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('probeKnowledgeBase returns code when URL missing', async () => {
  const result = await withEnv({ KNOWLEDGE_BASE_SEARCH_URL: '' }, () =>
    probeKnowledgeBase({ searchUrl: '' })
  );
  assert.equal(result.code, 'DW_E_KB_UNREACHABLE');
});

test('probeRepoAccess fails when path missing', () => {
  const result = probeRepoAccess({ repoPath: '' });
  assert.equal(result.code, 'DW_E_REPO_UNREADABLE');

  const result2 = probeRepoAccess({ repoPath: '/nonexistent/xyz-not-a-path-12345' });
  assert.equal(result2.code, 'DW_E_REPO_UNREADABLE');
});

test('probeRepoAccess returns null when path readable', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'preflight-'));
  try {
    assert.equal(probeRepoAccess({ repoPath: tmp }), null);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('probeBranchExists with injected execFn', () => {
  const ok = probeBranchExists({
    repoPath: '/tmp',
    branch: 'main',
    execFn: () => true,
  });
  assert.equal(ok, null);

  const miss = probeBranchExists({
    repoPath: '/tmp',
    branch: 'nope',
    execFn: () => false,
  });
  assert.equal(miss.code, 'DW_E_BRANCH_MISSING');
});

test('probeBranchExists skipped when branch blank', () => {
  const result = probeBranchExists({ repoPath: '/tmp', branch: '' });
  assert.equal(result, null);
});

test('probeDatabase fails when handle lacks query()', async () => {
  const result = await probeDatabase({ db: {} });
  assert.equal(result.code, 'DW_E_DB_WRITE_FAIL');
});

test('probeDatabase succeeds with stub', async () => {
  let called = 0;
  const stub = { query: async () => { called += 1; return [{ ok: 1 }]; } };
  const result = await probeDatabase({ db: stub });
  assert.equal(result, null);
  assert.equal(called, 1);
});

test('probeKnowledgeBaseVenv fails on missing python', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'venv-'));
  try {
    // missing bin/python
    const result = probeKnowledgeBaseVenv({ venvPath: tmp });
    assert.equal(result.code, 'DW_E_KB_VENV_MISSING');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('probeKnowledgeBaseVenv opt-in (returns null when no path)', () => {
  const result = withEnv({ KNOWLEDGE_BASE_VENV_PATH: undefined }, () =>
    probeKnowledgeBaseVenv({ venvPath: '' })
  );
  assert.equal(result, null);
});

test('probeConfigDrift detects host mismatch', () => {
  const result = probeConfigDrift({
    expectedKbUrl: 'http://127.0.0.1:8016/api/v1/search',
    reportedKbUrl: 'http://127.0.0.1:8000/api/v1/search',
  });
  assert.equal(result.code, 'DW_E_CONFIG_DRIFT');
});

test('probeConfigDrift tolerates matching hosts', () => {
  const result = probeConfigDrift({
    expectedKbUrl: 'http://127.0.0.1:8016/api/v1/search',
    reportedKbUrl: 'http://127.0.0.1:8016/api/v1/search',
  });
  assert.equal(result, null);
});

test('runPreflight aggregates failures and honors DEEPWIKI_PREFLIGHT_DISABLE', async () => {
  const result = await withEnv(
    {
      KNOWLEDGE_BASE_SEARCH_URL: '',
      KNOWLEDGE_BASE_VENV_PATH: undefined,
      LLM_BASE_URL: '',
      DEEPWIKI_PREFLIGHT_DISABLE: '',
    },
    async () => runPreflight({
      db: { query: async () => [{ ok: 1 }] },
      repoPath: '',
      branch: '',
    })
  );
  assert.equal(result.ok, false);
  const codes = result.failures.map((item) => item.code);
  assert.ok(codes.includes('DW_E_KB_UNREACHABLE'));
  assert.ok(codes.includes('DW_E_REPO_UNREADABLE'));

  const resultSkipped = await withEnv(
    {
      KNOWLEDGE_BASE_SEARCH_URL: '',
      KNOWLEDGE_BASE_VENV_PATH: undefined,
      LLM_BASE_URL: '',
      DEEPWIKI_PREFLIGHT_DISABLE: 'DW_E_KB_UNREACHABLE,DW_E_REPO_UNREADABLE',
    },
    async () => runPreflight({
      db: { query: async () => [{ ok: 1 }] },
      repoPath: '',
      branch: '',
    })
  );
  assert.ok(resultSkipped.skipped.includes('DW_E_KB_UNREACHABLE'));
  assert.ok(resultSkipped.skipped.includes('DW_E_REPO_UNREADABLE'));
  const skippedCodes = resultSkipped.failures.map((item) => item.code);
  assert.ok(!skippedCodes.includes('DW_E_KB_UNREACHABLE'));
  assert.ok(!skippedCodes.includes('DW_E_REPO_UNREADABLE'));
});

test('runPreflight ok=true when all probes clean', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'clean-'));
  try {
    const result = await withEnv(
      {
        KNOWLEDGE_BASE_SEARCH_URL: '',
        KNOWLEDGE_BASE_VENV_PATH: undefined,
        LLM_BASE_URL: '',
        DEEPWIKI_PREFLIGHT_DISABLE: 'DW_E_KB_UNREACHABLE',
      },
      async () => runPreflight({
        db: { query: async () => [{ ok: 1 }] },
        repoPath: tmp,
        branch: '',
      })
    );
    assert.equal(result.ok, true);
    assert.deepEqual(result.failures, []);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('formatFailuresAsError yields DeepWikiError aggregate', () => {
  const err = formatFailuresAsError([
    { probe: 'kb', code: 'DW_E_KB_UNREACHABLE', detail: 'boom' },
    { probe: 'repo', code: 'DW_E_REPO_UNREADABLE', detail: 'nope' },
  ]);
  assert.ok(err);
  assert.equal(err.code, 'DW_E_PREFLIGHT_FAILED');
  assert.match(err.detail, /kb:DW_E_KB_UNREACHABLE/);
  assert.match(err.detail, /repo:DW_E_REPO_UNREADABLE/);
  assert.equal(err.failures.length, 2);
});

test('formatFailuresAsError returns null for empty', () => {
  assert.equal(formatFailuresAsError([]), null);
  assert.equal(formatFailuresAsError(null), null);
});
