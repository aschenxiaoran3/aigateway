const STAGE_ORDER = [
  'repo_understanding',
  'structure_extraction',
  'data_contract_extraction',
  'semantic_mining',
  'business_logic_mining',
  'ddd_mapping',
  'evidence_ranking_binding',
  'diagram_composition',
  'wiki_authoring',
  'quality_gates',
  'solution_derivation',
];

const stageRegistry = new Map();
const skillRegistry = new Map();

function registerStage(stage) {
  stageRegistry.set(stage.stageKey, stage);
}

function getStage(stageKey) {
  return stageRegistry.get(stageKey) || null;
}

function getStageKeysInOrder() {
  return [...STAGE_ORDER];
}

function getStagesInOrder() {
  return STAGE_ORDER.map((key) => {
    const stage = stageRegistry.get(key);
    if (!stage) {
      throw new Error(`Stage not registered: ${key}`);
    }
    return stage;
  });
}

function registerSkill(skill) {
  skillRegistry.set(skill.skillKey, skill);
}

function getSkill(skillKey) {
  return skillRegistry.get(skillKey) || null;
}

function listSkills() {
  return Array.from(skillRegistry.values());
}

function findProducer(assetKey) {
  const normalized = String(assetKey || '').trim();
  if (!normalized) return null;
  return listSkills().find((skill) => Array.isArray(skill.outputs) && skill.outputs.includes(normalized)) || null;
}

module.exports = {
  STAGE_ORDER,
  registerStage,
  getStage,
  getStageKeysInOrder,
  getStagesInOrder,
  registerSkill,
  getSkill,
  listSkills,
  findProducer,
};
