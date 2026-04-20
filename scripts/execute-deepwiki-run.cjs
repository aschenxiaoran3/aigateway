#!/usr/bin/env node

const path = require('path');
const dotenv = require('dotenv');

const ROOT = path.join(__dirname, '..');
dotenv.config({ path: path.join(ROOT, 'control-plane/.env') });

const db = require(path.join(ROOT, 'control-plane/src/db/mysql'));

function parseArgs(argv) {
  const parsed = {};
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const cleaned = arg.slice(2);
    const eqIndex = cleaned.indexOf('=');
    if (eqIndex === -1) {
      parsed[cleaned] = true;
      continue;
    }
    parsed[cleaned.slice(0, eqIndex)] = cleaned.slice(eqIndex + 1);
  }
  return parsed;
}

function toInt(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function resolveRunId(args) {
  const explicitRunId = toInt(args['run-id']);
  if (explicitRunId) {
    return explicitRunId;
  }

  const projectId = toInt(args['project-id']);
  if (!projectId) {
    throw new Error('missing --run-id or --project-id');
  }

  const runs = await db.listDeepWikiRuns({
    project_id: projectId,
    limit: toInt(args.limit) || 20,
  });
  const branch = String(args.branch || '').trim();
  const preferred = runs.find((item) => {
    if (item.status !== 'queued') return false;
    if (branch && item.branch !== branch) return false;
    return true;
  });
  if (preferred) return preferred.id;

  const fallback = runs.find((item) => {
    if (branch && item.branch !== branch) return false;
    return item.status === 'queued' || item.status === 'failed';
  });
  if (fallback) return fallback.id;

  throw new Error(`no runnable deepwiki run found for project ${projectId}${branch ? ` branch ${branch}` : ''}`);
}

function summarizeRun(run) {
  const summary = run?.summary_json && typeof run.summary_json === 'object' ? run.summary_json : {};
  const stageProgress =
    summary.stage_progress && typeof summary.stage_progress === 'object'
      ? summary.stage_progress[String(run?.current_stage || '').trim()] || null
      : null;
  return {
    run_id: run?.id || null,
    status: run?.status || null,
    current_stage: run?.current_stage || null,
    branch: run?.branch || null,
    trace_id: run?.trace_id || null,
    queue_position: run?.queue_position ?? null,
    progress_percent: run?.progress_percent ?? null,
    snapshot_id: run?.snapshot?.id || null,
    runtime_result: summary.runtime_result || null,
    heartbeat_at: summary.heartbeat_at || null,
    current_stage_started_at: summary.current_stage_started_at || null,
    stage_progress: stageProgress
      ? {
          status: stageProgress.status || null,
          processed: stageProgress.processed ?? null,
          total: stageProgress.total ?? null,
          started_at: stageProgress.started_at || null,
          completed_at: stageProgress.completed_at || null,
          last_message: stageProgress.last_message || null,
        }
      : null,
    last_error: summary.last_error || null,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args['rebuild-snapshot-id']) {
    const snapshotId = toInt(args['rebuild-snapshot-id']);
    if (!snapshotId) {
      throw new Error('invalid --rebuild-snapshot-id');
    }
    const result = await db.rebuildDeepWikiAlgorithmProjection(snapshotId);
    console.log(
      JSON.stringify(
        {
          action: 'rebuild_projection',
          snapshot_id: snapshotId,
          rebuilt: Boolean(result),
        },
        null,
        2
      )
    );
    return;
  }

  const runId = await resolveRunId(args);
  let before = await db.getDeepWikiRunById(runId);

  if (!before) {
    throw new Error(`deepwiki run ${runId} not found`);
  }

  if (args['recover-stalled']) {
    const swept = await db.sweepStalledDeepWikiRuns();
    const hit = swept.find((item) => Number(item.id) === Number(runId));
    if (hit) {
      await db.resetDeepWikiRunForRetry(runId);
      before = await db.getDeepWikiRunById(runId);
    }
  }

  if (args['force-reset']) {
    await db.resetDeepWikiRunForRetry(runId);
    before = await db.getDeepWikiRunById(runId);
  }

  console.log(
    JSON.stringify(
      {
        action: 'before',
        ...summarizeRun(before),
        project_id: before.project_id || before.snapshot?.project_id || null,
      },
      null,
      2
    )
  );

  const result = await db.executeDeepWikiRun(runId);
  const after = await db.getDeepWikiRunById(runId);

  console.log(
    JSON.stringify(
      {
        action: 'after',
        ...summarizeRun(after || result),
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
