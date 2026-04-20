'use strict';

/**
 * Compute a structured diff between two DeepWiki run manifests.
 *
 * A manifest is a plain object with optional fields:
 *   - stages:    { [stageKey]: { duration_ms, asset_counts, status } }
 *   - assets:    { [assetKey]: number | { count } }
 *   - counters:  { [key]: number }   (e.g. business_rules, business_actions)
 *   - summary:   { [key]: any }
 *
 * The output is focused on highlighting notable changes. Consumers render it
 * in the admin-ui "health panel" and in run detail views.
 */

const DEFAULT_DROP_ALERT_RATIO = 0.5; // 50% drop triggers warn flag
const DEFAULT_SLOW_ALERT_RATIO = 1.5; // 50% slower triggers warn flag

function numberOrZero(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function asCount(value) {
  if (value == null) return 0;
  if (typeof value === 'number') return numberOrZero(value);
  if (typeof value === 'object' && value !== null) return numberOrZero(value.count);
  return 0;
}

function diffCounters(prev = {}, next = {}) {
  const keys = new Set([...Object.keys(prev || {}), ...Object.keys(next || {})]);
  const results = [];
  for (const key of keys) {
    const before = numberOrZero(prev[key]);
    const after = numberOrZero(next[key]);
    if (before === after) continue;
    const delta = after - before;
    const ratio = before === 0 ? null : after / before;
    const warn =
      before > 0 &&
      ((ratio !== null && ratio <= DEFAULT_DROP_ALERT_RATIO) ||
        (ratio !== null && ratio >= 1 + DEFAULT_SLOW_ALERT_RATIO - 1));
    results.push({ key, before, after, delta, ratio, warn });
  }
  return results.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}

function diffAssets(prev = {}, next = {}) {
  const keys = new Set([...Object.keys(prev || {}), ...Object.keys(next || {})]);
  const results = [];
  for (const key of keys) {
    const before = asCount(prev[key]);
    const after = asCount(next[key]);
    if (before === after) continue;
    const delta = after - before;
    const ratio = before === 0 ? null : after / before;
    const warn =
      before > 0 &&
      ratio !== null &&
      ratio <= DEFAULT_DROP_ALERT_RATIO;
    results.push({
      key,
      before,
      after,
      delta,
      ratio,
      added: before === 0 && after > 0,
      removed: after === 0 && before > 0,
      warn,
    });
  }
  return results.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}

function diffStages(prev = {}, next = {}) {
  const keys = new Set([...Object.keys(prev || {}), ...Object.keys(next || {})]);
  const results = [];
  for (const key of keys) {
    const before = prev[key] || {};
    const after = next[key] || {};
    const beforeDuration = numberOrZero(before.duration_ms);
    const afterDuration = numberOrZero(after.duration_ms);
    const durationDelta = afterDuration - beforeDuration;
    const durationRatio = beforeDuration === 0 ? null : afterDuration / beforeDuration;
    const slowWarn = beforeDuration > 0 && durationRatio !== null && durationRatio >= DEFAULT_SLOW_ALERT_RATIO;
    const statusChanged = (before.status || null) !== (after.status || null);
    if (durationDelta === 0 && !statusChanged) continue;
    results.push({
      stage: key,
      beforeDuration,
      afterDuration,
      durationDelta,
      durationRatio,
      beforeStatus: before.status || null,
      afterStatus: after.status || null,
      slowWarn,
      statusChanged,
    });
  }
  return results.sort((a, b) => Math.abs(b.durationDelta) - Math.abs(a.durationDelta));
}

function summarize(diff) {
  const addedAssets = (diff.assets || []).filter((item) => item.added).map((item) => item.key);
  const removedAssets = (diff.assets || []).filter((item) => item.removed).map((item) => item.key);
  const warnings = []
    .concat((diff.counters || []).filter((item) => item.warn).map((item) => ({ kind: 'counter', ...item })))
    .concat((diff.assets || []).filter((item) => item.warn).map((item) => ({ kind: 'asset', ...item })))
    .concat((diff.stages || []).filter((item) => item.slowWarn).map((item) => ({ kind: 'stage_slow', ...item })));
  return {
    added_assets: addedAssets,
    removed_assets: removedAssets,
    warning_count: warnings.length,
    warnings,
  };
}

function computeManifestDiff(previous = {}, current = {}) {
  const counters = diffCounters(previous.counters || {}, current.counters || {});
  const assets = diffAssets(previous.assets || {}, current.assets || {});
  const stages = diffStages(previous.stages || {}, current.stages || {});
  const diff = { counters, assets, stages };
  diff.summary = summarize(diff);
  return diff;
}

module.exports = {
  computeManifestDiff,
  diffCounters,
  diffAssets,
  diffStages,
  summarize,
  DEFAULT_DROP_ALERT_RATIO,
  DEFAULT_SLOW_ALERT_RATIO,
};
