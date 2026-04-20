function parseTimestamp(value) {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function getSyncIntervalMs(syncConfig = {}) {
  const minutes = Number(syncConfig.interval_minutes || 30);
  const normalizedMinutes = Number.isFinite(minutes) ? Math.min(1440, Math.max(5, Math.round(minutes))) : 30;
  return normalizedMinutes * 60 * 1000;
}

function getSyncBaseline(repoSource) {
  const sync = repoSource.sync_config || {};
  return (
    parseTimestamp(sync.last_checked_at) ||
    parseTimestamp(sync.last_triggered_at) ||
    parseTimestamp(sync.last_noop_at) ||
    parseTimestamp(sync.updated_at) ||
    parseTimestamp(repoSource.updated_at) ||
    parseTimestamp(repoSource.created_at) ||
    0
  );
}

function isRepoSourceDue(repoSource, now = Date.now()) {
  const sync = repoSource.sync_config || {};
  if (!sync.enabled) return false;
  const baseline = getSyncBaseline(repoSource);
  if (!baseline) return true;
  return now - baseline >= getSyncIntervalMs(sync);
}

function createDeepWikiScheduler({ db, queue, logger, pollIntervalMs, batchLimit }) {
  const intervalMs = Math.max(30_000, Number(pollIntervalMs || process.env.DEEPWIKI_SYNC_SCHEDULER_POLL_MS || 60_000));
  const maxBatchSize = Math.max(1, Number(batchLimit || process.env.DEEPWIKI_SYNC_SCHEDULER_BATCH_SIZE || 5));
  let timer = null;
  let running = false;
  let lastTickStartedAt = null;
  let lastTickFinishedAt = null;
  let lastError = null;

  async function processRepoSource(repoSource) {
    const sync = repoSource.sync_config || {};
    const checkedAt = new Date().toISOString();

    try {
      const data = await db.requestDeepWikiSync({
        repo_url: repoSource.repo_url,
        branch: sync.branch || '',
        project_code: sync.project_code || null,
        focus_prompt: sync.focus_prompt || '',
      });

      const syncState = {
        last_checked_at: checkedAt,
        last_error: null,
        last_result: data.noop ? 'up_to_date' : 'queued',
        last_run_id: data.run_id || null,
        last_trace_id: data.trace_id || null,
        last_commit_sha: data.preflight?.commit_sha || null,
        last_branch: data.preflight?.resolved_branch || sync.branch || '',
      };

      if (data.noop) {
        syncState.last_noop_at = checkedAt;
      } else {
        syncState.last_triggered_at = checkedAt;
        queue.enqueue(data.run_id);
      }

      await db.updateRepoSourceSyncState(repoSource.id, syncState);
      return data;
    } catch (error) {
      await db.updateRepoSourceSyncState(repoSource.id, {
        last_checked_at: checkedAt,
        last_result: 'error',
        last_error: error.message || 'unknown_error',
      });
      throw error;
    }
  }

  async function tick() {
    if (running) {
      return {
        skipped: true,
        reason: 'scheduler_busy',
      };
    }

    running = true;
    lastTickStartedAt = new Date().toISOString();
    lastError = null;

    try {
      const stalledRuns = typeof db.sweepStalledDeepWikiRuns === 'function'
        ? await db.sweepStalledDeepWikiRuns()
        : [];
      const repoSources = await db.listDeepWikiRepoSourcesForScheduling();
      const dueRepoSources = repoSources.filter((item) => isRepoSourceDue(item)).slice(0, maxBatchSize);
      const results = [];

      for (const repoSource of dueRepoSources) {
        try {
          const result = await processRepoSource(repoSource);
          results.push({
            repo_source_id: repoSource.id,
            repo_slug: repoSource.repo_slug,
            noop: Boolean(result?.noop),
            run_id: result?.run_id || null,
            trace_id: result?.trace_id || null,
          });
        } catch (error) {
          results.push({
            repo_source_id: repoSource.id,
            repo_slug: repoSource.repo_slug,
            error: error.message || 'scheduler_error',
          });
          if (logger?.error) {
            logger.error('deepwiki scheduler repo sync failed', {
              repo_source_id: repoSource.id,
              repo_slug: repoSource.repo_slug,
              error: error.message,
            });
          }
        }
      }

      lastTickFinishedAt = new Date().toISOString();
      return {
        checked: repoSources.length,
        due: dueRepoSources.length,
        stalled_recovered: stalledRuns.length,
        stalled_runs: stalledRuns,
        results,
      };
    } catch (error) {
      lastError = error.message || 'scheduler_error';
      lastTickFinishedAt = new Date().toISOString();
      if (logger?.error) {
        logger.error('deepwiki scheduler tick failed', {
          error: error.message,
        });
      }
      return {
        checked: 0,
        due: 0,
        error: lastError,
      };
    } finally {
      running = false;
    }
  }

  function start() {
    if (timer) return;
    timer = setInterval(() => {
      void tick();
    }, intervalMs);
    setImmediate(() => {
      void tick();
    });
  }

  function stop() {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
  }

  function status() {
    return {
      running,
      enabled: Boolean(timer),
      poll_interval_ms: intervalMs,
      batch_limit: maxBatchSize,
      last_tick_started_at: lastTickStartedAt,
      last_tick_finished_at: lastTickFinishedAt,
      last_error: lastError,
    };
  }

  return {
    start,
    stop,
    tick,
    status,
  };
}

module.exports = {
  createDeepWikiScheduler,
};
