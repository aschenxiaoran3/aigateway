'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  computeManifestDiff,
  diffCounters,
  diffAssets,
  diffStages,
} = require('../src/deepwiki/health/manifest-diff');

test('diffCounters computes delta and warns on big drop', () => {
  const results = diffCounters(
    { business_rules: 40, business_actions: 20 },
    { business_rules: 15, business_actions: 22 }
  );
  const rules = results.find((item) => item.key === 'business_rules');
  assert.equal(rules.before, 40);
  assert.equal(rules.after, 15);
  assert.equal(rules.delta, -25);
  assert.equal(rules.warn, true);
  const actions = results.find((item) => item.key === 'business_actions');
  assert.equal(actions.warn, false);
});

test('diffAssets detects added and removed entries', () => {
  const results = diffAssets(
    { semantic_assets: 10, api_contracts: 5 },
    { semantic_assets: 10, api_contracts: 0, journeys: 3 }
  );
  const removed = results.find((item) => item.key === 'api_contracts');
  assert.equal(removed.removed, true);
  const added = results.find((item) => item.key === 'journeys');
  assert.equal(added.added, true);
});

test('diffStages flags slow stages', () => {
  const results = diffStages(
    { rag_ingest: { duration_ms: 60_000, status: 'completed' } },
    { rag_ingest: { duration_ms: 120_000, status: 'completed' } }
  );
  const row = results[0];
  assert.equal(row.stage, 'rag_ingest');
  assert.equal(row.durationDelta, 60_000);
  assert.equal(row.slowWarn, true);
});

test('diffStages records status changes even when duration unchanged', () => {
  const results = diffStages(
    { quality_gates: { duration_ms: 1000, status: 'completed' } },
    { quality_gates: { duration_ms: 1000, status: 'failed' } }
  );
  assert.equal(results.length, 1);
  assert.equal(results[0].statusChanged, true);
  assert.equal(results[0].afterStatus, 'failed');
});

test('diffStages keeps entries with status change even if duration identical', () => {
  const results = diffStages(
    { retrieval_eval: { duration_ms: 2000, status: 'completed' } },
    { retrieval_eval: { duration_ms: 2500, status: 'failed' } }
  );
  assert.equal(results.length, 1);
  assert.equal(results[0].statusChanged, true);
});

test('computeManifestDiff aggregates and summarizes', () => {
  const previous = {
    counters: { business_rules: 30, business_actions: 40 },
    assets: { api_contracts: { count: 12 } },
    stages: { rag_ingest: { duration_ms: 60_000, status: 'completed' } },
  };
  const current = {
    counters: { business_rules: 10, business_actions: 45 },
    assets: { api_contracts: { count: 0 }, domain_model: { count: 4 } },
    stages: { rag_ingest: { duration_ms: 120_000, status: 'completed' } },
  };
  const diff = computeManifestDiff(previous, current);
  assert.ok(Array.isArray(diff.counters));
  assert.ok(Array.isArray(diff.assets));
  assert.ok(Array.isArray(diff.stages));
  assert.ok(diff.summary.added_assets.includes('domain_model'));
  assert.ok(diff.summary.removed_assets.includes('api_contracts'));
  assert.ok(diff.summary.warning_count >= 1);
  // the big drop in business_rules triggers a counter warning
  assert.ok(diff.summary.warnings.some((w) => w.kind === 'counter' && w.key === 'business_rules'));
});

test('computeManifestDiff tolerates empty manifests', () => {
  const diff = computeManifestDiff({}, {});
  assert.deepEqual(diff.counters, []);
  assert.deepEqual(diff.assets, []);
  assert.deepEqual(diff.stages, []);
  assert.equal(diff.summary.warning_count, 0);
});
