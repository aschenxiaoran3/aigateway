function average(values) {
  const nums = (Array.isArray(values) ? values : []).filter((item) => Number.isFinite(Number(item))).map(Number);
  if (!nums.length) return 0;
  return Number((nums.reduce((sum, item) => sum + item, 0) / nums.length).toFixed(4));
}

function buildScoreRecord(entityType, entityId, snapshotId, overallScore, dimensions, penalties, explanations) {
  return {
    score_id: `${entityType}:${entityId}`,
    entity_type: entityType,
    entity_id: entityId,
    snapshot_id: snapshotId,
    overall_score: overallScore,
    dimensions,
    penalties,
    grader_versions: {
      business_rubric: 'v0.1.0',
      traceability_grader: 'v0.1.0',
    },
    explanations,
  };
}

function computePenalties(entity, gateDecisions) {
  const penalties = [];
  const text = JSON.stringify(entity || {});
  if (/service|controller|repository/i.test(text)) {
    penalties.push({ type: 'too_many_class_names', score_delta: -0.08 });
  }
  if (gateDecisions && gateDecisions.reason === 'quality_gate_blocked') {
    penalties.push({ type: 'quality_gate_blocked', score_delta: -0.2 });
  }
  return penalties;
}

function scorePage(page, snapshotId, gateDecisions) {
  const businessSpecificity = /域|流程|能力|旅程/.test(String(page.title || '')) ? 0.88 : 0.72;
  const evidenceQuality = page.evidenceAsset ? 0.82 : 0.6;
  const traceability = page.evidenceAsset ? 0.86 : 0.55;
  const readability = page.summary ? 0.8 : 0.58;
  const consistency = gateDecisions && gateDecisions.publishReady ? 0.82 : 0.66;
  const penalties = computePenalties(page, gateDecisions);
  const overall = Number((businessSpecificity * 0.25 + evidenceQuality * 0.25 + traceability * 0.2 + readability * 0.15 + consistency * 0.15 + penalties.reduce((sum, item) => sum + item.score_delta, 0)).toFixed(4));
  return buildScoreRecord('page', page.pageSlug || page.title, snapshotId, overall, {
    business_specificity: businessSpecificity,
    evidence_quality: evidenceQuality,
    traceability: traceability,
    readability: readability,
    consistency: consistency,
  }, penalties, [
    '页面评分基于业务性、证据质量、可追溯性、可读性和一致性。',
  ]);
}

function scoreDiagram(diagram, snapshotId) {
  const content = String(diagram.content || diagram.summary || '');
  const entityId = String(
    diagram.diagram_key ||
      diagram.pageSlug ||
      diagram.page_slug ||
      diagram.id ||
      `${diagram.diagram_type || 'diagram'}:${diagram.title || 'untitled'}`
  );
  const businessSpecificity = /用户|业务|流程|订单|领域/.test(content) ? 0.84 : 0.62;
  const evidenceQuality = Array.isArray(diagram.covered_evidence) && diagram.covered_evidence.length ? 0.82 : 0.54;
  const traceability = evidenceQuality > 0.7 ? 0.82 : 0.58;
  const crossRepoCompleteness = /BFF|frontend|backend|前端|后端/.test(content) ? 0.85 : 0.6;
  const diagramQuality = String(diagram.diagram_type || '').includes('flow') ? 0.86 : 0.74;
  const penalties = [];
  if (/service|controller|repository/i.test(content)) {
    penalties.push({ type: 'too_many_class_names', score_delta: -0.12 });
  }
  const overall = Number((businessSpecificity * 0.25 + evidenceQuality * 0.25 + crossRepoCompleteness * 0.2 + traceability * 0.15 + diagramQuality * 0.15 + penalties.reduce((sum, item) => sum + item.score_delta, 0)).toFixed(4));
  return buildScoreRecord('diagram', entityId, snapshotId, overall, {
    business_specificity: businessSpecificity,
    evidence_quality: evidenceQuality,
    traceability: traceability,
    cross_repo_completeness: crossRepoCompleteness,
    diagram_quality: diagramQuality,
  }, penalties, [
    '图评分基于业务动作表达、跨仓闭环、证据和可追溯性。',
  ]);
}

function scoreDomain(domain, snapshotId, gateDecisions) {
  const domainAccuracy = /service|controller|repository/i.test(String(domain.name || '')) ? 0.45 : 0.86;
  const evidenceQuality = 0.8;
  const crossRepoCompleteness = Array.isArray(domain.participatingRepos) && domain.participatingRepos.length > 1 ? 0.88 : 0.62;
  const traceability = 0.8;
  const pageQuality = gateDecisions && gateDecisions.publishReady ? 0.82 : 0.66;
  const penalties = computePenalties(domain, gateDecisions);
  const overall = Number((domainAccuracy * 0.3 + evidenceQuality * 0.2 + crossRepoCompleteness * 0.2 + traceability * 0.15 + pageQuality * 0.15 + penalties.reduce((sum, item) => sum + item.score_delta, 0)).toFixed(4));
  return buildScoreRecord('domain', domain.key || domain.name, snapshotId, overall, {
    domain_accuracy: domainAccuracy,
    evidence_quality: evidenceQuality,
    cross_repo_completeness: crossRepoCompleteness,
    traceability: traceability,
    page_quality: pageQuality,
  }, penalties, [
    '领域评分关注命名正确性、跨仓覆盖和可追溯性。',
  ]);
}

function scoreFlow(flow, snapshotId) {
  const label = String(flow.flow_name || flow.title || flow.capability || '');
  const businessSpecificity = label ? 0.82 : 0.58;
  const evidenceQuality = 0.78;
  const crossRepoCompleteness = /前端|后端|BFF|frontend|backend|bff/i.test(label) ? 0.84 : 0.68;
  const traceability = 0.78;
  const diagramQuality = 0.8;
  const overall = Number((businessSpecificity * 0.25 + evidenceQuality * 0.25 + crossRepoCompleteness * 0.2 + traceability * 0.15 + diagramQuality * 0.15).toFixed(4));
  return buildScoreRecord('flow', flow.flow_code || label, snapshotId, overall, {
    business_specificity: businessSpecificity,
    evidence_quality: evidenceQuality,
    cross_repo_completeness: crossRepoCompleteness,
    traceability: traceability,
    diagram_quality: diagramQuality,
  }, [], [
    '流程评分关注业务动作表达和跨仓闭环程度。',
  ]);
}

function scoreJourney(journey, snapshotId) {
  const crossRepoCompleteness = Array.isArray(journey.steps || journey.steps_json) && (journey.steps || journey.steps_json).length >= 3 ? 0.84 : 0.64;
  return buildScoreRecord('journey', journey.journey || journey.thread_key || 'journey', snapshotId, crossRepoCompleteness, {
    cross_repo_completeness: crossRepoCompleteness,
  }, [], ['旅程评分关注前后端闭环与步骤完整度。']);
}

function scoreSolution(bundle, snapshotId, gateDecisions) {
  const formal = bundle.mode === 'formal';
  const traceability = formal ? 0.86 : 0.58;
  const impactCoverage = formal ? 0.82 : 0.6;
  const domainAlignment = 0.78;
  const dataApiCompleteness = 0.76;
  const testPlanQuality = formal ? 0.8 : 0.62;
  const penalties = [];
  if (!formal) {
    penalties.push({ type: 'unpublished_snapshot_used_in_solution_derivation', score_delta: -0.2 });
  }
  const overall = Number((traceability * 0.25 + impactCoverage * 0.25 + domainAlignment * 0.15 + dataApiCompleteness * 0.2 + testPlanQuality * 0.15 + penalties.reduce((sum, item) => sum + item.score_delta, 0)).toFixed(4));
  return buildScoreRecord('solution', bundle.mode || 'solution', snapshotId, overall, {
    traceability: traceability,
    impact_coverage: impactCoverage,
    domain_alignment: domainAlignment,
    data_api_completeness: dataApiCompleteness,
    test_plan_quality: testPlanQuality,
  }, penalties, [
    formal ? '方案基于 published snapshot，可进入正式评审。' : '方案仅为草案，因快照尚未发布而被扣分。',
  ]);
}

function runKnowledgeScoring(input) {
  const snapshotId = input.snapshot.id;
  const domainAssets = (((input.assetsByStage || {}).ddd_mapping || {}).domain_model || {}).domains || [];
  const pageAssets = (((input.assetsByStage || {}).wiki_authoring || {}).wiki_pages) || [];
  const diagramAssets = (((input.assetsByStage || {}).diagram_composition || {}).diagram_assets) || [];
  const flowAssets = (((input.assetsByStage || {}).ddd_mapping || {}).capability_map) || [];
  const journeyAssets = (((input.assetsByStage || {}).semantic_mining || {}).frontend_journeys) || [];
  const solutionAssets = [(((input.assetsByStage || {}).solution_derivation || {}).tech_spec_bundle), (((input.assetsByStage || {}).solution_derivation || {}).test_plan_bundle)].filter(Boolean);
  const gateDecisions = input.gateDecisions || {};

  const domainScores = domainAssets.map((item) => scoreDomain(item, snapshotId, gateDecisions));
  const pageScores = pageAssets.map((item) => scorePage(item, snapshotId, gateDecisions));
  const diagramScores = (Array.isArray(diagramAssets) ? diagramAssets : Object.values(diagramAssets || {})).map((item) => scoreDiagram(item, snapshotId));
  const flowScores = flowAssets.map((item) => scoreFlow(item, snapshotId));
  const journeyScores = journeyAssets.map((item) => scoreJourney(item, snapshotId));
  const solutionScores = solutionAssets.map((item) => scoreSolution(item, snapshotId, gateDecisions));

  const snapshotScore = average([
    average(pageScores.map((item) => item.overall_score)),
    average(domainScores.map((item) => item.overall_score)),
    average(flowScores.map((item) => item.overall_score)),
    average(diagramScores.map((item) => item.overall_score)),
    average(solutionScores.map((item) => item.overall_score)),
  ]);
  const projectScore = average([snapshotScore, average(domainScores.map((item) => item.overall_score))]);
  const healthIndex = Number((snapshotScore * 0.25 + average(domainScores.map((item) => item.overall_score)) * 0.2 + average(journeyScores.map((item) => item.overall_score)) * 0.2 + average(pageScores.map((item) => item.overall_score)) * 0.15 + average(solutionScores.map((item) => item.overall_score)) * 0.2).toFixed(4));
  const healthLevel = healthIndex >= 0.9 ? 'A' : healthIndex >= 0.8 ? 'B' : healthIndex >= 0.7 ? 'C' : healthIndex >= 0.6 ? 'D' : 'F';

  return {
    project_scores: [buildScoreRecord('project', input.project && (input.project.project_code || input.project.id || 'project'), snapshotId, projectScore, {
      snapshot_quality: snapshotScore,
      domain_quality: average(domainScores.map((item) => item.overall_score)),
    }, [], ['项目评分由 snapshot 与 domain 多层评分聚合得到。'])],
    snapshot_scores: [buildScoreRecord('snapshot', String(snapshotId), snapshotId, snapshotScore, {
      page_quality: average(pageScores.map((item) => item.overall_score)),
      domain_quality: average(domainScores.map((item) => item.overall_score)),
      flow_quality: average(flowScores.map((item) => item.overall_score)),
      diagram_quality: average(diagramScores.map((item) => item.overall_score)),
      solution_quality: average(solutionScores.map((item) => item.overall_score)),
    }, [], ['Snapshot 评分由页面、领域、流程、图和方案多层聚合得到。'])],
    domain_scores: domainScores,
    capability_scores: flowScores,
    flow_scores: flowScores,
    journey_scores: journeyScores,
    page_scores: pageScores,
    diagram_scores: diagramScores,
    solution_scores: solutionScores,
    score_breakdowns: {
      snapshotId,
      projectScore,
      snapshotScore,
      healthIndex,
      healthLevel,
    },
    ranking_views: {
      top_projects_by_business_quality: [
        { project_id: input.project && (input.project.project_code || input.project.id || 'project'), score: projectScore },
      ],
    },
    score_regressions: [],
    health_indices: {
      snapshotId,
      knowledge_health_index: healthIndex,
      health_level: healthLevel,
    },
  };
}

module.exports = {
  runKnowledgeScoring,
};
