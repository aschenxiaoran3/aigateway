const { createStageRunner } = require('../core/pipeline/types');
const { registerStage } = require('../core/pipeline/registry');
const { runStageDag } = require('../core/pipeline/engine');
const { withStageTimeout } = require('../stage-timeout');
const { executeWithRetry } = require('../health/retry-policy');

function shouldRetry() {
  const raw = String(process.env.DEEPWIKI_STAGE_RETRY || '').trim().toLowerCase();
  if (!raw) return false;
  return raw === '1' || raw === 'true' || raw === 'yes';
}

function resolveRetryOpts() {
  return {
    maxRetries: Number(process.env.DEEPWIKI_STAGE_RETRY_MAX) || 2,
    backoffMs: Number(process.env.DEEPWIKI_STAGE_RETRY_BACKOFF_MS) || 1500,
    backoffFactor: Number(process.env.DEEPWIKI_STAGE_RETRY_BACKOFF_FACTOR) || 2,
    maxBackoffMs: Number(process.env.DEEPWIKI_STAGE_RETRY_BACKOFF_MAX_MS) || 20_000,
  };
}

function registerDagStage(stageKey) {
  const stage = createStageRunner(stageKey, async (ctx) => {
    const run = () => withStageTimeout(() => runStageDag(ctx, stageKey), { stageKey });
    if (!shouldRetry()) {
      return run();
    }
    const opts = resolveRetryOpts();
    const out = await executeWithRetry(run, {
      ...opts,
      onAttempt: (info) => {
        if (ctx && ctx.logger && typeof ctx.logger.info === 'function') {
          ctx.logger.info('[deepwiki.stage.retry]', { stageKey, ...info });
        }
      },
    });
    return out.result;
  });
  registerStage(stage);
  return stage;
}

module.exports = {
  registerDagStage,
};
