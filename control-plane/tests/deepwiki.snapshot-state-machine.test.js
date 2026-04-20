const assert = require('node:assert/strict');
const test = require('node:test');

const {
  assertPublishedBaseline,
  backfillSnapshotRecord,
  canTransition,
  computeSnapshotStatus,
  evaluatePublishEligibility,
  pickPublishedSnapshot,
  resolveTransitionPath,
} = require('../src/deepwiki/snapshot-state-machine');
const { buildSnapshotBackfillPatch } = require('../../scripts/backfill-deepwiki-snapshot-state.cjs');

test('snapshot state machine starts from queued and allows only legal transitions', () => {
  assert.equal(computeSnapshotStatus({}), 'queued');
  assert.equal(canTransition('queued', 'generated'), true);
  assert.equal(canTransition('generated', 'analyzed'), true);
  assert.equal(canTransition('analyzed', 'validated'), true);
  assert.equal(canTransition('validated', 'ready'), true);
  assert.equal(
    canTransition('ready', 'published', {
      approval_status: 'approved',
      lineage_json: { created_from: 'test' },
      gates: [],
    }),
    true
  );
  assert.equal(canTransition('generated', 'published'), false);
  assert.equal(canTransition('queued', 'ready'), false);
  assert.equal(canTransition('published', 'ready'), false);
});

test('snapshot state machine resolves legal transition paths for live promotion', () => {
  assert.deepEqual(resolveTransitionPath('generated', 'ready'), [
    'generated',
    'analyzed',
    'validated',
    'ready',
  ]);
  assert.deepEqual(resolveTransitionPath('ready', 'needs_review'), ['ready', 'needs_review']);
  assert.deepEqual(resolveTransitionPath('generated', 'queued'), []);
});

test('publish eligibility blocks quality gate, missing approval, and missing lineage', () => {
  const blockedByQuality = evaluatePublishEligibility(
    {
      status: 'ready',
      approval_status: 'approved',
      lineage_json: { created_from: 'test' },
      quality_gate_blocked: true,
    },
    []
  );
  assert.equal(blockedByQuality.publishReady, false);
  assert.equal(blockedByQuality.qualityGateBlocked, true);

  const blockedByApproval = evaluatePublishEligibility(
    {
      status: 'ready',
      approval_status: 'pending',
      lineage_json: { created_from: 'test' },
    },
    []
  );
  assert.equal(blockedByApproval.canPublish, false);
  assert.ok(blockedByApproval.blockers.includes('approval_not_approved'));

  const blockedByLineage = evaluatePublishEligibility(
    {
      status: 'ready',
      approval_status: 'approved',
      lineage_json: {},
    },
    []
  );
  assert.equal(blockedByLineage.canPublish, false);
  assert.ok(blockedByLineage.blockers.includes('missing_lineage'));
});

test('assertPublishedBaseline only accepts published snapshots', () => {
  assert.doesNotThrow(() => assertPublishedBaseline({ status: 'published' }));
  assert.throws(() => assertPublishedBaseline({ status: 'ready' }), /published baseline/);
});

test('pickPublishedSnapshot never falls back to latest draft snapshot', () => {
  assert.equal(
    pickPublishedSnapshot([
      { id: 1, status: 'ready' },
      { id: 2, status: 'validated' },
    ]),
    null
  );
  assert.equal(
    pickPublishedSnapshot([
      { id: 1, status: 'ready' },
      { id: 2, status: 'published' },
    ])?.id,
    2
  );
});

test('backfill handles old-only, old-new conflict, and historical published conflict cases conservatively', () => {
  const oldOnly = buildSnapshotBackfillPatch({
    id: 1,
    run_id: 9,
    publish_status: 'draft',
    quality_status: 'review',
    quality_report_status: 'review',
    page_count: 4,
    diagram_count: 2,
    repo_revision_count: 1,
  });
  assert.equal(oldOnly.status, 'validated');
  assert.equal(oldOnly.publish_status, 'draft');

  const conflictNewWins = buildSnapshotBackfillPatch({
    id: 2,
    status: 'ready',
    publish_status: 'published',
    approval_status: 'pending',
    lineage_json: {},
    quality_status: 'ready',
  });
  assert.equal(conflictNewWins.status, 'ready');
  assert.equal(conflictNewWins.publish_status, 'draft');

  const legacyPublishedMissingLineage = buildSnapshotBackfillPatch({
    id: 3,
    publish_status: 'published',
    quality_status: 'published',
    published_at: '2026-04-18 12:00:00',
    approval_status: 'approved',
    quality_report_status: 'published',
    page_count: 8,
    diagram_count: 5,
    repo_revision_count: 2,
  });
  assert.equal(legacyPublishedMissingLineage.status, 'needs_review');
  assert.ok(Array.isArray(legacyPublishedMissingLineage.lineage_json.conflicts));
  assert.ok(legacyPublishedMissingLineage.lineage_json.conflicts.includes('missing_lineage'));
});

test('backfill keeps already-published rows published when new fields and lineage are present', () => {
  const published = backfillSnapshotRecord({
    id: 4,
    status: 'published',
    approval_status: 'approved',
    quality_gate_blocked: false,
    lineage_json: {
      created_from: 'snapshot_backfill',
      gate_summary: {},
    },
  });

  assert.equal(published.status, 'published');
  assert.equal(published.publish_ready, 1);
  assert.equal(published.publish_status, 'published');
});

test('backfill is idempotent for rows that already carry new snapshot fields', () => {
  const input = {
    id: 5,
    status: 'validated',
    publish_ready: 0,
    quality_gate_blocked: 0,
    approval_status: 'pending',
    lineage_json: {
      created_from: 'snapshot_backfill',
      gate_summary: {},
    },
    publish_status: 'draft',
    quality_status: 'review',
  };

  const first = buildSnapshotBackfillPatch(input);
  const second = buildSnapshotBackfillPatch({
    ...input,
    ...first,
  });

  assert.equal(first.status, second.status);
  assert.equal(first.publish_status, second.publish_status);
  assert.deepEqual(first.lineage_json, second.lineage_json);
});
