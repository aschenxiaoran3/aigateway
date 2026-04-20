#!/usr/bin/env node

const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '../control-plane/.env') });

const db = require('../control-plane/src/db/mysql');

async function main() {
  const forceProjection = process.argv.includes('--force-projection');
  const includeNonCompleted = process.argv.includes('--include-non-completed');

  const result = await db.bootstrapDeepWikiProjects({
    force_projection: forceProjection,
    completed_only: !includeNonCompleted,
  });

  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
