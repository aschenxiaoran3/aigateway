function createSkillContract(data) {
  const skillKey = String(data.skillKey || data.skill_key || '').trim();
  const layer = String(data.layer || '').trim();
  const inputs = Array.isArray(data.inputs)
    ? data.inputs.map((item) => String(item || '').trim()).filter(Boolean)
    : Array.isArray(data.acceptedInputs)
      ? data.acceptedInputs.map((item) => String(item || '').trim()).filter(Boolean)
      : [];
  const outputs = Array.isArray(data.outputs)
    ? data.outputs.map((item) => String(item || '').trim()).filter(Boolean)
    : Array.isArray(data.producedOutputs)
      ? data.producedOutputs.map((item) => String(item || '').trim()).filter(Boolean)
      : [];
  return {
    skillKey,
    skill_key: skillKey,
    layer,
    inputs,
    outputs,
    algorithm: String(data.algorithm || '').trim(),
    parameters: data.parameters && typeof data.parameters === 'object' && !Array.isArray(data.parameters)
      ? data.parameters
      : {},
    dependencies: Array.isArray(data.dependencies)
      ? data.dependencies.map((item) => String(item || '').trim()).filter(Boolean)
      : [],
    version: String(data.version || '0.1.0').trim(),
    purpose: String(data.purpose || '').trim(),
    acceptedInputs: inputs,
    producedOutputs: outputs,
    failureModes: Array.isArray(data.failureModes)
      ? data.failureModes.map((item) => String(item || '').trim()).filter(Boolean)
      : [],
    qualityChecks: Array.isArray(data.qualityChecks)
      ? data.qualityChecks.map((item) => String(item || '').trim()).filter(Boolean)
      : [],
  };
}

module.exports = {
  createSkillContract,
};
