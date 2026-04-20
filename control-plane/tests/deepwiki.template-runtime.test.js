const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { STAGE_CONTRACTS, SKILL_CONTRACTS } = require('../src/deepwiki/contracts/contracts');
const { evaluatePublishGate } = require('../src/deepwiki/gates/publish-gate');
const { planDag } = require('../src/deepwiki/core/pipeline/engine');
const { syncTemplateProjection, readSnapshotProjection } = require('../src/deepwiki/runtime');
const { deriveEvidenceAssets, deriveQualityAssets } = require('../src/deepwiki/asset-derivation');

test('template contracts expose the 10-stage pipeline and DAG-native skill contracts', () => {
  assert.equal(STAGE_CONTRACTS.length, 10);
  assert.deepEqual(
    STAGE_CONTRACTS.map((item) => item.stageKey),
    [
      'repo_understanding',
      'structure_extraction',
      'data_contract_extraction',
      'semantic_mining',
      'ddd_mapping',
      'evidence_ranking_binding',
      'diagram_composition',
      'wiki_authoring',
      'quality_gates',
      'solution_derivation',
    ]
  );
  assert.ok(SKILL_CONTRACTS.some((item) => item.skillKey === 'repo_understanding_skill'));
  assert.ok(SKILL_CONTRACTS.some((item) => item.skillKey === 'diagram_projection_skill'));
  assert.ok(SKILL_CONTRACTS.some((item) => item.skillKey === 'knowledge_scoring_skill'));
  assert.ok(SKILL_CONTRACTS.every((item) => item.layer));
  assert.ok(SKILL_CONTRACTS.every((item) => Array.isArray(item.inputs)));
  assert.ok(SKILL_CONTRACTS.every((item) => Array.isArray(item.outputs)));
  assert.ok(SKILL_CONTRACTS.every((item) => item.algorithm));
});

test('dag planner builds upstream dependencies from target assets instead of direct algorithm calls', () => {
  const dag = planDag(['diagram_assets', 'wiki_pages', 'quality_report']);
  const skillKeys = dag.nodes.map((node) => node.skill_key);

  assert.ok(skillKeys.includes('repo_understanding_skill'));
  assert.ok(skillKeys.includes('structure_extraction_skill'));
  assert.ok(skillKeys.includes('diagram_projection_skill'));
  assert.ok(skillKeys.includes('wiki_authoring_skill'));
  assert.ok(skillKeys.includes('quality_gates_skill'));

  const wikiNode = dag.nodes.find((node) => node.skill_key === 'wiki_authoring_skill');
  assert.ok(wikiNode.upstream.includes('diagram_projection_skill'));
});

test('publish gate never reports publishReady when quality gate is blocked', () => {
  const result = evaluatePublishGate({
    status: 'ready',
    qualityBlocked: true,
    hasEvidence: true,
  });

  assert.equal(result.publishReady, false);
  assert.equal(result.reason, 'quality_gate_blocked');
});

test('template projection writes stage assets and KSE outputs under .deepwiki snapshot storage', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'deepwiki-template-runtime-'));
  const snapshot = {
    id: 42,
    publish_status: 'draft',
    quality_status: 'needs_review',
    branch: 'main',
    commit_sha: 'abcdef1234567890',
    metadata_json: {
      output_root: tempRoot,
    },
  };

  const result = syncTemplateProjection({
    project: {
      id: 7,
      project_code: 'demo',
      project_name: 'Demo Project',
    },
    snapshot,
    preparedRepoUnits: [
      { repo_source_id: 1, repo_role: 'frontend', repo_slug: 'frontend-a', branch: 'main', commit_sha: 'abc123', local_path: '/tmp/frontend-a' },
      { repo_source_id: 2, repo_role: 'backend', repo_slug: 'backend-a', branch: 'main', commit_sha: 'def456', local_path: '/tmp/backend-a' },
    ],
    inventory: {
      controllers: [{ class_name: 'OrderController', path: 'backend-a/src/OrderController.ts' }],
      services: [{ class_name: 'OrderService', path: 'backend-a/src/OrderService.ts' }],
      entities: [{ class_name: 'OrderEntity', table_name: 'orders', path: 'backend-a/src/OrderEntity.ts' }],
      api_endpoints: ['POST /api/orders'],
      sql_tables: [{ table_name: 'orders', path: 'db/schema.sql' }],
    },
    pages: [
      {
        page_slug: 'domains/order',
        title: '订单域',
        page_type: 'domain',
        source_uri: 'domains/order.md',
        metadata_json: { participating_repos: ['frontend-a', 'backend-a'] },
        source_files: ['frontend-a/src/orderPage.tsx', 'backend-a/src/OrderController.ts'],
      },
    ],
    knowledgeGraph: {
      objects: [
        {
          object_type: 'domain',
          object_key: 'order',
          title: '订单域',
          evidence: [
            { evidence_type: 'api', source_uri: '/api/orders' },
            { evidence_type: 'table', source_uri: 'orders' },
          ],
        },
      ],
      relations: [
        { from_object_type: 'page', from_object_key: 'orderPage', to_object_type: 'service', to_object_key: 'createOrder', relation_type: 'calls' },
      ],
    },
    domains: [{ domain_key: 'order', domain_name: '订单域', confidence: 0.88 }],
    threads: [{ thread_key: 'journey-order-submit', thread_level: 'frontend_journey', title: '订单提交流程', domain_key: 'order', steps_json: [{ step: 'Open Page' }, { step: 'Submit Form' }, { step: 'Show Success' }] }],
    flows: [{ flow_code: 'order-submit', flow_name: '提交订单', flow_type: 'business_flow' }],
    diagrams: [{ diagram_type: 'business_flow', title: '订单主流程图', content: '用户 -> 前端 -> BFF -> 后端 -> orders', covered_evidence: ['/api/orders', 'orders'] }],
    qualityReport: { status: 'review', score: 0.71, summary: 'needs review', quality_json: { inventory_summary: { module_count: 2 } } },
  });

  assert.equal(result.snapshotId, 42);
  assert.ok(fs.existsSync(path.join(tempRoot, '.deepwiki', 'snapshots', '42', 'assets', 'project_topology.json')));
  assert.ok(fs.existsSync(path.join(tempRoot, '.deepwiki', 'snapshots', '42', 'assets', 'gate_decisions.json')));
  assert.ok(fs.existsSync(path.join(tempRoot, '.deepwiki', 'snapshots', '42', 'snapshot_scores.json')));

  const projection = readSnapshotProjection(snapshot);
  assert.ok(projection.assets.some((item) => item.assetKey === 'project_topology'));
  assert.ok(projection.assets.some((item) => item.assetKey === 'evidence_index'));
  assert.ok(projection.scores.snapshotScores[0].overall_score >= 0);
  assert.equal(projection.scores.solutionScores[0].dimensions.traceability < 0.8, true);
});

test('template projection passes snapshot lineage and approval into publish gate outputs', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'deepwiki-template-lineage-'));
  const snapshot = {
    id: 44,
    status: 'ready',
    publish_status: 'draft',
    quality_status: 'ready',
    approval_status: 'approved',
    publish_ready: true,
    quality_gate_blocked: false,
    branch: 'main',
    commit_sha: 'fedcba9876543210',
    lineage_json: {
      source_snapshot_id: 43,
      created_from: 'template-runtime-test',
    },
    metadata_json: {
      output_root: tempRoot,
    },
  };

  const result = syncTemplateProjection({
    project: {
      id: 9,
      project_code: 'single-repo-demo',
      project_name: 'Single Repo Demo',
    },
    snapshot,
    preparedRepoUnits: [
      { repo_source_id: 1, repo_role: 'backend', repo_slug: 'backend-a', branch: 'main', commit_sha: 'abc123', local_path: '/tmp/backend-a' },
    ],
    inventory: {
      controllers: [{ class_name: 'WarehouseController', path: 'backend-a/src/WarehouseController.ts' }],
      services: [{ class_name: 'WarehouseDomainService', path: 'backend-a/src/WarehouseDomainService.ts' }],
      entities: [{ class_name: 'WarehouseEntity', table_name: 'warehouses', path: 'backend-a/src/WarehouseEntity.ts' }],
      api_endpoints: ['POST /api/warehouses/save'],
      sql_tables: [{ table_name: 'warehouses', path: 'db/schema.sql' }],
    },
    pages: [
      {
        page_slug: 'domains/warehouse',
        title: '仓储 / 库存台账',
        page_type: 'domain',
        source_uri: 'domains/warehouse.md',
        metadata_json: { participating_repos: ['backend-a'] },
        source_files: ['backend-a/src/WarehouseController.ts'],
      },
    ],
    knowledgeGraph: {
      objects: [
        {
          object_type: 'domain',
          object_key: 'warehouse',
          title: '仓储 / 库存台账',
          evidence: [
            { evidence_type: 'api', source_uri: '/api/warehouses/save' },
            { evidence_type: 'table', source_uri: 'warehouses' },
          ],
        },
      ],
      relations: [],
    },
    domains: [{ domain_key: 'warehouse', domain_name: '仓储 / 库存台账', confidence: 0.9 }],
    threads: [],
    flows: [{ flow_code: 'warehouse-save', flow_name: '仓储保存', flow_type: 'business_flow' }],
    diagrams: [
      { diagram_type: 'business_flow', title: '仓储 / 库存台账 · 行为地图', content: 'flowchart TD\nA["仓储保存"] --> B["命令"]\nB --> C["事件"]', covered_evidence: ['/api/warehouses/save', 'warehouses'] },
      { diagram_type: 'module_flow', title: '仓储 / 库存台账 · 模块流程', content: 'flowchart LR\nA["BrandBizService"] --> B["warehouses"]', covered_evidence: ['/api/warehouses/save'] },
      { diagram_type: 'business_flow', title: '仓储 / 库存台账 · 行为地图 2', content: 'flowchart TD\nA["仓储更新"] --> B["命令"]\nB --> C["事件"]', covered_evidence: ['/api/warehouses/save'] },
      { diagram_type: 'business_flow', title: '仓储 / 库存台账 · 行为地图 3', content: 'flowchart TD\nA["仓储查询"] --> B["命令"]\nB --> C["事件"]', covered_evidence: ['warehouses'] },
    ],
    qualityReport: { status: 'ready', score: 0.91, summary: 'ready', quality_json: {} },
  });

  assert.ok(!(result.gateDecisions.blockers || []).includes('missing_lineage'));
  assert.ok(!(result.gateDecisions.blockers || []).includes('approval_not_approved'));
  assert.equal(result.gateDecisions.approval_status, 'approved');
});

test('single repo quality assets treat local closed loop as complete and ignore technical helper diagrams', () => {
  const evidence = deriveEvidenceAssets(
    {
      repos: [{ repoId: 'backend-a', role: 'backend' }],
      requirements: ['仓储保存'],
    },
    {
      repos: [{ repoId: 'backend-a', role: 'backend' }],
    },
    {
      symbols: [
        { kind: 'controller', path: 'src/WarehouseController.ts', repoId: 'backend-a' },
        { kind: 'service', path: 'src/WarehouseDomainService.ts', repoId: 'backend-a' },
        { kind: 'test', path: 'tests/WarehouseController.spec.ts', repoId: 'backend-a' },
      ],
      crossRepoEdges: [],
    },
    {
      apiContracts: [{ method: 'POST', path: '/api/warehouses/save', repoId: 'backend-a', action: '仓储保存' }],
      erModel: [{ table: 'warehouses', repoId: 'backend-a' }],
      eventCatalog: [{ event: 'WarehouseSaved', repoId: 'backend-a', topic: 'warehouse.saved' }],
      contractAlignmentReport: { unmatchedRequests: [] },
    },
    {
      businessTerms: ['仓储 / 库存台账'],
      businessActions: ['仓储保存'],
      frontendJourneys: [],
    },
    {
      domainModel: {
        domains: [{ name: '仓储 / 库存台账', participatingRepos: ['backend-a'] }],
      },
    }
  );

  const quality = deriveQualityAssets(
    {},
    evidence,
    {
      domainModel: {
        domains: [{ name: '仓储 / 库存台账' }],
      },
    },
    {
      diagramAssets: [
        { diagram_type: 'business_flow', title: '仓储 / 库存台账 · 行为地图', content: 'flowchart TD\nA["仓储保存"] --> B["命令"]\nB --> C["事件"]' },
        { diagram_type: 'module_flow', title: '仓储 / 库存台账 · 模块流程', content: 'flowchart LR\nA["BrandBizService"] --> B["warehouses"]' },
      ],
      diagramQualityReport: [{ passed: true }, { passed: true }, { passed: true }],
    },
    {
      businessTerms: ['仓储 / 库存台账'],
      businessActions: ['仓储保存'],
    },
    {
      contractAlignmentReport: { unmatchedRequests: [] },
    },
    {
      flowPaths: [{ title: '仓储保存主流程' }],
      branchPaths: [],
      exceptionPaths: [],
    }
  );

  assert.equal(evidence.qualitySignals.crossRepoClosedLoop, true);
  assert.equal(
    quality.qualityReport.checks.find((item) => item.checker === 'CrossRepoFlowCompletenessChecker')?.passed,
    true
  );
  assert.equal(
    quality.qualityReport.checks.find((item) => item.checker === 'DiagramBusinessActionChecker')?.passed,
    true
  );
});

test('template projection avoids mismatching generic frontend pages to AI endpoints and emits domain diagrams for every domain', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'deepwiki-template-routing-'));
  const snapshot = {
    id: 43,
    publish_status: 'draft',
    quality_status: 'needs_review',
    branch: 'main',
    commit_sha: 'abcdef1234567890',
    metadata_json: {
      output_root: tempRoot,
    },
  };

  const result = syncTemplateProjection({
    project: {
      id: 8,
      project_code: 'ai-erp-demo',
      project_name: 'AI ERP Demo',
    },
    snapshot,
    preparedRepoUnits: [
      { repo_source_id: 1, repo_role: 'frontend', repo_slug: 'frontend-a', branch: 'main', commit_sha: 'abc123', local_path: '/tmp/frontend-a' },
      { repo_source_id: 2, repo_role: 'service', repo_slug: 'backend-a', branch: 'main', commit_sha: 'def456', local_path: '/tmp/backend-a' },
    ],
    inventory: {
      frontend_pages: [
        'frontend/demo/src/views/account/UserList.vue',
        'frontend/demo/src/views/ai/assistant.vue',
      ],
      controllers: [{ class_name: 'AiChatController', path: 'backend-a/src/AiChatController.java' }],
      services: [{ class_name: 'AiChatService', path: 'backend-a/src/AiChatService.java' }],
      entities: [{ class_name: 'AiFeedbackEntity', table_name: 'ai_feedback', path: 'backend-a/src/AiFeedbackEntity.java' }],
      api_endpoints: [
        'POST /api/v1.0/ai/chat/stream',
        'POST /api/v1.0/basicCategory/listPaged',
      ],
      sql_tables: [
        { table_name: 'ai_feedback', path: 'db/schema.sql' },
        { table_name: 'basic_category', path: 'db/schema.sql' },
        { table_name: 'basic_category_info', path: 'db/schema.sql' },
      ],
    },
    domains: [
      { domain_key: 'ai_ordering', domain_name: 'AI 协同 / 智能编排' },
      { domain_key: 'basic_master', domain_name: '基础资料 / 主数据' },
    ],
    pages: [],
    knowledgeGraph: { objects: [], relations: [] },
    threads: [],
    flows: [],
    diagrams: [],
    qualityReport: { status: 'review', score: 0.6, summary: 'needs review', quality_json: {} },
  });

  const routeGraph = result.assetsByStage.structure_extraction.route_graph;
  assert.equal(
    routeGraph.some((item) => String(item.pageLabel).includes('UserList') && String(item.path).includes('/api/v1.0/ai/')),
    false
  );

  const domainDiagrams = result.assetsByStage.diagram_composition.diagram_assets.filter((item) => item.diagram_type === 'business_domain');
  assert.equal(domainDiagrams.length >= 2, true);
  assert.equal(domainDiagrams.every((item) => /Context Map/.test(item.title)), true);
});

test('template projection parses frontend api files into request bindings and AI journeys', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'deepwiki-template-frontend-api-'));
  const frontendRoot = path.join(tempRoot, 'frontend-repo');
  const backendRoot = path.join(tempRoot, 'backend-repo');
  fs.mkdirSync(path.join(frontendRoot, 'src', 'api'), { recursive: true });
  fs.mkdirSync(path.join(frontendRoot, 'src', 'components', 'AIOrderingAssistant'), { recursive: true });
  fs.mkdirSync(backendRoot, { recursive: true });

  fs.writeFileSync(
    path.join(frontendRoot, 'src', 'api', 'ai-ordering-assistant.js'),
    [
      "import request from '@/utils/request'",
      "const AI_SESSION_URL = '/api/v1.0/ai/session'",
      "const AI_STREAM_URL = '/api/v1.0/ai/chat/stream'",
      "const AI_FEEDBACK_URL = '/api/v1.0/ai/feedback'",
      'export function createAiOrderingSession() {',
      '  return request({ url: AI_SESSION_URL, method: "post", data: {} })',
      '}',
      'export function submitAiOrderingFeedback(data) {',
      '  return request({ url: AI_FEEDBACK_URL, method: "post", data })',
      '}',
      'export async function streamAiOrderingChat(payload) {',
      '  return fetch(joinBaseUrl(AI_STREAM_URL), { method: "POST", body: JSON.stringify(payload) })',
      '}',
      '',
    ].join('\n')
  );
  fs.writeFileSync(
    path.join(frontendRoot, 'src', 'components', 'AIOrderingAssistant', 'index.vue'),
    [
      '<script>',
      "import { createAiOrderingSession, streamAiOrderingChat } from '@/api/ai-ordering-assistant'",
      'export default { name: "AIOrderingAssistant" }',
      '</script>',
      '',
    ].join('\n')
  );

  const snapshot = {
    id: 44,
    publish_status: 'draft',
    quality_status: 'needs_review',
    branch: 'main',
    commit_sha: '1234567890abcdef',
    metadata_json: {
      output_root: tempRoot,
    },
  };

  const result = syncTemplateProjection({
    project: {
      id: 9,
      project_code: 'ai-erp-ai',
      project_name: 'AI ERP AI',
    },
    snapshot,
    preparedRepoUnits: [
      { repo_source_id: 1, repo_role: 'frontend', repo_slug: 'frontend-ai', branch: 'main', commit_sha: 'aaa111', local_path: frontendRoot },
      { repo_source_id: 2, repo_role: 'service', repo_slug: 'backend-ai', branch: 'main', commit_sha: 'bbb222', local_path: backendRoot },
    ],
    inventory: {
      api_files: ['frontend/demo/src/api/ai-ordering-assistant.js'],
      api_endpoints: [
        'POST /api/v1.0/ai/session',
        'POST /api/v1.0/ai/chat/stream',
        'POST /api/v1.0/ai/feedback',
      ],
      controllers: [{ class_name: 'AiChatController', path: 'backend-ai/src/AiChatController.java' }],
      services: [{ class_name: 'AiChatService', path: 'backend-ai/src/AiChatService.java' }],
      sql_tables: [{ table_name: 'ai_conversation_log', path: 'db/schema.sql' }],
    },
    domains: [{ domain_key: 'ai_ordering', domain_name: 'AI 协同 / 智能编排' }],
    pages: [],
    knowledgeGraph: { objects: [], relations: [] },
    threads: [],
    flows: [],
    diagrams: [],
    qualityReport: { status: 'review', score: 0.6, summary: 'needs review', quality_json: {} },
  });

  const frontendRequestMap = result.assetsByStage.data_contract_extraction.frontend_request_map;
  assert.equal(frontendRequestMap.some((item) => item.request === 'POST /api/v1.0/ai/session'), true);
  assert.equal(frontendRequestMap.some((item) => item.request === 'POST /api/v1.0/ai/chat/stream'), true);
  assert.equal(frontendRequestMap.some((item) => item.request === 'POST /api/v1.0/ai/feedback'), true);
  assert.equal(
    frontendRequestMap.some((item) => String(item.pageId).includes('src/components/AIOrderingAssistant/index.vue')),
    true
  );

  const aiFlow = result.assetsByStage.diagram_composition.flow_paths.find((item) => item.domainKey === 'ai_ordering');
  assert.equal(Boolean(aiFlow), true);
  assert.equal(aiFlow.steps.some((step) => step.type === 'api' && String(step.label).includes('/api/v1.0/ai/')), true);
});

test('template projection parses docs sql tables and keeps distinct chinese capability nodes', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'deepwiki-template-sql-ddd-'));
  const backendRoot = path.join(tempRoot, 'backend-repo');
  fs.mkdirSync(path.join(backendRoot, 'docs', 'ai-ordering', 'sql'), { recursive: true });

  fs.writeFileSync(
    path.join(backendRoot, 'docs', 'ai-ordering', 'sql', 'ai_conversation_log.sql'),
    [
      'CREATE TABLE `ai_conversation_log` (',
      '  `id` bigint NOT NULL AUTO_INCREMENT COMMENT \'主键ID\',',
      '  `session_id` varchar(64) NOT NULL COMMENT \'会话ID\',',
      '  `submit_success` tinyint(1) DEFAULT NULL COMMENT \'是否提交成功\',',
      '  PRIMARY KEY (`id`)',
      ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='AI开单会话日志';",
      '',
      'CREATE TABLE `ai_feedback` (',
      '  `id` bigint NOT NULL AUTO_INCREMENT COMMENT \'主键ID\',',
      '  `conversation_log_id` bigint DEFAULT NULL COMMENT \'关联的会话日志ID\',',
      '  `rating` varchar(16) NOT NULL COMMENT \'评价\',',
      '  PRIMARY KEY (`id`)',
      ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='AI开单用户反馈';",
      '',
    ].join('\n')
  );

  const snapshot = {
    id: 45,
    publish_status: 'draft',
    quality_status: 'needs_review',
    branch: 'main',
    commit_sha: 'feedface12345678',
    metadata_json: {
      output_root: tempRoot,
    },
  };

  const result = syncTemplateProjection({
    project: {
      id: 10,
      project_code: 'ai-erp-sql',
      project_name: 'AI ERP SQL',
    },
    snapshot,
    preparedRepoUnits: [
      { repo_source_id: 1, repo_role: 'service', repo_slug: 'backend-ai', branch: 'main', commit_sha: 'bbb222', local_path: backendRoot },
    ],
    inventory: {
      api_endpoints: [
        'POST /api/v1.0/ai/session',
        'POST /api/v1.0/ai/chat/submitBill',
      ],
      controllers: [{ class_name: 'AiChatController', path: 'backend-ai/src/AiChatController.java' }],
      services: [{ class_name: 'AiChatService', path: 'backend-ai/src/AiChatService.java' }],
      sql_tables: [
        { table_name: 'ai_conversation_log', path: 'service/backend-ai/docs/ai-ordering/sql/ai_conversation_log.sql' },
        { table_name: 'ai_feedback', path: 'service/backend-ai/docs/ai-ordering/sql/ai_conversation_log.sql' },
      ],
    },
    domains: [{ domain_key: 'ai_ordering', domain_name: 'AI 协同 / 智能编排' }],
    pages: [],
    knowledgeGraph: { objects: [], relations: [] },
    threads: [],
    flows: [],
    diagrams: [],
    qualityReport: { status: 'review', score: 0.6, summary: 'needs review', quality_json: {} },
  });

  const erModel = result.assetsByStage.data_contract_extraction.er_model;
  const conversationLog = erModel.find((item) => item.table === 'ai_conversation_log');
  assert.equal(Boolean(conversationLog), true);
  assert.equal(conversationLog.columns.some((column) => column.name === 'session_id'), true);

  const databaseDiagram = result.assetsByStage.diagram_composition.diagram_assets.find((item) => item.diagram_type === 'database_er');
  assert.equal(/session_id/.test(databaseDiagram.content), true);
  assert.equal(/conversation_log_id/.test(databaseDiagram.content), true);

  const aiDomainDiagram = result.assetsByStage.diagram_composition.diagram_assets.find(
    (item) => item.diagram_type === 'business_domain' && item.scope_key === 'ai_ordering'
  );
  assert.equal(Boolean(aiDomainDiagram), true);
  assert.equal(/智能会话建立/.test(aiDomainDiagram.content), true);
  assert.equal(/智能提单提交/.test(aiDomainDiagram.content), true);
});

test('template projection refines finance capability labels and removes repeated thread steps', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'deepwiki-template-thread-summary-'));
  const snapshot = {
    id: 46,
    publish_status: 'draft',
    quality_status: 'needs_review',
    branch: 'main',
    commit_sha: '1122334455667788',
    metadata_json: {
      output_root: tempRoot,
    },
  };

  const result = syncTemplateProjection({
    project: {
      id: 11,
      project_code: 'ai-erp-finance',
      project_name: 'AI ERP Finance',
    },
    snapshot,
    preparedRepoUnits: [
      { repo_source_id: 1, repo_role: 'frontend', repo_slug: 'frontend-ai', branch: 'main', commit_sha: 'aaa111', local_path: '/tmp/frontend-ai' },
      { repo_source_id: 2, repo_role: 'service', repo_slug: 'backend-ai', branch: 'main', commit_sha: 'bbb222', local_path: '/tmp/backend-ai' },
    ],
    inventory: {
      frontend_pages: ['frontend/demo/src/views/ai/assistant.vue'],
      api_endpoints: [
        'POST /api/v1.0/ai/session',
        'POST /api/v1.0/fundIncomeBill/insertDraft',
        'POST /api/v1.0/fundIncomeBill/listPaged',
        'POST /api/v1.0/billCommon/generateBillCode',
      ],
      controllers: [
        { class_name: 'AiChatController', path: 'backend-ai/src/AiChatController.java' },
        { class_name: 'ErpFinanceIncomeBillController', path: 'backend-ai/src/ErpFinanceIncomeBillController.java' },
        { class_name: 'ErpBillCommonController', path: 'backend-ai/src/ErpBillCommonController.java' },
      ],
      services: [{ class_name: 'AiChatService', path: 'backend-ai/src/AiChatService.java' }],
      sql_tables: [{ table_name: 'ai_conversation_log', path: 'db/schema.sql' }],
    },
    domains: [
      { domain_key: 'ai_ordering', domain_name: 'AI 协同 / 智能编排' },
      { domain_key: 'finance_bill', domain_name: '财务单据 / 结算' },
      { domain_key: 'bill_common', domain_name: '单据公共能力' },
    ],
    pages: [],
    knowledgeGraph: { objects: [], relations: [] },
    threads: [],
    flows: [],
    diagrams: [],
    qualityReport: { status: 'review', score: 0.61, summary: 'needs review', quality_json: {} },
  });

  const financeDomain = result.assetsByStage.ddd_mapping.domain_model.domains.find((item) => item.key === 'finance_bill');
  assert.equal(financeDomain.capabilities.includes('创建收入单草稿'), true);
  assert.equal(financeDomain.capabilities.includes('收入单查询'), true);
  assert.equal(financeDomain.capabilities.includes('财务单据处理'), false);

  const billCommonDomain = result.assetsByStage.ddd_mapping.domain_model.domains.find((item) => item.key === 'bill_common');
  assert.deepEqual(billCommonDomain.capabilities, ['生成单据编码']);

  const aiThreadSummary = result.visibleProjection.pages.find((item) => item.page_slug.includes('ai-ordering-main/00-summary'));
  assert.equal(Boolean(aiThreadSummary), true);
  assert.equal(aiThreadSummary.content.includes('-> 智能会话建立 -> 智能会话建立'), false);
  assert.equal(aiThreadSummary.content.includes('发起智能会话建立 -> 智能会话建立'), true);
});
