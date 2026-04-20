'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildRunTimeline,
  aggregateStageTrends,
  summarizeErrors,
  summarizeActiveRuns,
  percentile,
  durationMs,
} = require('../src/deepwiki/health/health-service');

test('durationMs handles ISO strings and missing values', () => {
  assert.equal(durationMs('2024-01-01T00:00:00Z', '2024-01-01T00:01:00Z'), 60_000);
  assert.equal(durationMs(null, '2024-01-01T00:01:00Z'), null);
});

test('percentile computes p50/p95 on sorted durations', () => {
  const values = [1000, 2000, 3000, 4000, 5000];
  assert.equal(percentile(values, 50), 3000);
  assert.equal(percentile(values, 95), 5000);
  assert.equal(percentile([], 50), null);
});

test('buildRunTimeline reads raw DB column ended_at when finished_at absent', () => {
  const nodes = [
    { id: 1, node_key: 'a', status: 'completed',
      started_at: '2024-01-01T00:00:00Z', ended_at: '2024-01-01T00:00:30Z' },
    { id: 2, node_key: 'b', status: 'failed',
      started_at: '2024-01-01T00:01:00Z', ended_at: '2024-01-01T00:02:00Z', error_code: 'DW_E_STAGE_TIMEOUT' },
  ];
  const result = buildRunTimeline({ nodes });
  assert.equal(result.timeline[0].duration_ms, 30_000);
  assert.equal(result.timeline[0].finished_at, '2024-01-01T00:00:30Z');
  assert.equal(result.timeline[1].duration_ms, 60_000);
  assert.equal(result.total_duration_ms, 120_000);
});

test('buildRunTimeline sorts by start and counts statuses', () => {
  const nodes = [
    { id: 2, node_key: 'b', node_label: 'B', status: 'failed',
      started_at: '2024-01-01T00:01:00Z', finished_at: '2024-01-01T00:02:30Z', error_code: 'DW_E_STAGE_TIMEOUT' },
    { id: 1, node_key: 'a', node_label: 'A', status: 'completed',
      started_at: '2024-01-01T00:00:00Z', finished_at: '2024-01-01T00:01:00Z' },
    { id: 3, node_key: 'c', status: 'running',
      started_at: '2024-01-01T00:02:30Z' },
  ];
  const result = buildRunTimeline({ nodes, pipelineRun: { id: 99, status: 'running' } });
  assert.equal(result.run_id, 99);
  assert.equal(result.stats.total, 3);
  assert.equal(result.stats.completed, 1);
  assert.equal(result.stats.failed, 1);
  assert.equal(result.stats.running, 1);
  assert.equal(result.timeline[0].node_key, 'a');
  assert.equal(result.timeline[1].error_code, 'DW_E_STAGE_TIMEOUT');
  assert.equal(result.timeline[0].duration_ms, 60_000);
  assert.equal(result.total_duration_ms, 150_000);
});

test('buildRunTimeline tolerates empty nodes', () => {
  const result = buildRunTimeline({ nodes: [], pipelineRun: null });
  assert.equal(result.run_id, null);
  assert.equal(result.stats.total, 0);
  assert.deepEqual(result.timeline, []);
});

test('aggregateStageTrends computes per-stage percentiles and failure ratio', () => {
  const runA = [
    { node_key: 'rag_ingest', status: 'completed',
      started_at: '2024-01-01T00:00:00Z', finished_at: '2024-01-01T00:05:00Z' },
    { node_key: 'retrieval_eval', status: 'failed',
      started_at: '2024-01-01T00:05:00Z', finished_at: '2024-01-01T00:05:30Z', error_code: 'DW_E_STAGE_TIMEOUT' },
  ];
  const runB = [
    { node_key: 'rag_ingest', status: 'completed',
      started_at: '2024-01-02T00:00:00Z', finished_at: '2024-01-02T00:10:00Z' },
    { node_key: 'retrieval_eval', status: 'completed',
      started_at: '2024-01-02T00:10:00Z', finished_at: '2024-01-02T00:10:20Z' },
  ];
  const rows = aggregateStageTrends([runA, runB]);
  const ingest = rows.find((r) => r.stage_key === 'rag_ingest');
  const retrieval = rows.find((r) => r.stage_key === 'retrieval_eval');
  assert.equal(ingest.sample_size, 2);
  assert.equal(ingest.duration_p50_ms, 300_000);
  assert.equal(ingest.failure_count, 0);
  assert.equal(retrieval.failure_count, 1);
  assert.equal(retrieval.failure_ratio, 0.5);
  assert.equal(retrieval.error_counts['DW_E_STAGE_TIMEOUT'], 1);
});

test('summarizeErrors aggregates by code with stages + last_seen', () => {
  const runA = [
    { node_key: 'rag_ingest', status: 'failed', error_code: 'DW_E_KB_UNREACHABLE',
      finished_at: '2024-01-01T00:10:00Z' },
  ];
  const runB = [
    { node_key: 'retrieval_eval', status: 'failed', error_code: 'DW_E_KB_UNREACHABLE',
      finished_at: '2024-01-02T00:10:00Z' },
    { node_key: 'structure_mining', status: 'failed', error_code: 'DW_E_STAGE_TIMEOUT',
      finished_at: '2024-01-02T00:15:00Z' },
  ];
  const summary = summarizeErrors([runA, runB]);
  assert.equal(summary[0].code, 'DW_E_KB_UNREACHABLE');
  assert.equal(summary[0].count, 2);
  assert.equal(summary[0].stages.rag_ingest, 1);
  assert.equal(summary[0].stages.retrieval_eval, 1);
  assert.equal(new Date(summary[0].last_seen).toISOString(), '2024-01-02T00:10:00.000Z');
  assert.equal(summary[1].code, 'DW_E_STAGE_TIMEOUT');
});

test('summarizeActiveRuns filters by running/queued/pending/retrying', () => {
  const runs = [
    { id: 1, status: 'completed', project_id: 10 },
    { id: 2, status: 'running', project_id: 10, project_code: 'svc-a' },
    { id: 3, status: 'queued', project_id: 10 },
    { id: 4, status: 'failed', project_id: 10 },
    { id: 5, status: 'retrying', project_id: 10 },
  ];
  const active = summarizeActiveRuns(runs);
  assert.deepEqual(active.map((r) => r.run_id), [2, 3, 5]);
  assert.equal(active[0].project_code, 'svc-a');
});

test('summarizeActiveRuns tolerates null input', () => {
  assert.deepEqual(summarizeActiveRuns(null), []);
  assert.deepEqual(summarizeActiveRuns(undefined), []);
});
