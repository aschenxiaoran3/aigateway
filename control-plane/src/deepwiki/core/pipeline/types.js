function createStageRunner(stageKey, run) {
  return {
    stageKey,
    run,
  };
}

function createSkillRunner(contract, execute) {
  return {
    skillKey: contract.skillKey,
    stageKey: contract.layer,
    inputs: Array.isArray(contract.inputs) ? [...contract.inputs] : [],
    outputs: Array.isArray(contract.outputs) ? [...contract.outputs] : [],
    contract,
    execute,
  };
}

module.exports = {
  createStageRunner,
  createSkillRunner,
};
