#!/usr/bin/env node
const path = require('path');

const root = path.join(__dirname, '..');

async function main() {
  const db = require(path.join(root, 'control-plane/src/db/mysql.js'));
  const repoSourceIdArg = process.argv.find((item) => item.startsWith('--repo-source-id='));
  const runIdArg = process.argv.find((item) => item.startsWith('--run-id='));
  const repoSourceId = repoSourceIdArg ? Number(repoSourceIdArg.split('=')[1]) : null;
  const runId = runIdArg ? Number(runIdArg.split('=')[1]) : null;

  const runs = runId
    ? [await db.getDeepWikiRunById(runId)].filter(Boolean)
    : await db.listDeepWikiRuns(repoSourceId ? { repo_source_id: repoSourceId } : {});

  if (!runs.length) {
    console.log('No Deep Wiki runs found for backfill.');
    return;
  }

  for (const run of runs) {
    const rebuilt = await db.rebuildDeepWikiKnowledgeGraphForRun(run.id);
    const coverage = rebuilt?.evidence_coverage?.percent ?? 0;
    console.log(
      `Backfilled run ${run.id}: object_types=${Object.keys(rebuilt?.object_counts || {}).join(',') || 'none'} evidence=${coverage}%`
    );
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
