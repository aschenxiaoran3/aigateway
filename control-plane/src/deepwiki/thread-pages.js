function createDeepWikiThreadPageBuilder(deps = {}) {
  const {
    buildDeepWikiDomainModel,
    normalizeText,
    normalizeDeepWikiThreadKey,
    toArray,
    summarizeThread,
    truncateText,
    buildThreadFlowMermaid,
    buildThreadSequenceMermaid,
    buildThreadBindingMermaid,
    buildDomainContextMermaid,
    buildDomainBehaviorMermaid,
    buildDomainAggregateMermaid,
  } = deps;

  function buildDeepWikiSupplementalPages({ inventory = {}, graph = {}, threads = [], existingPages = [] } = {}) {
    const pages = [];
    const pushPage = (page) => {
      if (pages.some((item) => item.page_slug === page.page_slug) || (existingPages || []).some((item) => item.page_slug === page.page_slug)) {
        return;
      }
      pages.push(page);
    };
    const projectTrunk = threads.find((item) => item.thread_level === 'project_trunk');
    const domainThreads = threads.filter((item) => item.thread_level === 'domain');
    const coreThreads = threads.filter((item) => item.thread_level === 'core_thread');
    const branchThreads = threads.filter((item) => item.thread_level === 'branch_thread' || item.thread_level === 'exception_thread');
    const frontendBound = !(inventory.missing_repo_roles || []).includes('frontend_view');
    const domains = buildDeepWikiDomainModel(0, graph, threads, existingPages, []);
    pushPage({
      page_slug: '01-architecture-backbone',
      title: '架构主干',
      page_type: 'architecture-backbone',
      source_files: toArray(inventory.entry_candidates).slice(0, 12),
      metadata_json: {
        scope_type: 'project',
        scope_key: 'project',
        summary_kind: 'project_trunk',
      },
      content: [
        '# 架构主干',
        '',
        projectTrunk?.summary_markdown || '当前未能提炼出项目主干线程。',
        '',
        '## 主干线程',
        ...(coreThreads.length ? coreThreads.slice(0, 10).map((item) => `- ${item.title} · ${item.thread_key}`) : ['- 待确认']),
      ].join('\n'),
    });
    pushPage({
      page_slug: '02-domain-map',
      title: '业务域地图',
      page_type: 'domain-map',
      source_files: toArray(inventory.api_files).slice(0, 12),
      metadata_json: {
        scope_type: 'project',
        scope_key: 'project',
        summary_kind: 'domains',
      },
      content: [
        '# 业务域地图',
        '',
        ...(domains.length
          ? domains.map((item) => `- **${item.title}**（${item.domain_tier === 'core' ? '核心域' : item.domain_tier === 'generic' ? '通用域' : '支撑域'}）：行为 ${(item.behaviors || []).length} 个，线程 ${item.thread_keys.length} 条，上下游 ${(item.upstream_contexts || []).length}/${(item.downstream_contexts || []).length}`)
          : domainThreads.length
            ? domainThreads.map((item) => `- **${item.title}**：覆盖 ${(item.object_keys_json || []).length} 个对象`)
            : ['- 当前未识别到明确业务域']),
      ].join('\n'),
    });
    pushPage({
      page_slug: '20-api-contract-map',
      title: '接口契约地图',
      page_type: 'api-contract-map',
      source_files: toArray(inventory.api_files).slice(0, 16),
      metadata_json: {
        scope_type: 'project',
        scope_key: 'project',
        summary_kind: 'api_contracts',
      },
      content: [
        '# 接口契约地图',
        '',
        ...(toArray(inventory.api_endpoints).length
          ? toArray(inventory.api_endpoints).slice(0, 40).map((item) => `- ${item}`)
          : ['- 暂未识别到稳定接口契约']),
      ].join('\n'),
    });
    pushPage({
      page_slug: '21-database-entity-map',
      title: '数据库与实体地图',
      page_type: 'database-entity-map',
      source_files: toArray(inventory.data_files).slice(0, 16),
      metadata_json: {
        scope_type: 'project',
        scope_key: 'project',
        summary_kind: 'database_entities',
      },
      content: [
        '# 数据库与实体地图',
        '',
        ...(toArray(inventory.tables).length
          ? toArray(inventory.tables).slice(0, 40).map((item) => `- ${item}`)
          : ['- 暂未识别到关键表']),
      ].join('\n'),
    });
    pushPage({
      page_slug: '22-runtime-boundaries',
      title: '运行时边界',
      page_type: 'runtime-boundaries',
      source_files: toArray(inventory.deploy_files).slice(0, 16),
      metadata_json: {
        scope_type: 'project',
        scope_key: 'project',
        summary_kind: 'runtime_boundaries',
      },
      content: [
        '# 运行时边界',
        '',
        `- 仓库角色：${(inventory.repo_roles || []).join('、') || '待确认'}`,
        `- 前端视角：${frontendBound ? '已绑定' : '缺失'}`,
        `- 部署线索：${toArray(inventory.deploy_files).join('、') || '待确认'}`,
      ].join('\n'),
    });
    pushPage({
      page_slug: '90-synthesis-and-gaps',
      title: '总结与缺口',
      page_type: 'synthesis-and-gaps',
      source_files: [],
      metadata_json: {
        scope_type: 'project',
        scope_key: 'project',
        summary_kind: 'gaps',
      },
      content: [
        '# 总结与缺口',
        '',
        `- 主线程数：${coreThreads.length}`,
        `- 分支线程数：${branchThreads.length}`,
        `- 前后端联动：${frontendBound ? '已绑定' : '缺前端 / BFF 仓'}`,
        `- 噪声目录：${(inventory.noise_modules || []).join('、') || '无'}`,
        '',
        '## 仍待补齐',
        ...(frontendBound ? [] : ['- 前端 / BFF 仓未接入，无法给出真实前端用户旅程']),
        ...(branchThreads.length ? [] : ['- 当前线程分支较少，需要继续补齐状态分叉和异常补偿']),
        ...(toArray(inventory.noise_modules).length ? [`- 已识别并剔除噪声目录：${toArray(inventory.noise_modules).join('、')}`] : ['- 未发现明显噪声目录']),
      ].join('\n'),
    });
    return pages;
  }

  function buildDeepWikiThreadPages(threads = [], inventory = {}, graph = {}) {
    const pages = [];
    const frontendBound = !(inventory.missing_repo_roles || []).includes('frontend_view');
    const domainModels = buildDeepWikiDomainModel(0, graph, threads, [], []);
    const domainByKey = new Map(domainModels.map((item) => [normalizeText(item.domain_key), item]));
    threads.forEach((thread) => {
      if (thread.thread_level === 'project_trunk') return;
      const domainKey = normalizeDeepWikiThreadKey(thread.domain_key || 'project', 'domain');
      if (thread.thread_level === 'domain') {
        const domain = domainByKey.get(normalizeText(thread.domain_context_key || thread.domain_key || domainKey));
        const fallbackDomain = domain || {
          title: thread.title,
          domain_key: thread.domain_context_key || thread.domain_key || domainKey,
          bounded_context_name: thread.title,
          domain_tier: thread.metrics_json?.domain_tier || 'supporting',
          ubiquitous_language: [],
          behaviors: threads
            .filter((item) => item.parent_thread_key === thread.thread_key && item.thread_level === 'core_thread')
            .slice(0, 4)
            .map((item) => ({
              object_key: item.behavior_key || item.thread_key,
              title: item.title,
              description: item.summary_markdown,
            })),
          aggregates: toArray(thread.object_keys_json)
            .filter((item) => /^aggregate:|^table:/.test(String(item || '')))
            .slice(0, 4)
            .map((item) => ({
              object_key: String(item || '').split(':').slice(1).join(':'),
              title: String(item || '').split(':').slice(1).join(':'),
            })),
          upstream_contexts: [],
          downstream_contexts: [],
          thread_keys: threads
            .filter((item) => normalizeText(item.domain_key) === normalizeText(domainKey))
            .map((item) => item.thread_key)
            .slice(0, 10),
        };
        const domainSummary = domain
          ? [
              `# ${domain.title}`,
              '',
              `- bounded context：${domain.bounded_context_name || domain.title}`,
              `- 领域层级：${domain.domain_tier === 'core' ? '核心域' : domain.domain_tier === 'generic' ? '通用域' : '支撑域'}`,
              `- 通用语言：${(domain.ubiquitous_language || []).join('、') || '待确认'}`,
              `- 核心行为：${(domain.behaviors || []).map((item) => item.title).join('、') || '待确认'}`,
              `- 聚合 / 核心对象：${(domain.aggregates || []).map((item) => item.title || item.object_key).join('、') || '待确认'}`,
              `- 上游上下文：${(domain.upstream_contexts || []).map((item) => item.domain_label || item.domain_key).join('、') || '待确认'}`,
              `- 下游上下文：${(domain.downstream_contexts || []).map((item) => item.domain_label || item.domain_key).join('、') || '待确认'}`,
              `- 关联线程：${(domain.thread_keys || []).join('、') || '待确认'}`,
            ].join('\n')
          : summarizeThread(thread);
        pages.push({
          page_slug: `10-domains/${domainKey}/00-summary`,
          title: thread.title,
          page_type: 'domain-summary',
          source_files: toArray(thread.evidence_json).map((item) => item.source_uri).filter(Boolean).slice(0, 12),
          metadata_json: {
            scope_type: 'domain',
            scope_key: domainKey,
            parent_scope_key: 'project',
            domain_key: domainKey,
            thread_key: thread.thread_key,
          },
          content: domainSummary,
        });
        if (fallbackDomain) {
          const sourceFiles = toArray(thread.evidence_json).map((item) => item.source_uri).filter(Boolean).slice(0, 12);
          pages.push({
            page_slug: `10-domains/${domainKey}/01-context-map`,
            title: `${thread.title} · Context Map`,
            page_type: 'diagram',
            format: 'mmd',
            source_files: sourceFiles,
            metadata_json: {
              scope_type: 'domain',
              scope_key: domainKey,
              parent_scope_key: 'project',
              domain_key: domainKey,
              thread_key: thread.thread_key,
              diagram_key: `domain/${domainKey}/context-map`,
              diagram_type: 'business_domain',
              sort_order: 10,
              diagram_summary: `${thread.title} context map，体现 bounded context 及上下游关系。`,
              render_source: 'domain_structured',
            },
            content: buildDomainContextMermaid(fallbackDomain),
          });
          pages.push({
            page_slug: `10-domains/${domainKey}/02-behavior-map`,
            title: `${thread.title} · 行为地图`,
            page_type: 'diagram',
            format: 'mmd',
            source_files: sourceFiles,
            metadata_json: {
              scope_type: 'domain',
              scope_key: domainKey,
              parent_scope_key: 'project',
              domain_key: domainKey,
              thread_key: thread.thread_key,
              diagram_key: `domain/${domainKey}/behavior-map`,
              diagram_type: 'business_flow',
              sort_order: 20,
              diagram_summary: `${thread.title} 行为图，体现命令、行为与事件。`,
              render_source: 'domain_structured',
            },
            content: buildDomainBehaviorMermaid(fallbackDomain),
          });
          pages.push({
            page_slug: `10-domains/${domainKey}/03-aggregate-map`,
            title: `${thread.title} · 聚合与实体`,
            page_type: 'diagram',
            format: 'mmd',
            source_files: sourceFiles,
            metadata_json: {
              scope_type: 'domain',
              scope_key: domainKey,
              parent_scope_key: 'project',
              domain_key: domainKey,
              thread_key: thread.thread_key,
              diagram_key: `domain/${domainKey}/aggregate-map`,
              diagram_type: 'database_er',
              sort_order: 30,
              diagram_summary: `${thread.title} 聚合 / 实体视图，体现核心对象与持久化落点。`,
              render_source: 'domain_structured',
            },
            content: buildDomainAggregateMermaid(fallbackDomain),
          });
        }
        return;
      }
      const baseSlug = `10-domains/${domainKey}/10-threads/${thread.thread_key}`;
      const commonMeta = {
        scope_type: thread.thread_level === 'branch_thread' || thread.thread_level === 'exception_thread' ? 'branch' : 'thread',
        scope_key: thread.thread_key,
        parent_scope_key: domainKey,
        domain_key: domainKey,
        thread_key: thread.thread_key,
        thread_level: thread.thread_level,
      };
      const sourceFiles = toArray(thread.evidence_json).map((item) => item.source_uri).filter(Boolean).slice(0, 16);
      const coveredEvidence = sourceFiles.slice(0, 8);
      const threadSummary = truncateText(normalizeText(thread.summary_markdown), 220);
      const makeDiagramMeta = (diagramKey, diagramType, sortOrder, summaryText, extra = {}) => ({
        ...commonMeta,
        diagram_key: diagramKey,
        diagram_type: diagramType,
        sort_order: sortOrder,
        diagram_summary: summaryText,
        covered_evidence: coveredEvidence,
        missing_evidence: extra.missing_evidence || [],
        quality_notes: extra.quality_notes || [],
        render_source: 'thread_structured',
      });
      pages.push({
        page_slug: `${baseSlug}/00-summary`,
        title: `${thread.title} · 总览`,
        page_type: 'thread-summary',
        source_files: sourceFiles,
        metadata_json: commonMeta,
        content: summarizeThread(thread),
      });
      pages.push({
        page_slug: `${baseSlug}/01-main-flow`,
        title: `${thread.title} · 主流程`,
        page_type: 'diagram',
        format: 'mmd',
        source_files: sourceFiles,
        metadata_json: makeDiagramMeta(
          `thread/${thread.thread_key}/main-flow`,
          'business_flow',
          10,
          `${thread.title} 主流程，聚焦主干步骤、关键对象与主要调用落点。`,
        ),
        content: buildThreadFlowMermaid(thread, 'main'),
      });
      pages.push({
        page_slug: `${baseSlug}/02-branch-flows`,
        title: `${thread.title} · 分支流程`,
        page_type: 'diagram',
        format: 'mmd',
        source_files: sourceFiles,
        metadata_json: makeDiagramMeta(
          `thread/${thread.thread_key}/branch-flow`,
          'module_flow',
          20,
          `${thread.title} 分支流程，聚焦状态分叉、异常补偿和回退路径。`,
          {
            quality_notes: thread.branch_points_json && thread.branch_points_json.length
              ? []
              : ['当前线程未识别到明确分支节点，分支图基于已有步骤近似生成'],
          }
        ),
        content: buildThreadFlowMermaid({
          ...thread,
          steps_json: (thread.branch_points_json || []).map((item, index) => ({
            step_order: index + 1,
            step_type: item.branch_type || 'branch',
            title: item.title || item.object_key || `分支${index + 1}`,
            object_key: item.object_key || '',
          })),
        }, 'branch'),
      });
      pages.push({
        page_slug: `${baseSlug}/03-sequence`,
        title: `${thread.title} · 时序`,
        page_type: 'diagram',
        format: 'mmd',
        source_files: sourceFiles,
        metadata_json: makeDiagramMeta(
          `thread/${thread.thread_key}/sequence`,
          'core_logic',
          30,
          `${thread.title} 时序图，聚焦服务调用、接口交互与数据落点顺序。`,
        ),
        content: buildThreadSequenceMermaid(thread),
      });
      pages.push({
        page_slug: `${baseSlug}/04-front-back-data-binding`,
        title: `${thread.title} · 前后端与数据绑定`,
        page_type: 'diagram',
        format: 'mmd',
        source_files: sourceFiles,
        metadata_json: makeDiagramMeta(
          `thread/${thread.thread_key}/entity-map`,
          'database_er',
          40,
          `${thread.title} 前后端与数据绑定图，串联入口、服务、实体与表之间的证据。`,
          {
            missing_evidence: frontendBound || thread.thread_level === 'frontend_journey'
              ? []
              : ['frontend_repo_missing'],
            quality_notes: frontendBound || thread.thread_level === 'frontend_journey'
              ? []
              : ['当前项目未绑定前端/BFF 仓，本图仅展示后端与数据链路'],
          }
        ),
        content: buildThreadBindingMermaid(thread, frontendBound || thread.thread_level === 'frontend_journey'),
      });
    });
    return pages;
  }

  return {
    buildDeepWikiSupplementalPages,
    buildDeepWikiThreadPages,
  };
}

module.exports = {
  createDeepWikiThreadPageBuilder,
};
