'use strict';

/**
 * Pure(-ish) aggregation helpers for the DeepWiki health dashboard.
 *
 * All functions take plain arrays/objects; the Express layer supplies them
 * from the database. This makes the module easy to unit test.
 */

const DEFAULT_TRENDS_LIMIT = 20;

function toMillis(value) {
  if (value == null) return null;
  if (value instanceof Date) return value.getTime();
  const parsed = new Date(value);
  const ms = parsed.getTime();
  return Number.isFinite(ms) ? ms : null;
}

function durationMs(startedAt, endedAt) {
  const a = toMillis(startedAt);
  const b = toMillis(endedAt);
  if (a == null || b == null) return null;
  return Math.max(0, b - a);
}

/**
 * Build a per-stage timeline for one DeepWiki run.
 *
 * @param {Object} options
 * @param {Array<Object>} options.nodes run node rows (gateway_run_nodes)
 *        Each node is expected to carry:
 *          - id / node_key / node_label / status
 *          - started_at / finished_at
 *          - attempt (optional) / error_code (optional)
 * @param {Object} [options.pipelineRun] the gateway_pipeline_runs row, optional.
 */
function buildRunTimeline({ nodes = [], pipelineRun = null } = {}) {
  const cleanedNodes = (Array.isArray(nodes) ? nodes : [])
    .map((node) => {
      const endedValue = node.ended_at || node.finished_at || node.end_time;
      const started = toMillis(node.started_at || node.start_time);
      const finished = toMillis(endedValue);
      return {
        node_id: node.id ?? null,
        node_key: node.node_key || node.stage_key || null,
        node_label: node.node_label || node.stage_label || node.node_key || null,
        status: node.status || null,
        attempt: Number(node.attempt || 1),
        error_code: node.error_code || null,
        started_at: node.started_at || null,
        finished_at: endedValue || null,
        duration_ms: durationMs(node.started_at || node.start_time, endedValue),
        _start: started,
        _finish: finished,
      };
    })
    .sort((a, b) => {
      const aStart = a._start ?? Number.POSITIVE_INFINITY;
      const bStart = b._start ?? Number.POSITIVE_INFINITY;
      return aStart - bStart;
    });

  const total = cleanedNodes.length;
  const completed = cleanedNodes.filter((n) => n.status === 'completed').length;
  const failed = cleanedNodes.filter((n) => n.status === 'failed' || n.status === 'blocked').length;
  const running = cleanedNodes.filter((n) => n.status === 'running').length;

  const starts = cleanedNodes.map((n) => n._start).filter((v) => v != null);
  const ends = cleanedNodes.map((n) => n._finish).filter((v) => v != null);
  const minStart = starts.length ? Math.min(...starts) : null;
  const maxEnd = ends.length ? Math.max(...ends) : null;
  const totalDuration = minStart != null && maxEnd != null ? Math.max(0, maxEnd - minStart) : null;

  const timeline = cleanedNodes.map((n) => {
    const out = { ...n };
    delete out._start;
    delete out._finish;
    return out;
  });

  return {
    run_id: pipelineRun && pipelineRun.id != null ? pipelineRun.id : null,
    run_status: pipelineRun ? pipelineRun.status || null : null,
    started_at: pipelineRun ? pipelineRun.started_at || null : null,
    finished_at: pipelineRun ? pipelineRun.finished_at || null : null,
    total_duration_ms: totalDuration,
    stats: { total, completed, failed, running },
    timeline,
  };
}

function percentile(values, p) {
  if (!values || values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  // nearest-rank method: idx = ceil(p/100 * n) - 1, clamped to [0, n-1]
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

/**
 * Aggregate stage-level stats across recent runs.
 *
 * @param {Array<Array<Object>>} runsNodes each entry is the run_nodes for one DeepWiki run.
 */
function aggregateStageTrends(runsNodes) {
  const perStage = new Map();
  for (const nodes of Array.isArray(runsNodes) ? runsNodes : []) {
    for (const node of Array.isArray(nodes) ? nodes : []) {
      const key = node.node_key || node.stage_key;
      if (!key) continue;
      let bucket = perStage.get(key);
      if (!bucket) {
        bucket = { stage_key: key, durations: [], statuses: {}, errors: {} };
        perStage.set(key, bucket);
      }
      const dur = durationMs(node.started_at || node.start_time, node.ended_at || node.finished_at || node.end_time);
      if (dur != null) bucket.durations.push(dur);
      const status = node.status || 'unknown';
      bucket.statuses[status] = (bucket.statuses[status] || 0) + 1;
      if (node.error_code) {
        bucket.errors[node.error_code] = (bucket.errors[node.error_code] || 0) + 1;
      }
    }
  }

  const rows = [];
  for (const bucket of perStage.values()) {
    const total = Object.values(bucket.statuses).reduce((acc, v) => acc + v, 0);
    const failures = (bucket.statuses.failed || 0) + (bucket.statuses.blocked || 0);
    rows.push({
      stage_key: bucket.stage_key,
      sample_size: total,
      duration_p50_ms: percentile(bucket.durations, 50),
      duration_p95_ms: percentile(bucket.durations, 95),
      failure_count: failures,
      failure_ratio: total > 0 ? Number((failures / total).toFixed(4)) : 0,
      status_counts: bucket.statuses,
      error_counts: bucket.errors,
    });
  }
  rows.sort((a, b) => (b.failure_ratio - a.failure_ratio) || ((b.duration_p95_ms || 0) - (a.duration_p95_ms || 0)));
  return rows;
}

function summarizeErrors(nodesFromRuns) {
  const bucket = new Map();
  for (const nodes of Array.isArray(nodesFromRuns) ? nodesFromRuns : []) {
    for (const node of Array.isArray(nodes) ? nodes : []) {
      if (!node.error_code) continue;
      const code = node.error_code;
      let entry = bucket.get(code);
      if (!entry) {
        entry = { code, count: 0, stages: {}, last_seen: null };
        bucket.set(code, entry);
      }
      entry.count += 1;
      const stageKey = node.node_key || node.stage_key || 'unknown';
      entry.stages[stageKey] = (entry.stages[stageKey] || 0) + 1;
      const ts = node.ended_at || node.finished_at || node.started_at;
      if (ts && (!entry.last_seen || new Date(ts) > new Date(entry.last_seen))) {
        entry.last_seen = ts;
      }
    }
  }
  return [...bucket.values()].sort((a, b) => b.count - a.count);
}

function summarizeActiveRuns(runs = []) {
  return (Array.isArray(runs) ? runs : [])
    .filter((run) => {
      const status = String(run.status || '').toLowerCase();
      return status === 'running' || status === 'queued' || status === 'pending' || status === 'retrying';
    })
    .map((run) => ({
      run_id: run.id ?? run.run_id ?? null,
      status: run.status || null,
      project_id: run.project_id ?? null,
      project_code: run.project_code || null,
      pipeline_run_id: run.pipeline_run_id ?? null,
      started_at: run.started_at || null,
      updated_at: run.updated_at || null,
      branch: run.branch || null,
    }));
}

module.exports = {
  DEFAULT_TRENDS_LIMIT,
  buildRunTimeline,
  aggregateStageTrends,
  summarizeErrors,
  summarizeActiveRuns,
  durationMs,
  percentile,
};
