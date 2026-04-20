const { createSkillRunner } = require('../core/pipeline/types');
const { registerSkill } = require('../core/pipeline/registry');
const { listSkillContracts } = require('../contracts/contracts');
const { evaluatePublishEligibility } = require('../snapshot-state-machine');
const {
  deriveRepoUnderstanding,
  deriveStructureAssets,
  deriveDataContractAssets,
  deriveSemanticAssets,
  deriveDddAssets,
  deriveEvidenceAssets,
  deriveFlowPathAssets,
  deriveNodeAbstractions,
  deriveDiagramAssets,
  deriveKnowledgeGraphProjection,
  deriveWikiAssets,
  deriveQualityAssets,
  deriveDerivationAssets,
} = require('../asset-derivation');
const { runKnowledgeScoring } = require('../scoring-engine');
const { buildAlgorithmVisibleProjection } = require('../algorithm-visible-projection');

let initializedSignature = '';

function mapContracts(skillContracts) {
  return new Map(skillContracts.map((contract) => [contract.skillKey, contract]));
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function ensureObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function deepMerge(base, override) {
  const left = ensureObject(base);
  const right = ensureObject(override);
  const merged = { ...left };
  Object.entries(right).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      merged[key] = [...value];
      return;
    }
    if (value && typeof value === 'object') {
      merged[key] = deepMerge(left[key], value);
      return;
    }
    merged[key] = value;
  });
  return merged;
}

function resolveProjectScopedParameters(ctx, contract) {
  const parameters = ensureObject(contract && contract.parameters);
  const projectOverrides = ensureObject(parameters.projectOverrides);
  const project = ctx.project || ctx.config?.project || {};
  const projectKeys = [
    project.project_code,
    ctx.config?.projectCode,
    project.id != null ? String(project.id) : '',
    ctx.config?.projectId != null ? String(ctx.config.projectId) : '',
  ].map((item) => String(item || '').trim()).filter(Boolean);
  const scopedOverride = projectKeys.reduce((acc, key) => acc || ensureObject(projectOverrides[key]), null);
  const baseParameters = { ...parameters };
  delete baseParameters.projectOverrides;
  return scopedOverride ? deepMerge(baseParameters, scopedOverride) : baseParameters;
}

function buildSkillConfig(ctx, contract) {
  return deepMerge(ensureObject(ctx && ctx.config), resolveProjectScopedParameters(ctx, contract));
}

function getSnapshotLike(ctx, inputs) {
  return inputs.snapshot || ctx.snapshot || ctx.config?.snapshot || {
    id: ctx.config?.snapshotId || null,
    status: ctx.status || 'draft',
    publish_status: ctx.config?.publish_status || 'draft',
    quality_status: ctx.config?.quality_status || 'pending',
  };
}

function buildAssetsByStage(inputs = {}) {
  return {
    repo_understanding: {
      project_topology: inputs.project_topology,
      repo_manifest_set: inputs.repo_manifest_set,
      repo_role_matrix: inputs.repo_role_matrix,
      subsystem_clusters: inputs.subsystem_clusters,
    },
    structure_extraction: {
      symbols: inputs.symbols,
      call_graph: inputs.call_graph,
      route_graph: inputs.route_graph,
      cross_repo_edges: inputs.cross_repo_edges,
      layer_classification: inputs.layer_classification,
      layered_architecture: inputs.layered_architecture,
    },
    data_contract_extraction: {
      api_contracts: inputs.api_contracts,
      frontend_request_map: inputs.frontend_request_map,
      er_model: inputs.er_model,
      event_catalog: inputs.event_catalog,
      contract_alignment_report: inputs.contract_alignment_report,
    },
    semantic_mining: {
      business_terms: inputs.business_terms,
      business_actions: inputs.business_actions,
      frontend_journeys: inputs.frontend_journeys,
      state_machines: inputs.state_machines,
      aggregate_candidates: inputs.aggregate_candidates,
    },
    ddd_mapping: {
      domain_model: inputs.domain_model,
      capability_map: inputs.capability_map,
      context_map: inputs.context_map,
      repo_participation_map: inputs.repo_participation_map,
      flow_domain_assignment: inputs.flow_domain_assignment,
    },
    evidence_ranking_binding: {
      evidence_index: inputs.evidence_index,
      evidence_ranked: inputs.evidence_ranked,
      confidence_report: inputs.confidence_report,
      negative_evidence: inputs.negative_evidence,
      stitched_cross_repo_evidence: inputs.stitched_cross_repo_evidence,
      quality_signals: inputs.quality_signals,
    },
    diagram_composition: {
      flow_paths: inputs.flow_paths,
      branch_paths: inputs.branch_paths,
      exception_paths: inputs.exception_paths,
      node_abstractions: inputs.node_abstractions,
      diagram_context: inputs.diagram_context,
      diagram_assets: inputs.diagram_assets,
      diagram_quality_report: inputs.diagram_quality_report,
      knowledge_graph_projection: inputs.knowledge_graph_projection,
    },
    wiki_authoring: {
      wiki_pages: inputs.wiki_pages,
      wiki_index: inputs.wiki_index,
      risk_gap_sections: inputs.risk_gap_sections,
    },
    quality_gates: {
      quality_report: inputs.quality_report,
      gate_decisions: inputs.gate_decisions,
    },
    solution_derivation: {
      impact_matrix: inputs.impact_matrix,
      tech_spec_bundle: inputs.tech_spec_bundle,
      test_plan_bundle: inputs.test_plan_bundle,
      derivation_lineage: inputs.derivation_lineage,
    },
  };
}

function createSkillMap(skillContracts) {
  const contracts = mapContracts(skillContracts);
  const skillMap = new Map();

  const addSkill = (skillKey, execute) => {
    const contract = contracts.get(skillKey);
    if (!contract) {
      throw new Error(`Missing skill contract for ${skillKey}`);
    }
    skillMap.set(
      skillKey,
      createSkillRunner(contract, (payload) =>
        execute({
          ...payload,
          skillContract: contract,
          config: buildSkillConfig(payload.ctx, contract),
        })
      )
    );
  };

  addSkill('repo_understanding_skill', ({ config }) => {
    const result = deriveRepoUnderstanding(config);
    return {
      project_topology: result.projectTopology,
      repo_manifest_set: result.repoManifestSet,
      repo_role_matrix: result.repoRoleMatrix,
      subsystem_clusters: result.subsystemClusters,
    };
  });

  addSkill('structure_extraction_skill', ({ config, inputs }) => {
    const result = deriveStructureAssets(config, inputs.project_topology || { repos: [] });
    return {
      symbols: result.symbols,
      call_graph: result.callGraph,
      route_graph: result.routeGraph,
      cross_repo_edges: result.crossRepoEdges,
      layer_classification: result.layerClassification,
      layered_architecture: result.layeredArchitecture,
    };
  });

  addSkill('data_contract_extraction_skill', ({ config, inputs }) => {
    const structure = {
      callGraph: ensureArray(inputs.call_graph),
      routeGraph: ensureArray(inputs.route_graph),
      crossRepoEdges: ensureArray(inputs.cross_repo_edges),
    };
    const result = deriveDataContractAssets(config, inputs.project_topology || { repos: [] }, structure);
    return {
      api_contracts: result.apiContracts,
      frontend_request_map: result.frontendRequestMap,
      er_model: result.erModel,
      event_catalog: result.eventCatalog,
      contract_alignment_report: result.contractAlignmentReport,
    };
  });

  addSkill('semantic_mining_skill', ({ config, inputs }) => {
    const structure = {
      symbols: ensureArray(inputs.symbols),
      crossRepoEdges: ensureArray(inputs.cross_repo_edges),
    };
    const dataContracts = {
      apiContracts: ensureArray(inputs.api_contracts),
      frontendRequestMap: ensureArray(inputs.frontend_request_map),
      erModel: ensureArray(inputs.er_model),
      eventCatalog: ensureArray(inputs.event_catalog),
    };
    const result = deriveSemanticAssets(config, inputs.project_topology || { repos: [] }, structure, dataContracts);
    return {
      business_terms: result.businessTerms,
      business_actions: result.businessActions,
      frontend_journeys: result.frontendJourneys,
      state_machines: result.stateMachines,
      aggregate_candidates: result.aggregateCandidates,
    };
  });

  addSkill('ddd_mapping_skill', ({ config, inputs }) => {
    const structure = {
      symbols: ensureArray(inputs.symbols),
      crossRepoEdges: ensureArray(inputs.cross_repo_edges),
    };
    const dataContracts = {
      apiContracts: ensureArray(inputs.api_contracts),
      frontendRequestMap: ensureArray(inputs.frontend_request_map),
      erModel: ensureArray(inputs.er_model),
      eventCatalog: ensureArray(inputs.event_catalog),
    };
    const semantic = {
      businessTerms: ensureArray(inputs.business_terms),
      businessActions: ensureArray(inputs.business_actions),
      frontendJourneys: ensureArray(inputs.frontend_journeys),
      stateMachines: ensureArray(inputs.state_machines),
      aggregateCandidates: ensureArray(inputs.aggregate_candidates),
    };
    const result = deriveDddAssets(config, inputs.project_topology || { repos: [] }, structure, dataContracts, semantic);
    return {
      domain_model: result.domainModel,
      capability_map: result.capabilityMap,
      context_map: result.contextMap,
      repo_participation_map: result.repoParticipationMap,
      flow_domain_assignment: result.flowDomainAssignment,
    };
  });

  addSkill('evidence_ranking_skill', ({ config, inputs }) => {
    const structure = {
      symbols: ensureArray(inputs.symbols),
      crossRepoEdges: ensureArray(inputs.cross_repo_edges),
    };
    const dataContracts = {
      apiContracts: ensureArray(inputs.api_contracts),
      frontendRequestMap: ensureArray(inputs.frontend_request_map),
      erModel: ensureArray(inputs.er_model),
      eventCatalog: ensureArray(inputs.event_catalog),
      contractAlignmentReport: inputs.contract_alignment_report || {},
    };
    const semantic = {
      businessTerms: ensureArray(inputs.business_terms),
      businessActions: ensureArray(inputs.business_actions),
    };
    const ddd = {
      domainModel: inputs.domain_model || { domains: [] },
      capabilityMap: ensureArray(inputs.capability_map),
      contextMap: ensureArray(inputs.context_map),
    };
    const result = deriveEvidenceAssets(config, inputs.project_topology || { repos: [] }, structure, dataContracts, semantic, ddd);
    return {
      evidence_index: result.evidenceIndex,
      evidence_ranked: result.evidenceRanked,
      confidence_report: result.confidenceReport,
      negative_evidence: result.negativeEvidence,
      stitched_cross_repo_evidence: result.stitchedCrossRepoEvidence,
      quality_signals: result.qualitySignals,
    };
  });

  addSkill('flow_path_mining_skill', ({ config, inputs }) => {
    const dataContracts = {
      apiContracts: ensureArray(inputs.api_contracts),
      frontendRequestMap: ensureArray(inputs.frontend_request_map),
      erModel: ensureArray(inputs.er_model),
      eventCatalog: ensureArray(inputs.event_catalog),
    };
    const semantic = {
      businessTerms: ensureArray(inputs.business_terms),
      businessActions: ensureArray(inputs.business_actions),
      frontendJourneys: ensureArray(inputs.frontend_journeys),
      stateMachines: ensureArray(inputs.state_machines),
    };
    const ddd = {
      domainModel: inputs.domain_model || { domains: [] },
      capabilityMap: ensureArray(inputs.capability_map),
      contextMap: ensureArray(inputs.context_map),
    };
    const evidence = {
      evidenceIndex: ensureArray(inputs.evidence_index),
      qualitySignals: inputs.quality_signals || {},
    };
    const result = deriveFlowPathAssets(config, inputs.project_topology || { repos: [] }, dataContracts, semantic, ddd, evidence);
    return {
      flow_paths: result.flowPaths,
      branch_paths: result.branchPaths,
      exception_paths: result.exceptionPaths,
    };
  });

  addSkill('node_abstraction_skill', ({ inputs }) => {
    const flowAssets = {
      flowPaths: ensureArray(inputs.flow_paths),
      branchPaths: ensureArray(inputs.branch_paths),
      exceptionPaths: ensureArray(inputs.exception_paths),
    };
    const dataContracts = {
      apiContracts: ensureArray(inputs.api_contracts),
      frontendRequestMap: ensureArray(inputs.frontend_request_map),
      erModel: ensureArray(inputs.er_model),
      eventCatalog: ensureArray(inputs.event_catalog),
    };
    const structure = {
      symbols: ensureArray(inputs.symbols),
      callGraph: ensureArray(inputs.call_graph),
      routeGraph: ensureArray(inputs.route_graph),
      crossRepoEdges: ensureArray(inputs.cross_repo_edges),
    };
    const result = deriveNodeAbstractions(flowAssets, dataContracts, structure);
    return {
      node_abstractions: result.nodeAbstractions,
    };
  });

  addSkill('diagram_projection_skill', ({ config, inputs }) => {
    const dataContracts = {
      apiContracts: ensureArray(inputs.api_contracts),
      frontendRequestMap: ensureArray(inputs.frontend_request_map),
      erModel: ensureArray(inputs.er_model),
      eventCatalog: ensureArray(inputs.event_catalog),
    };
    const ddd = {
      domainModel: inputs.domain_model || { domains: [] },
      capabilityMap: ensureArray(inputs.capability_map),
      contextMap: ensureArray(inputs.context_map),
    };
    const evidence = {
      evidenceIndex: ensureArray(inputs.evidence_index),
      confidenceReport: inputs.confidence_report || {},
      qualitySignals: inputs.quality_signals || {},
    };
    const flowAssets = {
      flowPaths: ensureArray(inputs.flow_paths),
      branchPaths: ensureArray(inputs.branch_paths),
      exceptionPaths: ensureArray(inputs.exception_paths),
    };
    const nodeAssets = {
      nodeAbstractions: ensureArray(inputs.node_abstractions),
    };
    const result = deriveDiagramAssets(config, inputs.project_topology || { repos: [] }, dataContracts, ddd, evidence, flowAssets, nodeAssets);
    return {
      diagram_context: result.diagramContext,
      diagram_assets: result.diagramAssets,
      diagram_quality_report: result.diagramQualityReport,
    };
  });

  addSkill('knowledge_graph_projection_skill', ({ config, inputs }) => {
    const ddd = {
      domainModel: inputs.domain_model || { domains: [] },
      capabilityMap: ensureArray(inputs.capability_map),
      contextMap: ensureArray(inputs.context_map),
    };
    const flowAssets = {
      flowPaths: ensureArray(inputs.flow_paths),
      branchPaths: ensureArray(inputs.branch_paths),
      exceptionPaths: ensureArray(inputs.exception_paths),
    };
    const diagrams = {
      diagramContext: inputs.diagram_context || {},
      diagramAssets: ensureArray(inputs.diagram_assets),
      diagramQualityReport: ensureArray(inputs.diagram_quality_report),
    };
    const evidence = {
      evidenceIndex: ensureArray(inputs.evidence_index),
      confidenceReport: inputs.confidence_report || {},
      qualitySignals: inputs.quality_signals || {},
    };
    const result = deriveKnowledgeGraphProjection(config, ddd, flowAssets, diagrams, evidence);
    return {
      knowledge_graph_projection: result,
    };
  });

  addSkill('wiki_authoring_skill', ({ config, inputs }) => {
    const semantic = {
      frontendJourneys: ensureArray(inputs.frontend_journeys),
    };
    const ddd = {
      domainModel: inputs.domain_model || { domains: [] },
      capabilityMap: ensureArray(inputs.capability_map),
      contextMap: ensureArray(inputs.context_map),
    };
    const evidence = {
      evidenceIndex: ensureArray(inputs.evidence_index),
      qualitySignals: inputs.quality_signals || {},
    };
    const diagrams = {
      diagramAssets: ensureArray(inputs.diagram_assets),
    };
    const result = deriveWikiAssets(config, inputs.project_topology || { repos: [] }, semantic, ddd, evidence, diagrams);
    return {
      wiki_pages: result.wikiPages,
      wiki_index: result.wikiIndex,
      risk_gap_sections: result.riskGapSections,
    };
  });

  addSkill('quality_gates_skill', ({ ctx, config, inputs }) => {
    const evidence = {
      evidenceIndex: ensureArray(inputs.evidence_index),
      confidenceReport: inputs.confidence_report || {},
      qualitySignals: inputs.quality_signals || {},
    };
    const ddd = {
      domainModel: inputs.domain_model || { domains: [] },
    };
    const diagrams = {
      diagramAssets: ensureArray(inputs.diagram_assets),
      diagramQualityReport: ensureArray(inputs.diagram_quality_report),
    };
    const semantic = {
      businessTerms: ensureArray(inputs.business_terms),
      businessActions: ensureArray(inputs.business_actions),
    };
    const dataContracts = {
      contractAlignmentReport: inputs.contract_alignment_report || {},
    };
    const flowAssets = {
      flowPaths: ensureArray(inputs.flow_paths),
      branchPaths: ensureArray(inputs.branch_paths),
      exceptionPaths: ensureArray(inputs.exception_paths),
    };
    const result = deriveQualityAssets(config, evidence, ddd, diagrams, semantic, dataContracts, flowAssets);
    const publish = evaluatePublishEligibility(
      {
        status: 'ready',
        quality_gate_blocked: ensureArray(result.gateSeed).some((gate) => gate.is_blocking && gate.decision_status === 'blocked'),
        approval_status: ctx.config?.approval_status || 'pending',
        lineage_json: ctx.config?.lineage_json || {},
      },
      ensureArray(result.gateSeed)
    );
    return {
      quality_report: result.qualityReport,
      gate_decisions: publish,
    };
  });

  addSkill('solution_derivation_skill', ({ ctx, config, inputs }) => {
    const snapshot = getSnapshotLike(ctx, inputs);
    const ddd = {
      domainModel: inputs.domain_model || { domains: [] },
    };
    const evidence = {
      evidenceIndex: ensureArray(inputs.evidence_index),
    };
    const dataContracts = {
      apiContracts: ensureArray(inputs.api_contracts),
      erModel: ensureArray(inputs.er_model),
      eventCatalog: ensureArray(inputs.event_catalog),
    };
    const result = deriveDerivationAssets(config, snapshot, ddd, evidence, dataContracts);
    return {
      impact_matrix: result.impactMatrix,
      tech_spec_bundle: result.techSpecBundle,
      test_plan_bundle: result.testPlanBundle,
      derivation_lineage: result.derivationLineage,
    };
  });

  addSkill('knowledge_scoring_skill', ({ ctx, config, inputs }) => {
    const assetsByStage = buildAssetsByStage(inputs);
    return runKnowledgeScoring({
      snapshot: getSnapshotLike(ctx, inputs),
      project: inputs.project || ctx.project || config?.project || {},
      topology: inputs.project_topology || {},
      assetsByStage,
      gateDecisions: inputs.gate_decisions || {},
    });
  });

  addSkill('visible_projection_skill', ({ ctx, config, inputs }) => {
    const assetsByStage = buildAssetsByStage(inputs);
    return {
      algorithm_visible_projection: buildAlgorithmVisibleProjection({
        project: inputs.project || ctx.project || config?.project || {},
        assetsByStage,
      }),
    };
  });

  return skillMap;
}

function ensureBuiltinSkillsRegistered() {
  const contracts = listSkillContracts();
  const signature = JSON.stringify(contracts);
  if (initializedSignature === signature) return;
  createSkillMap(contracts).forEach((skill) => {
    registerSkill(skill);
  });
  initializedSignature = signature;
}

module.exports = {
  ensureBuiltinSkillsRegistered,
};
