const SNAPSHOT_STATES = Object.freeze([
  'queued',
  'generated',
  'analyzed',
  'validated',
  'ready',
  'published',
  'needs_review',
  'rejected',
]);

const SNAPSHOT_STATE_SET = new Set(SNAPSHOT_STATES);
const SNAPSHOT_TRANSITIONS = Object.freeze({
  queued: new Set(['generated']),
  generated: new Set(['analyzed', 'rejected']),
  analyzed: new Set(['validated', 'needs_review', 'rejected']),
  validated: new Set(['ready', 'needs_review', 'rejected']),
  ready: new Set(['published', 'needs_review']),
  needs_review: new Set(['validated', 'ready', 'rejected']),
  published: new Set([]),
  rejected: new Set([]),
});

function normalizeText(value) {
  return String(value || '').trim();
}

function toBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const normalized = normalizeText(value).toLowerCase();
  return ['1', 'true', 'yes', 'y', 'on'].includes(normalized);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function uniqueStrings(values = []) {
  return Array.from(
    new Set(
      values
        .map((item) => normalizeText(item))
        .filter(Boolean)
    )
  );
}

function normalizeSnapshotStatus(value, fallback = 'queued') {
  const status = normalizeText(value).toLowerCase();
  if (SNAPSHOT_STATE_SET.has(status)) return status;
  return fallback;
}

function isValidSnapshotStatus(value) {
  return SNAPSHOT_STATE_SET.has(normalizeText(value).toLowerCase());
}

function normalizeApprovalStatus(value, fallback = 'pending') {
  const status = normalizeText(value).toLowerCase();
  if (['pending', 'approved', 'rejected'].includes(status)) return status;
  return fallback;
}

function normalizeGateRows(gates) {
  return (Array.isArray(gates) ? gates : [])
    .map((gate) => {
      if (!gate) return null;
      return {
        gate_key: normalizeText(gate.gate_key || gate.gateKey),
        scope_type: normalizeText(gate.scope_type || gate.scopeType || 'snapshot') || 'snapshot',
        scope_key: normalizeText(gate.scope_key || gate.scopeKey || '__snapshot__') || '__snapshot__',
        source_type: normalizeText(gate.source_type || gate.sourceType || 'stage') || 'stage',
        source_ref: normalizeText(gate.source_ref || gate.sourceRef || ''),
        source_stage_key: normalizeText(gate.source_stage_key || gate.sourceStageKey || ''),
        decision_status: normalizeText(gate.decision_status || gate.decision || gate.status || 'review').toLowerCase() || 'review',
        is_blocking: toBoolean(gate.is_blocking != null ? gate.is_blocking : gate.isBlocking),
        reason: normalizeText(gate.reason),
        detail_json: isPlainObject(gate.detail_json)
          ? gate.detail_json
          : isPlainObject(gate.decision_json)
            ? gate.decision_json
            : isPlainObject(gate.detailJson)
              ? gate.detailJson
              : {},
      };
    })
    .filter(Boolean);
}

function isBlockingGate(gate) {
  if (!gate) return false;
  if (gate.is_blocking) return true;
  return ['block', 'blocked', 'fail', 'failed', 'error'].includes(gate.decision_status);
}

function isPublishOnlyBlockerKey(value) {
  return ['approval_not_approved', 'missing_lineage', 'snapshot_not_ready'].includes(normalizeText(value).toLowerCase());
}

function collectBlockingGateKeys(gates = [], options = {}) {
  const includePublishOnly = options.includePublishOnly !== false;
  return uniqueStrings(
    normalizeGateRows(gates)
      .filter(isBlockingGate)
      .flatMap((gate) => {
        if (normalizeText(gate.gate_key).toLowerCase() === 'publish_gate') {
          const blockers = Array.isArray(gate.detail_json?.blockers)
            ? gate.detail_json.blockers
            : Array.isArray(gate.detail_json?.detail?.blockers)
              ? gate.detail_json.detail.blockers
              : [];
          return blockers.length ? blockers : [gate.reason || 'quality_gate_blocked'];
        }
        return [gate.gate_key || gate.reason || 'quality_gate_blocked'];
      })
      .filter((gateKey) => includePublishOnly || !isPublishOnlyBlockerKey(gateKey.replace(/^blocker:/, '')))
  );
}

function hasLineage(snapshot = {}) {
  return isPlainObject(snapshot.lineage_json) && Object.keys(snapshot.lineage_json).length > 0;
}

function hasProjectionArtifacts(context = {}) {
  const pageCount = Number(context.page_count || context.pageCount || context.pages_count || 0);
  const diagramCount = Number(context.diagram_count || context.diagramCount || context.diagrams_count || 0);
  const projectionAssetCount = Number(context.projection_asset_count || context.projectionAssetCount || 0);
  return pageCount > 0 || diagramCount > 0 || projectionAssetCount > 0 || toBoolean(context.has_projection);
}

function hasRuntimeArtifacts(context = {}) {
  const repoRevisionCount = Number(context.repo_revision_count || context.repoRevisionCount || 0);
  return Boolean(
    Number(context.run_id || context.runId || 0) > 0 ||
      repoRevisionCount > 0 ||
      normalizeText(context.output_root || context.outputRoot || context.metadata_json?.output_root) ||
      toBoolean(context.has_runtime_artifacts)
  );
}

function deriveLegacySnapshotFields(snapshot = {}) {
  const status = normalizeSnapshotStatus(snapshot.status, 'queued');
  const publish_status = status === 'published' ? 'published' : 'draft';
  let quality_status = 'pending';
  if (status === 'analyzed' || status === 'validated' || status === 'needs_review') {
    quality_status = 'review';
  } else if (status === 'ready') {
    quality_status = 'ready';
  } else if (status === 'published') {
    quality_status = 'published';
  } else if (status === 'rejected') {
    quality_status = 'blocked';
  }
  return {
    publish_status,
    quality_status,
  };
}

function buildLineageJson(snapshot = {}, overrides = {}) {
  const historicalFields = {
    status: normalizeText(snapshot.status) || null,
    publish_status: normalizeText(snapshot.publish_status) || null,
    quality_status: normalizeText(snapshot.quality_status) || null,
    published_at: snapshot.published_at || null,
  };
  const defaultLineage = {
    source_snapshot_id:
      Number.isFinite(Number(snapshot.source_snapshot_id)) && Number(snapshot.source_snapshot_id) > 0
        ? Number(snapshot.source_snapshot_id)
        : null,
    created_from: normalizeText(snapshot.created_from || snapshot.metadata_json?.created_from || 'snapshot_backfill') || 'snapshot_backfill',
    backfill_version: normalizeText(snapshot.backfill_version || 'pr1_snapshot_state_machine_v1'),
    publish_decision: null,
    gate_summary: {
      quality_gate_blocked: toBoolean(snapshot.quality_gate_blocked),
      blockers: uniqueStrings([...(snapshot.publish_blockers || []), ...(snapshot.blockers || [])]),
    },
    historical_fields: historicalFields,
    conflicts: Array.isArray(snapshot.conflicts) ? snapshot.conflicts.slice() : [],
  };
  if (hasLineage(snapshot)) {
    return {
      ...snapshot.lineage_json,
      ...overrides,
      historical_fields: {
        ...ensurePlainObject(snapshot.lineage_json.historical_fields),
        ...historicalFields,
        ...ensurePlainObject(overrides.historical_fields),
      },
      gate_summary: {
        ...ensurePlainObject(snapshot.lineage_json.gate_summary),
        ...ensurePlainObject(defaultLineage.gate_summary),
        ...ensurePlainObject(overrides.gate_summary),
      },
      conflicts: uniqueStrings([
        ...(Array.isArray(snapshot.lineage_json.conflicts) ? snapshot.lineage_json.conflicts : []),
        ...defaultLineage.conflicts,
        ...(Array.isArray(overrides.conflicts) ? overrides.conflicts : []),
      ]),
    };
  }
  return {
    ...defaultLineage,
    ...overrides,
    historical_fields: {
      ...defaultLineage.historical_fields,
      ...ensurePlainObject(overrides.historical_fields),
    },
    gate_summary: {
      ...defaultLineage.gate_summary,
      ...ensurePlainObject(overrides.gate_summary),
    },
    conflicts: uniqueStrings([
      ...defaultLineage.conflicts,
      ...(Array.isArray(overrides.conflicts) ? overrides.conflicts : []),
    ]),
  };
}

function ensurePlainObject(value) {
  return isPlainObject(value) ? value : {};
}

function evaluatePublishEligibility(snapshot = {}, gates = [], approval = snapshot.approval_status) {
  const gateRows = normalizeGateRows(gates);
  const blockingGateKeys = collectBlockingGateKeys(gateRows);
  const qualityBlockingGateKeys = collectBlockingGateKeys(gateRows, { includePublishOnly: false });
  const qualityGateBlocked = toBoolean(snapshot.quality_gate_blocked) || qualityBlockingGateKeys.length > 0;
  const status = normalizeSnapshotStatus(snapshot.status, 'queued');
  const approvalStatus = normalizeApprovalStatus(approval, 'pending');
  const lineagePresent = hasLineage(snapshot);
  const publishReady = status === 'ready' && !qualityGateBlocked;
  const blockers = [];
  if (status !== 'ready') blockers.push('snapshot_not_ready');
  blockers.push(...blockingGateKeys);
  if (qualityGateBlocked && !blockingGateKeys.includes('quality_gate_blocked')) {
    blockers.push('quality_gate_blocked');
  }
  if (approvalStatus !== 'approved') blockers.push('approval_not_approved');
  if (!lineagePresent) blockers.push('missing_lineage');
  const normalizedBlockers = uniqueStrings(blockers);
  return {
    status,
    approval_status: approvalStatus,
    publishReady,
    qualityGateBlocked,
    blockers: normalizedBlockers,
    canPublish: publishReady && approvalStatus === 'approved' && lineagePresent,
    reason: normalizedBlockers[0] || 'ok',
  };
}

function computeSnapshotStatus(context = {}) {
  const explicitStatus = normalizeSnapshotStatus(context.status, '');
  const legacyPublishStatus = normalizeText(context.publish_status).toLowerCase();
  const legacyQualityStatus = normalizeText(context.quality_status).toLowerCase();
  const gateRows = normalizeGateRows(context.gates || context.gate_decisions || []);
  const qualityBlockingGateKeys = collectBlockingGateKeys(gateRows, { includePublishOnly: false });
  const qualityGateBlocked = toBoolean(context.quality_gate_blocked) || qualityBlockingGateKeys.length > 0;
  const lineagePresent = hasLineage(context);
  const approvalStatus = normalizeApprovalStatus(
    context.approval_status || (legacyPublishStatus === 'published' ? 'approved' : 'pending'),
    'pending'
  );
  if (explicitStatus && explicitStatus !== 'published') {
    return explicitStatus;
  }
  const publishedSignal =
    explicitStatus === 'published' ||
    legacyPublishStatus === 'published' ||
    legacyQualityStatus === 'published' ||
    Boolean(context.published_at);
  if (publishedSignal) {
    const publishCheck = evaluatePublishEligibility(
      {
        ...context,
        status: 'ready',
        approval_status: approvalStatus,
        quality_gate_blocked: qualityGateBlocked,
      },
      gateRows,
      approvalStatus
    );
    return publishCheck.canPublish ? 'published' : 'needs_review';
  }
  if (legacyQualityStatus === 'ready') {
    return qualityGateBlocked ? 'validated' : 'ready';
  }
  if (legacyQualityStatus === 'review' || toBoolean(context.has_quality_report) || gateRows.length) {
    return toBoolean(context.publish_ready) && !qualityGateBlocked ? 'ready' : 'validated';
  }
  if (hasProjectionArtifacts(context)) {
    return 'analyzed';
  }
  if (hasRuntimeArtifacts(context)) {
    return 'generated';
  }
  return 'queued';
}

function canTransition(from, to, context = {}) {
  const source = normalizeSnapshotStatus(from, '');
  const target = normalizeSnapshotStatus(to, '');
  if (!source || !target) return false;
  if (source === target) return true;
  const allowedTargets = SNAPSHOT_TRANSITIONS[source];
  if (!allowedTargets || !allowedTargets.has(target)) return false;
  if (target === 'published') {
    const eligibility = evaluatePublishEligibility(
      {
        ...context,
        status: source,
      },
      context.gates || context.gate_decisions || [],
      context.approval_status || context.approvalStatus || context.approval
    );
    return eligibility.canPublish;
  }
  return true;
}

function resolveTransitionPath(from, to) {
  const source = normalizeSnapshotStatus(from, '');
  const target = normalizeSnapshotStatus(to, '');
  if (!source || !target) return [];
  if (source === target) return [source];
  const queue = [[source]];
  const visited = new Set([source]);
  while (queue.length) {
    const path = queue.shift();
    const current = path[path.length - 1];
    const nextStates = Array.from(SNAPSHOT_TRANSITIONS[current] || []);
    for (const nextState of nextStates) {
      if (visited.has(nextState)) continue;
      const nextPath = [...path, nextState];
      if (nextState === target) {
        return nextPath;
      }
      visited.add(nextState);
      queue.push(nextPath);
    }
  }
  return [];
}

function assertTransition(from, to, context = {}) {
  if (!canTransition(from, to, context)) {
    const source = normalizeSnapshotStatus(from, 'queued');
    const target = normalizeSnapshotStatus(to, 'queued');
    const error = new Error(`Invalid snapshot transition: ${source} -> ${target}`);
    error.code = 'INVALID_SNAPSHOT_TRANSITION';
    error.from = source;
    error.to = target;
    error.context = context;
    throw error;
  }
  return true;
}

function assertPublishedBaseline(snapshot = {}) {
  if (normalizeSnapshotStatus(snapshot.status, '') !== 'published') {
    const error = new Error('Snapshot is not a published baseline');
    error.code = 'SNAPSHOT_NOT_PUBLISHED';
    throw error;
  }
  return snapshot;
}

function isPublishedSnapshot(snapshot = {}) {
  return normalizeSnapshotStatus(snapshot.status, '') === 'published';
}

function pickPublishedSnapshot(snapshots = []) {
  return (Array.isArray(snapshots) ? snapshots : []).find((snapshot) => isPublishedSnapshot(snapshot)) || null;
}

function backfillSnapshotRecord(snapshot = {}) {
  const legacyPublished = normalizeText(snapshot.publish_status).toLowerCase() === 'published';
  const lineageWasMissing = !hasLineage(snapshot);
  const approvalStatus = normalizeApprovalStatus(
    snapshot.approval_status || (legacyPublished ? 'approved' : 'pending'),
    'pending'
  );
  const gateRows = normalizeGateRows(snapshot.gates || snapshot.gate_decisions || []);
  const blockingGateKeys = collectBlockingGateKeys(gateRows);
  const qualityGateBlocked = toBoolean(snapshot.quality_gate_blocked) || blockingGateKeys.length > 0;
  const conflicts = [];
  if (legacyPublished && approvalStatus !== 'approved') {
    conflicts.push('approval_not_approved');
  }
  if (legacyPublished && lineageWasMissing) {
    conflicts.push('missing_lineage');
  }
  if (legacyPublished && qualityGateBlocked) {
    conflicts.push('quality_gate_blocked');
  }
  const computedStatus = computeSnapshotStatus({
    ...snapshot,
    approval_status: approvalStatus,
    quality_gate_blocked: qualityGateBlocked,
    gates: gateRows,
  });
  const lineage_json = buildLineageJson(snapshot, {
    source_snapshot_id:
      Number.isFinite(Number(snapshot.source_snapshot_id)) && Number(snapshot.source_snapshot_id) > 0
        ? Number(snapshot.source_snapshot_id)
        : null,
    gate_summary: {
      quality_gate_blocked: qualityGateBlocked,
      blockers: uniqueStrings([
        ...(snapshot.publish_blockers || []),
        ...blockingGateKeys,
      ]),
    },
    conflicts,
  });
  const eligibility = evaluatePublishEligibility(
    {
      ...snapshot,
      status: computedStatus === 'published' ? 'ready' : computedStatus,
      approval_status: approvalStatus,
      quality_gate_blocked: qualityGateBlocked,
      lineage_json,
    },
    gateRows,
    approvalStatus
  );
  const status = computedStatus;
  const publish_ready = status === 'published' ? true : eligibility.publishReady;
  const legacyFields = deriveLegacySnapshotFields({ status });
  return {
    status,
    publish_ready: publish_ready ? 1 : 0,
    quality_gate_blocked: qualityGateBlocked ? 1 : 0,
    approval_status: status === 'published' ? 'approved' : approvalStatus,
    source_snapshot_id:
      Number.isFinite(Number(snapshot.source_snapshot_id)) && Number(snapshot.source_snapshot_id) > 0
        ? Number(snapshot.source_snapshot_id)
        : null,
    lineage_json,
    ...legacyFields,
  };
}

module.exports = {
  SNAPSHOT_STATES,
  normalizeSnapshotStatus,
  isValidSnapshotStatus,
  computeSnapshotStatus,
  canTransition,
  resolveTransitionPath,
  assertTransition,
  evaluatePublishEligibility,
  assertPublishedBaseline,
  deriveLegacySnapshotFields,
  backfillSnapshotRecord,
  isPublishedSnapshot,
  pickPublishedSnapshot,
  normalizeApprovalStatus,
};
