#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const {
  STORAGE_ROOT,
  RAW_ROOT,
  DAILY_ROOT,
  BRIEF_PATH,
  STATE_PATH,
  DEFAULT_ARCHIVE_DIR,
  ensureDirSecure,
  writeFileSecure,
  readJsonFile,
  listArchivedSessionFiles,
  extractCodexSessionFromText,
  sessionRelatesToProject,
  renderDailyMarkdown,
  loadStoredSessions,
  buildCodexBrief,
  syncSessionToControlPlane,
  closeControlPlaneSyncResources,
} = require('./codex-memory-utils.cjs');

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function getArgValue(name, fallback = '') {
  const found = process.argv.find((item) => item.startsWith(`${name}=`));
  if (!found) return fallback;
  return found.slice(name.length + 1);
}

async function main() {
  const archiveDir = getArgValue('--archive-dir', DEFAULT_ARCHIVE_DIR);
  const shouldSync = hasFlag('--sync-control-plane');
  const shouldSkipBrief = hasFlag('--skip-brief');
  const dryRun = hasFlag('--dry-run');
  const forceSync = hasFlag('--force-sync');
  const directStore = hasFlag('--direct-store');
  const shouldSyncKb = hasFlag('--sync-kb');

  try {
    ensureDirSecure(STORAGE_ROOT);
    ensureDirSecure(RAW_ROOT);
    ensureDirSecure(DAILY_ROOT);

    const state = readJsonFile(STATE_PATH, {
      version: 1,
      imported_sessions: {},
      last_import_at: null,
    });

    const files = listArchivedSessionFiles(archiveDir);
    const touchedDates = new Set();
    let importedCount = 0;
    let skippedCount = 0;
    let syncedCount = 0;

    for (const filePath of files) {
      const rawText = fs.readFileSync(filePath, 'utf8');
      const session = extractCodexSessionFromText(rawText, {
        sourceFile: filePath,
      });
      const relation = sessionRelatesToProject(session);
      if (!relation.related) {
        skippedCount += 1;
        continue;
      }

      const stat = fs.statSync(filePath);
      const existing = state.imported_sessions[session.id];
      const isUpToDate = existing && Number(existing.source_mtime_ms || 0) === Number(stat.mtimeMs || 0);

      if (isUpToDate && shouldSync && !dryRun && (forceSync || !existing.synced_to_control_plane_at)) {
        try {
          const syncResult = await syncSessionToControlPlane(session, {
            directStore,
            syncToKb: shouldSyncKb,
          });
          if (!syncResult?.skipped) {
            state.imported_sessions[session.id].synced_to_control_plane_at = new Date().toISOString();
            delete state.imported_sessions[session.id].sync_error;
            syncedCount += 1;
          }
        } catch (error) {
          state.imported_sessions[session.id].sync_error = error.message;
        }
      }

      if (isUpToDate) {
        touchedDates.add(session.date_key);
        skippedCount += 1;
        continue;
      }

      touchedDates.add(session.date_key);
      const rawDir = path.join(RAW_ROOT, session.date_key);
      const rawTarget = path.join(rawDir, `${session.id}.jsonl`);

      if (!dryRun) {
        writeFileSecure(rawTarget, rawText);
        state.imported_sessions[session.id] = {
          session_id: session.id,
          title: session.title,
          source_file: filePath,
          source_mtime_ms: Number(stat.mtimeMs || 0),
          raw_path: rawTarget,
          daily_path: path.join(DAILY_ROOT, `${session.date_key}.md`),
          related_reasons: relation.reasons,
          turn_count: session.turns.length,
          commentary_count: session.commentary.length,
          date_key: session.date_key,
          imported_at: new Date().toISOString(),
        };
      }

      if (shouldSync && !dryRun) {
        try {
          const syncResult = await syncSessionToControlPlane(session, {
            directStore,
            syncToKb: shouldSyncKb,
          });
          if (!syncResult?.skipped) {
            state.imported_sessions[session.id].synced_to_control_plane_at = new Date().toISOString();
            delete state.imported_sessions[session.id].sync_error;
            syncedCount += 1;
          }
        } catch (error) {
          state.imported_sessions[session.id].sync_error = error.message;
        }
      }
      importedCount += 1;
    }

    if (!dryRun) {
      const storedSessions = loadStoredSessions();
      for (const dateKey of touchedDates) {
        const sessionsForDay = storedSessions.filter((item) => item.date_key === dateKey);
        const dailyPath = path.join(DAILY_ROOT, `${dateKey}.md`);
        writeFileSecure(dailyPath, renderDailyMarkdown(dateKey, sessionsForDay));
      }
      if (!shouldSkipBrief) {
        writeFileSecure(BRIEF_PATH, buildCodexBrief(storedSessions));
      }
      state.last_import_at = new Date().toISOString();
      writeFileSecure(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`);
    }

    console.log(
      JSON.stringify(
        {
          archive_dir: archiveDir,
          imported_count: importedCount,
          skipped_count: skippedCount,
        synced_count: syncedCount,
        touched_dates: Array.from(touchedDates).sort(),
        dry_run: dryRun,
        synced: shouldSync,
        direct_store: directStore,
        sync_kb: shouldSyncKb,
      },
      null,
      2
    )
    );
  } finally {
    if (shouldSync) {
      await closeControlPlaneSyncResources();
    }
  }
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch(async (error) => {
    await closeControlPlaneSyncResources();
    console.error(error);
    process.exit(1);
  });
