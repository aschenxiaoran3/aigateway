const fs = require('fs');
const path = require('path');
const { createStageContract } = require('./stage-contract');
const { createSkillContract } = require('./skill-contract');

const OVERRIDE_FILE = path.resolve(__dirname, '../../../../storage/deepwiki/skill-registry-overrides.json');

const BASE_STAGE_CONTRACTS = [
  createStageContract({
    stageKey: 'repo_understanding',
    skills: ['repo_understanding_skill'],
    inputSchema: 'project.config.schema.json',
    outputSchema: 'project_topology.schema.json',
    qualityGateSchema: 'repo_understanding.gates.json',
    fallbackPolicy: 'manual_hints_allowed',
    projectionTargets: ['project_topology', 'repo_manifest_set', 'repo_role_matrix', 'subsystem_clusters'],
  }),
  createStageContract({
    stageKey: 'structure_extraction',
    skills: ['structure_extraction_skill'],
    inputSchema: 'project_topology.schema.json',
    outputSchema: 'structure_assets.schema.json',
    qualityGateSchema: 'structure.gates.json',
    fallbackPolicy: 'partial_structure_allowed_with_needs_review',
    projectionTargets: ['symbols', 'call_graph', 'route_graph', 'cross_repo_edges', 'layer_classification', 'layered_architecture'],
  }),
  createStageContract({
    stageKey: 'data_contract_extraction',
    skills: ['data_contract_extraction_skill'],
    inputSchema: 'structure_assets.schema.json',
    outputSchema: 'data_contract_assets.schema.json',
    qualityGateSchema: 'data_contract.gates.json',
    fallbackPolicy: 'incomplete_contracts_allowed_but_low_confidence',
    projectionTargets: ['api_contracts', 'frontend_request_map', 'er_model', 'event_catalog', 'contract_alignment_report'],
  }),
  createStageContract({
    stageKey: 'semantic_mining',
    skills: ['semantic_mining_skill'],
    inputSchema: 'semantic_inputs.schema.json',
    outputSchema: 'semantic_outputs.schema.json',
    qualityGateSchema: 'semantic.gates.json',
    fallbackPolicy: 'semantic_weak_marking',
    projectionTargets: ['business_terms', 'business_actions', 'frontend_journeys', 'state_machines', 'aggregate_candidates'],
  }),
  createStageContract({
    stageKey: 'business_logic_mining',
    skills: ['business_logic_mining_skill'],
    inputSchema: 'business_logic_inputs.schema.json',
    outputSchema: 'business_logic_outputs.schema.json',
    qualityGateSchema: 'business_logic.gates.json',
    fallbackPolicy: 'empty_business_logic_allowed',
    projectionTargets: ['business_logic_assets'],
  }),
  createStageContract({
    stageKey: 'ddd_mapping',
    skills: ['ddd_mapping_skill'],
    inputSchema: 'ddd_inputs.schema.json',
    outputSchema: 'ddd_outputs.schema.json',
    qualityGateSchema: 'ddd.gates.json',
    fallbackPolicy: 'needs_review_domains_only',
    projectionTargets: ['domain_model', 'capability_map', 'context_map', 'repo_participation_map', 'flow_domain_assignment'],
  }),
  createStageContract({
    stageKey: 'evidence_ranking_binding',
    skills: ['evidence_ranking_skill'],
    inputSchema: 'evidence_inputs.schema.json',
    outputSchema: 'evidence_outputs.schema.json',
    qualityGateSchema: 'evidence.gates.json',
    fallbackPolicy: 'needs_review_on_insufficient_evidence',
    projectionTargets: ['evidence_index', 'evidence_ranked', 'confidence_report', 'negative_evidence', 'stitched_cross_repo_evidence', 'quality_signals'],
  }),
  createStageContract({
    stageKey: 'diagram_composition',
    skills: ['flow_path_mining_skill', 'node_abstraction_skill', 'diagram_projection_skill', 'knowledge_graph_projection_skill'],
    inputSchema: 'diagram_inputs.schema.json',
    outputSchema: 'diagram_outputs.schema.json',
    qualityGateSchema: 'diagram.gates.json',
    fallbackPolicy: 'fallback_diagrams_are_not_ready',
    projectionTargets: ['flow_paths', 'branch_paths', 'exception_paths', 'node_abstractions', 'diagram_context', 'diagram_assets', 'diagram_quality_report', 'knowledge_graph_projection'],
  }),
  createStageContract({
    stageKey: 'wiki_authoring',
    skills: ['wiki_authoring_skill'],
    inputSchema: 'wiki_inputs.schema.json',
    outputSchema: 'wiki_outputs.schema.json',
    qualityGateSchema: 'wiki.gates.json',
    fallbackPolicy: 'title_failure_to_needs_review',
    projectionTargets: ['wiki_pages', 'wiki_index', 'risk_gap_sections'],
  }),
  createStageContract({
    stageKey: 'quality_gates',
    skills: ['quality_gates_skill'],
    inputSchema: 'quality_inputs.schema.json',
    outputSchema: 'quality_outputs.schema.json',
    qualityGateSchema: 'quality.gates.json',
    fallbackPolicy: 'none',
    projectionTargets: ['quality_report', 'gate_decisions'],
  }),
  createStageContract({
    stageKey: 'solution_derivation',
    skills: ['solution_derivation_skill'],
    inputSchema: 'derivation_inputs.schema.json',
    outputSchema: 'derivation_outputs.schema.json',
    qualityGateSchema: 'derivation.gates.json',
    fallbackPolicy: 'draft_only_without_published_snapshot',
    projectionTargets: ['impact_matrix', 'tech_spec_bundle', 'test_plan_bundle', 'derivation_lineage'],
  }),
];

const BASE_SKILL_CONTRACTS = [
  createSkillContract({
    skillKey: 'repo_understanding_skill',
    layer: 'repo_understanding',
    purpose: 'Derive project topology and repo role understanding for a multi-repo project.',
    inputs: ['project.config'],
    outputs: ['project_topology', 'repo_manifest_set', 'repo_role_matrix', 'subsystem_clusters'],
    algorithm: 'deriveRepoUnderstanding',
    parameters: { mode: 'project_topology' },
    dependencies: [],
    version: '1.0.0',
    failureModes: ['missing_repo_root', 'unknown_role'],
    qualityChecks: ['all_repos_bound', 'frontend_bff_detected_if_configured'],
  }),
  createSkillContract({
    skillKey: 'structure_extraction_skill',
    layer: 'structure_extraction',
    purpose: 'Extract structure, route graph and cross-repo edges from project topology.',
    inputs: ['project_topology'],
    outputs: ['symbols', 'call_graph', 'route_graph', 'cross_repo_edges', 'layer_classification', 'layered_architecture'],
    algorithm: 'deriveStructureAssets',
    parameters: {},
    dependencies: ['repo_understanding_skill'],
    version: '1.0.0',
    failureModes: ['structure_parse_failed'],
    qualityChecks: ['route_graph_present', 'cross_repo_edges_present'],
  }),
  createSkillContract({
    skillKey: 'data_contract_extraction_skill',
    layer: 'data_contract_extraction',
    purpose: 'Extract API contracts, request maps, ER model and events from structure assets.',
    inputs: ['project_topology', 'call_graph', 'route_graph', 'cross_repo_edges'],
    outputs: ['api_contracts', 'frontend_request_map', 'er_model', 'event_catalog', 'contract_alignment_report'],
    algorithm: 'deriveDataContractAssets',
    parameters: {},
    dependencies: ['structure_extraction_skill'],
    version: '1.0.0',
    failureModes: ['contract_parse_failed'],
    qualityChecks: ['frontend_backend_alignment_checked'],
  }),
  createSkillContract({
    skillKey: 'semantic_mining_skill',
    layer: 'semantic_mining',
    purpose: 'Mine business terms, actions, journeys and state machines from contracts and structure.',
    inputs: ['project_topology', 'symbols', 'cross_repo_edges', 'api_contracts', 'frontend_request_map', 'er_model', 'event_catalog'],
    outputs: ['business_terms', 'business_actions', 'frontend_journeys', 'state_machines', 'aggregate_candidates'],
    algorithm: 'deriveSemanticAssets',
    parameters: {},
    dependencies: ['data_contract_extraction_skill'],
    version: '1.0.0',
    failureModes: ['semantic_parse_failed'],
    qualityChecks: ['business_actions_present'],
  }),
  createSkillContract({
    skillKey: 'business_logic_mining_skill',
    layer: 'business_logic_mining',
    purpose: 'Mine business rules, test evidence and state machines with guards from contracts, comments and test names.',
    inputs: ['project_topology', 'api_contracts', 'er_model', 'event_catalog', 'business_terms', 'business_actions', 'state_machines'],
    outputs: ['business_logic_assets'],
    algorithm: 'deriveBusinessLogicAssets',
    parameters: { lexicon: 'ai-rules/skills/knowledge-os/doc-standards/business-lexicon.yaml' },
    dependencies: ['semantic_mining_skill'],
    version: '1.0.0',
    failureModes: ['lexicon_missing', 'rule_trigger_not_found'],
    qualityChecks: ['non_empty_when_requirements_present'],
  }),
  createSkillContract({
    skillKey: 'ddd_mapping_skill',
    layer: 'ddd_mapping',
    purpose: 'Build domain model, capability map and context map from semantic and contract assets.',
    inputs: ['project_topology', 'symbols', 'cross_repo_edges', 'api_contracts', 'frontend_request_map', 'er_model', 'event_catalog', 'business_terms', 'business_actions', 'frontend_journeys', 'state_machines', 'aggregate_candidates', 'business_logic_assets'],
    outputs: ['domain_model', 'capability_map', 'context_map', 'repo_participation_map', 'flow_domain_assignment'],
    algorithm: 'deriveDddAssets',
    parameters: {},
    dependencies: ['semantic_mining_skill', 'business_logic_mining_skill'],
    version: '1.0.0',
    failureModes: ['insufficient_evidence', 'class_name_domain'],
    qualityChecks: ['min_four_evidence_classes', 'domain_not_equal_class_name'],
  }),
  createSkillContract({
    skillKey: 'evidence_ranking_skill',
    layer: 'evidence_ranking_binding',
    purpose: 'Rank heterogeneous evidence and detect visibility-level quality signals.',
    inputs: ['project_topology', 'symbols', 'cross_repo_edges', 'api_contracts', 'frontend_request_map', 'er_model', 'event_catalog', 'contract_alignment_report', 'business_terms', 'business_actions', 'domain_model', 'capability_map', 'context_map'],
    outputs: ['evidence_index', 'evidence_ranked', 'confidence_report', 'negative_evidence', 'stitched_cross_repo_evidence', 'quality_signals'],
    algorithm: 'deriveEvidenceAssets',
    parameters: {},
    dependencies: ['ddd_mapping_skill'],
    version: '1.0.0',
    failureModes: ['test_pollution', 'single_source_only'],
    qualityChecks: ['no_test_primary_evidence', 'multi_source_required'],
  }),
  createSkillContract({
    skillKey: 'flow_path_mining_skill',
    layer: 'diagram_composition',
    purpose: 'Mine main, branch and exception flow paths from business evidence.',
    inputs: ['project_topology', 'api_contracts', 'frontend_request_map', 'er_model', 'event_catalog', 'business_terms', 'business_actions', 'frontend_journeys', 'state_machines', 'domain_model', 'capability_map', 'context_map', 'evidence_index', 'quality_signals'],
    outputs: ['flow_paths', 'branch_paths', 'exception_paths'],
    algorithm: 'deriveFlowPathAssets',
    parameters: {},
    dependencies: ['evidence_ranking_skill'],
    version: '1.0.0',
    failureModes: ['flow_path_mining_failed'],
    qualityChecks: ['main_flow_present'],
  }),
  createSkillContract({
    skillKey: 'node_abstraction_skill',
    layer: 'diagram_composition',
    purpose: 'Abstract technical nodes into business-facing flow nodes.',
    inputs: ['symbols', 'call_graph', 'route_graph', 'cross_repo_edges', 'api_contracts', 'frontend_request_map', 'er_model', 'event_catalog', 'flow_paths', 'branch_paths', 'exception_paths'],
    outputs: ['node_abstractions'],
    algorithm: 'deriveNodeAbstractions',
    parameters: {},
    dependencies: ['flow_path_mining_skill'],
    version: '1.0.0',
    failureModes: ['node_abstraction_failed'],
    qualityChecks: ['business_labels_present'],
  }),
  createSkillContract({
    skillKey: 'diagram_projection_skill',
    layer: 'diagram_composition',
    purpose: 'Project architecture, flow, sequence and ER diagrams from staged assets.',
    inputs: ['project_topology', 'api_contracts', 'frontend_request_map', 'er_model', 'event_catalog', 'domain_model', 'capability_map', 'context_map', 'evidence_index', 'confidence_report', 'quality_signals', 'flow_paths', 'branch_paths', 'exception_paths', 'node_abstractions'],
    outputs: ['diagram_context', 'diagram_assets', 'diagram_quality_report'],
    algorithm: 'deriveDiagramAssets',
    parameters: {},
    dependencies: ['node_abstraction_skill'],
    version: '1.0.0',
    failureModes: ['diagram_projection_failed'],
    qualityChecks: ['diagram_quality_present'],
  }),
  createSkillContract({
    skillKey: 'knowledge_graph_projection_skill',
    layer: 'diagram_composition',
    purpose: 'Project knowledge graph structure from domains, flows, diagrams and evidence.',
    inputs: ['domain_model', 'capability_map', 'context_map', 'evidence_index', 'flow_paths', 'branch_paths', 'exception_paths', 'diagram_context', 'diagram_assets', 'diagram_quality_report'],
    outputs: ['knowledge_graph_projection'],
    algorithm: 'deriveKnowledgeGraphProjection',
    parameters: {},
    dependencies: ['diagram_projection_skill'],
    version: '1.0.0',
    failureModes: ['graph_projection_failed'],
    qualityChecks: ['knowledge_graph_present'],
  }),
  createSkillContract({
    skillKey: 'wiki_authoring_skill',
    layer: 'wiki_authoring',
    purpose: 'Author project, domain and thread wiki pages from algorithmic assets.',
    inputs: ['project_topology', 'frontend_journeys', 'domain_model', 'capability_map', 'context_map', 'evidence_index', 'quality_signals', 'diagram_assets'],
    outputs: ['wiki_pages', 'wiki_index', 'risk_gap_sections'],
    algorithm: 'deriveWikiAssets',
    parameters: {},
    dependencies: ['diagram_projection_skill'],
    version: '1.0.0',
    failureModes: ['wiki_authoring_failed'],
    qualityChecks: ['business_first_titles'],
  }),
  createSkillContract({
    skillKey: 'quality_gates_skill',
    layer: 'quality_gates',
    purpose: 'Evaluate visible DeepWiki outputs and decide publish gate readiness.',
    inputs: ['evidence_index', 'confidence_report', 'quality_signals', 'domain_model', 'diagram_assets', 'diagram_quality_report', 'business_terms', 'business_actions', 'contract_alignment_report', 'flow_paths', 'branch_paths', 'exception_paths'],
    outputs: ['quality_report', 'gate_decisions'],
    algorithm: 'deriveQualityAssets',
    parameters: {},
    dependencies: ['wiki_authoring_skill'],
    version: '1.0.0',
    failureModes: ['quality_gate_blocked', 'missing_evidence'],
    qualityChecks: ['quality_gate_blocked_implies_publish_false'],
  }),
  createSkillContract({
    skillKey: 'solution_derivation_skill',
    layer: 'solution_derivation',
    purpose: 'Derive impact matrix, tech spec and test plan from published or draft snapshot assets.',
    inputs: ['project.config', 'snapshot', 'domain_model', 'evidence_index', 'api_contracts', 'er_model', 'event_catalog'],
    outputs: ['impact_matrix', 'tech_spec_bundle', 'test_plan_bundle', 'derivation_lineage'],
    algorithm: 'deriveDerivationAssets',
    parameters: {},
    dependencies: ['quality_gates_skill'],
    version: '1.0.0',
    failureModes: ['unpublished_snapshot', 'missing_lineage'],
    qualityChecks: ['lineage_required'],
  }),
  createSkillContract({
    skillKey: 'knowledge_scoring_skill',
    layer: 'system_projection',
    purpose: 'Score project, snapshot, domain, flow, page, diagram and solution quality from staged assets.',
    inputs: ['project', 'snapshot', 'project_topology', 'repo_manifest_set', 'repo_role_matrix', 'subsystem_clusters', 'symbols', 'call_graph', 'route_graph', 'cross_repo_edges', 'layer_classification', 'layered_architecture', 'api_contracts', 'frontend_request_map', 'er_model', 'event_catalog', 'contract_alignment_report', 'business_terms', 'business_actions', 'frontend_journeys', 'state_machines', 'aggregate_candidates', 'domain_model', 'capability_map', 'context_map', 'repo_participation_map', 'flow_domain_assignment', 'evidence_index', 'evidence_ranked', 'confidence_report', 'negative_evidence', 'stitched_cross_repo_evidence', 'quality_signals', 'flow_paths', 'branch_paths', 'exception_paths', 'node_abstractions', 'diagram_context', 'diagram_assets', 'diagram_quality_report', 'knowledge_graph_projection', 'wiki_pages', 'wiki_index', 'risk_gap_sections', 'quality_report', 'gate_decisions', 'impact_matrix', 'tech_spec_bundle', 'test_plan_bundle', 'derivation_lineage'],
    outputs: ['project_scores', 'snapshot_scores', 'domain_scores', 'capability_scores', 'flow_scores', 'journey_scores', 'page_scores', 'diagram_scores', 'solution_scores', 'score_breakdowns', 'ranking_views', 'score_regressions', 'health_indices'],
    algorithm: 'runKnowledgeScoring',
    parameters: {},
    dependencies: ['solution_derivation_skill'],
    version: '1.0.0',
    failureModes: ['score_projection_failed'],
    qualityChecks: ['score_breakdowns_present'],
  }),
  createSkillContract({
    skillKey: 'visible_projection_skill',
    layer: 'system_projection',
    purpose: 'Build algorithm-visible wiki projection strictly from staged assets.',
    inputs: ['project', 'project_topology', 'domain_model', 'capability_map', 'context_map', 'evidence_index', 'flow_paths', 'branch_paths', 'exception_paths', 'diagram_assets', 'wiki_pages'],
    outputs: ['algorithm_visible_projection'],
    algorithm: 'buildAlgorithmVisibleProjection',
    parameters: {},
    dependencies: ['wiki_authoring_skill'],
    version: '1.0.0',
    failureModes: ['visible_projection_failed'],
    qualityChecks: ['stage_assets_algorithmic_only'],
  }),
];

function normalizeText(value) {
  return String(value || '').trim();
}

function ensureArray(value) {
  return Array.isArray(value) ? value.map((item) => normalizeText(item)).filter(Boolean) : [];
}

function ensureObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function readOverrideStore() {
  try {
    if (!fs.existsSync(OVERRIDE_FILE)) {
      return { updated_at: null, stages: {}, skills: {} };
    }
    const parsed = JSON.parse(fs.readFileSync(OVERRIDE_FILE, 'utf8'));
    return {
      updated_at: parsed.updated_at || null,
      stages: ensureObject(parsed.stages),
      skills: ensureObject(parsed.skills),
    };
  } catch (error) {
    return { updated_at: null, stages: {}, skills: {} };
  }
}

function writeOverrideStore(store) {
  fs.mkdirSync(path.dirname(OVERRIDE_FILE), { recursive: true });
  fs.writeFileSync(
    OVERRIDE_FILE,
    JSON.stringify(
      {
        updated_at: new Date().toISOString(),
        stages: ensureObject(store.stages),
        skills: ensureObject(store.skills),
      },
      null,
      2
    ),
    'utf8'
  );
}

function cleanStagePatch(patch = {}) {
  const next = {};
  if (patch.stageKey !== undefined) next.stageKey = normalizeText(patch.stageKey);
  if (patch.skills !== undefined) next.skills = ensureArray(patch.skills);
  if (patch.inputSchema !== undefined) next.inputSchema = normalizeText(patch.inputSchema);
  if (patch.outputSchema !== undefined) next.outputSchema = normalizeText(patch.outputSchema);
  if (patch.qualityGateSchema !== undefined) next.qualityGateSchema = normalizeText(patch.qualityGateSchema);
  if (patch.fallbackPolicy !== undefined) next.fallbackPolicy = normalizeText(patch.fallbackPolicy);
  if (patch.projectionTargets !== undefined) next.projectionTargets = ensureArray(patch.projectionTargets);
  return next;
}

function cleanSkillPatch(patch = {}) {
  const next = {};
  if (patch.skillKey !== undefined) next.skillKey = normalizeText(patch.skillKey);
  if (patch.layer !== undefined) next.layer = normalizeText(patch.layer);
  if (patch.purpose !== undefined) next.purpose = normalizeText(patch.purpose);
  if (patch.inputs !== undefined || patch.acceptedInputs !== undefined) next.inputs = ensureArray(patch.inputs !== undefined ? patch.inputs : patch.acceptedInputs);
  if (patch.outputs !== undefined || patch.producedOutputs !== undefined) next.outputs = ensureArray(patch.outputs !== undefined ? patch.outputs : patch.producedOutputs);
  if (patch.algorithm !== undefined) next.algorithm = normalizeText(patch.algorithm);
  if (patch.parameters !== undefined) next.parameters = ensureObject(patch.parameters);
  if (patch.dependencies !== undefined) next.dependencies = ensureArray(patch.dependencies);
  if (patch.version !== undefined) next.version = normalizeText(patch.version);
  if (patch.failureModes !== undefined) next.failureModes = ensureArray(patch.failureModes);
  if (patch.qualityChecks !== undefined) next.qualityChecks = ensureArray(patch.qualityChecks);
  return next;
}

function mergeStageContract(base) {
  const store = readOverrideStore();
  const override = ensureObject(store.stages[base.stageKey]);
  return createStageContract({
    ...base,
    ...cleanStagePatch(override),
  });
}

function mergeSkillContract(base) {
  const store = readOverrideStore();
  const override = ensureObject(store.skills[base.skillKey]);
  return createSkillContract({
    ...base,
    ...cleanSkillPatch(override),
  });
}

function listStageContracts() {
  return BASE_STAGE_CONTRACTS.map(mergeStageContract);
}

function listSkillContracts() {
  return BASE_SKILL_CONTRACTS.map(mergeSkillContract);
}

function getStageContract(stageKey) {
  return listStageContracts().find((item) => item.stageKey === normalizeText(stageKey)) || null;
}

function getSkillContract(skillKey) {
  return listSkillContracts().find((item) => item.skillKey === normalizeText(skillKey)) || null;
}

function updateStageContractOverride(stageKey, patch = {}) {
  const normalizedStageKey = normalizeText(stageKey);
  const base = BASE_STAGE_CONTRACTS.find((item) => item.stageKey === normalizedStageKey);
  if (!base) {
    throw new Error(`unknown stage contract: ${normalizedStageKey}`);
  }
  const store = readOverrideStore();
  store.stages[normalizedStageKey] = {
    ...ensureObject(store.stages[normalizedStageKey]),
    ...cleanStagePatch(patch),
  };
  writeOverrideStore(store);
  return getStageContract(normalizedStageKey);
}

function updateSkillContractOverride(skillKey, patch = {}) {
  const normalizedSkillKey = normalizeText(skillKey);
  const base = BASE_SKILL_CONTRACTS.find((item) => item.skillKey === normalizedSkillKey);
  if (!base) {
    throw new Error(`unknown skill contract: ${normalizedSkillKey}`);
  }
  const store = readOverrideStore();
  store.skills[normalizedSkillKey] = {
    ...ensureObject(store.skills[normalizedSkillKey]),
    ...cleanSkillPatch(patch),
  };
  writeOverrideStore(store);
  return getSkillContract(normalizedSkillKey);
}

function resetSkillContractOverride(skillKey) {
  const normalizedSkillKey = normalizeText(skillKey);
  const store = readOverrideStore();
  if (store.skills[normalizedSkillKey] !== undefined) {
    delete store.skills[normalizedSkillKey];
    writeOverrideStore(store);
  }
  return getSkillContract(normalizedSkillKey);
}

module.exports = {
  OVERRIDE_FILE,
  BASE_STAGE_CONTRACTS,
  BASE_SKILL_CONTRACTS,
  STAGE_CONTRACTS: listStageContracts(),
  SKILL_CONTRACTS: listSkillContracts(),
  listStageContracts,
  listSkillContracts,
  getStageContract,
  getSkillContract,
  updateStageContractOverride,
  updateSkillContractOverride,
  resetSkillContractOverride,
  readOverrideStore,
};
