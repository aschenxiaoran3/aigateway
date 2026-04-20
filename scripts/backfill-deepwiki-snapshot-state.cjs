#!/usr/bin/env node
const path = require('path');

const root = path.join(__dirname, '..');

function buildSnapshotBackfillPatch(snapshotRow, gateRows = []) {
  const { backfillSnapshotRecord } = require(path.join(
    root,
    'control-plane/src/deepwiki/snapshot-state-machine.js'
  ));
  return backfillSnapshotRecord({
    ...snapshotRow,
    has_quality_report: Boolean(snapshotRow.quality_report_status),
    quality_status: snapshotRow.quality_status || snapshotRow.quality_report_status || null,
    page_count: Number(snapshotRow.page_count || 0),
    diagram_count: Number(snapshotRow.diagram_count || 0),
    repo_revision_count: Number(snapshotRow.repo_revision_count || 0),
    gates: gateRows,
  });
}

async function runBackfill(options = {}) {
  const { closePool, getPool } = require(path.join(root, 'control-plane/src/db/mysql.js'));
  const pool = getPool();
  const conn = await pool.getConnection();
  const summary = {
    scanned: 0,
    updated: 0,
  };

  try {
    const [rows] = await conn.query(
      `SELECT s.*,
              qr.status AS quality_report_status,
              COUNT(DISTINCT p.id) AS page_count,
              COUNT(DISTINCT d.id) AS diagram_count,
              COUNT(DISTINCT rr.id) AS repo_revision_count
       FROM gateway_wiki_snapshots s
       LEFT JOIN gateway_wiki_quality_reports qr ON qr.snapshot_id = s.id
       LEFT JOIN gateway_deepwiki_pages p ON p.run_id = s.run_id
       LEFT JOIN gateway_wiki_snapshot_diagrams d ON d.snapshot_id = s.id
       LEFT JOIN gateway_wiki_snapshot_repo_revisions rr ON rr.snapshot_id = s.id
       GROUP BY s.id
       ORDER BY s.id ASC`
    );
    for (const row of rows) {
      summary.scanned += 1;
      const [gateRows] = await conn.query(
        `SELECT *
         FROM gateway_wiki_gate_decisions
         WHERE snapshot_id = ?
         ORDER BY id ASC`,
        [Number(row.id)]
      );
      const patch = buildSnapshotBackfillPatch(row, gateRows);
      await conn.query(
        `UPDATE gateway_wiki_snapshots
         SET status = ?,
             publish_ready = ?,
             quality_gate_blocked = ?,
             approval_status = ?,
             source_snapshot_id = ?,
             lineage_json = CAST(? AS JSON),
             publish_status = ?,
             quality_status = ?,
             published_at = ?,
             updated_at = NOW()
         WHERE id = ?`,
        [
          patch.status,
          patch.publish_ready ? 1 : 0,
          patch.quality_gate_blocked ? 1 : 0,
          patch.approval_status,
          patch.source_snapshot_id,
          JSON.stringify(patch.lineage_json || {}),
          patch.publish_status,
          patch.quality_status,
          patch.status === 'published' ? row.published_at || new Date().toISOString().slice(0, 19).replace('T', ' ') : null,
          Number(row.id),
        ]
      );
      summary.updated += 1;
    }
    if (!options.quiet) {
      console.log(`DeepWiki snapshot backfill complete: ${summary.updated}/${summary.scanned}`);
    }
    return summary;
  } finally {
    conn.release();
    if (options.close_pool) {
      await closePool().catch(() => null);
    }
  }
}

if (require.main === module) {
  runBackfill({ close_pool: true }).catch((error) => {
    console.error('DeepWiki snapshot backfill failed:', error);
    process.exitCode = 1;
  });
}

module.exports = {
  buildSnapshotBackfillPatch,
  runBackfill,
};
