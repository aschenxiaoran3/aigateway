const { createStageRunner } = require('../core/pipeline/types');
const { registerStage } = require('../core/pipeline/registry');
const { runStageDag } = require('../core/pipeline/engine');
const { withStageTimeout } = require('../stage-timeout');

function registerDagStage(stageKey) {
  const stage = createStageRunner(stageKey, async (ctx) =>
    withStageTimeout(() => runStageDag(ctx, stageKey), { stageKey })
  );
  registerStage(stage);
  return stage;
}

module.exports = {
  registerDagStage,
};
