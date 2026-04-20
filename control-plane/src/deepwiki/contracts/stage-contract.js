function createStageContract(data) {
  return {
    stageKey: String(data.stageKey || '').trim(),
    skills: Array.isArray(data.skills) ? data.skills.map((item) => String(item || '').trim()).filter(Boolean) : [],
    inputSchema: String(data.inputSchema || '').trim(),
    outputSchema: String(data.outputSchema || '').trim(),
    qualityGateSchema: String(data.qualityGateSchema || '').trim(),
    fallbackPolicy: String(data.fallbackPolicy || '').trim(),
    projectionTargets: Array.isArray(data.projectionTargets)
      ? data.projectionTargets.map((item) => String(item || '').trim()).filter(Boolean)
      : [],
  };
}

module.exports = {
  createStageContract,
};
