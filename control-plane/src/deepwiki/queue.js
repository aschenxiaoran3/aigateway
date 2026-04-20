function createDeepWikiQueue(executor) {
  const pending = [];
  const queued = new Set();
  let running = false;
  let runningRunId = null;

  async function processNext() {
    if (running) return;
    const nextId = pending.shift();
    if (nextId == null) return;
    running = true;
    runningRunId = nextId;
    queued.delete(nextId);
    try {
      await executor(nextId);
    } catch (error) {
      console.error('[deepwiki-queue] run failed', {
        run_id: nextId,
        message: error.message,
      });
    } finally {
      running = false;
      runningRunId = null;
      if (pending.length) {
        setImmediate(() => {
          void processNext();
        });
      }
    }
  }

  return {
    enqueue(runId) {
      const id = Number(runId);
      if (!Number.isFinite(id) || id <= 0) return false;
      if (queued.has(id) || runningRunId === id) return false;
      pending.push(id);
      queued.add(id);
      setImmediate(() => {
        void processNext();
      });
      return true;
    },
    getPosition(runId) {
      const id = Number(runId);
      if (!Number.isFinite(id) || id <= 0) return null;
      if (runningRunId === id) return 0;
      const index = pending.indexOf(id);
      return index >= 0 ? index + 1 : null;
    },
    status() {
      return {
        running,
        running_run_id: runningRunId,
        pending: pending.slice(),
      };
    },
  };
}

module.exports = {
  createDeepWikiQueue,
};
