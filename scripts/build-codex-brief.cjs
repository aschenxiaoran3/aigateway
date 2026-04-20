#!/usr/bin/env node

const {
  STORAGE_ROOT,
  BRIEF_PATH,
  ensureDirSecure,
  writeFileSecure,
  loadStoredSessions,
  buildCodexBrief,
} = require('./codex-memory-utils.cjs');

function hasFlag(flag) {
  return process.argv.includes(flag);
}

async function main() {
  ensureDirSecure(STORAGE_ROOT);
  const sessions = loadStoredSessions();
  const brief = buildCodexBrief(sessions);
  if (!hasFlag('--dry-run')) {
    writeFileSecure(BRIEF_PATH, brief);
  }
  console.log(
    JSON.stringify(
      {
        brief_path: BRIEF_PATH,
        session_count: sessions.length,
        dry_run: hasFlag('--dry-run'),
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
