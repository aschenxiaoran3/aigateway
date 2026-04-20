const { createStageRunner } = require('../core/pipeline/types');
const { registerStage } = require('../core/pipeline/registry');
const { runStageDag } = require('../core/pipeline/engine');

function registerDagStage(stageKey) {
  const stage = createStageRunner(stageKey, async (ctx) => runStageDag(ctx, stageKey));
  registerStage(stage);
  return stage;
}

module.exports = {
  registerDagStage,
};
