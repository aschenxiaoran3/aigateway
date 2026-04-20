const { normalizeText, toArray, uniqueStrings } = require('./asset-derivation');

function kebabCase(value) {
  return normalizeText(value)
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^A-Za-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

function buildMermaidBlock(content) {
  return ['```mermaid', normalizeText(content) || 'flowchart LR\n  Empty["暂无图数据"]', '```'].join('\n');
}

function dedupeAdjacentLabels(labels = []) {
  const result = [];
  toArray(labels).forEach((label) => {
    const text = normalizeText(label);
    if (!text) return;
    if (!result.length || normalizeText(result[result.length - 1]) !== text) {
      result.push(text);
    }
  });
  return result;
}

function summarizeThreadSteps(steps = []) {
  return dedupeAdjacentLabels(toArray(steps).map((step) => step.businessLabel || step.label)).join(' -> ');
}

function pickDiagram(diagrams, type, fallback = null) {
  return toArray(diagrams).find((item) => normalizeText(item.diagram_type) === normalizeText(type)) || fallback;
}

function buildProjectDomainMapMermaid(domains = []) {
  const lines = ['flowchart LR'];
  toArray(domains).forEach((domain) => {
    const domainNode = kebabCase(`domain-${domain.key || domain.name}`);
    lines.push(`  ${domainNode}["${domain.name}"]`);
    toArray(domain.participatingRepos).forEach((repoId) => {
      const repoNode = kebabCase(`repo-${repoId}`);
      const repoLabel = normalizeText(repoId).split('/').filter(Boolean).slice(-1)[0] || normalizeText(repoId);
      lines.push(`  ${repoNode}["${repoLabel}"]`);
      lines.push(`  ${repoNode} --> ${domainNode}`);
    });
  });
  return lines.join('\n');
}

function buildProjectPages({ projectName, topology, domains, diagrams, flowPaths, evidenceAssets }) {
  const architecture = pickDiagram(diagrams, 'product_architecture');
  const businessFlow = pickDiagram(diagrams, 'business_flow');
  const sequence = pickDiagram(diagrams, 'core_logic');
  const journey = pickDiagram(diagrams, 'module_flow');
  const er = pickDiagram(diagrams, 'database_er');
  const domainMap = buildProjectDomainMapMermaid(domains);
  const repoSummary = toArray(topology.repos).map((repo) => `- ${repo.role} · ${repo.repoId} · ${repo.branch || '-'}`);
  const mainFlow = toArray(flowPaths)[0];
  return [
    {
      page_slug: '00-overview',
      title: '项目总览',
      page_type: 'overview',
      source_files: [],
      metadata_json: {
        scope_type: 'project',
        scope_key: 'project',
        render_source: 'stage_assets_algorithmic',
      },
      content: [
        `# ${projectName || '项目'}总览`,
        '',
        `- 多仓角色：${toArray(topology.repos).map((repo) => repo.role).join('、') || '待确认'}`,
        `- 业务域数量：${domains.length}`,
        `- 关键流程数量：${toArray(flowPaths).length}`,
        `- 证据数量：${toArray(evidenceAssets.evidenceIndex).length}`,
        '',
        '## 多仓清单',
        ...(repoSummary.length ? repoSummary : ['- 暂无仓绑定']),
        '',
        '## 主干业务',
        mainFlow ? `- ${mainFlow.title}` : '- 尚未抽取主干业务流程',
      ].join('\n'),
    },
    {
      page_slug: '01-architecture-backbone',
      title: '架构主干',
      page_type: 'technical_architecture',
      source_files: [],
      metadata_json: {
        scope_type: 'project',
        scope_key: 'project',
        diagram_type: 'technical_architecture',
        render_source: 'stage_assets_algorithmic',
      },
      content: [
        '# 架构主干',
        '',
        '## 项目级多仓业务架构',
        buildMermaidBlock(architecture?.content),
        '',
        architecture?.covered_evidence?.length ? '## 证据来源' : '',
        ...(architecture?.covered_evidence || []).map((item) => `- ${item}`),
      ].filter(Boolean).join('\n'),
    },
    {
      page_slug: '03-product-architecture',
      title: '产品架构图',
      page_type: 'product-architecture',
      source_files: [],
      metadata_json: {
        scope_type: 'project',
        scope_key: 'project',
        diagram_type: 'product_architecture',
        render_source: 'stage_assets_algorithmic',
      },
      content: [
        '# 产品架构图',
        '',
        '本图以业务域、前后端触点、数据落点和事件闭环为中心，不再按技术类名拼接。',
        '',
        buildMermaidBlock(architecture?.content),
      ].join('\n'),
    },
    {
      page_slug: '04-business-domain',
      title: '业务域地图',
      page_type: 'business-domain',
      source_files: [],
      metadata_json: {
        scope_type: 'project',
        scope_key: 'project',
        diagram_type: 'business_domain',
        render_source: 'stage_assets_algorithmic',
      },
      content: [
        '# 业务域地图',
        '',
        ...(domains.length
          ? domains.map((domain) => `- **${domain.name}**：能力 ${toArray(domain.capabilities).join('、') || '待补齐'}；参与仓 ${toArray(domain.participatingRepos).join('、') || '待确认'}`)
          : ['- 当前未识别到可靠业务域']),
        '',
        buildMermaidBlock(domainMap),
      ].join('\n'),
    },
    {
      page_slug: '05-db-schema-and-data-model',
      title: '数据库结构与数据模型',
      page_type: 'database-entity-map',
      source_files: [],
      metadata_json: {
        scope_type: 'project',
        scope_key: 'project',
        diagram_type: 'database_er',
        render_source: 'stage_assets_algorithmic',
      },
      content: [
        '# 数据库结构与数据模型',
        '',
        buildMermaidBlock(er?.content),
      ].join('\n'),
    },
    {
      page_slug: '06-core-flows',
      title: '核心流程图',
      page_type: 'business-flow',
      source_files: [],
      metadata_json: {
        scope_type: 'project',
        scope_key: 'project',
        diagram_type: 'business_flow',
        render_source: 'stage_assets_algorithmic',
      },
      content: [
        '# 核心流程图',
        '',
        mainFlow ? `- 主干业务：${mainFlow.title}` : '- 尚未识别主干业务',
        '',
        buildMermaidBlock(businessFlow?.content),
      ].join('\n'),
    },
    {
      page_slug: '07-key-sequence-diagrams',
      title: '关键时序图',
      page_type: 'core-logic',
      source_files: [],
      metadata_json: {
        scope_type: 'project',
        scope_key: 'project',
        diagram_type: 'core_logic',
        render_source: 'stage_assets_algorithmic',
      },
      content: [
        '# 关键时序图',
        '',
        buildMermaidBlock(sequence?.content),
      ].join('\n'),
    },
    {
      page_slug: '08-module-flow',
      title: '前后端联动旅程',
      page_type: 'journey',
      source_files: [],
      metadata_json: {
        scope_type: 'project',
        scope_key: 'project',
        diagram_type: 'module_flow',
        render_source: 'stage_assets_algorithmic',
      },
      content: [
        '# 前后端联动旅程',
        '',
        buildMermaidBlock(journey?.content),
      ].join('\n'),
    },
  ];
}

function buildDomainPages(domains, diagrams) {
  return toArray(domains).flatMap((domain) => {
    const baseSlug = `10-domains/${kebabCase(domain.key || domain.name)}`;
    const contextDiagram = toArray(diagrams).find((item) => normalizeText(item.scope_key) === normalizeText(domain.key) && normalizeText(item.diagram_type) === 'business_domain');
    return [
      {
        page_slug: `${baseSlug}/00-summary`,
        title: domain.name,
        page_type: 'domain-summary',
        source_files: [],
        metadata_json: {
          scope_type: 'domain',
          scope_key: domain.key,
          parent_scope_key: 'project',
          render_source: 'stage_assets_algorithmic',
        },
        content: [
          `# ${domain.name}`,
          '',
          `- 参与仓：${toArray(domain.participatingRepos).join('、') || '待确认'}`,
          `- 能力：${toArray(domain.capabilities).join('、') || '待补齐'}`,
          `- 证据类型：${toArray(domain.evidenceClasses).join('、') || '待补齐'}`,
        ].join('\n'),
      },
      {
        page_slug: `${baseSlug}/01-context-map`,
        title: `${domain.name} · Context Map`,
        page_type: 'diagram',
        format: 'mmd',
        source_files: [],
        metadata_json: {
          scope_type: 'domain',
          scope_key: domain.key,
          parent_scope_key: 'project',
          diagram_key: `domain/${domain.key}/context-map`,
          diagram_type: 'business_domain',
          render_source: 'stage_assets_algorithmic',
        },
        content: buildMermaidBlock(contextDiagram?.content),
      },
    ];
  });
}

function buildThreadRecords(flowPaths, branchPaths, exceptionPaths) {
  const mainFlow = toArray(flowPaths)[0];
  const projectTrunk = mainFlow
    ? [
        {
          thread_key: 'project-trunk',
          parent_thread_key: null,
          thread_level: 'project_trunk',
          domain_key: 'project',
          domain_context_key: 'project',
          behavior_key: mainFlow.flowId,
          title: '项目主干与关键链路',
          summary_markdown: `${mainFlow.title} 串联 ${summarizeThreadSteps(mainFlow.steps)}。`,
          entry_points_json: mainFlow.entryPoints || [],
          steps_json: mainFlow.steps || [],
          branch_points_json: [],
          command_keys_json: [],
          event_keys_json: toArray(mainFlow.steps).filter((step) => step.type === 'event').map((step) => step.label),
          object_keys_json: toArray(mainFlow.steps).map((step) => `${step.type}:${step.businessLabel || step.label}`),
          repo_roles_json: uniqueStrings(toArray(mainFlow.repos)),
          evidence_json: toArray(mainFlow.evidenceRefs).map((item) => ({ source_uri: item })),
          metrics_json: { generated_by: 'algorithm_projection' },
        },
      ]
    : [];
  const coreThreads = toArray(flowPaths).map((flow) => ({
    thread_key: kebabCase(flow.flowId),
    parent_thread_key: 'project-trunk',
    thread_level: flow.flowType === 'project_trunk' ? 'core_thread' : 'core_thread',
    domain_key: flow.domainKey,
    domain_context_key: flow.domainKey,
    behavior_key: flow.flowId,
    title: flow.title,
    summary_markdown: `${flow.title} 由 ${summarizeThreadSteps(flow.steps)} 组成。`,
    entry_points_json: flow.entryPoints || [],
    steps_json: flow.steps || [],
    branch_points_json: [],
    command_keys_json: [],
    event_keys_json: toArray(flow.steps).filter((step) => step.type === 'event').map((step) => step.label),
    object_keys_json: toArray(flow.steps).map((step) => `${step.type}:${step.businessLabel || step.label}`),
    repo_roles_json: uniqueStrings(toArray(flow.repos)),
    evidence_json: toArray(flow.evidenceRefs).map((item) => ({ source_uri: item })),
    metrics_json: { generated_by: 'algorithm_projection' },
  }));
  const branchThreads = toArray(branchPaths).map((flow) => ({
    thread_key: kebabCase(flow.branchId),
    parent_thread_key: kebabCase(flow.parentFlowId),
    thread_level: 'branch_thread',
    domain_key: flow.domainKey,
    domain_context_key: flow.domainKey,
    behavior_key: flow.parentFlowId,
    title: flow.title,
    summary_markdown: `${flow.title} 用于补充分支处理与反馈闭环。`,
    entry_points_json: [],
    steps_json: flow.steps || [],
    branch_points_json: [{ reason: flow.reason }],
    command_keys_json: [],
    event_keys_json: [],
    object_keys_json: toArray(flow.steps).map((step) => `${step.type}:${step.businessLabel || step.label}`),
    repo_roles_json: [],
    evidence_json: [],
    metrics_json: { generated_by: 'algorithm_projection' },
  }));
  const exceptionThreads = toArray(exceptionPaths).map((flow) => ({
    thread_key: kebabCase(flow.exceptionId),
    parent_thread_key: kebabCase(flow.parentFlowId),
    thread_level: 'exception_thread',
    domain_key: flow.domainKey,
    domain_context_key: flow.domainKey,
    behavior_key: flow.parentFlowId,
    title: flow.title,
    summary_markdown: `${flow.title} 用于异常处理、反馈纠偏或补偿。`,
    entry_points_json: [],
    steps_json: flow.steps || [],
    branch_points_json: [{ reason: flow.reason }],
    command_keys_json: [],
    event_keys_json: [],
    object_keys_json: toArray(flow.steps).map((step) => `${step.type}:${step.businessLabel || step.label}`),
    repo_roles_json: [],
    evidence_json: [],
    metrics_json: { generated_by: 'algorithm_projection' },
  }));
  return [...projectTrunk, ...coreThreads, ...branchThreads, ...exceptionThreads];
}

function buildThreadPages(threadRecords) {
  return toArray(threadRecords).flatMap((thread) => {
    if (thread.thread_level === 'project_trunk') return [];
    const baseSlug = `10-domains/${kebabCase(thread.domain_key || 'project')}/10-threads/${thread.thread_key}`;
    const stepSummary = summarizeThreadSteps(thread.steps_json);
    const repoSummary = uniqueStrings(toArray(thread.repo_roles_json)).join('、');
    return [
      {
        page_slug: `${baseSlug}/00-summary`,
        title: `${thread.title} · 总览`,
        page_type: 'thread-summary',
        source_files: [],
        metadata_json: {
          scope_type: thread.thread_level === 'branch_thread' || thread.thread_level === 'exception_thread' ? 'branch' : 'thread',
          scope_key: thread.thread_key,
          parent_scope_key: thread.domain_key,
          domain_key: thread.domain_key,
          thread_key: thread.thread_key,
          thread_level: thread.thread_level,
          render_source: 'stage_assets_algorithmic',
        },
        content: [
          `# ${thread.title}`,
          '',
          `- 线程级别：${thread.thread_level}`,
          `- 归属域：${thread.domain_key}`,
          `- 参与仓：${repoSummary || '待确认'}`,
          `- 入口：${toArray(thread.entry_points_json).join('、') || '待确认'}`,
          `- 主链：${stepSummary || '待补齐'}`,
        ].join('\n'),
      },
      {
        page_slug: `${baseSlug}/01-main-flow`,
        title: `${thread.title} · 主流程`,
        page_type: 'diagram',
        format: 'mmd',
        source_files: [],
        metadata_json: {
          scope_type: thread.thread_level === 'branch_thread' || thread.thread_level === 'exception_thread' ? 'branch' : 'thread',
          scope_key: thread.thread_key,
          parent_scope_key: thread.domain_key,
          thread_key: thread.thread_key,
          diagram_key: `thread/${thread.thread_key}/main-flow`,
          diagram_type: 'business_flow',
          render_source: 'stage_assets_algorithmic',
        },
        content: buildMermaidBlock([
          'flowchart LR',
          ...toArray(thread.steps_json).map((step) => `  ${kebabCase(step.key || step.label)}["${step.businessLabel || step.label}"]`),
          ...toArray(thread.steps_json).slice(0, -1).map((step, index) => `  ${kebabCase(step.key || step.label)} --> ${kebabCase(thread.steps_json[index + 1].key || thread.steps_json[index + 1].label)}`),
        ].join('\n')),
      },
    ];
  });
}

function buildAlgorithmVisibleProjection({ project, assetsByStage }) {
  const topology = assetsByStage.repo_understanding.project_topology;
  const dddAssets = assetsByStage.ddd_mapping;
  const semanticAssets = assetsByStage.semantic_mining;
  const evidenceAssets = assetsByStage.evidence_ranking_binding;
  const diagramAssets = assetsByStage.diagram_composition;
  const flowPaths = assetsByStage.diagram_composition.flow_paths || [];
  const branchPaths = assetsByStage.diagram_composition.branch_paths || [];
  const exceptionPaths = assetsByStage.diagram_composition.exception_paths || [];
  const domains = toArray(dddAssets.domain_model && dddAssets.domain_model.domains);
  const threadRecords = buildThreadRecords(flowPaths, branchPaths, exceptionPaths);
  const pages = [
    ...buildProjectPages({
      projectName: project?.project_name || project?.project_code || '项目',
      topology,
      domains,
      diagrams: diagramAssets.diagram_assets || [],
      flowPaths,
      evidenceAssets,
    }),
    ...buildDomainPages(domains, diagramAssets.diagram_assets || []),
    ...buildThreadPages(threadRecords),
  ];
  return {
    pages,
    diagrams: diagramAssets.diagram_assets || [],
    threads: threadRecords,
    graph: diagramAssets.knowledge_graph_projection || null,
    semanticSummary: {
      business_terms: semanticAssets.business_terms || [],
      business_actions: semanticAssets.business_actions || [],
    },
  };
}

module.exports = {
  buildAlgorithmVisibleProjection,
};
