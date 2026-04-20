const { deriveBusinessLogicAssets } = require('./business-logic-mining');
const { loadBusinessLexicon } = require('./business-lexicon');
const {
  buildEnforcerContext,
  enforceCitations,
  formatCitationString,
  DEFAULT_MODE: DEFAULT_CITATION_MODE,
} = require('./citation-enforcer');

function createBuildDeepWikiPages(deps = {}) {
  const {
    summarizeResearchReport,
    pickSynthesizedDiagram,
    buildOverviewDiagram,
    buildCodeLayeredArchitectureDiagram,
    buildSystemArchitectureDiagram,
    buildProductArchitectureDiagram,
    buildBusinessDomainDiagram,
    buildCoreFlowDiagram,
    buildModuleFlowDiagram,
    buildSequenceDiagram,
    buildErDiagram,
    buildDddDomainCards,
    buildModuleInsight,
    findDomainCardsForModule,
    extractDigestLead,
    isLowValueDigestLead,
    inferModuleFacetKeys,
    facetLabelForKey,
    summarizeEvidenceAppendix,
    toMarkdownList,
    buildMermaidBlock,
    moduleDisplayName,
    slugifySegment,
    uniqueStrings,
    inferSqlTableRelations,
  } = deps;

  return function buildDeepWikiPages({
    repo,
    inventory,
    moduleDigests,
    researchReport,
    focusPrompt,
    researchProvider,
    researchModel,
    outputProfile,
    diagramProfile,
    synthesizedDiagrams = null,
    businessLogicAssets = null,
  }) {
    const commitShort = String(repo.commit_sha || '').slice(0, 12);
    const researchSummary = summarizeResearchReport(researchReport);
    const moduleDigestMap = new Map(moduleDigests.map((item) => [item.name, item.content]));
    const docs = Array.isArray(inventory.docs) ? inventory.docs : [];
    const manifestFiles = Array.isArray(inventory.manifest_files) ? inventory.manifest_files : [];
    const entryCandidates = Array.isArray(inventory.entry_candidates) ? inventory.entry_candidates : [];
    const frameworks = Array.isArray(inventory.frameworks) ? inventory.frameworks : [];
    const topLanguages = Array.isArray(inventory.top_languages) ? inventory.top_languages : [];
    const modules = Array.isArray(inventory.modules) ? inventory.modules : [];
    const businessModules = Array.isArray(inventory.business_modules) && inventory.business_modules.length
      ? inventory.business_modules
      : modules;
    const supportModules = Array.isArray(inventory.support_modules) ? inventory.support_modules : [];
    const noiseModules = Array.isArray(inventory.noise_modules) ? inventory.noise_modules : [];
    const apiEndpoints = Array.isArray(inventory.api_endpoints) ? inventory.api_endpoints : [];
    const tables = Array.isArray(inventory.tables) ? inventory.tables : [];
    const apiFiles = Array.isArray(inventory.api_files) ? inventory.api_files : [];
    const dataFiles = Array.isArray(inventory.data_files) ? inventory.data_files : [];
    const deployFiles = Array.isArray(inventory.deploy_files) ? inventory.deploy_files : [];
    const controllers = Array.isArray(inventory.controllers) ? inventory.controllers : [];
    const services = Array.isArray(inventory.services) ? inventory.services : [];
    const repositories = Array.isArray(inventory.repositories) ? inventory.repositories : [];
    const mapperModels = Array.isArray(inventory.mapper_models) ? inventory.mapper_models : [];
    const dtoModels = Array.isArray(inventory.dto_models) ? inventory.dto_models : [];
    const voModels = Array.isArray(inventory.vo_models) ? inventory.vo_models : [];
    const entities = Array.isArray(inventory.entities) ? inventory.entities : [];
    const feignClients = Array.isArray(inventory.feign_clients) ? inventory.feign_clients : [];
    const sqlTables = Array.isArray(inventory.sql_tables) ? inventory.sql_tables : [];
    const inferredTableRelations = inferSqlTableRelations(sqlTables).slice(0, 16);
    const overviewPick = pickSynthesizedDiagram(synthesizedDiagrams, 'overview', buildOverviewDiagram, inventory);
    const codeLayerPick = pickSynthesizedDiagram(
      synthesizedDiagrams,
      'code_layered_architecture',
      buildCodeLayeredArchitectureDiagram,
      inventory
    );
    const technicalPick = pickSynthesizedDiagram(
      synthesizedDiagrams,
      'technical_architecture',
      buildSystemArchitectureDiagram,
      inventory
    );
    const productPick = pickSynthesizedDiagram(
      synthesizedDiagrams,
      'product_architecture',
      buildProductArchitectureDiagram,
      inventory
    );
    const businessDomainPick = pickSynthesizedDiagram(
      synthesizedDiagrams,
      'business_domain',
      buildBusinessDomainDiagram,
      inventory
    );
    const flowPick = pickSynthesizedDiagram(synthesizedDiagrams, 'business_flow', buildCoreFlowDiagram, inventory);
    const moduleFlowPick = pickSynthesizedDiagram(
      synthesizedDiagrams,
      'module_flow',
      buildModuleFlowDiagram,
      inventory
    );
    const coreLogicPick = pickSynthesizedDiagram(synthesizedDiagrams, 'core_logic', buildSequenceDiagram, inventory);
    const erPick = pickSynthesizedDiagram(synthesizedDiagrams, 'database_er', buildErDiagram, inventory);
    const overviewDiagram = overviewPick.body;
    const codeLayerDiagram = codeLayerPick.body;
    const systemArchitectureDiagram = technicalPick.body;
    const productArchitectureDiagram = productPick.body;
    const businessDomainDiagram = businessDomainPick.body;
    const coreFlowDiagram = flowPick.body;
    const moduleFlowDiagram = moduleFlowPick.body;
    const keySequenceDiagram = coreLogicPick.body;
    const erDiagram = erPick.body;
    const diagramSynthUsed = [
      overviewPick,
      codeLayerPick,
      technicalPick,
      productPick,
      businessDomainPick,
      flowPick,
      moduleFlowPick,
      coreLogicPick,
      erPick,
    ].some((item) => item.source !== 'fallback_heuristic');

    const sharedMeta = {
      repo_url: repo.repo_url,
      repo_slug: repo.repo_slug,
      branch: repo.branch,
      commit_sha: repo.commit_sha,
    };

    const resolvedBusinessLogic = businessLogicAssets || buildBusinessLogicFromInventory(inventory);

    const pages = [];
    const pushPage = (page) => {
      pages.push({
        ...page,
        metadata_json: {
          ...(page.metadata_json || {}),
          ...sharedMeta,
          section_type: page.page_type,
          page_slug: page.page_slug,
          source_files: page.source_files || [],
          provider: page.provider || researchProvider || null,
          model: page.model || researchModel || null,
          output_profile: page.output_profile || outputProfile || 'engineering_architecture_pack',
          diagram_profile: page.diagram_profile || diagramProfile || 'full',
          diagram_type: page.diagram_type || null,
          diagram_summary: page.diagram_summary || null,
          render_source: page.render_source || null,
          covered_evidence: page.covered_evidence || [],
          missing_evidence: page.missing_evidence || [],
          quality_notes: page.quality_notes || [],
          source_symbols: page.source_symbols || [],
          source_tables: page.source_tables || [],
          source_apis: page.source_apis || [],
        },
      });
    };

    const repoUnits = Array.isArray(inventory.repo_units) ? inventory.repo_units : [];
    const multiRepo = repoUnits.length > 1;
    const modulePolicy = inventory.module_merge_policy || null;
    const domainCards = buildDddDomainCards({
      ...inventory,
      modules: businessModules,
    }, moduleDigestMap, 6);
    const repoListBlock = multiRepo
      ? [
          '## 多仓库清单',
          '',
          ...repoUnits.map((u) => {
            const sha = String(u.commit_sha || '').slice(0, 12);
            return `- **${u.repo_role || 'repo'}** \`${u.repo_slug || ''}\` · ${u.branch || ''}@${sha} · ${u.repo_url || ''}`;
          }),
          '',
        ]
      : [];

    pushPage({
      page_slug: '00-overview',
      title: '项目总览',
      page_type: 'overview',
      source_files: [...docs.slice(0, 5), ...manifestFiles.slice(0, 5)],
      content: [
        '# 项目总览',
        '',
        ...(multiRepo
          ? [`- 本页为 **多仓库项目级** Deep Wiki（${repoUnits.length} 个仓库）。下列「主仓」为流水线主索引；各仓清单见下文。`, '']
          : []),
        `- 主仓地址：${repo.repo_url}`,
        `- 主仓分支：${repo.branch}`,
        `- 主仓提交：${commitShort}`,
        ...repoListBlock,
        `- 包管理器：${inventory.package_manager}`,
        `- 框架：${frameworks.join('、') || '待确认'}`,
        `- 语言分布：${topLanguages.map((item) => `${item.language}(${item.count})`).join('、') || '待确认'}`,
        `- 仓库角色：${(inventory.repo_roles || []).join('、') || '待确认'}`,
        `- 前端视角：${(inventory.missing_repo_roles || []).includes('frontend_view') ? '缺失前端/BFF 仓绑定，当前仅能生成后端视角' : '已绑定'}`,
        ...(modulePolicy
          ? [`- 模块合并策略：每仓最多 ${modulePolicy.per_repo_cap} 个模块，全局最多 ${modulePolicy.total_cap} 个。`]
          : []),
        '',
        '## Deep Wiki 目标',
        focusPrompt ? `- 本次关注点：${focusPrompt}` : '- 本次未指定额外 focus_prompt，按仓库全景生成。',
        '',
        '## 仓库画像',
        toMarkdownList([
          `可读文本文件 ${inventory.readable_files} 个，总文件 ${inventory.total_files} 个`,
          `入口候选：${entryCandidates.join('、') || '待确认'}`,
          `文档文件：${docs.join('、') || '待确认'}`,
          `噪声目录：${noiseModules.join('、') || '无'}`,
        ]),
        '',
        '## Deep Research 摘要',
        researchSummary || '暂无 Deep Research 摘要，使用本地规则分析结果作为兜底。',
        '',
        ...(diagramSynthUsed
          ? ['> 下图谱已由结构化制图阶段生成或部分覆盖；未通过校验的图仍回退为启发式模板。', '']
          : []),
        '## 工程架构包导览',
        toMarkdownList([
          '代码分层架构图：体现 Controller / Application / Domain / Repository / Model 分层与调用语义',
          '技术架构图：体现入口、服务、数据与外部依赖边界',
          '产品架构图与业务域图：体现业务能力、子系统与业务域拆分',
          '业务流程图 / 模块依赖图 / 核心时序图：用于追主链路与调用关系',
          '数据库 ER 图：用于梳理真实表、字段线索和关系',
        ]),
        '',
        '## Mermaid 总图',
        buildMermaidBlock('', overviewDiagram),
      ].join('\n'),
    });

    const enforcerContext = buildInventoryEnforcerContext(inventory);
    const businessLogicPage = renderBusinessLogicPage(resolvedBusinessLogic, { enforcerContext });
    if (businessLogicPage) {
      pushPage(businessLogicPage);
    }

    pushPage({
      page_slug: '01-code-layered-architecture',
      title: '代码分层架构图',
      page_type: 'code-layered-architecture',
      source_files: [...entryCandidates.slice(0, 8), ...manifestFiles.slice(0, 8)],
      source_symbols: [
        ...controllers.slice(0, 6).map((item) => item.class_name),
        ...services.slice(0, 8).map((item) => item.class_name),
        ...repositories.slice(0, 6).map((item) => item.class_name),
        ...entities.slice(0, 6).map((item) => item.class_name || item.table_name),
      ],
      source_apis: apiEndpoints.slice(0, 8),
      source_tables: tables.slice(0, 8),
      diagram_type: 'code_layered_architecture',
      diagram_summary: codeLayerPick.summary,
      render_source: codeLayerPick.source,
      covered_evidence: codeLayerPick.coveredEvidence,
      missing_evidence: codeLayerPick.missingEvidence,
      quality_notes: codeLayerPick.qualityNotes,
      content: [
        '# 代码分层架构图',
        '',
        multiRepo ? '> 多仓库合并视角：下图优先提炼主服务仓与关联前端仓之间的分层调用关系。' : '',
        '',
        '## Mermaid 代码分层架构图',
        buildMermaidBlock('', codeLayerDiagram),
        '',
        '## 分层关注点',
        toMarkdownList([
          `Controller：${controllers.map((item) => item.class_name).slice(0, 8).join('、') || '待确认'}`,
          `Application / Query：${services.map((item) => item.class_name).slice(0, 10).join('、') || '待确认'}`,
          `Repository / Mapper：${[...repositories.map((item) => item.class_name), ...mapperModels.map((item) => item.class_name)].slice(0, 10).join('、') || '待确认'}`,
          `Entity / DTO / VO：${[...entities.map((item) => item.class_name || item.table_name), ...dtoModels.map((item) => item.class_name), ...voModels.map((item) => item.class_name)].slice(0, 12).join('、') || '待确认'}`,
        ]),
        '',
        ...(codeLayerPick.summary ? ['## 图说明', codeLayerPick.summary, ''] : []),
        ...(codeLayerPick.coveredEvidence.length ? ['## 证据来源', toMarkdownList(codeLayerPick.coveredEvidence), ''] : []),
        ...(codeLayerPick.missingEvidence.length ? ['## 待确认点', toMarkdownList(codeLayerPick.missingEvidence), ''] : []),
        '## 架构说明',
        researchSummary || '暂无额外观点。',
      ].join('\n'),
    });

    pushPage({
      page_slug: '02-system-architecture',
      title: '系统架构图',
      page_type: 'system-architecture',
      source_files: [...entryCandidates.slice(0, 8), ...manifestFiles.slice(0, 8)],
      source_symbols: modules.slice(0, 8).map((module) => module.name),
      source_apis: apiEndpoints.slice(0, 8),
      source_tables: tables.slice(0, 8),
      diagram_type: 'technical_architecture',
      diagram_summary: technicalPick.summary,
      render_source: technicalPick.source,
      covered_evidence: technicalPick.coveredEvidence,
      missing_evidence: technicalPick.missingEvidence,
      quality_notes: technicalPick.qualityNotes,
      content: [
        '# 系统架构图',
        '',
        multiRepo ? '> 多仓库合并盘点：模块名前缀表示来源仓与角色。' : '',
        '',
        '## Mermaid 系统架构图',
        buildMermaidBlock('', systemArchitectureDiagram),
        '',
        '## 核心边界',
        toMarkdownList([
          `入口：${entryCandidates.join('、') || '待确认'}`,
          `API：${apiEndpoints.slice(0, 10).join('、') || '待确认'}`,
          `服务：${services.map((item) => item.class_name).slice(0, 10).join('、') || '待确认'}`,
          `数据：${tables.slice(0, 10).join('、') || '待确认'}`,
          `外部依赖：${feignClients.map((item) => item.class_name).slice(0, 6).join('、') || '待确认'}`,
        ]),
        '',
        ...(technicalPick.summary ? ['## 图说明', technicalPick.summary, ''] : []),
        ...(technicalPick.coveredEvidence.length ? ['## 证据来源', toMarkdownList(technicalPick.coveredEvidence), ''] : []),
        ...(technicalPick.missingEvidence.length ? ['## 待确认点', toMarkdownList(technicalPick.missingEvidence), ''] : []),
        '## 技术视角说明',
        researchSummary || '暂无额外观点。',
      ].join('\n'),
    });

    pushPage({
      page_slug: '03-product-architecture',
      title: '产品架构图',
      page_type: 'product-architecture',
      source_files: modules.flatMap((module) => module.source_files.slice(0, 3)).slice(0, 24),
      source_symbols: modules.slice(0, 12).map((module) => module.name),
      diagram_type: 'product_architecture',
      diagram_summary: productPick.summary,
      render_source: productPick.source,
      covered_evidence: productPick.coveredEvidence,
      missing_evidence: productPick.missingEvidence,
      quality_notes: productPick.qualityNotes,
      content: [
        '# 产品架构图',
        '',
        multiRepo ? '> 多仓库合并视角：下图聚合各仓模块，业务域划分可能跨前后端。' : '',
        '',
        '## Mermaid 产品架构图',
        buildMermaidBlock('', productArchitectureDiagram),
        '',
        '## 产品域 / 子系统',
        toMarkdownList(
          domainCards.length
            ? domainCards.map((card) => `${card.label}（${card.domain_tier === 'core' ? '核心域' : card.domain_tier === 'generic' ? '通用域' : '支撑域'}）：${card.insight.business_value}`)
            : modules.map((module) => `${module.name}：${module.file_count} 个文件`)
        ),
        '',
        ...(productPick.summary ? ['## 图说明', productPick.summary, ''] : []),
        ...(productPick.coveredEvidence.length ? ['## 证据来源', toMarkdownList(productPick.coveredEvidence), ''] : []),
        ...(productPick.missingEvidence.length ? ['## 待确认点', toMarkdownList(productPick.missingEvidence), ''] : []),
        '## 说明',
        '- 本图更偏业务域/子系统拆分，不等同于物理部署拓扑。',
      ].join('\n'),
    });

    pushPage({
      page_slug: '04-business-domain',
      title: '业务域知识图',
      page_type: 'business-domain',
      source_files: modules.flatMap((module) => module.source_files.slice(0, 4)).slice(0, 24),
      source_symbols: modules.map((module) => module.name),
      source_apis: apiEndpoints.slice(0, 12),
      source_tables: tables.slice(0, 12),
      diagram_type: 'business_domain',
      diagram_summary: businessDomainPick.summary,
      render_source: businessDomainPick.source,
      covered_evidence: businessDomainPick.coveredEvidence,
      missing_evidence: businessDomainPick.missingEvidence,
      quality_notes: businessDomainPick.qualityNotes,
      content: [
        '# 业务域知识图',
        '',
        '## Mermaid 业务域知识图',
        buildMermaidBlock('', businessDomainDiagram),
        '',
        ...(businessDomainPick.summary ? ['## 图说明', businessDomainPick.summary, ''] : []),
        ...(businessDomainPick.coveredEvidence.length ? ['## 证据来源', toMarkdownList(businessDomainPick.coveredEvidence), ''] : []),
        ...(businessDomainPick.missingEvidence.length ? ['## 待确认点', toMarkdownList(businessDomainPick.missingEvidence), ''] : []),
        '## DDD 业务域 / 上下文',
        ...(domainCards.length ? domainCards : modules.map((module) => ({
          label: moduleDisplayName(module.name),
          module,
          insight: buildModuleInsight(module, inventory, moduleDigestMap),
        }))).map((card) => {
          const insight = card.insight;
          const digestCandidate =
            card.module && moduleDigestMap.get(card.module.name)
              ? extractDigestLead(moduleDigestMap.get(card.module.name), card.module.name)
              : '';
          const digest =
            digestCandidate &&
            !isLowValueDigestLead(digestCandidate) &&
            String(digestCandidate || '').trim() !== String(insight.business_value || '').trim()
              ? digestCandidate
              : '';
          const domainLabel = card.module ? card.module.name : card.label;
          return [
            `### ${domainLabel}`,
            '',
            `- 领域层级：${card.domain_tier === 'core' ? '核心域' : card.domain_tier === 'generic' ? '通用域' : '支撑域'}`,
            `- bounded context：${card.bounded_context_name || `${domainLabel} 上下文`}`,
            `- 承载价值：${insight.business_value}`,
            `- 通用语言：${(card.ubiquitous_language || insight.key_objects).join('、') || '待确认'}`,
            `- 核心行为：${(card.behaviors || []).map((item) => item.title).join('、') || insight.related_apis.join('、') || '待确认'}`,
            `- 聚合 / 核心对象：${(card.aggregates || insight.key_objects).join('、') || '待确认'}`,
            `- 关键 API：${insight.related_apis.join('、') || '待确认'}`,
            `- 关键表：${insight.related_tables.map((item) => item.table_name).join('、') || '待确认'}`,
            `- 上游上下文：${(card.upstream_contexts || []).map((item) => item.domain_label).join('、') || '待确认'}`,
            `- 下游上下文：${(card.downstream_contexts || []).map((item) => item.domain_label).join('、') || '待确认'}`,
            ...(digest ? ['', digest] : []),
            '',
          ].join('\n');
        }),
      ].join('\n'),
    });

    pushPage({
      page_slug: '05-db-schema-and-data-model',
      title: '数据库结构与数据模型',
      page_type: 'db-schema-and-data-model',
      source_files: [
        ...dataFiles.slice(0, 16),
        ...entities.slice(0, 12).map((item) => item.path),
        ...sqlTables.slice(0, 12).map((item) => item.path),
      ],
      source_tables: tables,
      source_symbols: entities.map((item) => item.class_name),
      diagram_type: 'database_er',
      diagram_summary: erPick.summary,
      render_source: erPick.source,
      covered_evidence: erPick.coveredEvidence,
      missing_evidence: erPick.missingEvidence,
      quality_notes: erPick.qualityNotes,
      content: [
        '# 数据库结构与数据模型',
        '',
        '## Mermaid 数据库 ER 图',
        buildMermaidBlock('', erDiagram),
        '',
        ...(erPick.summary ? ['## 图说明', erPick.summary, ''] : []),
        ...(erPick.coveredEvidence.length ? ['## 证据来源', toMarkdownList(erPick.coveredEvidence), ''] : []),
        ...(erPick.missingEvidence.length ? ['## 待确认点', toMarkdownList(erPick.missingEvidence), ''] : []),
        '## 关键表 / 实体',
        toMarkdownList(
          tables.length
            ? tables
            : entities.map((item) => `${item.class_name}${item.table_name ? ` -> ${item.table_name}` : ''}`)
        ),
        '',
        '## 表来源映射',
        toMarkdownList(
          sqlTables.length
            ? sqlTables.map((item) => `${item.table_name} · ${item.path}`)
            : ['当前未识别到明确的 CREATE TABLE / 表定义来源']
        ),
        '',
        '## 推断表关系',
        toMarkdownList(
          inferredTableRelations.length
            ? inferredTableRelations.map((item) => `${item.from} -> ${item.to} · 线索字段 ${item.via}`)
            : ['当前未识别到明确的外键或可推断关联字段']
        ),
        '',
        '## 实体到表映射',
        toMarkdownList(
          entities.filter((item) => item.table_name).length
            ? entities
                .filter((item) => item.table_name)
                .map((item) => `${item.class_name} -> ${item.table_name} · ${item.path}`)
            : ['当前未识别到带显式表名映射的实体类']
        ),
        '',
        '## 持久层组件',
        toMarkdownList(repositories.map((item) => `${item.class_name} · ${item.path}`)),
        '',
        '## 说明',
        '- 当前以 DDL 文件、实体类、Mapper / Repository 命名线索为主，字段级关系仍需结合源码与数据库确认。',
      ].join('\n'),
    });

    pushPage({
      page_slug: '06-core-flows',
      title: '核心流程图',
      page_type: 'core-flows',
      source_files: [...controllers.slice(0, 8).map((item) => item.path), ...services.slice(0, 8).map((item) => item.path)],
      source_apis: apiEndpoints.slice(0, 8),
      source_symbols: services.map((item) => item.class_name),
      diagram_type: 'business_flow',
      diagram_summary: flowPick.summary,
      render_source: flowPick.source,
      covered_evidence: flowPick.coveredEvidence,
      missing_evidence: flowPick.missingEvidence,
      quality_notes: flowPick.qualityNotes,
      content: [
        '# 核心流程图',
        '',
        '## Mermaid 核心流程图',
        buildMermaidBlock('', coreFlowDiagram),
        '',
        '## 关键主链路说明',
        toMarkdownList([
          `入口候选：${entryCandidates.join('、') || '待确认'}`,
          `接口候选：${apiEndpoints.slice(0, 8).join('、') || apiFiles.join('、') || '待确认'}`,
          `服务候选：${services.map((item) => item.class_name).slice(0, 6).join('、') || '待确认'}`,
        ]),
        '',
        ...(flowPick.summary ? ['## 图说明', flowPick.summary, ''] : []),
        ...(flowPick.coveredEvidence.length ? ['## 证据来源', toMarkdownList(flowPick.coveredEvidence), ''] : []),
        ...(flowPick.missingEvidence.length ? ['## 待确认点', toMarkdownList(flowPick.missingEvidence), ''] : []),
        '## 注意事项',
        '- 当前流程图是按静态线索归纳的高层视图，真实业务分支与异常流仍需结合代码执行路径确认。',
      ].join('\n'),
    });

    pushPage({
      page_slug: '07-key-sequence-diagrams',
      title: '关键时序图',
      page_type: 'key-sequence-diagrams',
      source_files: [
        ...controllers.slice(0, 8).map((item) => item.path),
        ...feignClients.slice(0, 8).map((item) => item.path),
        ...repositories.slice(0, 8).map((item) => item.path),
      ],
      source_apis: apiEndpoints.slice(0, 6),
      source_symbols: [
        ...controllers.map((item) => item.class_name),
        ...services.map((item) => item.class_name),
        ...repositories.map((item) => item.class_name),
      ],
      source_tables: tables.slice(0, 6),
      diagram_type: 'core_logic',
      diagram_summary: coreLogicPick.summary,
      render_source: coreLogicPick.source,
      covered_evidence: coreLogicPick.coveredEvidence,
      missing_evidence: coreLogicPick.missingEvidence,
      quality_notes: coreLogicPick.qualityNotes,
      content: [
        '# 关键时序图',
        '',
        '## Mermaid 时序图',
        buildMermaidBlock('', keySequenceDiagram),
        '',
        ...(coreLogicPick.summary ? ['## 图说明', coreLogicPick.summary, ''] : []),
        ...(coreLogicPick.coveredEvidence.length ? ['## 证据来源', toMarkdownList(coreLogicPick.coveredEvidence), ''] : []),
        ...(coreLogicPick.missingEvidence.length ? ['## 待确认点', toMarkdownList(coreLogicPick.missingEvidence), ''] : []),
        '## 说明',
        '- 重点刻画调用方、API、业务服务、持久层和数据库之间的主链路交互。',
        '- 若仓库包含远程调用或消息队列，建议在后续人工校对时补齐外部参与者。',
      ].join('\n'),
    });

    pushPage({
      page_slug: '08-module-flow',
      title: '模块结构与依赖流图',
      page_type: 'module-flow',
      source_files: modules.flatMap((module) => module.source_files.slice(0, 4)).slice(0, 24),
      source_symbols: modules.slice(0, 12).map((module) => module.name),
      source_apis: apiEndpoints.slice(0, 10),
      source_tables: tables.slice(0, 10),
      diagram_type: 'module_flow',
      diagram_summary: moduleFlowPick.summary,
      render_source: moduleFlowPick.source,
      covered_evidence: moduleFlowPick.coveredEvidence,
      missing_evidence: moduleFlowPick.missingEvidence,
      quality_notes: moduleFlowPick.qualityNotes,
      content: [
        '# 模块结构与依赖流图',
        '',
        '## Mermaid 模块依赖流图',
        buildMermaidBlock('', moduleFlowDiagram),
        '',
        ...(moduleFlowPick.summary ? ['## 图说明', moduleFlowPick.summary, ''] : []),
        ...(moduleFlowPick.coveredEvidence.length ? ['## 证据来源', toMarkdownList(moduleFlowPick.coveredEvidence), ''] : []),
        ...(moduleFlowPick.missingEvidence.length ? ['## 待确认点', toMarkdownList(moduleFlowPick.missingEvidence), ''] : []),
        '## 模块说明',
        toMarkdownList(
          domainCards.length
            ? domainCards.map((card) => `${card.label}：${card.insight.business_value}`)
            : modules.map((module) => {
                const insight = buildModuleInsight(module, inventory, moduleDigestMap);
                return `${module.name}：${insight.business_value}`;
              })
        ),
      ].join('\n'),
    });

    pushPage({
      page_slug: '09-runtime-and-deployment',
      title: '运行与部署',
      page_type: 'runtime-and-deployment',
      source_files: deployFiles.length
        ? deployFiles
        : manifestFiles.filter((item) => /(docker|compose|makefile|readme)/i.test(item)).slice(0, 16),
      content: [
        '# 运行与部署',
        '',
        '## 相关文件',
        toMarkdownList(
          deployFiles.length
            ? deployFiles
            : manifestFiles.filter((item) => /(docker|compose|makefile|readme)/i.test(item))
        ),
        '',
        '## 运行假设',
        toMarkdownList([
          `包管理器为 ${inventory.package_manager}`,
          `主要框架为 ${frameworks.join('、') || '待确认'}`,
          inventory.package_json?.scripts
            ? `package.json scripts：${Object.keys(inventory.package_json.scripts).join('、')}`
            : '未发现 package.json scripts 或不适用',
        ]),
        '',
        '## 部署线索',
        toMarkdownList(deployFiles),
        '',
        '## 注意事项',
        '- 本页优先记录仓库内显式可见的运行脚本和容器配置，不额外推断线上环境。',
      ].join('\n'),
    });

    pushPage({
      page_slug: '10-development-guide',
      title: '开发与维护指南',
      page_type: 'development-guide',
      source_files: [...docs.slice(0, 8), ...manifestFiles.slice(0, 8)],
      content: [
        '# 开发与维护指南',
        '',
        '## 上手入口',
        toMarkdownList(docs.slice(0, 10)),
        '',
        '## 常见操作',
        inventory.package_json?.scripts
          ? toMarkdownList(Object.entries(inventory.package_json.scripts).map(([name, script]) => `${name}: ${script}`))
          : '- 未识别 package.json scripts',
        '',
        '## 维护建议',
        toMarkdownList([
          '优先从 README、部署文件和入口文件确认真实启动链路',
          '修改模块前先查看对应 modules/<name>.md 与关键文件',
          '若仓库存在多运行时，先分清主服务与辅助脚本边界',
        ]),
      ].join('\n'),
    });

    pushPage({
      page_slug: '11-glossary-open-questions',
      title: '术语与待确认项',
      page_type: 'glossary-and-open-questions',
      source_files: modules.flatMap((module) => module.source_files.slice(0, 2)).slice(0, 16),
      content: [
        '# 术语与待确认项',
        '',
        '## 模块名速查',
        toMarkdownList(modules.map((module) => `${module.name}`)),
        '',
        '## 待确认',
        toMarkdownList([
          entryCandidates.length ? null : '缺少明显入口文件，需人工确认主启动链路',
          apiFiles.length ? null : '未识别明显 API/路由文件，需人工确认服务接口位置',
          dataFiles.length ? null : '未识别明显数据模型/迁移文件，需人工确认存储结构',
          noiseModules.length ? `以下目录已识别为噪声或支撑目录，不再作为主业务模块：${noiseModules.join('、')}` : null,
          (inventory.missing_repo_roles || []).includes('frontend_view') ? '当前项目未绑定前端 / BFF 仓，前后端联动页会显式标记缺口。' : null,
          'Deep Wiki 由静态分析与模型总结生成，不等同于人工逐文件 code review',
        ].filter(Boolean)),
        '',
        '## Deep Research 原文摘录',
        researchSummary || '暂无。',
      ].join('\n'),
    });

    if (modules.length > 0) {
      for (const module of [...businessModules, ...supportModules]) {
        const insight = buildModuleInsight(module, inventory, moduleDigestMap);
        const matchingDomainCards = findDomainCardsForModule(module, domainCards);
        const matchedBehaviors = uniqueStrings(matchingDomainCards.flatMap((card) => (card.behaviors || []).map((item) => item.title))).slice(0, 6);
        const matchedAggregates = uniqueStrings(matchingDomainCards.flatMap((card) => card.aggregates || [])).slice(0, 6);
        const upstreamContexts = uniqueStrings(matchingDomainCards.flatMap((card) => (card.upstream_contexts || []).map((item) => item.domain_label))).slice(0, 4);
        const downstreamContexts = uniqueStrings(matchingDomainCards.flatMap((card) => (card.downstream_contexts || []).map((item) => item.domain_label))).slice(0, 4);
        const moduleDigestLead = extractDigestLead(moduleDigestMap.get(module.name), module.name);
        const moduleSummary =
          moduleDigestLead &&
          !isLowValueDigestLead(moduleDigestLead) &&
          String(moduleDigestLead || '').trim() !== String(insight.business_value || '').trim()
            ? moduleDigestLead
            : '';
        const moduleFacetLabels = insight.facet_labels?.length
          ? insight.facet_labels
          : inferModuleFacetKeys(module, 3).map((facetKey) => facetLabelForKey(facetKey));
        const tableNames = Array.from(
          new Set([
            ...insight.related_tables.map((item) => item.table_name),
            ...insight.related_entities.map((item) => item.table_name),
          ].filter(Boolean))
        );
        const technicalObjects = Array.from(
          new Set([
            ...insight.related_entities.map((item) => item.class_name || item.table_name),
            ...insight.related_dtos,
            ...insight.related_vos,
            ...insight.related_requests,
          ].filter(Boolean))
        );
        pushPage({
          page_slug: `modules/${slugifySegment(String(module.name || '').replace(/[:/]+/g, '--'), 'module')}`,
          title: `模块详解 · ${module.name}`,
          page_type: 'module',
          source_files: module.source_files,
          source_apis: insight.related_apis,
          source_tables: tableNames,
          source_symbols: Array.from(
            new Set([
              ...insight.related_controllers.map((item) => item.class_name),
              ...insight.related_services.map((item) => item.class_name),
              ...insight.related_repositories.map((item) => item.class_name),
              ...insight.related_entities.map((item) => item.class_name || item.table_name),
              ...insight.related_requests,
              ...insight.related_dtos,
              ...insight.related_vos,
            ].filter(Boolean))
          ),
          content: [
            `# 模块详解 · ${module.name}`,
            '',
            `- 文件数：${module.file_count}`,
            `- 关键文件：${module.source_files.slice(0, 10).join('、') || '待确认'}`,
            '',
            '## 业务职责',
            `- 所属业务域：${moduleFacetLabels.join('、') || '待确认'}`,
            `- bounded context：${matchingDomainCards.map((item) => item.bounded_context_name).join('、') || '待确认'}`,
            `- 模块职责：${insight.business_value}`,
            `- 主行为：${matchedBehaviors.join('、') || insight.related_apis.join('、') || '待确认'}`,
            `- 关键规则 / 不变量：${insight.related_validations.join('、') || '待结合源码确认'}`,
            `- 生命周期 / 状态：${matchedBehaviors.length ? '围绕主行为的创建 / 校验 / 流转 / 异常回退展开' : '待结合线程与单据状态补齐'}`,
            `- 上游依赖：${upstreamContexts.join('、') || '前端 / 调用方待确认'}`,
            `- 下游依赖：${downstreamContexts.join('、') || tableNames.join('、') || '持久化 / 外部依赖待确认'}`,
            `- 主入口：${insight.related_apis.join('、') || insight.related_controllers.map((item) => item.class_name).join('、') || '待确认'}`,
            `- 聚合 / 核心对象：${matchedAggregates.join('、') || insight.key_objects.join('、') || '待确认'}`,
            '',
            '## 技术实现骨架',
            toMarkdownList([
              `入口 / Controller：${insight.related_controllers.map((item) => item.class_name).join('、') || '待确认'}`,
              `Application / Domain Service：${insight.related_services.map((item) => item.class_name).join('、') || '待确认'}`,
              `规则 / 校验：${insight.related_validations.join('、') || '待确认'}`,
              `转换：${insight.related_converts.join('、') || '待确认'}`,
              `事务边界：${insight.related_transactions.join('、') || '待确认'}`,
              `仓储 / Mapper / RPC：${[...insight.related_repositories.map((item) => item.class_name), ...insight.related_rpc.map((item) => item.class_name)].join('、') || '待确认'}`,
              `实体 / Request / DTO / VO：${technicalObjects.join('、') || '待确认'}`,
              `数据库对象：${tableNames.join('、') || '待确认'}`,
            ]),
            ...(moduleSummary ? ['', '## 模块补充说明', moduleSummary, ''] : []),
            '## 证据附录',
            ...summarizeEvidenceAppendix(module.key_files.map((file) => `${file.path} · ${file.preview.slice(0, 180).replace(/\s+/g, ' ')}`), 10),
          ].join('\n'),
        });
      }
    }

    [
      {
        page_slug: 'diagrams/wiki-overview',
        title: 'Wiki 总图 · Mermaid',
        diagram_type: 'overview',
        diagram_key: 'project/overview',
        content: overviewDiagram,
        source_files: entryCandidates.slice(0, 6),
        pick: overviewPick,
        scope_type: 'project',
        scope_key: 'project',
        sort_order: 10,
      },
      {
        page_slug: 'diagrams/code-layered-architecture',
        title: '代码分层架构图 · Mermaid',
        diagram_type: 'code_layered_architecture',
        diagram_key: 'project/code-layered-architecture',
        content: codeLayerDiagram,
        source_files: entryCandidates.slice(0, 8),
        pick: codeLayerPick,
        scope_type: 'project',
        scope_key: 'project',
        sort_order: 20,
      },
      {
        page_slug: 'diagrams/system-architecture',
        title: '系统架构图 · Mermaid',
        diagram_type: 'technical_architecture',
        diagram_key: 'project/architecture-backbone',
        content: systemArchitectureDiagram,
        source_files: entryCandidates.slice(0, 8),
        pick: technicalPick,
        scope_type: 'project',
        scope_key: 'project',
        sort_order: 30,
      },
      {
        page_slug: 'diagrams/product-architecture',
        title: '产品架构图 · Mermaid',
        diagram_type: 'product_architecture',
        diagram_key: 'project/product-architecture',
        content: productArchitectureDiagram,
        source_files: modules.flatMap((module) => module.source_files.slice(0, 2)).slice(0, 16),
        pick: productPick,
        scope_type: 'project',
        scope_key: 'project',
        sort_order: 40,
      },
      {
        page_slug: 'diagrams/business-domain',
        title: '业务域知识图 · Mermaid',
        diagram_type: 'business_domain',
        diagram_key: 'project/domain-map',
        content: businessDomainDiagram,
        source_files: modules.flatMap((module) => module.source_files.slice(0, 2)).slice(0, 16),
        pick: businessDomainPick,
        scope_type: 'project',
        scope_key: 'project',
        sort_order: 50,
      },
      {
        page_slug: 'diagrams/core-flow',
        title: '核心流程图 · Mermaid',
        diagram_type: 'business_flow',
        diagram_key: 'project/main-flow',
        content: coreFlowDiagram,
        source_files: controllers.slice(0, 8).map((item) => item.path),
        pick: flowPick,
        scope_type: 'project',
        scope_key: 'project',
        sort_order: 60,
      },
      {
        page_slug: 'diagrams/module-flow',
        title: '模块流程图 · Mermaid',
        diagram_type: 'module_flow',
        diagram_key: 'project/module-flow',
        content: moduleFlowDiagram,
        source_files: modules.flatMap((module) => module.source_files.slice(0, 2)).slice(0, 16),
        pick: moduleFlowPick,
        scope_type: 'project',
        scope_key: 'project',
        sort_order: 70,
      },
      {
        page_slug: 'diagrams/key-sequence',
        title: '关键时序图 · Mermaid',
        diagram_type: 'core_logic',
        diagram_key: 'project/key-sequence',
        content: keySequenceDiagram,
        source_files: controllers.slice(0, 8).map((item) => item.path),
        pick: coreLogicPick,
        scope_type: 'project',
        scope_key: 'project',
        sort_order: 80,
      },
      {
        page_slug: 'diagrams/database-er',
        title: '数据库 ER 图 · Mermaid',
        diagram_type: 'database_er',
        diagram_key: 'project/database-entity-map',
        content: erDiagram,
        source_files: sqlTables.slice(0, 8).map((item) => item.path),
        pick: erPick,
        scope_type: 'project',
        scope_key: 'project',
        sort_order: 90,
      },
    ].forEach((diagram) => {
      pushPage({
        page_slug: diagram.page_slug,
        title: diagram.title,
        page_type: 'diagram',
        format: 'mmd',
        diagram_type: diagram.diagram_type,
        source_files: diagram.source_files,
        source_tables: tables.slice(0, 12),
        source_apis: apiEndpoints.slice(0, 12),
        source_symbols: modules.map((module) => module.name),
        diagram_summary: diagram.pick.summary,
        render_source: diagram.pick.source,
        covered_evidence: diagram.pick.coveredEvidence,
        missing_evidence: diagram.pick.missingEvidence,
        quality_notes: diagram.pick.qualityNotes,
        metadata_json: {
          diagram_key: diagram.diagram_key,
          scope_type: diagram.scope_type,
          scope_key: diagram.scope_key,
          parent_scope_key: null,
          sort_order: diagram.sort_order,
        },
        content: diagram.content,
      });
    });

    return pages;
  };
}

function buildBusinessLogicFromInventory(inventory) {
  if (!inventory || typeof inventory !== 'object') {
    return { business_rules: [], test_evidence: [], state_machines_with_guards: [], summary: {} };
  }
  const ruleComments = Array.isArray(inventory.rule_comments) ? inventory.rule_comments : [];
  const testMethods = Array.isArray(inventory.test_methods) ? inventory.test_methods : [];
  if (!ruleComments.length && !testMethods.length) {
    return { business_rules: [], test_evidence: [], state_machines_with_guards: [], summary: {} };
  }
  const topology = {
    repos: [
      {
        repo_slug: inventory.repo_slug || 'current',
        commentRecords: ruleComments,
        testMethods,
      },
    ],
  };
  try {
    const lexicon = loadBusinessLexicon();
    return deriveBusinessLogicAssets({
      config: {},
      topology,
      dataContracts: { apiContracts: [], erModel: [], eventCatalog: [] },
      semantic: { businessTerms: [], businessActions: [], stateMachines: [] },
      lexicon,
    });
  } catch (err) {
    return { business_rules: [], test_evidence: [], state_machines_with_guards: [], summary: { error: String(err && err.message || err) } };
  }
}

function buildInventoryEnforcerContext(inventory) {
  if (!inventory || typeof inventory !== 'object') return null;
  const allowedPaths = new Set();
  const pushAll = (arr, key = 'path') => {
    if (!Array.isArray(arr)) return;
    for (const item of arr) {
      if (!item) continue;
      if (typeof item === 'string') {
        allowedPaths.add(item);
      } else if (typeof item === 'object' && item[key]) {
        allowedPaths.add(item[key]);
      }
    }
  };
  pushAll(inventory.sample_tree);
  pushAll(inventory.controllers);
  pushAll(inventory.services);
  pushAll(inventory.repositories);
  pushAll(inventory.entities);
  pushAll(inventory.mapper_models);
  pushAll(inventory.dto_models);
  pushAll(inventory.vo_models);
  pushAll(inventory.request_models);
  pushAll(inventory.criteria_models);
  pushAll(inventory.feign_clients);
  pushAll(inventory.sql_tables);
  pushAll(inventory.rule_comments);
  pushAll(inventory.test_methods);
  pushAll(inventory.docs);
  pushAll(inventory.frontend_pages);
  pushAll(inventory.test_files);
  if (allowedPaths.size === 0) return null;
  return buildEnforcerContext({
    allowedPaths: Array.from(allowedPaths),
    mode: process.env.DEEPWIKI_CITATION_MODE === 'strict' ? 'strict' : DEFAULT_CITATION_MODE,
  });
}

function formatCitation(citation) {
  return formatCitationString(citation);
}

function formatCitations(citations) {
  if (!Array.isArray(citations)) return '';
  const rendered = citations.map((c) => formatCitationString(c)).filter(Boolean);
  if (!rendered.length) return '';
  return rendered.slice(0, 3).join('、');
}

function filterCitations(citations, ctx) {
  if (!Array.isArray(citations) || citations.length === 0) return { accepted: [], rejected: [], downgraded: [] };
  if (!ctx) {
    return {
      accepted: citations.filter((c) => c && typeof c === 'object' && c.path),
      rejected: [],
      downgraded: [],
    };
  }
  return enforceCitations(citations, ctx);
}

function enforceCitation(citation, ctx) {
  if (!ctx) return citation && typeof citation === 'object' && citation.path ? citation : null;
  const result = enforceCitations([citation], ctx);
  return result.accepted[0] || null;
}

function renderBusinessLogicPage(assets, options = {}) {
  if (!assets || typeof assets !== 'object') return null;
  const ctx = options.enforcerContext || null;
  const rulesInput = Array.isArray(assets.business_rules) ? assets.business_rules : [];
  const testEvidenceInput = Array.isArray(assets.test_evidence) ? assets.test_evidence : [];
  const stateMachinesInput = Array.isArray(assets.state_machines_with_guards) ? assets.state_machines_with_guards : [];

  const manifest = { dropped_rules: 0, dropped_tests: 0, dropped_transitions: 0, downgraded: 0 };

  const filterRecord = (record) => {
    const accepted = filterCitations(record.citations, ctx);
    manifest.downgraded += accepted.downgraded.length;
    if (ctx && ctx.mode === 'strict' && accepted.accepted.length === 0) return null;
    return { ...record, citations: accepted.accepted };
  };

  const rules = rulesInput
    .map((rule) => {
      const filtered = filterRecord(rule);
      if (!filtered) manifest.dropped_rules += 1;
      return filtered;
    })
    .filter(Boolean);

  const testEvidence = testEvidenceInput
    .map((evidence) => {
      const filtered = filterRecord(evidence);
      if (!filtered) manifest.dropped_tests += 1;
      return filtered;
    })
    .filter(Boolean);

  const stateMachines = stateMachinesInput.map((machine) => {
    const transitions = Array.isArray(machine.transitions)
      ? machine.transitions
          .map((t) => {
            const cite = enforceCitation(t.citation, ctx);
            if (ctx && ctx.mode === 'strict' && t.citation && !cite) {
              manifest.dropped_transitions += 1;
              return null;
            }
            return { ...t, citation: cite || t.citation || null };
          })
          .filter(Boolean)
      : [];
    return { ...machine, transitions };
  });

  if (!rules.length && !testEvidence.length && !stateMachines.length) {
    return null;
  }

  const lines = [];
  lines.push('# 业务逻辑洞察');
  lines.push('');
  lines.push('> 本页聚合从代码注释、测试命名、状态机等来源挖掘得到的**业务语义**证据；目的在于让 Wiki 正文承载「业务规则 / 场景 / 状态迁移」，而非仅罗列技术构件。');
  lines.push('');

  if (rules.length) {
    lines.push('## 业务规则');
    lines.push('');
    lines.push('| # | 规则 | 触发词 | 来源 | 置信度 |');
    lines.push('| - | ---- | ------ | ---- | ------ |');
    rules.slice(0, 40).forEach((rule, idx) => {
      const citation = formatCitations(rule.citations) || '—';
      const text = String(rule.natural_text || '').replace(/\|/g, '\\|').slice(0, 160);
      const trigger = String(rule.trigger || '').replace(/\|/g, '\\|');
      const confidence = typeof rule.confidence === 'number' ? rule.confidence.toFixed(2) : '—';
      lines.push(`| ${idx + 1} | ${text || '—'} | ${trigger || '—'} | ${citation} | ${confidence} |`);
    });
    lines.push('');
  }

  if (stateMachines.length) {
    lines.push('## 状态机与守卫');
    lines.push('');
    stateMachines.slice(0, 8).forEach((machine) => {
      lines.push(`### ${machine.entity || '状态机'}`);
      const states = Array.isArray(machine.states) ? machine.states : [];
      if (states.length) {
        lines.push(`- 状态：${states.join(' → ')}`);
      }
      const transitions = Array.isArray(machine.transitions) ? machine.transitions : [];
      if (transitions.length) {
        lines.push('- 迁移：');
        transitions.slice(0, 16).forEach((t) => {
          const parts = [];
          parts.push(`\`${t.from || '?'}\` → \`${t.to || '?'}\``);
          if (t.trigger) parts.push(`触发：${t.trigger}`);
          if (t.guard) parts.push(`守卫：${t.guard}`);
          const effects = Array.isArray(t.side_effects) ? t.side_effects.filter(Boolean) : [];
          if (effects.length) {
            const rendered = effects
              .slice(0, 3)
              .map((e) => {
                if (e == null) return '';
                if (typeof e === 'string') return e;
                if (typeof e === 'object') {
                  const label = e.name || e.text || e.hint || e.topic || e.type;
                  if (label) return e.type && e.type !== label ? `${e.type}:${label}` : String(label);
                  try { return JSON.stringify(e); } catch (_err) { return ''; }
                }
                return String(e);
              })
              .filter(Boolean);
            if (rendered.length) parts.push(`副作用：${rendered.join('、')}`);
          }
          const cite = formatCitation(t.citation);
          if (cite) parts.push(`证据：${cite}`);
          lines.push(`  - ${parts.join(' ｜ ')}`);
        });
      }
      lines.push('');
    });
  }

  if (testEvidence.length) {
    lines.push('## 测试证据（Given-When-Then）');
    lines.push('');
    lines.push('> 测试命名是业务规则最诚实的来源；下列条目由测试方法名 / `it(...)` 描述自动解析。');
    lines.push('');
    lines.push('| # | 描述 | Given | When | Then | 来源 |');
    lines.push('| - | ---- | ----- | ---- | ---- | ---- |');
    testEvidence.slice(0, 40).forEach((item, idx) => {
      const citation = formatCitations(item.citations) || '—';
      const toCell = (s) => String(s || '—').replace(/\|/g, '\\|').slice(0, 100);
      lines.push(
        `| ${idx + 1} | ${toCell(item.description)} | ${toCell(item.given)} | ${toCell(item.when)} | ${toCell(item.then)} | ${citation} |`,
      );
    });
    lines.push('');
  }

  lines.push('## 附：辅助信息');
  lines.push('');
  lines.push('- 技术构件清单（controllers / services / repositories / tables 等）已降级为辅助信息，参见其他章节「代码分层架构图」与「模块详情」。');
  lines.push('- 本页内容来自 L3.5 `business_logic_mining` 阶段的启发式抽取，`citations` 字段已携带 `path` + `line_start` / `line_end`。');

  const summary = assets.summary || {};
  return {
    page_slug: '00b-business-logic',
    title: '业务逻辑洞察',
    page_type: 'business-logic',
    source_files: collectSourceFilesFromAssets(rules, testEvidence),
    content: lines.join('\n'),
    metadata_json: {
      rule_count: rules.length,
      test_evidence_count: testEvidence.length,
      state_machine_count: stateMachines.length,
      citation_enforcement: {
        mode: ctx ? ctx.mode : 'unenforced',
        ...manifest,
      },
      summary,
    },
  };
}

function collectSourceFilesFromAssets(rules, testEvidence) {
  const set = new Set();
  const harvest = (items) => {
    if (!Array.isArray(items)) return;
    items.forEach((item) => {
      if (!item || !Array.isArray(item.citations)) return;
      item.citations.forEach((c) => {
        if (c && c.path) set.add(c.path);
      });
    });
  };
  harvest(rules);
  harvest(testEvidence);
  return Array.from(set).slice(0, 16);
}

module.exports = {
  createBuildDeepWikiPages,
  buildBusinessLogicFromInventory,
  renderBusinessLogicPage,
  buildInventoryEnforcerContext,
};
