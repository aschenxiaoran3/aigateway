const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');
const winston = require('winston');
const { v4: uuidv4 } = require('uuid');
const { DOC_GATE_OUTPUT_SCHEMA } = require('../contracts/docGateOutputSchema');
const {
  deriveRepoSlug,
  sanitizePathSegment,
  normalizeBranchName,
  preflightRepository,
  prepareRepositorySnapshot,
  collectRepositoryInventory,
  collectProjectManifestInventory,
  buildRepositoryContext,
  buildModuleDigestPrompt,
  buildDeepWikiPages,
  buildDeepWikiKnowledgeGraph,
  buildDeepWikiPageFilePath,
  buildContextStructuredDiagram,
} = require('../deepwiki/repository');
const {
  buildDiagramSynthesisGatewayPayload,
  resolveResearchProvider,
} = require('../deepwiki/provider-routing');
const {
  STAGE_CONTRACTS,
  SKILL_CONTRACTS,
} = require('../deepwiki/contracts/contracts');
const { createDeepWikiProjectionStore } = require('../deepwiki/projection-store');
const { createDeepWikiAlgorithmVisibleStore } = require('../deepwiki/algorithm-visible-store');
const { createDeepWikiThreadPageBuilder } = require('../deepwiki/thread-pages');
const yaml = require('js-yaml');
const { loadKnowledgeOsBundleSafe } = require('../deepwiki/knowledge-os-loader');
const {
  buildExpectedCoverage,
  buildObservedCoverage,
  buildCoverageReport,
  buildCoverageGapPages,
} = require('../deepwiki/coverage-gate');
const { buildDocumentBundle } = require('../deepwiki/doc-projection');
const { dualWriteDeepWikiMarkdownBundle } = require('../deepwiki/repo-docs-writer');
const {
  assertTransition,
  assertPublishedBaseline,
  backfillSnapshotRecord,
  canTransition,
  computeSnapshotStatus,
  deriveLegacySnapshotFields,
  evaluatePublishEligibility,
  isPublishedSnapshot,
  normalizeApprovalStatus,
  normalizeSnapshotStatus,
  pickPublishedSnapshot,
  resolveTransitionPath,
} = require('../deepwiki/snapshot-state-machine');

/** 文档门禁 gate_type → 标准节点 node_key（gateway_standard_nodes） */
const GATE_TYPE_TO_STANDARD_NODE_KEY = {
  input_contract: 'std_input_contract',
  prd_gate: 'std_prd_gate',
  tech_spec_gate: 'std_tech_spec_gate',
  test_plan_gate: 'std_test_plan_gate',
};

const GATE_TYPE_KNOWLEDGE_ASSET_HINTS = {
  input_contract: ['ka-eng-mgmt-evolution', 'ka-api-md', 'ka-arch-overview'],
  prd_gate: ['ka-gate-prd-yaml', 'ka-prd-sales-order', 'ka-eng-mgmt-evolution'],
  tech_spec_gate: ['ka-gate-tech-yaml', 'ka-api-md', 'ka-arch-overview'],
  test_plan_gate: ['ka-test-plan-template-spec', 'ka-test-plan-gate-rules', 'ka-platform-manual'],
};

const DEFAULT_KNOWLEDGE_COLLECTION = process.env.KNOWLEDGE_BASE_COLLECTION || 'phase1_knowledge_assets';
const DEFAULT_DEEPWIKI_COLLECTION = process.env.DEEPWIKI_KNOWLEDGE_COLLECTION || 'deepwiki_assets';
const DEEPWIKI_SUMMARY_TIMEOUT_MS = Number(process.env.DEEPWIKI_SUMMARY_TIMEOUT_MS || 30000);
const DEEPWIKI_DEEP_RESEARCH_TIMEOUT_MS = Number(process.env.DEEPWIKI_DEEP_RESEARCH_TIMEOUT_MS || 180000);
const DEEPWIKI_QUERY_MAX_COMMUNITIES = Math.max(1, Number(process.env.DEEPWIKI_QUERY_MAX_COMMUNITIES || 3));
const DEEPWIKI_MODULE_DIGEST_CONCURRENCY = Math.max(
  1,
  Number(process.env.DEEPWIKI_MODULE_DIGEST_CONCURRENCY || 3)
);
const DEEPWIKI_DIAGRAM_SYNTHESIS_TIMEOUT_MS = Number(process.env.DEEPWIKI_DIAGRAM_SYNTHESIS_TIMEOUT_MS || 120000);
const DEEPWIKI_STAGE_ORDER = [
  'repo_prepare',
  'repo_inventory',
  'module_digest',
  'deep_research_outline',
  'diagram_synthesis',
  'wiki_render',
  'knowledge_extract',
  'coverage_check',
  'coverage_repair',
  'doc_projection_md',
  'knowledge_register',
  'community_index',
  'rag_ingest',
  'retrieval_eval',
  'publish',
];
const DEEPWIKI_SOURCE_TYPES = new Set([
  'repo',
  'prd',
  'biz_spec',
  'tech_spec',
  'test_asset',
  'api_contract',
  'ddl',
  'review',
  'postmortem',
]);
const DEEPWIKI_DIAGRAM_TYPES = new Set([
  'overview',
  'code_layered_architecture',
  'product_architecture',
  'technical_architecture',
  'business_domain',
  'business_flow',
  'module_flow',
  'core_logic',
  'database_er',
]);
const DEEPWIKI_PROJECT_DIAGRAM_SPECS = [
  { diagram_type: 'overview', diagram_key: 'project/overview', title: '总图', fallbackSlug: 'diagrams/wiki-overview', pageType: 'overview', sort_order: 10 },
  { diagram_type: 'code_layered_architecture', diagram_key: 'project/code-layered-architecture', title: '代码分层架构图', fallbackSlug: '01-code-layered-architecture', pageType: 'code_layered_architecture', sort_order: 20 },
  { diagram_type: 'technical_architecture', diagram_key: 'project/architecture-backbone', title: '技术架构图', fallbackSlug: '02-system-architecture', pageType: 'technical_architecture', sort_order: 30 },
  { diagram_type: 'product_architecture', diagram_key: 'project/product-architecture', title: '产品架构图', fallbackSlug: '03-product-architecture', pageType: 'product_architecture', sort_order: 40 },
  { diagram_type: 'business_domain', diagram_key: 'project/domain-map', title: '业务域知识图', fallbackSlug: '04-business-domain', pageType: 'business_domain', sort_order: 50 },
  { diagram_type: 'business_flow', diagram_key: 'project/main-flow', title: '业务总体流程图', fallbackSlug: '06-core-flows', pageType: 'business_flow', sort_order: 60 },
  { diagram_type: 'module_flow', diagram_key: 'project/module-flow', title: '模块流程图', fallbackSlug: '08-module-flow', pageType: 'module_flow', sort_order: 70 },
  { diagram_type: 'core_logic', diagram_key: 'project/key-sequence', title: '核心逻辑时序图', fallbackSlug: '07-key-sequence-diagrams', pageType: 'core_logic', sort_order: 80 },
  { diagram_type: 'database_er', diagram_key: 'project/database-entity-map', title: '数据库 ER 图', fallbackSlug: '05-db-schema-and-data-model', pageType: 'database_er', sort_order: 90 },
];
const DEEPWIKI_THREAD_LEVELS = new Set([
  'project_trunk',
  'domain',
  'core_thread',
  'branch_thread',
  'exception_thread',
  'frontend_journey',
]);
const DOC_WORKFLOW_MODES = {
  upload_existing: [
    'collect_inputs',
    'input_contract',
    'prd_gate',
    'tech_spec_gate',
    'coverage_graph',
    'test_plan_generate',
    'test_plan_gate',
    'publish',
  ],
  generate_tech_spec: [
    'collect_inputs',
    'input_contract',
    'prd_gate',
    'repo_context_build',
    'tech_spec_generate',
    'tech_spec_gate',
    'coverage_graph',
    'test_plan_generate',
    'test_plan_gate',
    'publish',
  ],
};
const DOC_REPO_SCAN_IGNORES = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.next',
  '.nuxt',
  '.turbo',
  '.venv',
  'vendor',
  'tmp',
  'temp',
]);
const OFFICIAL_PROJECT_CODES = [
  'F01', 'F02', 'F03', 'F04', 'F05',
  'G03', 'P05',
  'C01', 'C02', 'C03', 'C04', 'C05',
  'P01', 'P02', 'P03', 'P04', 'P06', 'P07', 'P08',
  'G01', 'G02', 'G04',
];
const ACCEPTANCE_CHECKPOINTS = [
  { key: '4_30_gate', label: '4/30 阶段一闸口', due_date: '2026-04-30' },
  { key: '5_31_check', label: '5/31 中间检查', due_date: '2026-05-31' },
  { key: '6_30_acceptance', label: '6/30 最终验收', due_date: '2026-06-30' },
];
const AI_RULES_CONTRACT_SOURCE_MAP = {
  'gate-execution-sync': 'ai-rules/contracts/gate_execution_sync.schema.json',
  prd_input: 'ai-rules/contracts/prd_input.schema.json',
  prd_output: 'ai-rules/contracts/prd_output.schema.json',
  tech_spec_input: 'ai-rules/contracts/tech_spec_input.schema.json',
  tech_spec_output: 'ai-rules/contracts/tech_spec_output.schema.json',
  test_plan_input: 'ai-rules/contracts/test_plan_input.schema.json',
  doc_gate_output: 'ai-rules/contracts/doc_gate_output.schema.json',
  pipeline_node_input: 'ai-rules/contracts/pipeline_node_input.schema.json',
  pipeline_node_output: 'ai-rules/contracts/pipeline_node_output.schema.json',
  value_assessment_record: 'ai-rules/contracts/value_assessment_record.schema.json',
};
const AI_RULES_PIPELINE_SOURCE_MAP = {
  'gate-review': 'ai-rules/pipelines/gate-review.json',
  'doc-pipeline-v1': 'ai-rules/pipelines/doc-pipeline-v1.json',
  'p01-tech-bug-loop-v1': 'ai-rules/pipelines/p01-tech-bug-loop-v1.json',
  'p02-test-automation-v1': 'ai-rules/pipelines/p02-test-automation-v1.json',
  'p03-ops-release-closure-v1': 'ai-rules/pipelines/p03-ops-release-closure-v1.json',
  'p04-pm-task-closure-v1': 'ai-rules/pipelines/p04-pm-task-closure-v1.json',
  'p05-product-value-evaluation-v1': 'ai-rules/pipelines/p05-product-value-evaluation-v1.json',
};
const AI_RULES_FOUNDATION_ASSET_KEYS = [
  'ka-ai-rules-readme',
  'ka-ai-manual-pm-v1',
  'ka-ai-manual-rd-v1',
  'ka-ai-manual-qa-v1',
  'ka-ai-prompt-gate-review-agent',
  'ka-ai-prompt-harness-node-executor',
  'ka-ai-contract-node-input',
  'ka-ai-contract-node-output',
  'ka-ai-contract-value-assessment',
  'ka-ai-pipeline-p01',
  'ka-ai-pipeline-p02',
  'ka-ai-pipeline-p03',
  'ka-ai-pipeline-p04',
  'ka-ai-pipeline-p05',
];
const DEEPWIKI_GLOBAL_QUERY_HINTS = ['整体', '全局', '总体', '架构', '业务域', '横向', '全链路', '概览', 'overview', 'global'];
const DEEPWIKI_LOCAL_QUERY_HINTS = ['接口', 'api', '表', '字段', 'service', 'controller', '类', '模块', '方法', 'endpoint'];

const logDir = path.join(__dirname, '../../logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.json(),
  transports: [new winston.transports.File({ filename: path.join(logDir, 'control-plane-db.log') })],
});

let pool = null;
let poolResetPromise = null;

const TRANSIENT_DB_ERROR_CODES = new Set([
  'EADDRNOTAVAIL',
  'ECONNRESET',
  'ECONNREFUSED',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EPIPE',
  'ETIMEDOUT',
  'PROTOCOL_CONNECTION_LOST',
  'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR',
  'PROTOCOL_ENQUEUE_AFTER_QUIT',
  'PROTOCOL_SEQUENCE_TIMEOUT',
]);

const DB_CONNECTION_LIMIT = Math.max(1, Number(process.env.DB_CONNECTION_LIMIT || 12));
const DB_MAX_IDLE = Math.max(1, Number(process.env.DB_MAX_IDLE || Math.min(DB_CONNECTION_LIMIT, 8)));
const DB_IDLE_TIMEOUT_MS = Math.max(1000, Number(process.env.DB_IDLE_TIMEOUT_MS || 60000));
const DB_RETRY_BACKOFF_MS = Math.max(50, Number(process.env.DB_RETRY_BACKOFF_MS || 250));

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildPoolConfig() {
  return {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'ai_gateway',
    charset: 'utf8mb4',
    timezone: '+08:00',
    ssl: false,
    insecureAuth: true,
    multipleStatements: true,
    waitForConnections: true,
    connectionLimit: DB_CONNECTION_LIMIT,
    maxIdle: DB_MAX_IDLE,
    idleTimeout: DB_IDLE_TIMEOUT_MS,
    queueLimit: 0,
    connectTimeout: 30000,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
  };
}

function isTransientDbConnectionError(error) {
  const code = normalizeText(error?.code) || normalizeText(error?.errno) || normalizeText(error?.cause?.code);
  if (code && TRANSIENT_DB_ERROR_CODES.has(code)) {
    return true;
  }
  const message = normalizeText(error?.message || error?.cause?.message) || '';
  return /EADDRNOTAVAIL|ECONNRESET|PROTOCOL_CONNECTION_LOST|read EADDRNOTAVAIL/i.test(message);
}

function isRetrySafeQuery(sql) {
  const normalized = String(sql || '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*--.*$/gm, ' ')
    .trim()
    .toLowerCase();
  return /^(select|show|describe|desc|explain|with)\b/.test(normalized);
}

async function resetPool(reason, error) {
  if (poolResetPromise) {
    await poolResetPromise;
    return;
  }
  const currentPool = pool;
  pool = null;
  poolResetPromise = (async () => {
    if (!currentPool) {
      return;
    }
    logger.warn('resetting mysql pool', {
      reason,
      error_code: normalizeText(error?.code) || null,
      error_message: normalizeText(error?.message) || null,
    });
    try {
      await currentPool.end();
    } catch (closeError) {
      logger.warn('mysql pool close failed during reset', {
        reason,
        error_code: normalizeText(closeError?.code) || null,
        error_message: normalizeText(closeError?.message) || null,
      });
    }
  })();
  try {
    await poolResetPromise;
  } finally {
    poolResetPromise = null;
  }
}

function getPool() {
  if (!pool) {
    pool = mysql.createPool(buildPoolConfig());
  }
  return pool;
}

async function closePool() {
  await resetPool('manual close');
}

function parseJson(value, fallback = null) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function stringifyJson(value, fallback = '{}') {
  if (value == null) return fallback;
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function mapKnowledgeAssetRow(row) {
  if (!row) return null;
  return {
    ...row,
    metadata_json: parseJson(row.metadata_json, {}),
    latest_index_meta: parseJson(row.latest_index_meta, {}),
  };
}

function mapStandardNodeRow(row) {
  if (!row) return null;
  return {
    ...row,
    artifact_types_json: parseJson(row.artifact_types_json, []),
    input_contract_json: parseJson(row.input_contract_json, null),
    output_contract_json: parseJson(row.output_contract_json, null),
    rule_set_json: parseJson(row.rule_set_json, null),
    prompt_spec_json: parseJson(row.prompt_spec_json, null),
    trace_contract_json: parseJson(row.trace_contract_json, null),
    human_checkpoint_json: parseJson(row.human_checkpoint_json, null),
    acceptance_rule_json: parseJson(row.acceptance_rule_json, null),
  };
}

function mapCodeRepositoryRow(row) {
  if (!row) return null;
  return {
    ...row,
    metadata_json: parseJson(row.metadata_json, {}),
  };
}

function mapRepoContextRunRow(row) {
  if (!row) return null;
  return {
    ...row,
    summary_json: parseJson(row.summary_json, {}),
  };
}

function mapDocBundleContextRow(row) {
  if (!row) return null;
  return {
    ...row,
    knowledge_scope_json: parseJson(row.knowledge_scope_json, {}),
  };
}

function mapRepoSourceRow(row) {
  if (!row) return null;
  return {
    ...row,
    metadata_json: parseJson(row.metadata_json, {}),
  };
}

function mapRepoSnapshotRow(row) {
  if (!row) return null;
  return {
    ...row,
    manifest_json: parseJson(row.manifest_json, {}),
  };
}

function mapDeepWikiRunRow(row) {
  if (!row) return null;
  return {
    ...row,
    summary_json: buildDeepWikiSummaryState(parseJson(row.summary_json, {}), {
      status: row.status,
      current_stage: row.current_stage,
    }),
  };
}

function mapDeepWikiPageRow(row) {
  if (!row) return null;
  const metadata = parseJson(row.metadata_json, {});
  return {
    ...row,
    metadata_json: metadata,
    object_refs: Array.isArray(metadata.object_refs) ? metadata.object_refs.map((item) => Number(item)).filter(Number.isFinite) : [],
    object_keys: Array.isArray(metadata.object_keys) ? metadata.object_keys.map((item) => String(item || '')).filter(Boolean) : [],
  };
}

function mapWikiObjectRow(row) {
  if (!row) return null;
  return {
    ...row,
    payload_json: parseJson(row.payload_json, {}),
  };
}

function mapWikiEvidenceRow(row) {
  if (!row) return null;
  return {
    ...row,
    meta_json: parseJson(row.meta_json, {}),
  };
}

function mapWikiProjectRow(row) {
  if (!row) return null;
  return {
    ...row,
    owners_json: parseJson(row.owners_json, {}),
    metadata_json: parseJson(row.metadata_json, {}),
  };
}

function mapWikiProjectRepoRow(row) {
  if (!row) return null;
  return {
    ...row,
    metadata_json: parseJson(row.metadata_json, {}),
  };
}

function mapWikiSnapshotRow(row) {
  if (!row) return null;
  const mapped = {
    ...row,
    source_manifest_json: parseJson(row.source_manifest_json, {}),
    metadata_json: parseJson(row.metadata_json, {}),
    lineage_json: parseJson(row.lineage_json, {}),
  };
  const normalized = backfillSnapshotRecord(mapped);
  return {
    ...mapped,
    ...normalized,
  };
}

function mapWikiGenerationJobRow(row) {
  if (!row) return null;
  return {
    ...row,
    request_json: parseJson(row.request_json, {}),
    result_json: parseJson(row.result_json, {}),
    error_json: parseJson(row.error_json, {}),
  };
}

async function getGatewaySettings() {
  try {
    const rows = await query(
      `SELECT setting_key, setting_value
       FROM gateway_settings`
    );
    const mapped = {};
    for (const row of rows || []) {
      try {
        mapped[row.setting_key] = JSON.parse(row.setting_value);
      } catch {
        mapped[row.setting_key] = row.setting_value;
      }
    }
    return mapped;
  } catch (error) {
    if (/doesn't exist|不存在/i.test(error.message || '')) {
      return {};
    }
    throw error;
  }
}

function mapWikiQualityReportRow(row) {
  if (!row) return null;
  return {
    ...row,
    quality_json: parseJson(row.quality_json, {}),
  };
}

function mapWikiBranchRow(row) {
  if (!row) return null;
  return {
    ...row,
    metadata_json: parseJson(row.metadata_json, {}),
  };
}

function mapWikiBranchRepoMappingRow(row) {
  if (!row) return null;
  return {
    ...row,
    metadata_json: parseJson(row.metadata_json, {}),
  };
}

function mapWikiSnapshotRepoRevisionRow(row) {
  if (!row) return null;
  return {
    ...row,
    metadata_json: parseJson(row.metadata_json, {}),
  };
}

function mapWikiProjectSourceBindingRow(row) {
  if (!row) return null;
  return {
    ...row,
    metadata_json: parseJson(row.metadata_json, {}),
  };
}

function mapWikiSnapshotDocumentRevisionRow(row) {
  if (!row) return null;
  const metadata = parseJson(row.metadata_json, {});
  return {
    ...row,
    metadata_json: metadata,
    origin: normalizeText(metadata.origin) || null,
    confidence: Number.isFinite(Number(metadata.confidence)) ? Number(Number(metadata.confidence).toFixed(4)) : null,
    source_snapshot_id: Number.isFinite(Number(metadata.source_snapshot_id)) ? Number(metadata.source_snapshot_id) : null,
  };
}

function mapWikiSnapshotDiagramRow(row) {
  if (!row) return null;
  const metadata = parseJson(row.metadata_json, {});
  const scopeType = normalizeText(row.scope_type || metadata.scope_type) || 'project';
  return {
    ...row,
    metadata_json: metadata,
    render_source: normalizeText(metadata.render_source) || null,
    provider: normalizeText(metadata.provider) || null,
    model: normalizeText(metadata.model) || null,
    summary: normalizeText(metadata.diagram_summary || metadata.summary) || null,
    covered_evidence: Array.isArray(metadata.covered_evidence) ? metadata.covered_evidence.map((item) => String(item || '')).filter(Boolean) : [],
    missing_evidence: Array.isArray(metadata.missing_evidence) ? metadata.missing_evidence.map((item) => String(item || '')).filter(Boolean) : [],
    quality_notes: Array.isArray(metadata.quality_notes) ? metadata.quality_notes.map((item) => String(item || '')).filter(Boolean) : [],
    export_assets: metadata.export_assets && typeof metadata.export_assets === 'object' ? metadata.export_assets : {},
    diagram_key: normalizeText(row.diagram_key || metadata.diagram_key) || null,
    scope_type: scopeType,
    scope_key: normalizeText(row.scope_key || metadata.scope_key) || null,
    parent_scope_key: normalizeText(row.parent_scope_key || metadata.parent_scope_key) || null,
    sort_order: Number.isFinite(Number(row.sort_order)) ? Number(row.sort_order) : Number(metadata.sort_order || 0),
    diagram_group:
      scopeType === 'domain'
        ? 'domain'
        : scopeType === 'thread'
          ? 'thread'
          : scopeType === 'branch'
            ? 'branch'
            : 'project',
  };
}

function mapWikiConsistencyCheckRow(row) {
  if (!row) return null;
  return {
    ...row,
    detail_json: parseJson(row.detail_json, {}),
    evidence_json: parseJson(row.evidence_json, []),
  };
}

function mapWikiFlowRow(row) {
  if (!row) return null;
  return {
    ...row,
    preconditions_json: parseJson(row.preconditions_json, []),
    postconditions_json: parseJson(row.postconditions_json, []),
    evidence_json: parseJson(row.evidence_json, []),
  };
}

function mapWikiFlowStepRow(row) {
  if (!row) return null;
  return {
    ...row,
    evidence_json: parseJson(row.evidence_json, []),
  };
}

function mapWikiAssertionRow(row) {
  if (!row) return null;
  return {
    ...row,
    expected_result_json: parseJson(row.expected_result_json, {}),
    evidence_json: parseJson(row.evidence_json, []),
  };
}

function mapWikiScenarioRow(row) {
  if (!row) return null;
  return {
    ...row,
    input_fixture_json: parseJson(row.input_fixture_json, {}),
    expected_assertions_json: parseJson(row.expected_assertions_json, []),
  };
}

function mapWikiSemanticScoreRow(row) {
  if (!row) return null;
  return {
    ...row,
    detail_json: parseJson(row.detail_json, {}),
  };
}

function mapWikiCommunityReportRow(row) {
  if (!row) return null;
  return {
    ...row,
    object_ids_json: parseJson(row.object_ids_json, []),
    page_slugs_json: parseJson(row.page_slugs_json, []),
    metadata_json: parseJson(row.metadata_json, {}),
  };
}

function mapWikiThreadRow(row) {
  if (!row) return null;
  const metrics = parseJson(row.metrics_json, {});
  return {
    ...row,
    entry_points_json: parseJson(row.entry_points_json, []),
    steps_json: parseJson(row.steps_json, []),
    branch_points_json: parseJson(row.branch_points_json, []),
    domain_context_key: normalizeText(row.domain_context_key || metrics.domain_context_key) || null,
    behavior_key: normalizeText(row.behavior_key || metrics.behavior_key) || null,
    command_keys_json: parseJson(row.command_keys_json, metrics.command_keys_json || []),
    event_keys_json: parseJson(row.event_keys_json, metrics.event_keys_json || []),
    object_keys_json: parseJson(row.object_keys_json, []),
    repo_roles_json: parseJson(row.repo_roles_json, []),
    evidence_json: parseJson(row.evidence_json, []),
    metrics_json: metrics,
  };
}

function mapWikiQueryLogRow(row) {
  if (!row) return null;
  return {
    ...row,
    citations_json: parseJson(row.citations_json, []),
    trace_json: parseJson(row.trace_json, {}),
    metadata_json: parseJson(row.metadata_json, {}),
  };
}

function mapWikiFeedbackEventRow(row) {
  if (!row) return null;
  return {
    ...row,
    payload_json: parseJson(row.payload_json, {}),
    evidence_json: parseJson(row.evidence_json, []),
  };
}

function hashText(value = '') {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function normalizeProjectCode(value, fallback = 'deepwiki-project') {
  const normalized = String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9._/-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-/.]+|[-/.]+$/g, '')
    .toLowerCase();
  return normalized || fallback;
}

function deriveDeepWikiProjectCode(repoSource = {}, explicitCode = null) {
  return normalizeProjectCode(
    explicitCode ||
      repoSource?.metadata_json?.sync?.project_code ||
      repoSource?.metadata_json?.project_code ||
      repoSource?.repo_slug ||
      repoSource?.repo_url,
    'deepwiki-project'
  );
}

function deriveDeepWikiProjectName(repoSource = {}, explicitName = null) {
  return normalizeText(explicitName || repoSource?.metadata_json?.project_name || repoSource?.repo_slug || repoSource?.repo_url) || 'Deep Wiki 项目';
}

function inferDeepWikiRepoRole(repoSource = {}, explicitRole = '') {
  const normalizedExplicitRole = normalizeText(explicitRole).toLowerCase();
  if (normalizedExplicitRole) return normalizedExplicitRole;
  const fingerprint = [
    repoSource?.repo_slug,
    repoSource?.repo_url,
    repoSource?.metadata_json?.project_name,
  ].map((item) => normalizeText(item).toLowerCase()).join(' ');
  if (/(^|\b)(frontend|front-end|web|ui|client|h5|fe|portal|console|admin-ui)(\b|$)/.test(fingerprint)) {
    return 'frontend';
  }
  if (/(^|\b)(bff|gateway-bff|backend-for-frontend)(\b|$)/.test(fingerprint)) {
    return 'bff';
  }
  if (/(^|\b)(shared|common|lib|library|sdk|utils)(\b|$)/.test(fingerprint)) {
    return 'shared_lib';
  }
  if (/(^|\b)(test|qa|automation|autotest|playwright|cypress|e2e)(\b|$)/.test(fingerprint)) {
    return 'test_automation';
  }
  if (/(^|\b)(infra|ops|deploy|helm|terraform|iac|k8s)(\b|$)/.test(fingerprint)) {
    return 'infra';
  }
  return 'backend';
}

function buildDeepWikiSnapshotVersion(branch, commitSha) {
  const safeBranch = normalizeText(branch || 'main').replace(/[^a-zA-Z0-9._/-]+/g, '-');
  const shortCommit = normalizeText(commitSha).slice(0, 12) || hashText(safeBranch).slice(0, 12);
  return `${safeBranch}@${shortCommit}`;
}

function inferWorkspaceRoot() {
  const candidates = [
    process.env.AIPLAN_WORKSPACE_ROOT,
    path.resolve(__dirname, '../../../../../'),
    path.resolve(process.cwd(), '../../..'),
    path.resolve(process.cwd(), '../..'),
  ].filter(Boolean);

  return (
    candidates.find((candidate) => fs.existsSync(path.join(candidate, 'projects', 'ai-platform'))) ||
    candidates[0] ||
    path.resolve(__dirname, '../../../../../')
  );
}

function resolveWorkspacePath(filePath) {
  if (!filePath) return null;
  const candidates = [filePath];
  const workspaceRoot = inferWorkspaceRoot();
  if (!path.isAbsolute(filePath)) {
    candidates.push(path.resolve(workspaceRoot, filePath));
    candidates.push(path.resolve(process.cwd(), filePath));
  } else if (filePath.startsWith('/docs/')) {
    candidates.push(path.resolve(workspaceRoot, filePath.slice(1)));
  }
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function toWorkspaceRelativePath(filePath) {
  const normalized = normalizeText(filePath);
  if (!normalized) return null;
  if (!path.isAbsolute(normalized)) {
    return normalized.replace(/\\/g, '/');
  }
  const workspaceRoot = inferWorkspaceRoot();
  const relativePath = path.relative(workspaceRoot, normalized).replace(/\\/g, '/');
  if (!relativePath || relativePath.startsWith('..')) {
    return normalized;
  }
  return relativePath;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function getDeepWikiStorageRoot() {
  const root = path.join(inferWorkspaceRoot(), 'projects', 'ai-platform', 'storage');
  ensureDir(root);
  ensureDir(path.join(root, 'deepwiki'));
  ensureDir(path.join(root, 'repos-cache'));
  ensureDir(path.join(root, 'repos-worktree'));
  return root;
}

function readTextIfExists(filePath) {
  const resolved = resolveWorkspacePath(filePath);
  if (!resolved) return null;
  try {
    return fs.readFileSync(resolved, 'utf8');
  } catch {
    return null;
  }
}

function normalizeText(value) {
  return String(value || '')
    .replace(/\r/g, '')
    .replace(/\u00a0/g, ' ')
    .trim();
}

function uniqueStrings(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function tokenizeSearchText(value) {
  const text = normalizeText(value).toLowerCase();
  const alphaTokens = text.match(/[a-z0-9_./:-]{2,64}/g) || [];
  const cjkChars = [...text].filter((char) => char >= '\u4e00' && char <= '\u9fff');
  return uniqueStrings([...alphaTokens, ...cjkChars]);
}

function rankTextAgainstQuery(query, text) {
  const queryTokens = tokenizeSearchText(query);
  const textTokens = new Set(tokenizeSearchText(text));
  if (!queryTokens.length || !textTokens.size) return 0;
  let overlap = 0;
  queryTokens.forEach((token) => {
    if (textTokens.has(token)) overlap += 1;
  });
  const normalized = overlap / Math.max(1, queryTokens.length);
  return Number(normalized.toFixed(4));
}

function buildDeepWikiObjectSearchText(object = {}) {
  const payload = getRecordLike(parseJson(object.payload_json, object.payload_json || {}), {});
  return [
    object.title,
    object.object_key,
    object.object_type,
    payload.domain_key,
    payload.domain_label,
    payload.domain_tier,
    ...(Array.isArray(payload.ubiquitous_language) ? payload.ubiquitous_language : []),
    ...(Array.isArray(payload.aggregates) ? payload.aggregates : []),
    ...(Array.isArray(payload.behaviors) ? payload.behaviors.map((item) => item.title || item.behavior_key) : []),
    ...(Array.isArray(payload.source_symbols) ? payload.source_symbols : []),
    ...(Array.isArray(payload.source_apis) ? payload.source_apis : []),
    ...(Array.isArray(payload.source_tables) ? payload.source_tables : []),
    payload.detail?.service_name,
    payload.detail?.feature_name,
    payload.detail?.table_name,
    payload.detail?.path,
    payload.detail?.method,
  ]
    .filter(Boolean)
    .join(' ');
}

function sourceFileExists(sourceRef) {
  const resolved = resolveWorkspacePath(sourceRef);
  return Boolean(resolved && fs.existsSync(resolved));
}

function normalizeDateValue(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function decorateSourceRef(row, sourceRef) {
  if (!row) return row;
  const finalSourceRef = normalizeText(sourceRef) || null;
  return {
    ...row,
    source_ref: finalSourceRef,
    source_exists: finalSourceRef ? sourceFileExists(finalSourceRef) : false,
  };
}

function mapPipelineNodeTraceRow(row) {
  if (!row) return null;
  return {
    ...row,
    input_payload: parseJson(row.input_payload, null),
    output_payload: parseJson(row.output_payload, null),
    retrieval_context: parseJson(row.retrieval_context, []),
    evidence_refs: parseJson(row.evidence_refs, []),
  };
}

function mapApprovalTaskRow(row) {
  if (!row) return null;
  return {
    ...row,
    approval_context: parseJson(row.approval_context, {}),
  };
}

function mapIntegrationConnectionRow(row) {
  if (!row) return null;
  return {
    ...row,
    metadata_json: parseJson(row.metadata_json, {}),
  };
}

function mapValueAssessmentRow(row) {
  if (!row) return null;
  return {
    ...row,
    metadata_json: parseJson(row.metadata_json, {}),
  };
}

function mapCertificationRecordRow(row) {
  if (!row) return null;
  return {
    ...row,
    metadata_json: parseJson(row.metadata_json, {}),
  };
}

function mapMilestoneRow(row) {
  if (!row) return null;
  return {
    ...row,
    metadata_json: parseJson(row.metadata_json, {}),
  };
}

function normalizeDeepWikiSourceType(value, fallback = 'repo') {
  const normalized = normalizeText(value).toLowerCase().replace(/-/g, '_');
  if (DEEPWIKI_SOURCE_TYPES.has(normalized)) return normalized;
  return fallback;
}

function normalizeDeepWikiDiagramType(value, fallback = 'overview') {
  const normalized = normalizeText(value).toLowerCase().replace(/-/g, '_');
  if (DEEPWIKI_DIAGRAM_TYPES.has(normalized)) return normalized;
  return fallback;
}

function inferDocumentSourceType(artifactType = '') {
  const normalized = normalizeText(artifactType).toLowerCase();
  if (!normalized) return 'review';
  if (normalized.startsWith('prd')) return 'prd';
  if (normalized.startsWith('tech_spec')) return 'tech_spec';
  if (normalized.startsWith('test_plan')) return 'test_asset';
  if (normalized === 'api_contract') return 'api_contract';
  if (normalized === 'ddl') return 'ddl';
  return 'review';
}

function inferDiagramTypeFromPage(page = {}) {
  const pageMeta = getRecordLike(page.metadata_json, {});
  const metaType = normalizeDeepWikiDiagramType(pageMeta.diagram_type, '');
  if (metaType) return metaType;
  const slug = normalizeText(page.page_slug).toLowerCase();
  const pageType = normalizeText(page.page_type).toLowerCase().replace(/-/g, '_');
  if (slug.includes('wiki-knowledge-graph') || slug.includes('wiki-overview')) return 'overview';
  if (slug.includes('code-layered-architecture') || pageType === 'code_layered_architecture') {
    return 'code_layered_architecture';
  }
  if (slug.includes('system-architecture') || pageType === 'system_architecture') return 'technical_architecture';
  if (slug.includes('product-architecture') || pageType === 'product_architecture') return 'product_architecture';
  if (slug.includes('business-domain') || pageType === 'business_domain') return 'business_domain';
  if (slug.includes('core-flow') || pageType === 'core_flow') return 'business_flow';
  if (slug.includes('module-flow') || pageType === 'module_flow') return 'module_flow';
  if (slug.includes('sequence') || slug.includes('core-logic') || pageType === 'sequence') return 'core_logic';
  if (slug.includes('database-er') || slug.includes('data-model') || pageType === 'database_er' || pageType === 'db_schema_and_data_model') {
    return 'database_er';
  }
  return 'overview';
}

function getDeepWikiDiagramDefaults(diagramType) {
  const normalized = normalizeDeepWikiDiagramType(diagramType);
  const titles = {
    overview: '总图',
    code_layered_architecture: '代码分层架构图',
    product_architecture: '产品架构图',
    technical_architecture: '技术架构图',
    business_domain: '业务域知识图',
    business_flow: '业务总体流程图',
    module_flow: '模块流程图',
    core_logic: '核心逻辑时序图',
    database_er: '数据库 ER 图',
  };
  return {
    diagram_type: normalized,
    title: titles[normalized] || normalized,
  };
}

function normalizeDeepWikiScopeType(value, fallback = 'project') {
  const normalized = normalizeText(value).toLowerCase().replace(/-/g, '_');
  if (['project', 'domain', 'thread', 'branch'].includes(normalized)) return normalized;
  return fallback;
}

function inferDiagramKeyFromPage(page = {}) {
  const pageMeta = getRecordLike(page.metadata_json, {});
  if (normalizeText(pageMeta.diagram_key)) {
    return normalizeText(pageMeta.diagram_key);
  }
  const spec = DEEPWIKI_PROJECT_DIAGRAM_SPECS.find((item) => item.fallbackSlug === normalizeText(page.page_slug));
  if (spec) return spec.diagram_key;
  const slug = normalizeText(page.page_slug).replace(/^diagrams\//, '');
  return slug ? `project/${slug}` : null;
}

function inferDiagramScopeFromPage(page = {}) {
  const pageMeta = getRecordLike(page.metadata_json, {});
  const diagramKey = inferDiagramKeyFromPage(page);
  return {
    diagram_key: normalizeText(diagramKey) || null,
    scope_type: normalizeDeepWikiScopeType(pageMeta.scope_type, diagramKey?.startsWith('thread/') ? 'thread' : diagramKey?.startsWith('domain/') ? 'domain' : 'project'),
    scope_key: normalizeText(pageMeta.scope_key) || (diagramKey?.startsWith('thread/') ? diagramKey.split('/')[1] : diagramKey?.startsWith('domain/') ? diagramKey.split('/')[1] : 'project'),
    parent_scope_key: normalizeText(pageMeta.parent_scope_key) || null,
    sort_order: Number.isFinite(Number(pageMeta.sort_order)) ? Number(pageMeta.sort_order) : 0,
  };
}

function extractMermaidSource(content) {
  const text = String(content || '');
  const fenced = text.match(/```mermaid\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();
  return text.trim();
}

function inferWorkflowMode(bundleContext) {
  return normalizeText(bundleContext?.workflow_mode) || 'upload_existing';
}

function getWorkflowStages(workflowMode) {
  return DOC_WORKFLOW_MODES[workflowMode] || DOC_WORKFLOW_MODES.upload_existing;
}

function getRequiredArtifactsForMode(workflowMode) {
  return workflowMode === 'generate_tech_spec' ? ['prd'] : ['prd', 'tech_spec'];
}

function getRecommendedArtifactsForMode(_workflowMode) {
  return ['api_contract', 'ddl'];
}

function sanitizeKnowledgeScope(value) {
  const raw = value && typeof value === 'object' ? value : {};
  return {
    asset_categories: uniqueStrings(Array.isArray(raw.asset_categories) ? raw.asset_categories.map((item) => normalizeText(item)) : []),
    domains: uniqueStrings(Array.isArray(raw.domains) ? raw.domains.map((item) => normalizeText(item)) : []),
    modules: uniqueStrings(Array.isArray(raw.modules) ? raw.modules.map((item) => normalizeText(item)) : []),
    knowledge_asset_ids: uniqueStrings(Array.isArray(raw.knowledge_asset_ids) ? raw.knowledge_asset_ids.map((item) => Number(item)).filter((item) => Number.isFinite(item)) : []),
    asset_keys: uniqueStrings(Array.isArray(raw.asset_keys) ? raw.asset_keys.map((item) => normalizeText(item)) : []),
  };
}

function chooseLatestDocument(documents, keys = []) {
  return keys
    .map((key) => documents[key])
    .filter(Boolean)
    .sort((left, right) => new Date(right.created_at || 0) - new Date(left.created_at || 0))[0] || null;
}

function truncateText(value, maxLength = 600) {
  const text = normalizeText(value);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}...`;
}

function hasAnyPattern(text, patterns) {
  return (patterns || []).some((pattern) => new RegExp(pattern, 'i').test(text));
}

function buildChecks(text, specs) {
  return specs.map((spec) => ({
    key: spec.key,
    label: spec.label,
    status: hasAnyPattern(text, spec.patterns) ? 'pass' : spec.required === false ? 'warn' : 'block',
    required: spec.required !== false,
  }));
}

function scoreChecks(checks) {
  const total = checks.length || 1;
  const passed = checks.filter((check) => check.status === 'pass').length;
  return Number(((passed / total) * 100).toFixed(2));
}

function aggregateGateStatus(checks, options = {}) {
  const blockKeys = new Set(options.blockKeys || []);
  if (checks.some((check) => check.status === 'block' && (blockKeys.size === 0 || blockKeys.has(check.key)))) {
    return 'block';
  }
  if (checks.some((check) => check.status !== 'pass')) {
    return 'warn';
  }
  return 'pass';
}

function mergeStatuses(...statuses) {
  if (statuses.includes('block')) return 'block';
  if (statuses.includes('warn')) return 'warn';
  return 'pass';
}

function clampScore(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(100, Number(number.toFixed(2))));
}

function dedupeList(values) {
  return uniqueStrings((values || []).map((item) => normalizeText(item)).filter(Boolean));
}

function extractJsonPayload(text) {
  const normalized = normalizeText(text);
  if (!normalized) return null;
  const fenced = normalized.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : normalized;
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function resolveKnowledgeFilters(gateType, bundle, documents, bundleContext) {
  const filters = {};
  const knowledgeScope = sanitizeKnowledgeScope(bundleContext?.knowledge_scope_json);
  if (bundle?.domain) filters.domain = bundle.domain;
  if (bundle?.module_name) filters.module = bundle.module_name;
  if (documents?.api_contract) filters.asset_category = 'DDL/接口契约类';
  if (gateType === 'prd_gate') filters.asset_category = '样板类';
  if (gateType === 'tech_spec_gate') filters.asset_category = '提示词/规则类';
  if (gateType === 'test_plan_gate') filters.asset_category = '规范类';
  if (knowledgeScope.asset_categories[0]) filters.asset_category = knowledgeScope.asset_categories[0];
  if (knowledgeScope.domains[0]) filters.domain = knowledgeScope.domains[0];
  if (knowledgeScope.modules[0]) filters.module = knowledgeScope.modules[0];
  return filters;
}

function buildGateKnowledgeQuery(gateType, bundle, documents, candidateText = '') {
  const snippets = [
    documents?.prd?.content_text,
    documents?.tech_spec?.content_text,
    documents?.api_contract?.content_text,
    documents?.ddl?.content_text,
    candidateText,
  ]
    .map((item) => truncateText(item, 300))
    .filter(Boolean)
    .join('\n');

  const queryPrefixes = {
    input_contract: '检查文档齐套、引用契约与 DDL、主流程逆向流程状态机是否完整',
    prd_gate: '检查 PRD 正向主流程、逆向流程、状态机、字段规则、范围界定',
    tech_spec_gate: '检查技术方案 API 入口、表字段职责、子流程边界、接口契约与 DDL 引用一致性',
    test_plan_gate: '检查测试方案 coverage obligation、追溯矩阵、字段级 DB 断言、逆向流程覆盖',
  };
  return `${queryPrefixes[gateType] || '检查文档门禁引用'}\n模块：${bundle?.module_name || bundle?.title || '未命名'}\n${snippets}`;
}

async function listKnowledgeAssetsByKeys(assetKeys = []) {
  if (!assetKeys.length) return [];
  const placeholders = assetKeys.map(() => '?').join(', ');
  const rows = await query(
    `SELECT *
     FROM gateway_knowledge_assets
     WHERE asset_key IN (${placeholders})
     ORDER BY FIELD(asset_key, ${placeholders})`,
    [...assetKeys, ...assetKeys]
  );
  return rows.map(mapKnowledgeAssetRow);
}

async function searchKnowledgeBase({ gateType, bundle, documents, bundleContext, candidateText, minResults = 1 }) {
  const knowledgeBaseUrl = (process.env.KNOWLEDGE_BASE_SEARCH_URL || '').trim();
  const knowledgeScope = sanitizeKnowledgeScope(bundleContext?.knowledge_scope_json);
  const scopedAssets = knowledgeScope.knowledge_asset_ids.length
    ? await listKnowledgeAssets({ ids: knowledgeScope.knowledge_asset_ids })
    : [];
  const hintedAssets = scopedAssets.length
    ? scopedAssets
    : await listKnowledgeAssetsByKeys(GATE_TYPE_KNOWLEDGE_ASSET_HINTS[gateType] || []);
  const queryText = buildGateKnowledgeQuery(gateType, bundle, documents, candidateText);
  const filters = resolveKnowledgeFilters(gateType, bundle, documents, bundleContext);
  const projectCode = bundle?.project_code || 'C04';
  const traceId = bundle?.trace_id || null;
  const allowedAssetIds = new Set(knowledgeScope.knowledge_asset_ids);

  if (!knowledgeBaseUrl) {
    return {
      status: 'warn',
      disabled_reason: 'KNOWLEDGE_BASE_SEARCH_URL not configured',
      query_text: queryText,
      result_count: 0,
      citations: hintedAssets.map((asset) => ({
        knowledge_asset_id: asset.id,
        asset_key: asset.asset_key,
        name: asset.name,
        source_uri: asset.source_uri || '',
        source: 'registry_fallback',
        score: null,
        reason: '使用知识资产目录回退引用',
        excerpt: '',
      })),
    };
  }

  try {
    const searchOptions = {
      timeout: Number(process.env.KNOWLEDGE_BASE_TIMEOUT_MS || 12000),
      headers: { 'Content-Type': 'application/json' },
    };
    const basePayload = {
      query: queryText,
      collection: DEFAULT_KNOWLEDGE_COLLECTION,
      top_k: 3,
      trace_id: traceId,
      project_code: projectCode,
    };
    const mapResultsToCitations = (results) =>
      results
        .filter((result) => {
          if (!allowedAssetIds.size) return true;
          const assetId = Number(result.metadata?.knowledge_asset_id);
          return Number.isFinite(assetId) && allowedAssetIds.has(assetId);
        })
        .map((result) => ({
          knowledge_asset_id: result.metadata?.knowledge_asset_id ?? null,
          asset_key: normalizeText(result.metadata?.asset_key) || 'unknown_asset',
          name: normalizeText(result.metadata?.asset_name) || normalizeText(result.metadata?.title) || '未知资产',
          source_uri: normalizeText(result.metadata?.source_uri),
          source: 'knowledge_base',
          score: Number.isFinite(result.score) ? Number(result.score) : null,
          reason: '知识库语义检索命中',
          excerpt: truncateText(result.text, 180),
        }));
    const executeSearch = async (searchFilters, minScore = Number(process.env.KNOWLEDGE_BASE_MIN_SCORE || 0.2)) => {
      const response = await axios.post(
        knowledgeBaseUrl,
        {
          ...basePayload,
          min_score: minScore,
          filters: searchFilters,
        },
        searchOptions
      );
      const results = Array.isArray(response.data?.results) ? response.data.results : [];
      return {
        latency_ms: response.data?.latency_ms || null,
        results,
        citations: mapResultsToCitations(results),
      };
    };

    let searchResult = await executeSearch(filters);
    if (searchResult.citations.length < minResults && (filters.module || filters.domain)) {
      const relaxedFilters = { ...filters };
      delete relaxedFilters.module;
      delete relaxedFilters.domain;
      searchResult = await executeSearch(relaxedFilters);
    }
    if (searchResult.citations.length < minResults && filters.asset_category) {
      searchResult = await executeSearch({});
    }
    if (searchResult.citations.length < minResults) {
      searchResult = await executeSearch({}, 0);
    }

    await logRagQuery({
      trace_id: traceId,
      project_code: projectCode,
      knowledge_asset_id: searchResult.citations[0]?.knowledge_asset_id || null,
      query_text: queryText,
      result_count: searchResult.citations.length,
      latency_ms: searchResult.latency_ms,
    });

    if (searchResult.citations.length >= minResults) {
      return {
        status: 'pass',
        disabled_reason: null,
        query_text: queryText,
        result_count: searchResult.citations.length,
        citations: searchResult.citations,
      };
    }

    return {
      status: 'warn',
      disabled_reason: '知识库返回结果不足，已回退到资产目录引用',
      query_text: queryText,
      result_count: searchResult.citations.length,
      citations: searchResult.citations.length ? searchResult.citations : hintedAssets.map((asset) => ({
        knowledge_asset_id: asset.id,
        asset_key: asset.asset_key,
        name: asset.name,
        source_uri: asset.source_uri || '',
        source: 'registry_fallback',
        score: null,
        reason: '知识库结果不足，回退到资产目录引用',
        excerpt: '',
      })),
    };
  } catch (error) {
    return {
      status: 'warn',
      disabled_reason: `知识库检索失败：${error.message}`,
      query_text: queryText,
      result_count: 0,
      citations: hintedAssets.map((asset) => ({
        knowledge_asset_id: asset.id,
        asset_key: asset.asset_key,
        name: asset.name,
        source_uri: asset.source_uri || '',
        source: 'registry_fallback',
        score: null,
        reason: '知识库不可用，回退到资产目录引用',
        excerpt: '',
      })),
    };
  }
}

let cachedPromptApiKey = undefined;

async function getPromptApiKey() {
  if (cachedPromptApiKey !== undefined) {
    return cachedPromptApiKey;
  }
  if (process.env.DOC_GATE_API_KEY) {
    cachedPromptApiKey = process.env.DOC_GATE_API_KEY;
    return cachedPromptApiKey;
  }
  const rows = await query(
    `SELECT api_key
     FROM gateway_api_keys
     WHERE status = 'active'
     ORDER BY id ASC
     LIMIT 1`
  );
  cachedPromptApiKey = rows[0]?.api_key || null;
  return cachedPromptApiKey;
}

function promptGateEnabled() {
  return String(process.env.DOC_GATE_PROMPT_ENABLED || 'true').toLowerCase() !== 'false';
}

function buildPromptChecklist(gateType) {
  const specs = {
    input_contract: [
      '是否同时具备 PRD、技术方案、接口契约、DDL 或明确引用方式',
      'PRD 是否提供主流程、逆向流程、状态机',
      '技术方案是否提供 API 入口、字段职责、子流程边界、查库点',
    ],
    prd_gate: [
      '是否包含正向主流程',
      '是否包含逆向/驳回/作废等逆向链路',
      '是否包含状态机和关键合法/非法迁移',
      '是否包含角色权限边界、提示语、字段业务规则、不在范围',
    ],
    tech_spec_gate: [
      '是否包含 Controller/API 入口',
      '是否包含 Service 编排节点和调用顺序',
      '是否包含表/字段职责、幂等补偿、子流程边界、查库点',
      '是否正确引用接口契约和 DDL',
    ],
    test_plan_gate: [
      '是否可由测试人员逐步执行',
      '是否覆盖正向与逆向流程',
      '是否覆盖状态迁移、关键接口、字段级 DB 断言、子流程边界、公式/CAL',
      '是否证明 Coverage Graph 义务已绑定到测试用例',
    ],
  };
  return specs[gateType] || [];
}

function buildPromptPayload({ gateType, bundle, documents, candidateText, ruleResult, coverageGraph }) {
  const docSnippets = Object.entries(documents || {})
    .filter(([, doc]) => doc?.content_text)
    .reduce((acc, [key, doc]) => {
      acc[key] = truncateText(doc.content_text, 2200);
      return acc;
    }, {});

  return {
    gate_type: gateType,
    bundle: {
      code: bundle?.bundle_code,
      title: bundle?.title,
      module_name: bundle?.module_name,
      version_label: bundle?.version_label,
    },
    checklist: buildPromptChecklist(gateType),
    rule_result: {
      status: ruleResult.status,
      score: ruleResult.score,
      summary: ruleResult.summary,
      failed_or_warn_checks: (ruleResult.checks || [])
        .filter((item) => item.status !== 'pass')
        .map((item) => ({ key: item.key, label: item.label, status: item.status })),
    },
    coverage_graph: coverageGraph
      ? {
          missing_coverage_items: coverageGraph.missing_coverage_items || [],
          unbound_case_items: coverageGraph.unbound_case_items || [],
          uninferable_items: coverageGraph.uninferable_items || [],
          obligations: (coverageGraph.graph_json?.coverage_obligations || []).slice(0, 30),
        }
      : null,
    candidate_excerpt: candidateText ? truncateText(candidateText, 3000) : null,
    documents: docSnippets,
    output_contract: {
      format: 'json',
      fields: [
        'status(pass|warn|block)',
        'summary(string)',
        'score(number 0-100)',
        'checks(array of {key,label,status,evidence})',
        'missing_inputs(string[])',
        'risk_items(string[])',
        'uninferable_items(string[])',
        'citations(array of knowledge assets)',
        'evaluator_meta(object)',
      ],
    },
  };
}

async function runPromptGateReview({ gateType, bundle, documents, candidateText, ruleResult, coverageGraph }) {
  if (!promptGateEnabled()) {
    return {
      disabled: true,
      reason: 'DOC_GATE_PROMPT_ENABLED=false',
    };
  }

  const apiKey = await getPromptApiKey();
  if (!apiKey) {
    return {
      disabled: true,
      reason: 'No active API key available for prompt evaluator',
    };
  }

  const endpoint =
    process.env.DOC_GATE_PROMPT_URL || 'http://127.0.0.1:3001/v1/chat/completions';
  const model = process.env.DOC_GATE_PROMPT_MODEL || 'qwen3.6-plus';
  const payload = buildPromptPayload({
    gateType,
    bundle,
    documents,
    candidateText,
    ruleResult,
    coverageGraph,
  });

  try {
    const response = await axios.post(
      endpoint,
      {
        model,
        temperature: 0.1,
        max_tokens: Number(process.env.DOC_GATE_PROMPT_MAX_TOKENS || 1200),
        stream: false,
        response_format: { type: 'json_object' },
        metadata: {
          client: 'control-plane-doc-gate',
          source: 'control-plane',
          purpose: `doc-${gateType}`,
          project_code: bundle?.project_code || 'C04',
          artifact_type: gateType,
        },
        messages: [
          {
            role: 'system',
            content:
              '你是企业内部的严格文档门禁评审器。你只能依据输入内容做判断，不能脑补不存在的信息。请输出严格 JSON，不要输出解释性文字。',
          },
          {
            role: 'user',
            content: JSON.stringify(payload, null, 2),
          },
        ],
      },
      {
        timeout: Number(process.env.DOC_GATE_PROMPT_TIMEOUT_MS || 30000),
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'X-AI-Gateway-Client': 'control-plane',
        },
      }
    );

    const content =
      response.data?.choices?.[0]?.message?.content ||
      response.data?.choices?.[0]?.text ||
      '';
    const parsed = extractJsonPayload(content);
    if (!parsed) {
      return {
        disabled: true,
        reason: 'Prompt evaluator returned non-JSON content',
      };
    }

    return {
      status: ['pass', 'warn', 'block'].includes(parsed.status) ? parsed.status : 'warn',
      score: clampScore(parsed.score),
      summary: normalizeText(parsed.summary) || 'Prompt evaluator completed without summary',
      checks: Array.isArray(parsed.checks)
        ? parsed.checks.map((check, index) => ({
            key: normalizeText(check.key) || `prompt_check_${index + 1}`,
            label: normalizeText(check.label) || `Prompt 检查项 ${index + 1}`,
            status: ['pass', 'warn', 'block'].includes(check.status) ? check.status : 'warn',
            evidence: normalizeText(check.evidence),
            source: 'prompt',
          }))
        : [],
      missing_inputs: dedupeList(parsed.missing_inputs),
      risk_items: dedupeList(parsed.risk_items),
      uninferable_items: dedupeList(parsed.uninferable_items),
      citations: Array.isArray(parsed.citations)
        ? parsed.citations.map((item) => ({
            knowledge_asset_id: item.knowledge_asset_id ?? null,
            asset_key: normalizeText(item.asset_key) || 'prompt_citation',
            name: normalizeText(item.name) || normalizeText(item.asset_key) || 'Prompt 引用',
            source_uri: normalizeText(item.source_uri),
            source: normalizeText(item.source) || 'prompt',
            score: Number.isFinite(item.score) ? Number(item.score) : null,
            reason: normalizeText(item.reason) || 'Prompt evaluator citation',
            excerpt: truncateText(item.excerpt, 180),
          }))
        : [],
      evaluator_meta: parsed.evaluator_meta && typeof parsed.evaluator_meta === 'object'
        ? parsed.evaluator_meta
        : null,
    };
  } catch (error) {
    logger.warn('prompt gate review failed', {
      gateType,
      message: error.message,
      endpoint,
    });
    return {
      disabled: true,
      reason: `Prompt evaluator failed: ${error.message}`,
    };
  }
}

function mergeGateResult(ruleResult, promptResult, extras = {}) {
  const mergedChecks = [
    ...(ruleResult.checks || []).map((check) => ({ ...check, source: 'rule' })),
    ...(promptResult?.checks || []),
  ];
  const statuses = [ruleResult.status];
  if (promptResult && !promptResult.disabled) {
    statuses.push(promptResult.status);
  }
  if (extras.forceStatus) {
    statuses.push(extras.forceStatus);
  }

  const status = mergeStatuses(...statuses);
  const scores = [ruleResult.score];
  if (promptResult && !promptResult.disabled && Number.isFinite(promptResult.score)) {
    scores.push(promptResult.score);
  }

  return {
    status,
    score: clampScore(scores.reduce((sum, item) => sum + Number(item || 0), 0) / Math.max(scores.length, 1)),
    summary: [
      ruleResult.summary,
      promptResult?.disabled
        ? `Prompt 评审已降级：${promptResult.reason}`
        : promptResult?.summary
          ? `Prompt 评审：${promptResult.summary}`
          : null,
      extras.summary,
    ]
      .filter(Boolean)
      .join('；'),
    checks: mergedChecks,
    missing_inputs: dedupeList([
      ...(ruleResult.missing_inputs || []),
      ...(promptResult?.missing_inputs || []),
      ...(extras.missing_inputs || []),
    ]),
    risk_items: dedupeList([
      ...(ruleResult.risk_items || []),
      ...(promptResult?.risk_items || []),
      ...(extras.risk_items || []),
      ...(promptResult?.disabled ? [promptResult.reason] : []),
    ]),
    uninferable_items: dedupeList([
      ...(ruleResult.uninferable_items || []),
      ...(promptResult?.uninferable_items || []),
      ...(extras.uninferable_items || []),
    ]),
    missing_coverage_items: dedupeList(extras.missing_coverage_items || []),
    unbound_case_items: dedupeList(extras.unbound_case_items || []),
    citations: [
      ...(promptResult?.citations || []),
      ...(extras.citations || []),
    ].filter((item, index, arr) =>
      arr.findIndex((candidate) =>
        candidate.asset_key === item.asset_key &&
        candidate.source_uri === item.source_uri &&
        candidate.reason === item.reason
      ) === index
    ),
    evaluator_meta: {
      rule: ruleResult,
      prompt: promptResult?.disabled
        ? { disabled: true, reason: promptResult.reason }
        : promptResult || null,
      coverage: extras.coverage || null,
      knowledge: extras.knowledge || null,
    },
  };
}

function summarizeChecks(checks) {
  const missing = checks.filter((check) => check.status !== 'pass').map((check) => check.label);
  if (!missing.length) {
    return '全部关键检查项通过';
  }
  return `缺失或风险项：${missing.join('、')}`;
}

async function buildKnowledgeExtras({ gateType, context, candidateText }) {
  const knowledge = await searchKnowledgeBase({
    gateType,
    bundle: context.bundle,
    documents: context.documents,
    bundleContext: context.bundle_context,
    candidateText,
    minResults: 1,
  });
  return {
    forceStatus: knowledge.status === 'warn' ? 'warn' : null,
    risk_items: knowledge.disabled_reason ? [knowledge.disabled_reason] : [],
    citations: knowledge.citations || [],
    knowledge: {
      status: knowledge.status,
      disabled_reason: knowledge.disabled_reason || null,
      query_text: knowledge.query_text,
      result_count: knowledge.result_count || 0,
      collection: DEFAULT_KNOWLEDGE_COLLECTION,
    },
  };
}

function extractMethodPaths(text) {
  const matches = normalizeText(text).match(/\b(?:GET|POST|PUT|DELETE|PATCH)\s+\/[A-Za-z0-9/_{}.:?-]+/g) || [];
  return uniqueStrings(matches);
}

function extractBacktickedFields(text) {
  const fieldMatches = [...normalizeText(text).matchAll(/`([a-zA-Z_][a-zA-Z0-9_]*)`/g)].map((match) => match[1]);
  return uniqueStrings(fieldMatches).slice(0, 80);
}

function buildCoverageGraphFromTexts(documents) {
  const prdText = normalizeText(documents.prd?.content_text);
  const techText = normalizeText(documents.tech_spec?.content_text);
  const apiText = normalizeText(documents.api_contract?.content_text);
  const ddlText = normalizeText(documents.ddl?.content_text);
  const combinedText = [prdText, techText, apiText, ddlText].filter(Boolean).join('\n');

  const flowCatalog = [
    { id: 'flow_draft_submit', name: '草稿与提交闭环', patterns: ['草稿', '提交'] },
    { id: 'flow_approve_reject', name: '审核/驳回闭环', patterns: ['审核', '驳回'] },
    { id: 'flow_sale_out_draft', name: '转出库草稿闭环', patterns: ['转出库', '草稿'] },
    { id: 'flow_confirm_writeback', name: '销售出库 confirm 回写闭环', patterns: ['confirm', '回写', '已出库', '出库确认'] },
    { id: 'flow_confirm_receive', name: '确认收货闭环', patterns: ['确认收货', '收货'] },
    { id: 'flow_cancel_compensate', name: '作废/逆向补偿闭环', patterns: ['作废', '补偿', '撤销'] },
    { id: 'flow_formula_db', name: '公式/CAL/DB 字段闭环', patterns: ['公式', 'CAL', 'DDL', '字段', '累计', '折扣'] },
  ];

  const featureFlows = flowCatalog
    .filter((item) => hasAnyPattern(combinedText, item.patterns))
    .map((item) => ({
      id: item.id,
      type: 'flow',
      name: item.name,
      source: ['prd', 'tech_spec'],
      assertion: `${item.name}必须至少有一条正向可执行用例`,
      risk_level: 'P0',
      must_cover: true,
      linked_cases: [],
    }));

  const reverseFlows = [
    { id: 'reverse_reject', name: '驳回链路', patterns: ['驳回'] },
    { id: 'reverse_cancel', name: '作废链路', patterns: ['作废'] },
    { id: 'reverse_block_cancel', name: '阻断性作废链路', patterns: ['阻断', '不可作废', '不允许作废'] },
  ]
    .filter((item) => hasAnyPattern(combinedText, item.patterns))
    .map((item) => ({
      id: item.id,
      type: 'reverse',
      name: item.name,
      source: ['prd', 'tech_spec'],
      assertion: `${item.name}必须有逆向或非法场景验证`,
      risk_level: 'P0',
      must_cover: true,
      linked_cases: [],
    }));

  const stateTransitions = [
    { id: 'state_legal', name: '合法状态迁移', patterns: ['状态机', '状态迁移', '合法迁移'] },
    { id: 'state_illegal', name: '关键非法状态迁移', patterns: ['非法迁移', '不允许', '禁止'] },
  ]
    .filter((item) => hasAnyPattern(combinedText, item.patterns))
    .map((item) => ({
      id: item.id,
      type: 'state',
      name: item.name,
      source: ['prd', 'tech_spec'],
      assertion: `${item.name}必须至少有一条用例`,
      risk_level: 'P0',
      must_cover: true,
      linked_cases: [],
    }));

  const apiContracts = extractMethodPaths(`${techText}\n${apiText}`).map((entry, index) => ({
    id: `api_${index + 1}`,
    type: 'api',
    name: entry,
    source: apiText ? ['api_contract'] : ['tech_spec'],
    assertion: '关键接口必须覆盖正向与逆向验收',
    risk_level: 'P1',
    must_cover: true,
    linked_cases: [],
  }));

  const dbAssertions = extractBacktickedFields(`${techText}\n${ddlText}\n${prdText}`).map((field, index) => ({
    id: `db_${index + 1}`,
    type: 'db',
    name: field,
    source: ddlText ? ['ddl', 'tech_spec'] : ['tech_spec'],
    assertion: `${field} 必须有字段级 DB 断言`,
    risk_level: 'P1',
    must_cover: true,
    linked_cases: [],
  }));

  const errorPrompts = [
    { id: 'prompt_submit', name: '非合法状态提交提示', patterns: ['不允许提交', '状态不允许提交', '当前订单状态不允许提交'] },
    { id: 'prompt_approve', name: '非合法状态审核提示', patterns: ['不允许审核', '状态不允许审核'] },
    { id: 'prompt_cancel', name: '阻断作废提示', patterns: ['不允许作废', '已确认出库', '阻断'] },
  ]
    .filter((item) => hasAnyPattern(combinedText, item.patterns))
    .map((item) => ({
      id: item.id,
      type: 'prompt',
      name: item.name,
      source: ['prd', 'tech_spec'],
      assertion: '提示语必须映射到具体场景和用例',
      risk_level: 'P1',
      must_cover: true,
      linked_cases: [],
    }));

  const subprocessLinks = hasAnyPattern(combinedText, ['子流程', '现网', 'confirm', '外部'])
    ? [
        {
          id: 'subprocess_confirm',
          type: 'subprocess',
          name: '外部/现网子流程边界',
          source: ['tech_spec'],
          assertion: '必须写清本域断言什么，子流程引用什么',
          risk_level: 'P0',
          must_cover: true,
          linked_cases: [],
        },
      ]
    : [];

  const coverageObligations = uniqueStrings([
    ...featureFlows.map((item) => item.name),
    ...reverseFlows.map((item) => item.name),
    ...stateTransitions.map((item) => item.name),
    ...(apiContracts.length ? ['关键接口覆盖'] : []),
    ...(dbAssertions.length ? ['字段级 DB 断言'] : []),
    ...(subprocessLinks.length ? ['子流程边界覆盖'] : []),
  ]).map((name, index) => ({
    id: `obl_${index + 1}`,
    type: 'obligation',
    name,
    source: ['coverage_graph'],
    assertion: `${name} 必须可绑定测试用例`,
    risk_level: 'P0',
    must_cover: true,
    linked_cases: [],
  }));

  const missingCoverageItems = [];
  if (!featureFlows.length) missingCoverageItems.push('缺正向主流程覆盖');
  if (!reverseFlows.length) missingCoverageItems.push('缺逆向流程覆盖');
  if (!stateTransitions.find((item) => item.id === 'state_illegal')) {
    missingCoverageItems.push('缺关键非法状态迁移');
  }
  if (!apiContracts.length) missingCoverageItems.push('缺接口契约覆盖');
  if (!dbAssertions.length) missingCoverageItems.push('缺字段级 DB 断言');
  if (hasAnyPattern(combinedText, ['子流程', 'confirm', '现网']) && !subprocessLinks.length) {
    missingCoverageItems.push('缺子流程边界覆盖');
  }

  const uninferableItems = [];
  if (!documents.api_contract) {
    uninferableItems.push('未提供接口契约，接口级断言可能不完整');
  }
  if (!documents.ddl) {
    uninferableItems.push('未提供 DDL，字段级 DB 断言可能不完整');
  }

  return {
    feature_flows: featureFlows,
    reverse_flows: reverseFlows,
    state_transitions: stateTransitions,
    api_contracts: apiContracts,
    db_assertions: dbAssertions,
    error_prompts: errorPrompts,
    subprocess_links: subprocessLinks,
    coverage_obligations: coverageObligations,
    missing_coverage_items: missingCoverageItems,
    unbound_case_items: [],
    uninferable_items: uninferableItems,
  };
}

function formatGateSummary(gateType, result) {
  const prefix = {
    input_contract: '输入契约检查',
    prd_gate: 'PRD 门禁',
    tech_spec_gate: '技术方案门禁',
    test_plan_gate: '测试方案门禁',
  }[gateType] || '门禁检查';
  return `${prefix}${result.status === 'pass' ? '通过' : result.status === 'warn' ? '告警' : '阻断'}：${result.summary}`;
}

async function query(sql, params = []) {
  const retryableRead = isRetrySafeQuery(sql);
  const maxAttempts = retryableRead ? 2 : 1;
  let attempt = 0;
  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      const [rows] = await getPool().execute(sql, params);
      return rows;
    } catch (error) {
      if (String(error?.code || '') === 'ER_BAD_FIELD_ERROR') {
        console.error('[mysql-bad-field]', {
          error_code: error.code,
          error_message: error.message,
          sql_preview: normalizeText(sql).slice(0, 240),
        });
        logger.error('mysql bad field error', {
          error_code: error.code,
          error_message: error.message,
          sql_preview: normalizeText(sql).slice(0, 240),
        });
      }
      if (!isTransientDbConnectionError(error)) {
        throw error;
      }
      await resetPool(`query attempt ${attempt} failed`, error);
      if (attempt >= maxAttempts) {
        throw error;
      }
      await sleep(DB_RETRY_BACKOFF_MS * attempt);
    }
  }
  return [];
}

function isMissingTableError(error) {
  return String(error?.code || '') === 'ER_NO_SUCH_TABLE';
}

function isUnknownColumnError(error, columnName = '') {
  return String(error?.code || '') === 'ER_BAD_FIELD_ERROR' && normalizeText(error?.message).includes(`'${columnName}'`);
}

const {
  persistDeepWikiTemplateProjection,
  persistDeepWikiScoreProjection,
  getDeepWikiTemplateProjectionBySnapshotId,
} = createDeepWikiProjectionStore({
  query,
  parseJson,
  stringifyJson,
  normalizeText,
  uniqueStrings,
  getRecordLike,
  STAGE_CONTRACTS,
  SKILL_CONTRACTS,
  deriveLegacySnapshotFields,
  isPublishedSnapshot,
});

const {
  applyVisibleProjection: applyDeepWikiAlgorithmVisibleProjection,
} = createDeepWikiAlgorithmVisibleStore({
  query,
  normalizeText,
  stringifyJson,
  upsertKnowledgeAsset,
  buildDeepWikiAssetKey,
  buildDeepWikiPageFilePath,
  toWorkspaceRelativePath,
  replaceDeepWikiSnapshotDiagrams,
  replaceDeepWikiThreads,
});

const {
  buildDeepWikiSupplementalPages,
  buildDeepWikiThreadPages,
} = createDeepWikiThreadPageBuilder({
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
});

async function ensureReferenceProject(projectCode = 'C04') {
  const rows = await query(
    'SELECT code FROM gateway_program_projects WHERE code = ? LIMIT 1',
    [projectCode]
  );
  if (rows[0]) return rows[0];
  await query(
    `INSERT INTO gateway_program_projects
     (code, name, layer, wave_id, okr_refs, owner_role, co_owner_roles, start_date, end_date, status, risk_level, summary, acceptance_rule)
     VALUES (?, ?, ?, NULL, CAST(? AS JSON), ?, CAST(? AS JSON), CURDATE(), DATE_ADD(CURDATE(), INTERVAL 90 DAY), 'active', 'medium', ?, ?)`,
    [
      projectCode,
      '门禁评审链路治理项目',
      'control',
      JSON.stringify(['KR10.2', 'KR10.3']),
      '平台组',
      JSON.stringify(['项目管理组', '后端组']),
      '首条门禁评审链路默认挂接项目',
      '至少产出一条可追溯门禁证据链路',
    ]
  );
  return { code: projectCode };
}

async function ensureGateReviewPipeline() {
  let rows = await query(
    'SELECT * FROM gateway_pipeline_definitions WHERE pipeline_key = ? LIMIT 1',
    ['gate-review']
  );
  let pipeline = rows[0] || null;

  if (!pipeline) {
    const result = await query(
      `INSERT INTO gateway_pipeline_definitions
       (pipeline_key, name, domain, description, owner_role, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        'gate-review',
        '门禁评审链路',
        'pm',
        'PRD/技术方案/测试用例/代码门禁统一链路',
        '平台组',
        'active',
      ]
    );
    rows = await query(
      'SELECT * FROM gateway_pipeline_definitions WHERE id = ? LIMIT 1',
      [result.insertId]
    );
    pipeline = rows[0];
  }

  let versionId = pipeline.current_version_id || null;
  if (versionId) {
    const versionRows = await query(
      'SELECT id FROM gateway_pipeline_versions WHERE id = ? LIMIT 1',
      [versionId]
    );
    if (!versionRows[0]) {
      versionId = null;
    }
  }

  if (!versionId) {
    const versionResult = await query(
      `INSERT INTO gateway_pipeline_versions
       (pipeline_definition_id, version, status, published_at, change_summary)
       VALUES (?, ?, ?, NOW(), ?)`,
      [pipeline.id, '1.0.0', 'published', '初始化门禁评审管道']
    );
    versionId = versionResult.insertId;
    await query(
      'UPDATE gateway_pipeline_definitions SET current_version_id = ? WHERE id = ?',
      [versionId, pipeline.id]
    );
  }

  const existingNodes = await query(
    'SELECT id, node_key FROM gateway_pipeline_nodes WHERE pipeline_version_id = ? ORDER BY id ASC',
    [versionId]
  );
  const nodes = [
    ['artifact_ingest', '工件接入', 'tool', 1],
    ['rule_bind', '规则绑定', 'gate', 2],
    ['gate_execute', '门禁执行', 'gate', 3],
    ['approval_or_override', '人工复核', 'approval', 4],
    ['evidence_archive', '证据归档', 'callback', 5],
  ];
  const existingNodeKeys = new Set(existingNodes.map((node) => node.node_key));
  for (const [nodeKey, nodeName, nodeType, sortOrder] of nodes) {
    if (existingNodeKeys.has(nodeKey)) {
      continue;
    }
    await query(
      `INSERT INTO gateway_pipeline_nodes
       (pipeline_version_id, node_key, node_name, node_type, retry_policy, timeout_policy, fallback_policy, sort_order, config_json)
       VALUES (?, ?, ?, ?, CAST(? AS JSON), CAST(? AS JSON), CAST(? AS JSON), ?, CAST(? AS JSON))`,
      [
        versionId,
        nodeKey,
        nodeName,
        nodeType,
        JSON.stringify({ maxRetries: nodeType === 'approval' ? 0 : 2 }),
        JSON.stringify({ timeoutMs: 30000 }),
        JSON.stringify({ mode: nodeType === 'approval' ? 'manual' : 'continue' }),
        sortOrder,
        JSON.stringify({}),
      ]
    );
  }
  rows = await query(
    'SELECT * FROM gateway_pipeline_definitions WHERE id = ? LIMIT 1',
    [pipeline.id]
  );
  return rows[0];
}

async function ensureDocPipeline() {
  let rows = await query(
    'SELECT * FROM gateway_pipeline_definitions WHERE pipeline_key = ? LIMIT 1',
    ['doc-pipeline-v1']
  );
  let pipeline = rows[0] || null;

  if (!pipeline) {
    const result = await query(
      `INSERT INTO gateway_pipeline_definitions
       (pipeline_key, name, domain, description, owner_role, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        'doc-pipeline-v1',
        '文档管道 Phase1',
        'engineering',
        '标准节点驱动的文档门禁与测试方案发布链路',
        '平台组',
        'active',
      ]
    );
    rows = await query('SELECT * FROM gateway_pipeline_definitions WHERE id = ? LIMIT 1', [result.insertId]);
    pipeline = rows[0];
  }

  let versionId = pipeline.current_version_id || null;
  if (!versionId) {
    const versionResult = await query(
      `INSERT INTO gateway_pipeline_versions
       (pipeline_definition_id, version, status, published_at, change_summary)
       VALUES (?, ?, ?, NOW(), ?)`,
      [pipeline.id, '1.0.0', 'published', '初始化文档管道标准节点顺序执行器']
    );
    versionId = versionResult.insertId;
    await query(
      'UPDATE gateway_pipeline_definitions SET current_version_id = ?, status = ? WHERE id = ?',
      [versionId, 'active', pipeline.id]
    );
  }

  const existingNodes = await query(
    'SELECT id, node_key FROM gateway_pipeline_nodes WHERE pipeline_version_id = ? ORDER BY id ASC',
    [versionId]
  );
  const nodeDefs = [
    ['input_contract', '输入契约检查', 'gate', 1],
    ['prd_gate', 'PRD 门禁', 'gate', 2],
    ['repo_context_build', '仓库上下文构建', 'transform', 3],
    ['tech_spec_generate', '技术方案生成', 'generate', 4],
    ['tech_spec_gate', '技术方案门禁', 'gate', 5],
    ['coverage_graph', 'Coverage Graph 构建', 'transform', 6],
    ['test_plan_generate', '测试方案生成', 'transform', 7],
    ['test_plan_gate', '测试方案门禁', 'gate', 8],
    ['publish', '正式版发布', 'callback', 9],
  ];
  const existingNodeKeys = new Set(existingNodes.map((node) => node.node_key));
  for (const [nodeKey, nodeName, nodeType, sortOrder] of nodeDefs) {
    if (existingNodeKeys.has(nodeKey)) continue;
    await query(
      `INSERT INTO gateway_pipeline_nodes
       (pipeline_version_id, node_key, node_name, node_type, retry_policy, timeout_policy, fallback_policy, sort_order, config_json)
       VALUES (?, ?, ?, ?, CAST(? AS JSON), CAST(? AS JSON), CAST(? AS JSON), ?, CAST(? AS JSON))`,
      [
        versionId,
        nodeKey,
        nodeName,
        nodeType,
        stringifyJson({ maxRetries: nodeType === 'callback' ? 0 : 1 }),
        stringifyJson({ timeoutMs: 30000 }),
        stringifyJson({ mode: nodeKey === 'publish' ? 'stop' : 'continue' }),
        sortOrder,
        stringifyJson({ standard_node_key: GATE_TYPE_TO_STANDARD_NODE_KEY[nodeKey] || null }),
      ]
    );
  }

  rows = await query('SELECT * FROM gateway_pipeline_definitions WHERE id = ? LIMIT 1', [pipeline.id]);
  return rows[0];
}

const DEEPWIKI_NODE_LABELS = {
  repo_prepare: '仓库准备',
  repo_inventory: '仓库盘点',
  module_digest: '模块摘要',
  deep_research_outline: 'Deep Research 综合分析',
  diagram_synthesis: '结构化 Mermaid 制图',
  wiki_render: 'Wiki 渲染',
  knowledge_extract: '知识结构化抽取',
  coverage_check: 'Coverage 门禁',
  coverage_repair: 'Coverage 补页',
  doc_projection_md: '文档族 MD 投影',
  knowledge_register: '知识资产登记',
  community_index: '社区摘要索引',
  rag_ingest: 'RAG 入库',
  retrieval_eval: '检索评测',
  publish: '发布',
};

function inferDeepWikiPipelineNodeType(nodeKey) {
  if (['publish', 'knowledge_register', 'rag_ingest'].includes(nodeKey)) return 'callback';
  if (['module_digest', 'deep_research_outline', 'diagram_synthesis'].includes(nodeKey)) return 'generate';
  return 'transform';
}

async function ensureDeepWikiPipeline() {
  let rows = await query(
    'SELECT * FROM gateway_pipeline_definitions WHERE pipeline_key = ? LIMIT 1',
    ['deepwiki-pipeline-v1']
  );
  let pipeline = rows[0] || null;

  if (!pipeline) {
    const result = await query(
      `INSERT INTO gateway_pipeline_definitions
       (pipeline_key, name, domain, description, owner_role, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        'deepwiki-pipeline-v1',
        'Deep Wiki 代码库知识管道',
        'engineering',
        '仓库预检、结构分析、Deep Research、Wiki 渲染、知识入库和 RAG 沉淀',
        '平台组',
        'active',
      ]
    );
    rows = await query('SELECT * FROM gateway_pipeline_definitions WHERE id = ? LIMIT 1', [result.insertId]);
    pipeline = rows[0];
  }

  let versionId = pipeline.current_version_id || null;
  if (!versionId) {
    const versionResult = await query(
      `INSERT INTO gateway_pipeline_versions
       (pipeline_definition_id, version, status, published_at, change_summary)
       VALUES (?, ?, ?, NOW(), ?)`,
      [pipeline.id, '1.0.0', 'published', '初始化 Deep Wiki 标准知识沉淀管道']
    );
    versionId = versionResult.insertId;
    await query(
      'UPDATE gateway_pipeline_definitions SET current_version_id = ?, status = ? WHERE id = ?',
      [versionId, 'active', pipeline.id]
    );
  }

  const existingNodes = await query(
    'SELECT id, node_key FROM gateway_pipeline_nodes WHERE pipeline_version_id = ? ORDER BY id ASC',
    [versionId]
  );
  const nodeDefs = DEEPWIKI_STAGE_ORDER.map((nodeKey, idx) => [
    nodeKey,
    DEEPWIKI_NODE_LABELS[nodeKey] || nodeKey,
    inferDeepWikiPipelineNodeType(nodeKey),
    idx + 1,
  ]);
  const existingNodeKeys = new Set(existingNodes.map((node) => node.node_key));
  for (const [nodeKey, nodeName, nodeType, sortOrder] of nodeDefs) {
    if (existingNodeKeys.has(nodeKey)) continue;
    await query(
      `INSERT INTO gateway_pipeline_nodes
       (pipeline_version_id, node_key, node_name, node_type, retry_policy, timeout_policy, fallback_policy, sort_order, config_json)
       VALUES (?, ?, ?, ?, CAST(? AS JSON), CAST(? AS JSON), CAST(? AS JSON), ?, CAST(? AS JSON))`,
      [
        versionId,
        nodeKey,
        nodeName,
        nodeType,
        stringifyJson({ maxRetries: ['repo_prepare', 'rag_ingest'].includes(nodeKey) ? 1 : 0 }),
        stringifyJson({ timeoutMs: nodeKey === 'deep_research_outline' ? 600000 : 300000 }),
        stringifyJson({ mode: nodeKey === 'publish' ? 'stop' : 'continue' }),
        sortOrder,
        stringifyJson({}),
      ]
    );
  }

  rows = await query('SELECT * FROM gateway_pipeline_definitions WHERE id = ? LIMIT 1', [pipeline.id]);
  return rows[0];
}

async function updateRunNodeStatus(pipelineRunId, nodeKey, patch = {}) {
  const sets = [];
  const params = [];
  if (patch.status != null) {
    sets.push('status = ?');
    params.push(patch.status);
  }
  if (patch.output_summary !== undefined) {
    sets.push('output_summary = ?');
    params.push(patch.output_summary || null);
  }
  if (patch.error_message !== undefined) {
    sets.push('error_message = ?');
    params.push(patch.error_message || null);
  }
  if (patch.gate_execution_id !== undefined) {
    sets.push('gate_execution_id = ?');
    params.push(patch.gate_execution_id || null);
  }
  if (patch.status && ['completed', 'failed', 'blocked', 'skipped'].includes(patch.status)) {
    sets.push('ended_at = NOW()');
  }
  sets.push('updated_at = NOW()');
  if (!sets.length) return;
  await query(
    `UPDATE gateway_run_nodes
     SET ${sets.join(', ')}
     WHERE pipeline_run_id = ? AND node_key = ?`,
    [...params, pipelineRunId, nodeKey]
  );
}

async function executeDocPipelineRun(bundleId, data = {}) {
  const context = await getBundleDocuments(bundleId);
  if (!context) return null;
  const pipeline = await ensureDocPipeline();
  const traceId = data.trace_id || context.bundle.trace_id || `trace-doc-${uuidv4().replace(/-/g, '').slice(0, 16)}`;
  const projectCode = data.project_code || context.bundle.project_code || 'C04';
  const workflowMode = inferWorkflowMode(context.bundle_context);

  await query(
    'UPDATE gateway_doc_bundles SET trace_id = ?, project_code = ?, updated_at = NOW() WHERE id = ?',
    [traceId, projectCode, bundleId]
  );

  const run = await startPipelineRun(pipeline.id, {
    trace_id: traceId,
    project_code: projectCode,
    source_type: 'manual',
    entry_event: 'doc-pipeline-v1',
    status: 'running',
    approval_status: 'approved',
  });

  const stepResults = [];
  const runStep = async (nodeKey, executor) => {
    try {
      const result = await executor();
      const blocked = result?.status === 'block';
      await updateRunNodeStatus(run.id, nodeKey, {
        status: blocked ? 'blocked' : 'completed',
        output_summary: result?.summary || result?.status || 'completed',
        gate_execution_id: result?.id || null,
      });
      stepResults.push({ node_key: nodeKey, status: blocked ? 'blocked' : 'completed', result });
      return { stop: blocked, result };
    } catch (error) {
      await updateRunNodeStatus(run.id, nodeKey, {
        status: 'failed',
        error_message: error.message,
        output_summary: error.message,
      });
      stepResults.push({ node_key: nodeKey, status: 'failed', error: error.message });
      throw error;
    }
  };

  try {
    let outcome = await runStep('input_contract', () => evaluateInputContract(bundleId));
    if (outcome.stop) {
      await query('UPDATE gateway_pipeline_runs SET status = ?, approval_status = ?, ended_at = NOW(), updated_at = NOW() WHERE id = ?', ['blocked', 'pending', run.id]);
      return { pipeline_run_id: run.id, trace_id: traceId, step_results: stepResults };
    }

    outcome = await runStep('prd_gate', () => evaluatePrdGate(bundleId));
    if (outcome.stop) {
      await query('UPDATE gateway_pipeline_runs SET status = ?, approval_status = ?, ended_at = NOW(), updated_at = NOW() WHERE id = ?', ['blocked', 'pending', run.id]);
      return { pipeline_run_id: run.id, trace_id: traceId, step_results: stepResults };
    }

    if (workflowMode === 'generate_tech_spec') {
      const repoContextRun = await buildRepoContextRun(bundleId);
      await updateRunNodeStatus(run.id, 'repo_context_build', {
        status: 'completed',
        output_summary: summarizeRepositoryContext(repoContextRun?.summary_json || {}),
      });
      stepResults.push({ node_key: 'repo_context_build', status: 'completed', result: repoContextRun });

      const techSpecRun = await generateTechSpec(bundleId);
      await updateRunNodeStatus(run.id, 'tech_spec_generate', {
        status: 'completed',
        output_summary: techSpecRun?.draft_artifact?.title || '技术方案草稿已生成',
      });
      stepResults.push({ node_key: 'tech_spec_generate', status: 'completed', result: techSpecRun });
    } else {
      await updateRunNodeStatus(run.id, 'repo_context_build', {
        status: 'skipped',
        output_summary: '上传现成技术方案模式，跳过仓库上下文构建',
      });
      await updateRunNodeStatus(run.id, 'tech_spec_generate', {
        status: 'skipped',
        output_summary: '上传现成技术方案模式，跳过技术方案生成',
      });
      stepResults.push({ node_key: 'repo_context_build', status: 'skipped' });
      stepResults.push({ node_key: 'tech_spec_generate', status: 'skipped' });
    }

    outcome = await runStep('tech_spec_gate', () => evaluateTechSpecGate(bundleId));
    if (outcome.stop) {
      await query('UPDATE gateway_pipeline_runs SET status = ?, approval_status = ?, ended_at = NOW(), updated_at = NOW() WHERE id = ?', ['blocked', 'pending', run.id]);
      return { pipeline_run_id: run.id, trace_id: traceId, step_results: stepResults };
    }

    const coverage = await buildCoverageGraph(bundleId);
    await updateRunNodeStatus(run.id, 'coverage_graph', {
      status: 'completed',
      output_summary: coverage?.missing_coverage_items?.length
        ? `Coverage Graph 构建完成，缺失项 ${coverage.missing_coverage_items.length} 个`
        : 'Coverage Graph 构建完成',
    });
    stepResults.push({ node_key: 'coverage_graph', status: 'completed', result: coverage });

    const generated = await generateTestPlan(bundleId);
    await updateRunNodeStatus(run.id, 'test_plan_generate', {
      status: 'completed',
      output_summary:
        generated?.draft_artifact && generated?.ai_draft_artifact
          ? `${generated.draft_artifact.title} + ${generated.ai_draft_artifact.title}`
          : generated?.draft_artifact?.title || '测试方案双轨草稿已生成',
    });
    stepResults.push({ node_key: 'test_plan_generate', status: 'completed', result: generated });

    outcome = await runStep('test_plan_gate', () => evaluateTestPlanGate(bundleId));
    if (outcome.stop) {
      await query('UPDATE gateway_pipeline_runs SET status = ?, approval_status = ?, ended_at = NOW(), updated_at = NOW() WHERE id = ?', ['blocked', 'pending', run.id]);
      return { pipeline_run_id: run.id, trace_id: traceId, step_results: stepResults };
    }

    const published = await publishTestPlan(bundleId);
    await updateRunNodeStatus(run.id, 'publish', {
      status: 'completed',
      output_summary: published?.title || '测试方案正式版已发布',
    });
    stepResults.push({ node_key: 'publish', status: 'completed', result: published });

    await query(
      `UPDATE gateway_pipeline_runs
       SET status = ?, approval_status = ?, ended_at = NOW(), updated_at = NOW()
       WHERE id = ?`,
      ['completed', 'approved', run.id]
    );

    const bundleDetail = await getDocBundleById(bundleId);
    return {
      pipeline_run_id: run.id,
      trace_id: traceId,
      workflow_mode: workflowMode,
      status: 'completed',
      current_stage: bundleDetail?.current_stage || 'publish',
      blocking_gate: bundleDetail?.blocking_gate || null,
      recommended_actions: bundleDetail?.recommended_actions || [],
      generated_tech_spec_summary: bundleDetail?.generated_artifact_summary?.tech_spec_draft || null,
      generated_test_plan_summary: {
        template_draft: bundleDetail?.generated_artifact_summary?.template_draft || null,
        ai_enhanced_draft: bundleDetail?.generated_artifact_summary?.ai_enhanced_draft || null,
        final_artifact: bundleDetail?.generated_artifact_summary?.final_artifact || null,
      },
      generated_artifact_summary: bundleDetail?.generated_artifact_summary || {},
      publish_ready: bundleDetail?.publish_ready ?? true,
      step_results: stepResults,
    };
  } catch (error) {
    await query(
      `UPDATE gateway_pipeline_runs
       SET status = ?, approval_status = ?, ended_at = NOW(), updated_at = NOW()
       WHERE id = ?`,
      ['failed', 'pending', run.id]
    );
    const bundleDetail = await getDocBundleById(bundleId).catch(() => null);
    error.pipeline_context = bundleDetail
      ? {
          current_stage: bundleDetail.current_stage,
          blocking_gate: bundleDetail.blocking_gate,
          recommended_actions: bundleDetail.recommended_actions,
          generated_artifact_summary: bundleDetail.generated_artifact_summary,
        }
      : null;
    throw error;
  }
}

function mapProjectRow(row) {
  return {
    ...row,
    okr_refs: parseJson(row.okr_refs, []),
    co_owner_roles: parseJson(row.co_owner_roles, []),
    metadata_json: parseJson(row.metadata_json, {}),
  };
}

async function listWaves() {
  return query('SELECT * FROM gateway_waves ORDER BY start_date ASC, id ASC');
}

async function listProjects() {
  const rows = await query(
    `SELECT p.*, w.name AS wave_name, w.code AS wave_code, w.stage AS wave_stage,
            (SELECT COUNT(*) FROM gateway_project_milestones m WHERE m.project_code = p.code) AS milestone_count,
            (SELECT COUNT(*) FROM gateway_project_milestones m WHERE m.project_code = p.code AND m.status = 'completed') AS completed_milestone_count,
            (SELECT m.title FROM gateway_project_milestones m WHERE m.project_code = p.code AND m.status <> 'completed' ORDER BY m.due_date ASC, m.id ASC LIMIT 1) AS next_milestone_title,
            (SELECT m.due_date FROM gateway_project_milestones m WHERE m.project_code = p.code AND m.status <> 'completed' ORDER BY m.due_date ASC, m.id ASC LIMIT 1) AS next_milestone_due_date,
            (SELECT m.status FROM gateway_project_milestones m WHERE m.project_code = p.code AND m.status <> 'completed' ORDER BY m.due_date ASC, m.id ASC LIMIT 1) AS next_milestone_status,
            (SELECT COUNT(*) FROM gateway_project_risk_issues r WHERE r.project_code = p.code AND COALESCE(r.resolution_status, 'open') <> 'resolved') AS open_risk_count,
            (SELECT COUNT(*) FROM gateway_evidence_packs e WHERE e.project_code = p.code) AS evidence_count
     FROM gateway_program_projects p
     LEFT JOIN gateway_waves w ON p.wave_id = w.id
     WHERE COALESCE(p.official_order, 999) < 900
     ORDER BY p.official_order ASC, p.code ASC`
  );
  return rows.map(mapProjectRow);
}

async function getProjectByCode(code) {
  const [project] = await query(
    `SELECT p.*, w.name AS wave_name, w.code AS wave_code, w.stage AS wave_stage,
            (SELECT COUNT(*) FROM gateway_evidence_packs e WHERE e.project_code = p.code) AS evidence_count
     FROM gateway_program_projects p
     LEFT JOIN gateway_waves w ON p.wave_id = w.id
     WHERE p.code = ?
     LIMIT 1`,
    [code]
  );
  if (!project) return null;
  const [milestones, risks, updates, evidence] = await Promise.all([
    query(
      'SELECT * FROM gateway_project_milestones WHERE project_code = ? ORDER BY due_date ASC, id ASC',
      [code]
    ),
    query(
      'SELECT * FROM gateway_project_risk_issues WHERE project_code = ? ORDER BY created_at DESC',
      [code]
    ),
    query(
      'SELECT * FROM gateway_project_weekly_updates WHERE project_code = ? ORDER BY created_at DESC LIMIT 10',
      [code]
    ),
    query(
      'SELECT * FROM gateway_evidence_packs WHERE project_code = ? ORDER BY created_at DESC LIMIT 20',
      [code]
    ),
  ]);
  return {
    ...mapProjectRow(project),
    milestones: milestones.map(mapMilestoneRow),
    risks,
    weekly_updates: updates,
    evidence_packs: evidence,
  };
}

async function createWeeklyUpdate(projectCode, data) {
  const result = await query(
    `INSERT INTO gateway_project_weekly_updates
     (project_code, week_label, progress_summary, risks, blockers, status, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      projectCode,
      data.week_label,
      data.progress_summary || '',
      data.risks || null,
      data.blockers || null,
      data.status || 'green',
      data.created_by || 'system',
    ]
  );
  const [row] = await query(
    'SELECT * FROM gateway_project_weekly_updates WHERE id = ? LIMIT 1',
    [result.insertId]
  );
  return row;
}

async function listEvidencePacks(projectCode) {
  const sql = projectCode
    ? 'SELECT * FROM gateway_evidence_packs WHERE project_code = ? ORDER BY created_at DESC'
    : 'SELECT * FROM gateway_evidence_packs ORDER BY created_at DESC LIMIT 100';
  const params = projectCode ? [projectCode] : [];
  const rows = await query(sql, params);
  return rows.map((row) => ({
    ...row,
    metadata_json: parseJson(row.metadata_json, {}),
  }));
}

async function createEvidencePack(data) {
  const result = await query(
    `INSERT INTO gateway_evidence_packs
     (project_code, milestone_type, title, review_result, reviewer, reviewed_at, trace_id, pipeline_run_id, summary)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.project_code,
      data.milestone_type,
      data.title,
      data.review_result || 'pending',
      data.reviewer || null,
      data.reviewed_at || null,
      data.trace_id || null,
      data.pipeline_run_id || null,
      data.summary || null,
    ]
  );
  const evidencePackId = result.insertId;
  for (const item of data.items || []) {
    await query(
      `INSERT INTO gateway_evidence_pack_items
       (evidence_pack_id, item_type, item_name, item_ref, payload_json)
       VALUES (?, ?, ?, ?, CAST(? AS JSON))`,
      [
        evidencePackId,
        item.item_type,
        item.item_name,
        item.item_ref || null,
        stringifyJson(item.payload_json || {}),
      ]
    );
  }
  const [row] = await query(
    'SELECT * FROM gateway_evidence_packs WHERE id = ? LIMIT 1',
    [evidencePackId]
  );
  return row;
}

async function listPipelines() {
  const rows = await query(
    `SELECT p.*,
            v.version AS current_version,
            (SELECT COUNT(*) FROM gateway_pipeline_nodes n WHERE n.pipeline_version_id = p.current_version_id) AS node_count
     FROM gateway_pipeline_definitions p
     LEFT JOIN gateway_pipeline_versions v ON p.current_version_id = v.id
     ORDER BY p.updated_at DESC, p.id DESC`
  );
  return rows.map((row) =>
    decorateSourceRef(
      row,
      normalizeText(row.template_ref) || AI_RULES_PIPELINE_SOURCE_MAP[row.pipeline_key] || null
    )
  );
}

async function createPipeline(data) {
  const result = await query(
    `INSERT INTO gateway_pipeline_definitions
     (pipeline_key, name, domain, description, owner_role, status)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      data.pipeline_key,
      data.name,
      data.domain,
      data.description || null,
      data.owner_role || '平台组',
      data.status || 'draft',
    ]
  );
  const versionResult = await query(
    `INSERT INTO gateway_pipeline_versions
     (pipeline_definition_id, version, status, change_summary)
     VALUES (?, ?, ?, ?)`,
    [result.insertId, data.version || '1.0.0', 'draft', data.change_summary || '初始化版本']
  );
  const versionId = versionResult.insertId;
  for (const [index, node] of (data.nodes || []).entries()) {
    await query(
      `INSERT INTO gateway_pipeline_nodes
       (pipeline_version_id, node_key, node_name, node_type, retry_policy, timeout_policy, fallback_policy, sort_order, config_json)
       VALUES (?, ?, ?, ?, CAST(? AS JSON), CAST(? AS JSON), CAST(? AS JSON), ?, CAST(? AS JSON))`,
      [
        versionId,
        node.node_key,
        node.node_name,
        node.node_type,
        stringifyJson(node.retry_policy || { maxRetries: 1 }),
        stringifyJson(node.timeout_policy || { timeoutMs: 30000 }),
        stringifyJson(node.fallback_policy || { mode: 'continue' }),
        index + 1,
        stringifyJson(node.config_json || {}),
      ]
    );
  }
  await query(
    'UPDATE gateway_pipeline_definitions SET current_version_id = ? WHERE id = ?',
    [versionId, result.insertId]
  );
  const [row] = await query(
    'SELECT * FROM gateway_pipeline_definitions WHERE id = ? LIMIT 1',
    [result.insertId]
  );
  return row;
}

async function publishPipeline(id) {
  const [pipeline] = await query(
    'SELECT * FROM gateway_pipeline_definitions WHERE id = ? LIMIT 1',
    [id]
  );
  if (!pipeline) return null;
  const versionId = pipeline.current_version_id;
  if (versionId) {
    await query(
      'UPDATE gateway_pipeline_versions SET status = ?, published_at = NOW() WHERE id = ?',
      ['published', versionId]
    );
  }
  await query(
    'UPDATE gateway_pipeline_definitions SET status = ?, updated_at = NOW() WHERE id = ?',
    ['active', id]
  );
  const [row] = await query(
    `SELECT p.*, v.version AS current_version
     FROM gateway_pipeline_definitions p
     LEFT JOIN gateway_pipeline_versions v ON p.current_version_id = v.id
     WHERE p.id = ? LIMIT 1`,
    [id]
  );
  return row;
}

async function getPipelineDefinitionByRef(ref) {
  if (ref == null) return null;
  const normalized = normalizeText(ref);
  if (!normalized) return null;
  const isNumericId = /^\d+$/.test(normalized);
  const [row] = await query(
    `SELECT p.*, v.version AS current_version
     FROM gateway_pipeline_definitions p
     LEFT JOIN gateway_pipeline_versions v ON p.current_version_id = v.id
     WHERE ${isNumericId ? 'p.id = ?' : 'p.pipeline_key = ?'}
     LIMIT 1`,
    [isNumericId ? Number(normalized) : normalized]
  );
  return row
    ? decorateSourceRef(
        row,
        normalizeText(row.template_ref) || AI_RULES_PIPELINE_SOURCE_MAP[row.pipeline_key] || null
      )
    : null;
}

async function listSimpleRows(tableName, keyField) {
  const rows = await query(`SELECT * FROM ${tableName} ORDER BY updated_at DESC, id DESC`);
  return rows.map((row) => ({
    ...row,
    [keyField]: row[keyField],
  }));
}

async function createRuntimeEvent(data) {
  const eventKey = data.event_key || uuidv4();
  const result = await query(
    `INSERT INTO gateway_runtime_events
     (event_key, source_type, event_type, payload_json, trace_id, project_code)
     VALUES (?, ?, ?, CAST(? AS JSON), ?, ?)`,
    [
      eventKey,
      data.source_type || 'manual',
      data.event_type,
      stringifyJson(data.payload_json || {}),
      data.trace_id || eventKey,
      data.project_code || null,
    ]
  );
  return { id: result.insertId, event_key: eventKey };
}

async function startPipelineRun(pipelineId, data = {}) {
  const [pipeline] = await query(
    'SELECT * FROM gateway_pipeline_definitions WHERE id = ? LIMIT 1',
    [pipelineId]
  );
  if (!pipeline) return null;
  const traceId = data.trace_id || uuidv4();
  const result = await query(
    `INSERT INTO gateway_pipeline_runs
     (pipeline_definition_id, pipeline_version_id, trace_id, project_code, status, source_type, entry_event, request_payload, started_at, gate_execution_id, approval_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), NOW(), ?, ?)`,
    [
      pipeline.id,
      pipeline.current_version_id,
      traceId,
      data.project_code || null,
      data.status || 'running',
      data.source_type || 'manual',
      data.entry_event || 'manual-start',
      stringifyJson({
        ...data,
      }),
      data.gate_execution_id || null,
      data.approval_status || 'pending',
    ]
  );
  const runId = result.insertId;
  const nodes = await query(
    'SELECT * FROM gateway_pipeline_nodes WHERE pipeline_version_id = ? ORDER BY sort_order ASC, id ASC',
    [pipeline.current_version_id]
  );
  for (const node of nodes) {
    await query(
      `INSERT INTO gateway_run_nodes
       (pipeline_run_id, node_key, node_name, node_type, status, output_summary)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        runId,
        node.node_key,
        node.node_name,
        node.node_type,
        node.node_key === 'artifact_ingest' ? 'completed' : 'pending',
        node.node_key === 'artifact_ingest' ? '工件已接入待执行' : null,
      ]
    );
  }
  const [row] = await query(
    'SELECT * FROM gateway_pipeline_runs WHERE id = ? LIMIT 1',
    [runId]
  );
  return row;
}

async function listPipelineRuns() {
  const rows = await query(
    `SELECT r.*, r.pipeline_definition_id AS pipeline_id,
            p.name AS pipeline_name, p.pipeline_key, p.template_ref,
            (SELECT COUNT(*) FROM gateway_run_nodes n WHERE n.pipeline_run_id = r.id) AS node_count,
            (SELECT COUNT(*) FROM gateway_run_nodes n WHERE n.pipeline_run_id = r.id AND n.status = 'completed') AS completed_node_count,
            (SELECT COUNT(*) FROM gateway_run_nodes n WHERE n.pipeline_run_id = r.id AND n.status IN ('failed', 'blocked')) AS failed_node_count,
            (SELECT COUNT(*) FROM gateway_approval_tasks a WHERE a.pipeline_run_id = r.id AND a.status = 'pending') AS pending_approval_count
     FROM gateway_pipeline_runs r
     LEFT JOIN gateway_pipeline_definitions p ON r.pipeline_definition_id = p.id
     ORDER BY r.created_at DESC, r.id DESC
     LIMIT 100`
  );
  return rows.map((row) =>
    decorateSourceRef(
      {
        ...row,
        request_payload: parseJson(row.request_payload, {}),
      },
      normalizeText(row.template_ref) || AI_RULES_PIPELINE_SOURCE_MAP[row.pipeline_key] || null
    )
  );
}

async function getTraceById(traceId) {
  const [run] = await query(
    `SELECT r.*, p.name AS pipeline_name, p.pipeline_key
     FROM gateway_pipeline_runs r
     LEFT JOIN gateway_pipeline_definitions p ON r.pipeline_definition_id = p.id
     WHERE r.trace_id = ?
     ORDER BY r.id DESC
     LIMIT 1`,
    [traceId]
  );
  const [docBundlesByTrace, docGateRows] = await Promise.all([
    query(
      'SELECT * FROM gateway_doc_bundles WHERE trace_id = ? ORDER BY id DESC LIMIT 20',
      [traceId]
    ),
    query(
      `SELECT g.* FROM gateway_doc_gate_executions g
       INNER JOIN gateway_doc_bundles b ON b.id = g.bundle_id
       WHERE b.trace_id = ?
       ORDER BY g.id ASC`,
      [traceId]
    ),
  ]);
  const docGateExecutions = docGateRows.map((row) => ({
    ...row,
    result_json: parseJson(row.result_json, {}),
  }));
  const latestDocBundleDetail = docBundlesByTrace[0]?.id
    ? await getDocBundleById(docBundlesByTrace[0].id)
    : null;
  const normalizedRun = run
    ? decorateSourceRef(
        {
          ...run,
          request_payload: parseJson(run.request_payload, {}),
        },
        AI_RULES_PIPELINE_SOURCE_MAP[run.pipeline_key] || null
      )
    : null;
  if (!run) {
    if (!docBundlesByTrace.length) return null;
    return {
      run: null,
      nodes: [],
      usage_logs: [],
      gate_executions: [],
      evidence_packs: [],
      approvals: [],
      doc_bundles: docBundlesByTrace,
      doc_gate_executions: docGateExecutions,
      workflow_summary: latestDocBundleDetail?.workflow_summary || null,
    };
  }
  const [nodes, usageLogs, gateExecutions, evidencePacks, approvals] = await Promise.all([
    query(
      'SELECT * FROM gateway_run_nodes WHERE pipeline_run_id = ? ORDER BY id ASC',
      [run.id]
    ),
    query(
      `SELECT *
       FROM gateway_usage_logs
       WHERE trace_id = ?
       ORDER BY created_at ASC`,
      [traceId]
    ),
    query(
      `SELECT *
       FROM gateway_gate_executions
       WHERE JSON_EXTRACT(execution_meta, '$.trace_id') = JSON_QUOTE(?)
          OR JSON_UNQUOTE(JSON_EXTRACT(execution_meta, '$.trace_id')) = ?
       ORDER BY created_at ASC`,
      [traceId, traceId]
    ),
    query(
      'SELECT * FROM gateway_evidence_packs WHERE trace_id = ? ORDER BY created_at ASC',
      [traceId]
    ),
    query(
      'SELECT * FROM gateway_approval_tasks WHERE pipeline_run_id = ? ORDER BY created_at DESC',
      [run.id]
    ),
  ]);
  return {
    run: normalizedRun,
    nodes: nodes.map(mapPipelineNodeTraceRow),
    usage_logs: usageLogs,
    gate_executions: gateExecutions.map((row) => ({
      ...row,
      failed_checks: parseJson(row.failed_checks, []),
      check_results: parseJson(row.check_results, []),
      execution_meta: parseJson(row.execution_meta, {}),
    })),
    evidence_packs: evidencePacks,
    approvals: approvals.map(mapApprovalTaskRow),
    doc_bundles: docBundlesByTrace,
    doc_gate_executions: docGateExecutions,
    workflow_summary: latestDocBundleDetail?.workflow_summary || null,
  };
}

async function listIntegrationConnections() {
  const rows = await query(
    'SELECT * FROM gateway_integration_connections ORDER BY updated_at DESC, id DESC'
  );
  return rows.map(mapIntegrationConnectionRow);
}

async function createIntegrationConnection(data = {}) {
  const result = await query(
    `INSERT INTO gateway_integration_connections
     (connection_key, name, category, endpoint_url, auth_mode, owner_role, status, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON))
     ON DUPLICATE KEY UPDATE
       name = VALUES(name),
       category = VALUES(category),
       endpoint_url = VALUES(endpoint_url),
       auth_mode = VALUES(auth_mode),
       owner_role = VALUES(owner_role),
       status = VALUES(status),
       metadata_json = VALUES(metadata_json),
       updated_at = NOW()`,
    [
      normalizeText(data.connection_key),
      normalizeText(data.name),
      normalizeText(data.category) || 'custom',
      normalizeText(data.endpoint_url) || null,
      normalizeText(data.auth_mode) || null,
      normalizeText(data.owner_role) || null,
      normalizeText(data.status) || 'planned',
      stringifyJson(data.metadata_json || {}),
    ]
  );
  const id = result.insertId
    || (await query('SELECT id FROM gateway_integration_connections WHERE connection_key = ? LIMIT 1', [normalizeText(data.connection_key)]))[0]?.id;
  const [row] = await query('SELECT * FROM gateway_integration_connections WHERE id = ? LIMIT 1', [id]);
  return mapIntegrationConnectionRow(row);
}

async function listValueAssessments(projectCode = null) {
  const rows = await query(
    `SELECT * FROM gateway_value_assessments
     ${projectCode ? 'WHERE project_code = ?' : ''}
     ORDER BY updated_at DESC, id DESC`,
    projectCode ? [projectCode] : []
  );
  return rows.map(mapValueAssessmentRow);
}

async function createValueAssessment(data = {}) {
  const projectCode = normalizeText(data.project_code) || 'P05';
  const assessmentKey = normalizeText(data.assessment_key) || `value-assessment-${Date.now()}`;
  const result = await query(
    `INSERT INTO gateway_value_assessments
     (project_code, pipeline_run_id, assessment_key, demand_title, value_summary, assessment_status, assessment_score, confirm_owner, confirm_time, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON))
     ON DUPLICATE KEY UPDATE
       pipeline_run_id = VALUES(pipeline_run_id),
       demand_title = VALUES(demand_title),
       value_summary = VALUES(value_summary),
       assessment_status = VALUES(assessment_status),
       assessment_score = VALUES(assessment_score),
       confirm_owner = VALUES(confirm_owner),
       confirm_time = VALUES(confirm_time),
       metadata_json = VALUES(metadata_json),
       updated_at = NOW()`,
    [
      projectCode,
      data.pipeline_run_id != null ? Number(data.pipeline_run_id) : null,
      assessmentKey,
      normalizeText(data.demand_title) || null,
      normalizeText(data.value_summary) || null,
      normalizeText(data.assessment_status) || 'draft',
      data.assessment_score != null ? Number(data.assessment_score) : null,
      normalizeText(data.confirm_owner) || null,
      data.confirm_time || null,
      stringifyJson(data.metadata_json || {}),
    ]
  );
  const lookup = await query(
    'SELECT id FROM gateway_value_assessments WHERE project_code = ? AND assessment_key = ? LIMIT 1',
    [projectCode, assessmentKey]
  );
  const id = result.insertId || lookup[0]?.id;
  const [row] = await query('SELECT * FROM gateway_value_assessments WHERE id = ? LIMIT 1', [id]);
  return mapValueAssessmentRow(row);
}

async function listCertificationRecords(projectCode = null) {
  const rows = await query(
    `SELECT * FROM gateway_certification_records
     ${projectCode ? 'WHERE project_code = ?' : ''}
     ORDER BY updated_at DESC, id DESC`,
    projectCode ? [projectCode] : []
  );
  return rows.map(mapCertificationRecordRow);
}

async function createCertificationRecord(data = {}) {
  const result = await query(
    `INSERT INTO gateway_certification_records
     (project_code, record_type, subject_name, owner_role, assessment_result, score, effective_date, report_uri, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON))
     ON DUPLICATE KEY UPDATE
       owner_role = VALUES(owner_role),
       assessment_result = VALUES(assessment_result),
       score = VALUES(score),
       effective_date = VALUES(effective_date),
       report_uri = VALUES(report_uri),
       metadata_json = VALUES(metadata_json),
       updated_at = NOW()`,
    [
      normalizeText(data.project_code) || null,
      normalizeText(data.record_type) || 'certification',
      normalizeText(data.subject_name) || '未命名认证记录',
      normalizeText(data.owner_role) || null,
      normalizeText(data.assessment_result) || null,
      data.score != null ? Number(data.score) : null,
      data.effective_date || null,
      normalizeText(data.report_uri) || null,
      stringifyJson(data.metadata_json || {}),
    ]
  );
  const lookup = await query(
    'SELECT id FROM gateway_certification_records WHERE project_code <=> ? AND record_type = ? AND subject_name = ? LIMIT 1',
    [normalizeText(data.project_code) || null, normalizeText(data.record_type) || 'certification', normalizeText(data.subject_name) || '未命名认证记录']
  );
  const id = result.insertId || lookup[0]?.id;
  const [row] = await query('SELECT * FROM gateway_certification_records WHERE id = ? LIMIT 1', [id]);
  return mapCertificationRecordRow(row);
}

async function listAgents() {
  const rows = await query('SELECT * FROM gateway_agent_specs ORDER BY updated_at DESC, id DESC');
  return rows.map((row) =>
    decorateSourceRef(
      {
        ...row,
        tool_bindings: parseJson(row.tool_bindings, []),
        memory_policy: parseJson(row.memory_policy, {}),
        error_policy: parseJson(row.error_policy, {}),
        runtime_env: parseJson(row.runtime_env, {}),
      },
      normalizeText(row.prompt_ref) || null
    )
  );
}

async function listSchemas() {
  const rows = await query('SELECT * FROM gateway_contract_schemas ORDER BY updated_at DESC, id DESC');
  return rows.map((row) =>
    decorateSourceRef(
      {
        ...row,
        json_schema: parseJson(row.json_schema, {}),
        sample_payload: parseJson(row.sample_payload, {}),
      },
      AI_RULES_CONTRACT_SOURCE_MAP[row.schema_key] || `ai-rules/contracts/${row.schema_key}.schema.json`
    )
  );
}

async function listSkills() {
  const rows = await query('SELECT * FROM gateway_skill_packages ORDER BY updated_at DESC, id DESC');
  return rows.map((row) =>
    decorateSourceRef(
      {
        ...row,
        env_tags: parseJson(row.env_tags, []),
        input_decl: parseJson(row.input_decl, {}),
        output_decl: parseJson(row.output_decl, {}),
        tool_refs: parseJson(row.tool_refs, []),
      },
      normalizeText(row.prompt_ref) || null
    )
  );
}

async function decideApproval(id, data) {
  await query(
    `UPDATE gateway_approval_tasks
     SET decision = ?, decision_at = NOW(), comment = ?, status = ?
     WHERE id = ?`,
    [data.decision, data.comment || null, 'completed', id]
  );
  const [row] = await query(
    'SELECT * FROM gateway_approval_tasks WHERE id = ? LIMIT 1',
    [id]
  );
  if (row?.pipeline_run_id) {
    await query(
      `UPDATE gateway_pipeline_runs
       SET approval_status = ?, status = IF(? = 'approved', 'completed', status), ended_at = IF(? = 'approved', NOW(), ended_at), updated_at = NOW()
       WHERE id = ?`,
      [data.decision, data.decision, data.decision, row.pipeline_run_id]
    );
  }
  return row;
}

async function syncGateExecution(data) {
  const projectCode = data.project_code || 'C04';
  await ensureReferenceProject(projectCode);
  const pipeline = await ensureGateReviewPipeline();
  let pipelineRunId = data.pipeline_run_id || null;

  if (pipelineRunId) {
    const existingRun = await query(
      'SELECT id FROM gateway_pipeline_runs WHERE id = ? LIMIT 1',
      [pipelineRunId]
    );
    if (!existingRun[0]) {
      pipelineRunId = null;
    }
  }

  if (!pipelineRunId) {
    const run = await startPipelineRun(pipeline.id, {
      trace_id: data.trace_id || uuidv4(),
      project_code: projectCode,
      source_type: data.source || 'gateway',
      entry_event: 'gate-execution',
      gate_execution_id: data.gate_execution_id || null,
      status: data.passed ? 'completed' : 'running',
      approval_status: data.passed ? 'approved' : 'pending',
    });
    pipelineRunId = run.id;
  }

  const nodes = await query(
    'SELECT * FROM gateway_run_nodes WHERE pipeline_run_id = ? ORDER BY id ASC',
    [pipelineRunId]
  );
  const statusMap = {
    artifact_ingest: 'completed',
    rule_bind: 'completed',
    gate_execute: data.passed ? 'completed' : 'failed',
    approval_or_override: data.passed ? 'skipped' : 'pending',
    evidence_archive: 'completed',
  };
  for (const node of nodes) {
    const nextStatus = statusMap[node.node_key] || node.status;
    await query(
      `UPDATE gateway_run_nodes
       SET status = ?, gate_execution_id = ?, output_summary = ?, updated_at = NOW(), ended_at = IF(? IN ('completed', 'failed', 'skipped'), NOW(), ended_at)
       WHERE id = ?`,
      [
        nextStatus,
        data.gate_execution_id || null,
        data.passed
          ? `${data.gate_name} 通过，得分 ${data.total_score}/${data.max_score}`
          : `${data.gate_name} 未通过，得分 ${data.total_score}/${data.max_score}`,
        nextStatus,
        node.id,
      ]
    );
  }

  if (!data.passed) {
    const existingApproval = await query(
      'SELECT id FROM gateway_approval_tasks WHERE pipeline_run_id = ? AND status = ? LIMIT 1',
      [pipelineRunId, 'pending']
    );
    if (!existingApproval[0]) {
      const approvalNode = nodes.find((node) => node.node_key === 'approval_or_override');
      await query(
        `INSERT INTO gateway_approval_tasks
         (pipeline_run_id, run_node_id, approver_role, payload_summary, decision, status)
         VALUES (?, ?, ?, ?, NULL, 'pending')`,
        [
          pipelineRunId,
          approvalNode?.id || null,
          '项目管理组',
          `${data.gate_name} 未通过，需人工复核`,
        ]
      );
    }
  }

  const evidence = await createEvidencePack({
    project_code: projectCode,
    milestone_type: data.milestone_type || '4_30_gate',
    title: `${data.gate_name} 门禁证据包`,
    review_result: data.passed ? 'passed' : 'failed',
    reviewer: data.author || 'system',
    reviewed_at: new Date(),
    trace_id: data.trace_id,
    pipeline_run_id: pipelineRunId,
    summary: data.document_name || data.gate_name,
    items: [
      {
        item_type: 'gate_execution',
        item_name: data.gate_name,
        item_ref: String(data.gate_execution_id || ''),
        payload_json: {
          total_score: data.total_score,
          max_score: data.max_score,
          passed: data.passed,
          failed_checks: data.failed_checks || [],
          execution_meta: data.execution_meta || {},
        },
      },
    ],
  });

  await query(
    `UPDATE gateway_pipeline_runs
     SET gate_execution_id = ?, trace_id = ?, status = ?, approval_status = ?, project_code = COALESCE(project_code, ?), ended_at = IF(? = 'completed', NOW(), ended_at), updated_at = NOW()
     WHERE id = ?`,
    [
      data.gate_execution_id || null,
      data.trace_id || uuidv4(),
      data.passed ? 'completed' : 'running',
      data.passed ? 'approved' : 'pending',
      projectCode,
      data.passed ? 'completed' : 'running',
      pipelineRunId,
    ]
  );

  await query(
    `INSERT INTO gateway_audit_events
     (event_type, trace_id, project_code, payload_json, source_system)
     VALUES (?, ?, ?, CAST(? AS JSON), ?)`,
    [
      'gate_execution_synced',
      data.trace_id || null,
      projectCode,
      stringifyJson({
        gate_execution_id: data.gate_execution_id,
        pipeline_run_id: pipelineRunId,
        evidence_pack_id: evidence.id,
      }),
      'ai-gateway',
    ]
  );

  return {
    pipeline_run_id: pipelineRunId,
    evidence_pack_id: evidence.id,
    trace_id: data.trace_id,
    project_code: projectCode,
  };
}

async function listCodeRepositories(options = {}) {
  const conditions = [];
  const params = [];
  if (options.project_code) {
    conditions.push('project_code = ?');
    params.push(String(options.project_code));
  }
  if (options.status) {
    conditions.push('status = ?');
    params.push(String(options.status));
  }
  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = await query(
    `SELECT * FROM gateway_code_repositories ${whereClause} ORDER BY updated_at DESC, id DESC`,
    params
  );
  return rows.map(mapCodeRepositoryRow);
}

async function getCodeRepositoryById(id) {
  const [row] = await query('SELECT * FROM gateway_code_repositories WHERE id = ? LIMIT 1', [
    Number(id),
  ]);
  return mapCodeRepositoryRow(row);
}

async function getCodeRepositoryByRepoKey(repoKey) {
  const normalized = normalizeText(repoKey);
  if (!normalized) return null;
  const [row] = await query('SELECT * FROM gateway_code_repositories WHERE repo_key = ? LIMIT 1', [
    normalized,
  ]);
  return mapCodeRepositoryRow(row);
}

async function createCodeRepository(data = {}) {
  const result = await query(
    `INSERT INTO gateway_code_repositories
     (repo_key, project_code, name, local_path, default_branch, language, status, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON))`,
    [
      data.repo_key,
      data.project_code || null,
      data.name,
      data.local_path,
      data.default_branch || 'main',
      data.language || null,
      data.status || 'active',
      stringifyJson(data.metadata_json || {}),
    ]
  );
  return getCodeRepositoryById(result.insertId);
}

async function getDocBundleContextByBundleId(bundleId) {
  const [row] = await query(
    `SELECT * FROM gateway_doc_bundle_contexts WHERE bundle_id = ? LIMIT 1`,
    [bundleId]
  );
  const bundleContext = mapDocBundleContextRow(row);
  if (!bundleContext) return null;
  return {
    ...bundleContext,
    code_repository: bundleContext.code_repository_id
      ? await getCodeRepositoryById(bundleContext.code_repository_id)
      : null,
  };
}

async function upsertDocBundleContext(bundleId, data = {}) {
  const payload = {
    workflow_mode: normalizeText(data.workflow_mode) || 'upload_existing',
    code_repository_id: data.code_repository_id != null ? Number(data.code_repository_id) : null,
    knowledge_scope_json: sanitizeKnowledgeScope(data.knowledge_scope_json),
  };
  const existing = await getDocBundleContextByBundleId(bundleId);
  if (existing?.id) {
    await query(
      `UPDATE gateway_doc_bundle_contexts
       SET workflow_mode = ?, code_repository_id = ?, knowledge_scope_json = CAST(? AS JSON), updated_at = NOW()
       WHERE id = ?`,
      [
        payload.workflow_mode,
        payload.code_repository_id,
        stringifyJson(payload.knowledge_scope_json),
        existing.id,
      ]
    );
  } else {
    await query(
      `INSERT INTO gateway_doc_bundle_contexts
       (bundle_id, workflow_mode, code_repository_id, knowledge_scope_json)
       VALUES (?, ?, ?, CAST(? AS JSON))`,
      [
        bundleId,
        payload.workflow_mode,
        payload.code_repository_id,
        stringifyJson(payload.knowledge_scope_json),
      ]
    );
  }
  return getDocBundleContextByBundleId(bundleId);
}

async function createDocBundle(data) {
  const bundleCode = data.bundle_code || `doc-bundle-${uuidv4().slice(0, 8)}`;
  const traceId = data.trace_id || `trace-doc-${uuidv4().replace(/-/g, '').slice(0, 16)}`;
  const projectCode = data.project_code != null ? String(data.project_code) : null;
  const result = await query(
    `INSERT INTO gateway_doc_bundles
     (bundle_code, trace_id, project_code, title, domain, module_name, version_label, source_mode, status, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      bundleCode,
      traceId,
      projectCode,
      data.title,
      data.domain || null,
      data.module_name || null,
      data.version_label || null,
      data.source_mode || 'hybrid',
      data.status || 'draft',
      data.created_by || 'system',
    ]
  );
  const [row] = await query('SELECT * FROM gateway_doc_bundles WHERE id = ? LIMIT 1', [result.insertId]);
  await upsertDocBundleContext(result.insertId, {
    workflow_mode: data.workflow_mode || 'upload_existing',
    code_repository_id: data.code_repository_id || null,
    knowledge_scope_json: data.knowledge_scope_json || {},
  });
  return getDocBundleById(row.id);
}

function inferDeepWikiRepositoryName(repoSlug = '') {
  const normalized = normalizeText(repoSlug);
  if (!normalized) return 'Deep Wiki 仓库';
  const segments = normalized.split('/').filter(Boolean);
  return segments[segments.length - 1] || normalized;
}

async function listDocBundlesByDeepWikiRunId(runId) {
  const rows = await query(
    `SELECT DISTINCT b.id, b.updated_at
     FROM gateway_doc_bundles b
     INNER JOIN gateway_doc_bundle_contexts c ON c.bundle_id = b.id
     INNER JOIN gateway_code_repositories r ON r.id = c.code_repository_id
     WHERE JSON_UNQUOTE(JSON_EXTRACT(r.metadata_json, '$.deepwiki.run_id')) = ?
     ORDER BY b.updated_at DESC, b.id DESC`,
    [String(Number(runId))]
  );
  const bundles = await Promise.all(rows.map((row) => getDocBundleById(row.id)));
  return bundles.filter(Boolean);
}

async function createDocBundleFromDeepWikiRun(runId, data = {}) {
  const run = await getDeepWikiRunById(runId);
  if (!run) return null;
  const repoSource = run.repo_source || (await getRepoSourceById(run.repo_source_id));
  const snapshot = run.snapshot || (run.snapshot_id ? await getRepoSnapshotById(run.snapshot_id) : null);
  if (!repoSource) {
    throw new Error('Deep Wiki repo source not found');
  }
  if (!snapshot?.local_path) {
    throw new Error('Deep Wiki snapshot not found');
  }

  const pages = Array.isArray(run.pages) ? run.pages : await listDeepWikiPages(run.id);
  const knowledgeAssetIds = uniqueStrings(
    pages
      .map((item) => Number(item.knowledge_asset_id))
      .filter((item) => Number.isFinite(item))
  );
  if (!knowledgeAssetIds.length) {
    throw new Error('Deep Wiki 尚未完成知识资产登记，请先等待知识注册与 RAG 入库完成');
  }

  const branch = normalizeText(snapshot.branch || run.branch || repoSource.default_branch) || 'main';
  const commitSha = normalizeText(snapshot.commit_sha || run.commit_sha);
  const shortCommit = commitSha.slice(0, 8) || 'snapshot';
  const repoName = inferDeepWikiRepositoryName(repoSource.repo_slug);
  const repoKeySeed = `${repoSource.repo_slug}:${branch}:${shortCommit}`;
  const repoKey =
    normalizeText(data.repo_key) ||
    `deepwiki:${sanitizePathSegment(repoName).slice(0, 24)}:${hashText(repoKeySeed).slice(0, 16)}`;
  let codeRepository = await getCodeRepositoryByRepoKey(repoKey);
  if (!codeRepository) {
    codeRepository = await createCodeRepository({
      repo_key: repoKey,
      project_code: normalizeText(data.project_code) || normalizeText(run.project_code) || null,
      name: `${repoName}@${branch}`,
      local_path: snapshot.local_path,
      default_branch: branch,
      language: normalizeText(data.language) || null,
      status: 'active',
      metadata_json: {
        source: 'deepwiki',
        deepwiki: {
          run_id: run.id,
          repo_source_id: repoSource.id,
          snapshot_id: snapshot.id,
          repo_url: repoSource.repo_url,
          repo_slug: repoSource.repo_slug,
          branch,
          commit_sha: commitSha,
          output_root: run.output_root || null,
          knowledge_asset_count: knowledgeAssetIds.length,
        },
      },
    });
  }

  const bundleTitle =
    normalizeText(data.title) ||
    `${repoName} ${branch} 技术与测试方案`;
  const moduleName = normalizeText(data.module_name) || repoName;
  const projectCode =
    normalizeText(data.project_code) || normalizeText(run.project_code) || null;
  const workflowMode = normalizeText(data.workflow_mode) || 'generate_tech_spec';
  const shouldCreatePrdArtifact = data.create_prd_artifact !== false;

  const bundle = await createDocBundle({
    title: bundleTitle,
    module_name: moduleName,
    project_code: projectCode,
    version_label: normalizeText(data.version_label) || shortCommit,
    source_mode: 'hybrid',
    status: 'draft',
    created_by: 'deepwiki-bridge',
    workflow_mode: workflowMode,
    code_repository_id: codeRepository.id,
    knowledge_scope_json: {
      knowledge_asset_ids: knowledgeAssetIds,
      asset_categories: ['代码库类'],
    },
  });

  const prdContent = normalizeText(data.prd_content);
  if (shouldCreatePrdArtifact && prdContent) {
    await createDocArtifact(bundle.id, {
      artifact_type: 'prd',
      source_type: 'generated',
      title: normalizeText(data.prd_title) || `${bundleTitle}—产品 PRD`,
      version_label: bundle.version_label || shortCommit,
      status: 'active',
      content_text: prdContent,
      metadata_json: {
        imported_from: 'deepwiki_bridge',
        deepwiki_run_id: run.id,
      },
    });
  }

  const bundleDetail = await getDocBundleById(bundle.id);
  await query(
    `INSERT INTO gateway_audit_events
     (event_type, trace_id, project_code, payload_json, source_system)
     VALUES (?, ?, ?, CAST(? AS JSON), ?)`,
    [
      'deepwiki_doc_bundle_created',
      run.trace_id,
      projectCode,
      stringifyJson({
        run_id: run.id,
        repo_slug: repoSource.repo_slug,
        branch,
        commit_sha: commitSha,
        bundle_id: bundleDetail?.id || bundle.id,
        code_repository_id: codeRepository.id,
        knowledge_asset_count: knowledgeAssetIds.length,
      }),
      'control-plane',
    ]
  );

  return {
    bundle: bundleDetail,
    code_repository: codeRepository,
    knowledge_asset_ids: knowledgeAssetIds,
    deepwiki_run: {
      id: run.id,
      trace_id: run.trace_id,
      repo_source_id: run.repo_source_id,
      branch,
      commit_sha: commitSha,
    },
  };
}

async function listDocBundlesByDeepWikiSnapshotId(snapshotId) {
  const [snapshot] = await query('SELECT * FROM gateway_wiki_snapshots WHERE id = ? LIMIT 1', [Number(snapshotId)]);
  if (!snapshot?.run_id) return [];
  return listDocBundlesByDeepWikiRunId(Number(snapshot.run_id));
}

async function syncDeepWikiProjectSourceBindings(projectId) {
  const [repoBindings, snapshotRows] = await Promise.all([
    getDeepWikiProjectRepoBindings(projectId),
    query(
      `SELECT id, run_id
       FROM gateway_wiki_snapshots
       WHERE project_id = ?
       ORDER BY id DESC`,
      [Number(projectId)]
    ),
  ]);
  const sourceBindings = [];
  for (const repoBinding of repoBindings) {
    sourceBindings.push(await upsertDeepWikiProjectSourceBinding(projectId, {
      source_type: 'repo',
      source_key: `repo:${Number(repoBinding.repo_source_id)}`,
      source_ref_id: Number(repoBinding.repo_source_id),
      title: repoBinding.repo_source?.repo_slug || repoBinding.repo_slug || `repo:${repoBinding.repo_source_id}`,
      metadata_json: {
        repo_role: repoBinding.repo_role,
        repo_url: repoBinding.repo_source?.repo_url || repoBinding.repo_url || null,
        is_primary: Boolean(repoBinding.is_primary),
      },
    }));
  }
  for (const snapshotRow of snapshotRows) {
    const bundles = await listDocBundlesByDeepWikiRunId(Number(snapshotRow.run_id)).catch(() => []);
    for (const bundle of bundles) {
      const documents = bundle.documents || {};
      const candidateDocs = [
        documents.prd,
        documents.tech_spec,
        documents.api_contract,
        documents.ddl,
        documents.test_plan_final,
        documents.test_plan_ai_draft,
        documents.test_plan_draft,
      ].filter(Boolean);
      for (const doc of candidateDocs) {
        sourceBindings.push(await upsertDeepWikiProjectSourceBinding(projectId, {
          source_type: inferDocumentSourceType(doc.artifact_type),
          source_key: `doc:${bundle.id}:${doc.artifact_type}:${doc.id || hashText(doc.title || doc.storage_uri || '')}`,
          source_ref_id: Number(doc.id || 0) || null,
          title: normalizeText(doc.title) || `${doc.artifact_type}#${doc.id || ''}`,
          metadata_json: {
            bundle_id: bundle.id,
            artifact_type: doc.artifact_type,
            version_label: doc.version_label || null,
            source_uri: doc.storage_uri || null,
          },
        }));
      }
    }
  }
  return sourceBindings;
}

async function syncDeepWikiSnapshotDocumentRevisions(snapshotId) {
  const snapshot = await getDeepWikiSnapshotRecord(snapshotId);
  if (!snapshot) return [];
  const projectBindings = await listDeepWikiProjectSourceBindings(Number(snapshot.project_id));
  const bindingByDocKey = new Map(projectBindings.map((item) => [item.source_key, item]));
  const bundles = await listDocBundlesByDeepWikiSnapshotId(Number(snapshotId));
  const revisions = [];
  for (const bundle of bundles) {
    const documents = bundle.documents || {};
    const candidateDocs = [
      documents.prd,
      documents.tech_spec,
      documents.api_contract,
      documents.ddl,
      documents.test_plan_final,
      documents.test_plan_ai_draft,
      documents.test_plan_draft,
    ].filter(Boolean);
    for (const doc of candidateDocs) {
      const sourceType = inferDocumentSourceType(doc.artifact_type);
      const sourceKey = `doc:${bundle.id}:${doc.artifact_type}:${doc.id || hashText(doc.title || doc.storage_uri || '')}`;
      let binding = bindingByDocKey.get(sourceKey);
      if (!binding) {
        binding = await upsertDeepWikiProjectSourceBinding(Number(snapshot.project_id), {
          source_type: sourceType,
          source_key: sourceKey,
          source_ref_id: Number(doc.id || 0) || null,
          title: normalizeText(doc.title) || `${doc.artifact_type}#${doc.id || ''}`,
          metadata_json: {
            bundle_id: bundle.id,
            artifact_type: doc.artifact_type,
            version_label: doc.version_label || null,
            source_uri: doc.storage_uri || null,
          },
        });
        bindingByDocKey.set(sourceKey, binding);
      }
      revisions.push({
        source_binding_id: binding.id,
        document_type: sourceType,
        title: normalizeText(doc.title) || `${doc.artifact_type}#${doc.id || ''}`,
        source_uri: doc.storage_uri || null,
        version_label: doc.version_label || bundle.version_label || null,
        knowledge_asset_id: Number(doc.metadata_json?.knowledge_asset_id || 0) || null,
        metadata_json: {
          bundle_id: bundle.id,
          artifact_type: doc.artifact_type,
          artifact_id: doc.id || null,
          bundle_code: bundle.bundle_code,
          workflow_mode: bundle.workflow_mode || null,
          content_text: normalizeText(doc.content_text || ''),
        },
      });
    }
  }
  await replaceDeepWikiSnapshotDocumentRevisions(Number(snapshotId), revisions);
  return listDeepWikiSnapshotDocumentRevisions(Number(snapshotId));
}

async function syncDeepWikiSnapshotDiagrams(snapshotId) {
  const snapshot = await getDeepWikiSnapshotRecord(snapshotId);
  if (!snapshot?.run_id) return [];
  const pages = await listDeepWikiPagesBySnapshotId(Number(snapshotId));
  const pageByType = new Map();
  const pageBySlug = new Map();
  pages.forEach((page) => {
    pageBySlug.set(normalizeText(page.page_slug), page);
    if (page.page_type === 'diagram') {
      pageByType.set(inferDiagramTypeFromPage(page), page);
    }
  });
  const diagrams = [];
  for (const spec of DEEPWIKI_PROJECT_DIAGRAM_SPECS) {
    const page =
      pageBySlug.get(spec.fallbackSlug) ||
      pageByType.get(spec.diagram_type) ||
      pages.find((item) => normalizeText(item.page_slug) === spec.fallbackSlug || normalizeText(item.page_slug) === spec.pageType);
    const defaults = getDeepWikiDiagramDefaults(spec.diagram_type);
    const pageMeta = page?.metadata_json && typeof page.metadata_json === 'object' ? page.metadata_json : {};
    diagrams.push({
      diagram_type: spec.diagram_type,
      diagram_key: spec.diagram_key,
      scope_type: 'project',
      scope_key: 'project',
      parent_scope_key: null,
      sort_order: spec.sort_order,
      title: defaults.title,
      format: 'mermaid',
      content: page ? extractMermaidSource(readTextIfExists(page.source_uri) || '') : '',
      render_status: page ? 'ready' : 'missing',
      source_page_id: page?.id || null,
      metadata_json: {
        diagram_key: spec.diagram_key,
        scope_type: 'project',
        scope_key: 'project',
        parent_scope_key: null,
        sort_order: spec.sort_order,
        page_slug: page?.page_slug || null,
        page_type: page?.page_type || null,
        provider: normalizeText(pageMeta.provider) || null,
        model: normalizeText(pageMeta.model) || null,
        render_source: normalizeText(pageMeta.render_source) || (page ? 'fallback_heuristic' : 'missing'),
        diagram_summary: normalizeText(pageMeta.diagram_summary) || null,
        covered_evidence: Array.isArray(pageMeta.covered_evidence) ? pageMeta.covered_evidence : [],
        missing_evidence: Array.isArray(pageMeta.missing_evidence) ? pageMeta.missing_evidence : [],
        quality_notes: Array.isArray(pageMeta.quality_notes) ? pageMeta.quality_notes : [],
        export_assets: {
          mmd: page?.source_uri || null,
        },
      },
    });
  }
  const seenDiagramKeys = new Set(diagrams.map((item) => item.diagram_key));
  pages
    .filter((page) => page.page_type === 'diagram' && normalizeText(page.metadata_json?.diagram_key))
    .forEach((page) => {
      const scope = inferDiagramScopeFromPage(page);
      if (!scope.diagram_key || seenDiagramKeys.has(scope.diagram_key)) return;
      const pageMeta = page?.metadata_json && typeof page.metadata_json === 'object' ? page.metadata_json : {};
      seenDiagramKeys.add(scope.diagram_key);
      diagrams.push({
        diagram_type: normalizeDeepWikiDiagramType(pageMeta.diagram_type || inferDiagramTypeFromPage(page), inferDiagramTypeFromPage(page)),
        diagram_key: scope.diagram_key,
        scope_type: scope.scope_type,
        scope_key: scope.scope_key,
        parent_scope_key: scope.parent_scope_key,
        sort_order: scope.sort_order,
        title: normalizeText(page.title) || normalizeText(pageMeta.title) || normalizeText(scope.diagram_key),
        format: 'mermaid',
        content: extractMermaidSource(readTextIfExists(page.source_uri) || ''),
        render_status: page ? 'ready' : 'missing',
        source_page_id: page?.id || null,
        metadata_json: {
          ...pageMeta,
          diagram_key: scope.diagram_key,
          scope_type: scope.scope_type,
          scope_key: scope.scope_key,
          parent_scope_key: scope.parent_scope_key,
          sort_order: scope.sort_order,
          page_slug: page?.page_slug || null,
          page_type: page?.page_type || null,
          provider: normalizeText(pageMeta.provider) || null,
          model: normalizeText(pageMeta.model) || null,
          render_source: normalizeText(pageMeta.render_source) || 'thread_generated',
          diagram_summary: normalizeText(pageMeta.diagram_summary) || null,
          covered_evidence: Array.isArray(pageMeta.covered_evidence) ? pageMeta.covered_evidence : [],
          missing_evidence: Array.isArray(pageMeta.missing_evidence) ? pageMeta.missing_evidence : [],
          quality_notes: Array.isArray(pageMeta.quality_notes) ? pageMeta.quality_notes : [],
          export_assets: {
            mmd: page?.source_uri || null,
          },
        },
      });
    });
  await replaceDeepWikiSnapshotDiagrams(Number(snapshotId), diagrams);
  return listDeepWikiSnapshotDiagrams(Number(snapshotId));
}

function isRegenerableDeepWikiPageSlug(pageSlug = '') {
  const slug = normalizeText(pageSlug);
  if (slug.startsWith('modules/')) {
    return true;
  }
  if (slug.startsWith('10-domains/')) {
    return true;
  }
  return new Set([
    '00-overview',
    '01-architecture-backbone',
    '02-domain-map',
    '01-code-layered-architecture',
    '02-system-architecture',
    '03-product-architecture',
    '04-business-domain',
    '05-db-schema-and-data-model',
    '06-core-flows',
    '07-key-sequence-diagrams',
    '08-module-flow',
    '20-api-contract-map',
    '21-database-entity-map',
    '22-runtime-boundaries',
    '90-synthesis-and-gaps',
    'diagrams/wiki-overview',
    'diagrams/code-layered-architecture',
    'diagrams/system-architecture',
    'diagrams/product-architecture',
    'diagrams/business-domain',
    'diagrams/core-flow',
    'diagrams/module-flow',
    'diagrams/key-sequence',
    'diagrams/database-er',
  ]).has(slug);
}

async function regenerateDeepWikiSnapshotDiagrams(snapshotId, options = {}) {
  const snapshot = await getDeepWikiSnapshotRecord(Number(snapshotId));
  if (!snapshot?.run_id) return [];
  const [run, repoSource] = await Promise.all([
    getDeepWikiRunRecord(Number(snapshot.run_id)),
    getRepoSourceById(Number(snapshot.repo_source_id)),
  ]);
  if (!run || !repoSource) {
    return syncDeepWikiSnapshotDiagrams(Number(snapshotId));
  }
  const outputRoot =
    normalizeText(snapshot.metadata_json?.output_root) ||
    normalizeText(run.output_root) ||
    '';
  if (!outputRoot) {
    return syncDeepWikiSnapshotDiagrams(Number(snapshotId));
  }

  const inventory = parseJson(readTextIfExists(path.join(outputRoot, 'inventory.json')), null);
  const moduleDigests = parseJson(readTextIfExists(path.join(outputRoot, 'module-digests.json')), []);
  const researchReport = readTextIfExists(path.join(outputRoot, 'deep-research.md')) || '';
  if (!inventory || !Array.isArray(moduleDigests)) {
    return syncDeepWikiSnapshotDiagrams(Number(snapshotId));
  }

  const summary = deepWikiSummaryDefaults(run.summary_json || {});
  const researchSummary = getRecordLike(summary.research, {});
  const sourcesSummary = getRecordLike(summary.sources, {});
  const provider = normalizeText(options.provider || options.research_provider);
  const model = normalizeText(options.model || options.research_model || options.diagram_model);
  const outputProfile =
    normalizeText(options.output_profile || run.output_profile || sourcesSummary.output_profile) ||
    'engineering_architecture_pack';
  const diagramProfile =
    normalizeText(options.diagram_profile || run.diagram_profile || sourcesSummary.diagram_profile) || 'full';
  const providerStrategy = normalizeText(options.provider_strategy) || 'default';
  const requestedDiagramTypes = Array.isArray(options.diagram_types)
    ? options.diagram_types.map((item) => normalizeDeepWikiDiagramType(item, '')).filter(Boolean)
    : [];
  const requestedScopeType = normalizeText(options.scope_type);
  const requestedScopeKey = normalizeText(options.scope_key);
  const existingDiagramSynthesis = parseJson(readTextIfExists(path.join(outputRoot, 'diagram-synthesis.json')), {});

  const synthesizedDiagrams = await synthesizeDeepWikiDiagrams(
    run.trace_id,
    repoSource,
    {
      branch: snapshot.branch,
      commit_sha: snapshot.commit_sha,
      version_line_display_name: snapshot.version_line_display_name,
    },
    inventory,
    moduleDigests,
    researchReport,
    {
      provider,
      model,
      diagram_model: normalizeText(options.diagram_model) || '',
      provider_strategy: providerStrategy,
      diagram_types: requestedDiagramTypes,
      project_force_codex: providerStrategy === 'project_override' ? true : undefined,
    }
  );
  const mergedSynthesizedDiagrams = {
    ...(existingDiagramSynthesis && typeof existingDiagramSynthesis === 'object' ? existingDiagramSynthesis : {}),
    ...(synthesizedDiagrams && typeof synthesizedDiagrams === 'object' ? synthesizedDiagrams : {}),
    _meta: {
      ...((existingDiagramSynthesis && existingDiagramSynthesis._meta) || {}),
      ...((synthesizedDiagrams && synthesizedDiagrams._meta) || {}),
    },
  };

  try {
    fs.writeFileSync(
      path.join(outputRoot, 'diagram-synthesis.json'),
      JSON.stringify(mergedSynthesizedDiagrams || { _meta: { ok: false } }, null, 2),
      'utf8'
    );
    if (Array.isArray(mergedSynthesizedDiagrams?._meta?.attempts)) {
      fs.writeFileSync(
        path.join(outputRoot, 'diagram-synthesis-debug.json'),
        JSON.stringify(
          {
            generated_keys: mergedSynthesizedDiagrams?._meta?.keys || [],
            llm_keys: mergedSynthesizedDiagrams?._meta?.llm_keys || [],
            context_keys: mergedSynthesizedDiagrams?._meta?.context_keys || [],
            attempts: mergedSynthesizedDiagrams._meta.attempts,
          },
          null,
          2
        ),
        'utf8'
      );
    }
    if (mergedSynthesizedDiagrams?._meta?.diagram_context) {
      fs.writeFileSync(
        path.join(outputRoot, 'diagram_context.json'),
        JSON.stringify(mergedSynthesizedDiagrams._meta.diagram_context, null, 2),
        'utf8'
      );
    }
  } catch {
    /* ignore */
  }

  const rebuiltPages = buildDeepWikiPages({
    repo: {
      repo_url: repoSource.repo_url,
      repo_slug: repoSource.repo_slug,
      branch: snapshot.branch,
      commit_sha: snapshot.commit_sha,
    },
    inventory,
    moduleDigests,
    researchReport,
    focusPrompt: normalizeText(run.focus_prompt || run.metadata_json?.focus_prompt),
    researchProvider: provider,
    researchModel: model,
    outputProfile,
    diagramProfile,
    synthesizedDiagrams: mergedSynthesizedDiagrams,
  });
  const graph = await loadDeepWikiKnowledgeGraphBySnapshotId(Number(snapshotId)).catch(() => ({ objects: [], relations: [] }));
  const threadRecords = (await listDeepWikiThreads(Number(snapshotId)).catch(() => []));
  const rebuiltThreads = threadRecords.length ? threadRecords : buildDeepWikiThreadsFromGraph({ inventory, graph });
  const supplementalPages = buildDeepWikiSupplementalPages({ inventory, graph, threads: rebuiltThreads, existingPages: rebuiltPages });
  const threadPages = buildDeepWikiThreadPages(rebuiltThreads, inventory, graph);
  const allRebuiltPages = [...rebuiltPages, ...supplementalPages, ...threadPages];
  const rebuiltPageMap = new Map(
    allRebuiltPages
      .filter((page) => isRegenerableDeepWikiPageSlug(page.page_slug))
      .filter((page) => {
        if (!requestedScopeType && !requestedScopeKey) return true;
        const pageMeta = getRecordLike(page.metadata_json, {});
        if (requestedScopeType && normalizeDeepWikiScopeType(pageMeta.scope_type, '') !== normalizeDeepWikiScopeType(requestedScopeType, '')) {
          return false;
        }
        if (requestedScopeKey && normalizeText(pageMeta.scope_key) !== requestedScopeKey && normalizeText(pageMeta.thread_key) !== requestedScopeKey) {
          return false;
        }
        return true;
      })
      .map((page) => [normalizeText(page.page_slug), page])
  );
  const existingPages = await listDeepWikiPagesBySnapshotId(Number(snapshotId));
  const existingPageBySlug = new Map(existingPages.map((page) => [normalizeText(page.page_slug), page]));
  for (const existingPage of existingPages) {
    const rebuiltPage = rebuiltPageMap.get(normalizeText(existingPage.page_slug));
    if (!rebuiltPage) continue;
    const targetPath = buildDeepWikiPageFilePath(outputRoot, rebuiltPage);
    ensureDir(path.dirname(targetPath));
    fs.writeFileSync(targetPath, rebuiltPage.content || '', 'utf8');
    await query(
      `UPDATE gateway_deepwiki_pages
       SET title = ?,
           page_type = ?,
           source_uri = ?,
           metadata_json = CAST(? AS JSON),
           updated_at = NOW()
       WHERE id = ?`,
      [
        rebuiltPage.title,
        rebuiltPage.page_type,
        targetPath,
        stringifyJson(rebuiltPage.metadata_json || {}),
        Number(existingPage.id),
      ]
    );
  }
  for (const [pageSlug, rebuiltPage] of rebuiltPageMap.entries()) {
    if (existingPageBySlug.has(pageSlug)) continue;
    const targetPath = buildDeepWikiPageFilePath(outputRoot, rebuiltPage);
    ensureDir(path.dirname(targetPath));
    fs.writeFileSync(targetPath, rebuiltPage.content || '', 'utf8');
    await query(
      `INSERT INTO gateway_deepwiki_pages
       (run_id, page_slug, title, page_type, source_uri, ingest_status, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, CAST(? AS JSON))`,
      [
        Number(run.id),
        rebuiltPage.page_slug,
        rebuiltPage.title,
        rebuiltPage.page_type,
        targetPath,
        'pending',
        stringifyJson(rebuiltPage.metadata_json || {}),
      ]
    );
  }

  await patchDeepWikiRun(Number(run.id), {
    summary_json: {
      research: {
        provider,
        model,
      },
      diagram_synthesis: {
        ok: Boolean(mergedSynthesizedDiagrams?._meta?.ok),
        keys: mergedSynthesizedDiagrams?._meta?.keys || [],
        provider,
        model,
        provider_strategy: providerStrategy,
        regenerated_at: new Date().toISOString(),
      },
    },
  }).catch(() => {});

  return syncDeepWikiSnapshotDiagrams(Number(snapshotId));
}

async function listDocBundles() {
  return query(
    `SELECT b.*, c.workflow_mode
     FROM gateway_doc_bundles b
     LEFT JOIN gateway_doc_bundle_contexts c ON c.bundle_id = b.id
     ORDER BY b.updated_at DESC, b.id DESC
     LIMIT 100`
  );
}

async function resolveArtifactContent(data) {
  const inlineText = normalizeText(data.content_text);
  if (inlineText) {
    return { content_text: inlineText, storage_uri: data.storage_uri || null };
  }
  const contentFromFile = readTextIfExists(data.storage_uri);
  return {
    content_text: normalizeText(contentFromFile),
    storage_uri: data.storage_uri || null,
  };
}

async function createDocArtifact(bundleId, data) {
  const resolved = await resolveArtifactContent(data);
  const contentHash = resolved.content_text ? hashText(resolved.content_text) : null;
  const result = await query(
    `INSERT INTO gateway_doc_artifacts
     (bundle_id, artifact_type, source_type, title, storage_uri, content_hash, version_label, status, content_text, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON))`,
    [
      bundleId,
      data.artifact_type,
      data.source_type || 'upload',
      data.title,
      resolved.storage_uri,
      contentHash,
      data.version_label || null,
      data.status || 'ready',
      resolved.content_text || null,
      stringifyJson(data.metadata_json || {}),
    ]
  );
  await query('UPDATE gateway_doc_bundles SET status = ?, updated_at = NOW() WHERE id = ?', ['uploaded', bundleId]);
  const [row] = await query('SELECT * FROM gateway_doc_artifacts WHERE id = ? LIMIT 1', [result.insertId]);
  return row;
}

async function createDocArtifactLink(bundleId, data) {
  const result = await query(
    `INSERT INTO gateway_doc_artifact_links
     (bundle_id, artifact_type, title, uri, version_label, metadata_json)
     VALUES (?, ?, ?, ?, ?, CAST(? AS JSON))`,
    [
      bundleId,
      data.artifact_type,
      data.title,
      data.uri,
      data.version_label || null,
      stringifyJson(data.metadata_json || {}),
    ]
  );
  const [row] = await query('SELECT * FROM gateway_doc_artifact_links WHERE id = ? LIMIT 1', [result.insertId]);
  return row;
}

async function listDocArtifacts(bundleId) {
  const rows = await query(
    'SELECT * FROM gateway_doc_artifacts WHERE bundle_id = ? ORDER BY created_at ASC, id ASC',
    [bundleId]
  );
  return rows.map((row) => ({
    ...row,
    metadata_json: parseJson(row.metadata_json, {}),
  }));
}

async function getDocArtifactById(bundleId, artifactId) {
  const [row] = await query(
    'SELECT * FROM gateway_doc_artifacts WHERE bundle_id = ? AND id = ? LIMIT 1',
    [Number(bundleId), Number(artifactId)]
  );
  if (!row) return null;
  return {
    ...row,
    metadata_json: parseJson(row.metadata_json, {}),
  };
}

async function listDocArtifactLinks(bundleId) {
  const rows = await query(
    'SELECT * FROM gateway_doc_artifact_links WHERE bundle_id = ? ORDER BY created_at ASC, id ASC',
    [bundleId]
  );
  return rows.map((row) => ({
    ...row,
    metadata_json: parseJson(row.metadata_json, {}),
  }));
}

async function listDocGateExecutions(bundleId) {
  const rows = await query(
    'SELECT * FROM gateway_doc_gate_executions WHERE bundle_id = ? ORDER BY created_at DESC, id DESC',
    [bundleId]
  );
  return rows.map((row) => ({
    ...row,
    result_json: parseJson(row.result_json, {}),
  }));
}

async function getBundleDocuments(bundleId) {
  const [bundle] = await query('SELECT * FROM gateway_doc_bundles WHERE id = ? LIMIT 1', [bundleId]);
  if (!bundle) return null;

  const [artifacts, links, bundleContext] = await Promise.all([
    listDocArtifacts(bundleId),
    listDocArtifactLinks(bundleId),
    getDocBundleContextByBundleId(bundleId),
  ]);
  const candidatesByType = new Map();

  for (const artifact of artifacts) {
    const contentText = normalizeText(artifact.content_text || readTextIfExists(artifact.storage_uri));
    const candidate = {
      ...artifact,
      content_text: contentText,
      source_origin: 'artifact',
    };
    const current = candidatesByType.get(artifact.artifact_type);
    if (!current || new Date(candidate.created_at) > new Date(current.created_at)) {
      candidatesByType.set(artifact.artifact_type, candidate);
    }
  }

  for (const link of links) {
    const contentText = normalizeText(readTextIfExists(link.uri));
    const candidate = {
      ...link,
      title: link.title,
      storage_uri: link.uri,
      content_text: contentText,
      source_origin: 'link',
      created_at: link.created_at,
    };
    const current = candidatesByType.get(link.artifact_type);
    if (!current || (!current.content_text && candidate.content_text)) {
      candidatesByType.set(link.artifact_type, candidate);
    }
  }

  const primaryTechSpec = chooseLatestDocument(
    Object.fromEntries(candidatesByType.entries()),
    ['tech_spec_final', 'tech_spec', 'tech_spec_draft']
  );

  return {
    bundle,
    bundle_context: bundleContext || {
      workflow_mode: 'upload_existing',
      code_repository_id: null,
      knowledge_scope_json: sanitizeKnowledgeScope({}),
      code_repository: null,
    },
    artifacts,
    links,
    documents: {
      prd: candidatesByType.get('prd') || null,
      tech_spec: primaryTechSpec,
      tech_spec_uploaded: candidatesByType.get('tech_spec') || null,
      tech_spec_draft: candidatesByType.get('tech_spec_draft') || null,
      tech_spec_final: candidatesByType.get('tech_spec_final') || null,
      api_contract: candidatesByType.get('api_contract') || null,
      ddl: candidatesByType.get('ddl') || null,
      test_plan_draft: candidatesByType.get('test_plan_draft') || null,
      test_plan_ai_draft: candidatesByType.get('test_plan_ai_draft') || null,
      test_plan_final: candidatesByType.get('test_plan_final') || null,
    },
  };
}

function mapCoverageRunRow(row) {
  if (!row) return null;
  return {
    ...row,
    source_artifact_ids: parseJson(row.source_artifact_ids, []),
    graph_json: parseJson(row.graph_json, {}),
    missing_coverage_items: parseJson(row.missing_coverage_items, []),
    unbound_case_items: parseJson(row.unbound_case_items, []),
    uninferable_items: parseJson(row.uninferable_items, []),
  };
}

function mapTestPlanRunRow(row, artifactsById = {}) {
  if (!row) return null;
  return {
    ...row,
    generation_summary_json: parseJson(row.generation_summary_json, {}),
    draft_artifact: artifactsById[row.draft_artifact_id] || null,
    ai_draft_artifact: artifactsById[row.ai_draft_artifact_id] || null,
    final_artifact: artifactsById[row.final_artifact_id] || null,
  };
}

function mapTechSpecRunRow(row, artifactsById = {}) {
  if (!row) return null;
  return {
    ...row,
    generation_summary_json: parseJson(row.generation_summary_json, {}),
    draft_artifact: artifactsById[row.draft_artifact_id] || null,
    final_artifact: artifactsById[row.final_artifact_id] || null,
  };
}

function getArtifactTitle(doc, fallbackLabel) {
  if (!doc) return '未上传';
  return normalizeText(doc.title) || normalizeText(doc.storage_uri) || fallbackLabel;
}

function summarizeArtifact(doc, fallbackLabel) {
  if (!doc) return `${fallbackLabel}: 未上传`;
  return `${fallbackLabel}: ${getArtifactTitle(doc, fallbackLabel)}`;
}

function buildGeneratedArtifactSummary(testPlanRun, techSpecRun) {
  if (!testPlanRun && !techSpecRun) {
    return {
      tech_spec_draft: null,
      tech_spec_final: null,
      template_draft: null,
      ai_enhanced_draft: null,
      final_artifact: null,
    };
  }
  return {
    tech_spec_draft: techSpecRun?.draft_artifact
      ? {
          id: techSpecRun.draft_artifact.id,
          title: techSpecRun.draft_artifact.title,
          status: techSpecRun.draft_artifact.status,
        }
      : null,
    tech_spec_final: techSpecRun?.final_artifact
      ? {
          id: techSpecRun.final_artifact.id,
          title: techSpecRun.final_artifact.title,
          status: techSpecRun.final_artifact.status,
        }
      : null,
    template_draft: testPlanRun.draft_artifact
      ? {
          id: testPlanRun.draft_artifact.id,
          title: testPlanRun.draft_artifact.title,
          status: testPlanRun.draft_artifact.status,
        }
      : null,
    ai_enhanced_draft: testPlanRun.ai_draft_artifact
      ? {
          id: testPlanRun.ai_draft_artifact.id,
          title: testPlanRun.ai_draft_artifact.title,
          status: testPlanRun.ai_draft_artifact.status,
        }
      : null,
    final_artifact: testPlanRun.final_artifact
      ? {
          id: testPlanRun.final_artifact.id,
          title: testPlanRun.final_artifact.title,
          status: testPlanRun.final_artifact.status,
        }
      : null,
  };
}

function summarizeRepositoryContext(summary = {}) {
  const topDirs = (summary.top_level_dirs || []).join('、') || '未识别';
  const codeTouches = (summary.code_touchpoints || []).slice(0, 6).join('、') || '未识别';
  return `仓库目录：${topDirs}；关键触点：${codeTouches}`;
}

async function buildDeepWikiKnowledgeContext(bundleContext = {}, repoContextRun = null) {
  const knowledgeAssets = await resolveKnowledgeScopeAssets(bundleContext);
  const deepWikiAssets = knowledgeAssets.filter((item) => {
    const meta = item.metadata_json && typeof item.metadata_json === 'object' ? item.metadata_json : {};
    return item.asset_type === 'deep_wiki_page' || item.asset_category === '代码库类' || Boolean(meta.run_id);
  });
  const repoMeta = bundleContext?.code_repository?.metadata_json?.deepwiki || {};
  const pageReferences = deepWikiAssets.slice(0, 16).map((item) => {
    const meta = item.metadata_json && typeof item.metadata_json === 'object' ? item.metadata_json : {};
    return {
      id: item.id,
      name: item.name,
      asset_key: item.asset_key,
      page_slug: normalizeText(meta.page_slug) || null,
      page_type: normalizeText(meta.page_type) || null,
      source_files: Array.isArray(meta.source_files) ? meta.source_files.slice(0, 6) : [],
      source_uri: item.source_uri || null,
    };
  });
  const moduleNames = uniqueStrings(
    pageReferences
      .filter((item) => item.page_type === 'module')
      .map((item) => item.page_slug || item.name)
  );

  return {
    repository: {
      repo_slug: normalizeText(repoMeta.repo_slug) || null,
      repo_url: normalizeText(repoMeta.repo_url) || null,
      branch: normalizeText(repoMeta.branch) || bundleContext?.code_repository?.default_branch || null,
      commit_sha: normalizeText(repoMeta.commit_sha) || null,
    },
    repo_context_summary: summarizeRepositoryContext(repoContextRun?.summary_json || {}),
    deepwiki_knowledge_context: {
      asset_count: deepWikiAssets.length,
      module_count: moduleNames.length,
      module_names: moduleNames.slice(0, 12),
      page_titles: pageReferences.map((item) => item.name).filter(Boolean),
    },
    deepwiki_page_references: pageReferences,
    knowledge_assets: knowledgeAssets,
  };
}

function walkRepositoryFiles(rootDir, options = {}, depth = 0, bucket = []) {
  if (!rootDir || !fs.existsSync(rootDir) || bucket.length >= (options.maxFiles || 160)) {
    return bucket;
  }
  if (depth > (options.maxDepth || 4)) return bucket;
  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    if (bucket.length >= (options.maxFiles || 160)) break;
    if (DOC_REPO_SCAN_IGNORES.has(entry.name)) continue;
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      walkRepositoryFiles(fullPath, options, depth + 1, bucket);
    } else {
      bucket.push(fullPath);
    }
  }
  return bucket;
}

function buildRepositoryContextSummary(repository, files = []) {
  const relativeFiles = files
    .map((item) => path.relative(repository.local_path, item))
    .filter(Boolean);
  const topLevelDirs = uniqueStrings(relativeFiles.map((item) => item.split(path.sep)[0]).filter(Boolean)).slice(0, 12);
  const readmePath = files.find((item) => /readme/i.test(path.basename(item)));
  const readmeExcerpt = truncateText(readmePath ? readTextIfExists(readmePath) : '', 800);
  const matchFiles = (pattern) => relativeFiles.filter((item) => pattern.test(item)).slice(0, 10);
  const controllerFiles = matchFiles(/controller|handler|route|router/i);
  const serviceFiles = matchFiles(/service|application|usecase/i);
  const repositoryFiles = matchFiles(/repository|dao|mapper|store/i);
  const apiFiles = matchFiles(/api|openapi|swagger|contract/i);
  const ddlFiles = matchFiles(/ddl|schema|migration|sql/i);
  const configFiles = matchFiles(/config|properties|yaml|yml|env/i);
  const testFiles = matchFiles(/test|spec/i);
  const codeTouchpoints = uniqueStrings([
    ...controllerFiles,
    ...serviceFiles,
    ...repositoryFiles,
    ...apiFiles,
    ...ddlFiles,
  ]).slice(0, 15);
  return {
    repository: {
      id: repository.id,
      repo_key: repository.repo_key,
      name: repository.name,
      language: repository.language,
      default_branch: repository.default_branch,
      local_path: repository.local_path,
    },
    readme_excerpt: readmeExcerpt,
    top_level_dirs: topLevelDirs,
    controller_files: controllerFiles,
    service_files: serviceFiles,
    repository_files: repositoryFiles,
    api_files: apiFiles,
    ddl_files: ddlFiles,
    config_files: configFiles,
    test_files: testFiles,
    code_touchpoints: codeTouchpoints,
    file_count: relativeFiles.length,
  };
}

async function buildRepoContextRun(bundleId) {
  const context = await getBundleDocuments(bundleId);
  if (!context) return null;
  const bundleContext = context.bundle_context || {};
  if (!bundleContext.code_repository_id) {
    throw new Error('Code repository not selected');
  }
  const repository = bundleContext.code_repository || (await getCodeRepositoryById(bundleContext.code_repository_id));
  if (!repository) {
    throw new Error('Code repository not found');
  }
  const repoPath = resolveWorkspacePath(repository.local_path) || repository.local_path;
  if (!fs.existsSync(repoPath)) {
    throw new Error(`Repository path not found: ${repository.local_path}`);
  }
  const files = walkRepositoryFiles(repoPath);
  const summary = buildRepositoryContextSummary({ ...repository, local_path: repoPath }, files);
  const result = await query(
    `INSERT INTO gateway_repo_context_runs
     (bundle_id, code_repository_id, status, summary_json)
     VALUES (?, ?, ?, CAST(? AS JSON))`,
    [bundleId, repository.id, 'ready', stringifyJson(summary)]
  );
  const [row] = await query('SELECT * FROM gateway_repo_context_runs WHERE id = ? LIMIT 1', [
    result.insertId,
  ]);
  return mapRepoContextRunRow(row);
}

async function getLatestRepoContextRun(bundleId) {
  const [row] = await query(
    'SELECT * FROM gateway_repo_context_runs WHERE bundle_id = ? ORDER BY created_at DESC, id DESC LIMIT 1',
    [bundleId]
  );
  return mapRepoContextRunRow(row);
}

async function getLatestTechSpecRun(bundleId) {
  const [row] = await query(
    'SELECT * FROM gateway_tech_spec_generation_runs WHERE bundle_id = ? ORDER BY created_at DESC, id DESC LIMIT 1',
    [bundleId]
  );
  if (!row) return null;
  const [draftRows, finalRows] = await Promise.all([
    row.draft_artifact_id
      ? query('SELECT * FROM gateway_doc_artifacts WHERE id = ? LIMIT 1', [row.draft_artifact_id])
      : Promise.resolve([]),
    row.final_artifact_id
      ? query('SELECT * FROM gateway_doc_artifacts WHERE id = ? LIMIT 1', [row.final_artifact_id])
      : Promise.resolve([]),
  ]);
  return mapTechSpecRunRow(row, {
    [row.draft_artifact_id]: draftRows[0] || null,
    [row.final_artifact_id]: finalRows[0] || null,
  });
}

function buildBundleWorkflowSummary(bundle, context, gates, coverageRuns, testPlanRuns) {
  const latestGateByType = {};
  for (const gate of gates) {
    if (!latestGateByType[gate.gate_type]) {
      latestGateByType[gate.gate_type] = gate;
    }
  }

  const latestCoverage = coverageRuns[0] || null;
  const latestTestPlanRun = testPlanRuns[0] || null;
  const workflowMode = inferWorkflowMode(context.bundle_context);
  const requiredArtifacts = getRequiredArtifactsForMode(workflowMode);
  const recommendedArtifacts = getRecommendedArtifactsForMode(workflowMode);
  const missingRequiredArtifacts = requiredArtifacts.filter((key) => !context.documents[key]);
  const missingRecommendedArtifacts = recommendedArtifacts.filter((key) => !context.documents[key]);
  const orderedStages = getWorkflowStages(workflowMode);
  const latestTechSpecRun = context.latest_tech_spec_run || null;
  const latestRepoContextRun = context.latest_repo_context_run || null;

  let currentStage = 'collect_inputs';
  let blockingGate = null;
  let publishReady = false;
  const recommendedActions = [];

  if (missingRequiredArtifacts.length) {
    recommendedActions.push(`请先上传必需文档：${missingRequiredArtifacts.join('、')}`);
  } else {
    currentStage = 'input_contract';
    if (!latestGateByType.input_contract) {
      recommendedActions.push('执行输入契约检查，确认文档齐套与契约完整性');
    } else if (latestGateByType.input_contract.status === 'block') {
      blockingGate = 'input_contract';
      recommendedActions.push('补齐输入契约门禁缺失项后重新执行');
    } else {
      currentStage = 'prd_gate';
      if (!latestGateByType.prd_gate) {
        recommendedActions.push('执行 PRD 门禁，校验流程、状态机和字段规则');
      } else if (latestGateByType.prd_gate.status === 'block') {
        blockingGate = 'prd_gate';
        recommendedActions.push('修订 PRD 后重新执行 PRD 门禁');
      } else {
        if (workflowMode === 'generate_tech_spec') {
          currentStage = 'repo_context_build';
          if (!context.bundle_context?.code_repository_id) {
            blockingGate = 'repo_context_build';
            recommendedActions.push('先选择平台注册代码仓库');
          } else if (!context.bundle_context?.knowledge_scope_json?.knowledge_asset_ids?.length) {
            blockingGate = 'repo_context_build';
            recommendedActions.push('先选择知识范围，再生成技术方案');
          } else if (!latestRepoContextRun) {
            recommendedActions.push('构建仓库上下文，抽取代码触点、接口、DDL 与配置线索');
          } else if (!latestTechSpecRun?.draft_artifact) {
            currentStage = 'tech_spec_generate';
            recommendedActions.push('基于 PRD、仓库上下文和知识范围生成技术方案');
          } else {
            currentStage = 'tech_spec_gate';
            if (!latestGateByType.tech_spec_gate) {
              recommendedActions.push('执行技术方案门禁，校验接口、数据职责、边界、幂等与可观测性');
            } else if (latestGateByType.tech_spec_gate.status === 'block') {
              blockingGate = 'tech_spec_gate';
              recommendedActions.push('修订生成的技术方案后重新执行技术方案门禁');
            } else {
              currentStage = 'coverage_graph';
            }
          }
        } else {
          currentStage = 'tech_spec_gate';
          if (!latestGateByType.tech_spec_gate) {
            recommendedActions.push('执行技术方案门禁，校验接口、数据职责和边界说明');
          } else if (latestGateByType.tech_spec_gate.status === 'block') {
            blockingGate = 'tech_spec_gate';
            recommendedActions.push('补齐技术方案后重新执行技术方案门禁');
          } else {
            currentStage = 'coverage_graph';
          }
        }

        if (!blockingGate && currentStage === 'coverage_graph') {
          if (!latestCoverage) {
            recommendedActions.push('构建 Coverage Graph，生成覆盖义务与追溯关系');
          } else {
            currentStage = 'test_plan_generate';
            if (!latestTestPlanRun?.draft_artifact) {
              recommendedActions.push('生成测试方案双轨草稿');
            } else {
              currentStage = 'test_plan_gate';
              if (!latestGateByType.test_plan_gate) {
                recommendedActions.push('执行测试方案门禁，确认模板版结构、风险、环境、数据、追溯与发布建议');
              } else if (latestGateByType.test_plan_gate.status === 'block') {
                blockingGate = 'test_plan_gate';
                recommendedActions.push('修订测试方案结构或内容后重新执行测试方案门禁');
              } else {
                currentStage = latestTestPlanRun.final_artifact ? 'publish' : 'publish';
                publishReady = latestGateByType.test_plan_gate.status === 'pass';
                if (!latestTestPlanRun.final_artifact) {
                  recommendedActions.push(
                    publishReady ? '可发布正式版测试方案' : '模板版已通过，AI 增强版告警可接受，按需发布正式版'
                  );
                }
              }
            }
          }
        }
      }
    }
  }

  if (bundle.status === 'published' || latestTestPlanRun?.final_artifact) {
    currentStage = 'publish';
    publishReady = true;
  }

  if (missingRecommendedArtifacts.length) {
    recommendedActions.push(`建议补充推荐文档：${missingRecommendedArtifacts.join('、')}`);
  }

  const latestGate = gates[0] || null;
  const gateStatusSummary = Object.fromEntries(
    ['input_contract', 'prd_gate', 'tech_spec_gate', 'test_plan_gate'].map((gateType) => [
      gateType,
      latestGateByType[gateType]?.status || null,
    ])
  );

  return {
    workflow_mode: workflowMode,
    ordered_stages: orderedStages,
    current_stage: currentStage,
    blocking_gate: blockingGate,
    publish_ready: publishReady,
    last_gate_status: latestGate?.status || null,
    last_gate_summary: latestGate?.summary || null,
    gate_status_summary: gateStatusSummary,
    recommended_actions: uniqueStrings(recommendedActions),
    input_readiness: {
      missing_required_artifacts: missingRequiredArtifacts,
      missing_recommended_artifacts: missingRecommendedArtifacts,
      uploaded_artifacts: [
        summarizeArtifact(context.documents.prd, 'PRD'),
        summarizeArtifact(context.documents.tech_spec, workflowMode === 'generate_tech_spec' ? '技术方案（生成或上传）' : '技术方案'),
        summarizeArtifact(context.documents.api_contract, '接口契约'),
        summarizeArtifact(context.documents.ddl, 'DDL'),
      ],
    },
    generated_artifact_summary: buildGeneratedArtifactSummary(latestTestPlanRun, latestTechSpecRun),
  };
}

async function getDocBundleById(bundleId) {
  const context = await getBundleDocuments(bundleId);
  if (!context) return null;
  const [gates, coverageRows, testPlanRows, repoContextRows, techSpecRows] = await Promise.all([
    listDocGateExecutions(bundleId),
    query('SELECT * FROM gateway_coverage_graph_runs WHERE bundle_id = ? ORDER BY created_at DESC, id DESC', [bundleId]),
    query('SELECT * FROM gateway_test_plan_generation_runs WHERE bundle_id = ? ORDER BY created_at DESC, id DESC', [bundleId]),
    query('SELECT * FROM gateway_repo_context_runs WHERE bundle_id = ? ORDER BY created_at DESC, id DESC', [bundleId]),
    query('SELECT * FROM gateway_tech_spec_generation_runs WHERE bundle_id = ? ORDER BY created_at DESC, id DESC', [bundleId]),
  ]);
  const artifactRows = context.artifacts;
  const artifactsById = artifactRows.reduce((acc, item) => {
    acc[item.id] = item;
    return acc;
  }, {});
  const coverageRuns = coverageRows.map(mapCoverageRunRow);
  const testPlanRuns = testPlanRows.map((row) => mapTestPlanRunRow(row, artifactsById));
  const repoContextRuns = repoContextRows.map(mapRepoContextRunRow);
  const techSpecRuns = techSpecRows.map((row) => mapTechSpecRunRow(row, artifactsById));
  context.latest_repo_context_run = repoContextRuns[0] || null;
  context.latest_tech_spec_run = techSpecRuns[0] || null;
  const workflowSummary = buildBundleWorkflowSummary(context.bundle, context, gates, coverageRuns, testPlanRuns);
  return {
    ...context.bundle,
    bundle_context: context.bundle_context,
    artifacts: context.artifacts,
    links: context.links,
    gates,
    workflow_mode: workflowSummary.workflow_mode,
    current_stage: workflowSummary.current_stage,
    blocking_gate: workflowSummary.blocking_gate,
    recommended_actions: workflowSummary.recommended_actions,
    publish_ready: workflowSummary.publish_ready,
    generated_artifact_summary: workflowSummary.generated_artifact_summary,
    workflow_summary: workflowSummary,
    repo_context_runs: repoContextRuns,
    tech_spec_generation_runs: techSpecRuns,
    coverage_graph_runs: coverageRuns,
    test_plan_generation_runs: testPlanRuns,
  };
}

async function getDocBundleByCode(bundleCode) {
  const [row] = await query('SELECT id FROM gateway_doc_bundles WHERE bundle_code = ? LIMIT 1', [
    bundleCode,
  ]);
  if (!row?.id) return null;
  return getDocBundleById(row.id);
}

async function createDocGateExecution(bundleId, gateType, result) {
  const [bundleRow] = await query('SELECT trace_id FROM gateway_doc_bundles WHERE id = ? LIMIT 1', [bundleId]);
  const traceId = bundleRow?.trace_id || null;
  const nodeKey = GATE_TYPE_TO_STANDARD_NODE_KEY[gateType] || gateType;
  const resultJson = {
    checks: result.checks || [],
    missing_inputs: result.missing_inputs || [],
    risk_items: result.risk_items || [],
    uninferable_items: result.uninferable_items || [],
    missing_coverage_items: result.missing_coverage_items || [],
    unbound_case_items: result.unbound_case_items || [],
    citations: result.citations || [],
    evaluator_meta: result.evaluator_meta || {},
  };
  const summary = formatGateSummary(gateType, result);
  const executionResult = await query(
    `INSERT INTO gateway_doc_gate_executions
     (bundle_id, trace_id, node_key, gate_type, status, score, summary, result_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON))`,
    [
      bundleId,
      traceId,
      nodeKey,
      gateType,
      result.status,
      result.score || null,
      summary,
      stringifyJson(resultJson),
    ]
  );
  await query('UPDATE gateway_doc_bundles SET status = ?, updated_at = NOW() WHERE id = ?', [
    result.status === 'block' ? 'blocked' : 'gating',
    bundleId,
  ]);
  const [row] = await query('SELECT * FROM gateway_doc_gate_executions WHERE id = ? LIMIT 1', [
    executionResult.insertId,
  ]);
  return {
    ...row,
    result_json: parseJson(row.result_json, {}),
  };
}

async function evaluateInputContract(bundleId) {
  const context = await getBundleDocuments(bundleId);
  if (!context) return null;
  const { documents } = context;
  const workflowMode = inferWorkflowMode(context.bundle_context);
  const prdText = normalizeText(documents.prd?.content_text);
  const techText = normalizeText(documents.tech_spec?.content_text);
  const knowledgeScope = sanitizeKnowledgeScope(context.bundle_context?.knowledge_scope_json);

  const checks = [
    { key: 'prd_exists', label: 'PRD 已提供', status: documents.prd ? 'pass' : 'block' },
    {
      key: 'workflow_mode',
      label: '工作模式已设定',
      status: ['upload_existing', 'generate_tech_spec'].includes(workflowMode) ? 'pass' : 'block',
    },
    {
      key: 'tech_exists',
      label: workflowMode === 'generate_tech_spec' ? '技术方案将由平台生成' : '技术方案已提供',
      status: workflowMode === 'generate_tech_spec' ? 'pass' : documents.tech_spec ? 'pass' : 'block',
    },
    {
      key: 'repository_selected',
      label: '平台注册仓库已选择',
      status:
        workflowMode === 'generate_tech_spec'
          ? context.bundle_context?.code_repository_id
            ? 'pass'
            : 'block'
          : 'pass',
    },
    {
      key: 'knowledge_scope_selected',
      label: '知识范围已选择',
      status:
        workflowMode === 'generate_tech_spec'
          ? knowledgeScope.knowledge_asset_ids.length || knowledgeScope.asset_categories.length || knowledgeScope.modules.length || knowledgeScope.domains.length
            ? 'pass'
            : 'block'
          : 'pass',
    },
    { key: 'api_contract_support', label: '接口契约已提供或已引用', status: documents.api_contract ? 'pass' : 'warn', required: false },
    { key: 'ddl_support', label: 'DDL 已提供或已引用', status: documents.ddl ? 'pass' : 'warn', required: false },
    ...buildChecks(prdText, [
      { key: 'prd_main_flow', label: 'PRD 正向主流程', patterns: ['正向主流程', '主流程', '业务流程'] },
      { key: 'prd_reverse_flow', label: 'PRD 逆向流程', patterns: ['逆向流程', '驳回', '作废', '补偿'] },
      { key: 'prd_state_machine', label: 'PRD 状态机/迁移', patterns: ['状态机', '状态迁移', '状态流转'] },
    ]),
    ...(workflowMode === 'generate_tech_spec'
      ? []
      : buildChecks(techText, [
          { key: 'tech_api_entry', label: '技术方案 API 入口', patterns: ['接口设计', 'API', 'Controller', 'Path'] },
          { key: 'tech_data_contract', label: '技术方案数据职责', patterns: ['数据库设计', '表结构', '字段', 'DDL'] },
          { key: 'tech_subprocess', label: '技术方案子流程边界', patterns: ['子流程', '现网', 'confirm', '外部'] },
          { key: 'tech_formula', label: '技术方案公式/累计/闭单条件', patterns: ['公式', '累计', '闭单', '折扣', 'shipped'] },
        ])),
  ];

  const ruleResult = {
    status: aggregateGateStatus(checks),
    score: scoreChecks(checks),
    summary: summarizeChecks(checks),
    checks,
    missing_inputs: checks.filter((check) => check.status === 'block').map((check) => check.label),
    risk_items: checks.filter((check) => check.status === 'warn').map((check) => check.label),
    uninferable_items: [],
  };
  const promptResult = await runPromptGateReview({
    gateType: 'input_contract',
    bundle: context.bundle,
    documents,
    ruleResult,
  });
  const knowledgeExtras = await buildKnowledgeExtras({
    gateType: 'input_contract',
    context,
    candidateText: `${prdText}\n${techText}`,
  });
  const mergedResult = mergeGateResult(ruleResult, promptResult, knowledgeExtras);
  return createDocGateExecution(bundleId, 'input_contract', mergedResult);
}

async function evaluatePrdGate(bundleId) {
  const context = await getBundleDocuments(bundleId);
  if (!context) return null;
  const prdText = normalizeText(context.documents.prd?.content_text);
  const checks = buildChecks(prdText, [
    { key: 'main_flow', label: '正向主流程', patterns: ['正向主流程', '主流程', '业务流程'] },
    { key: 'reverse_flow', label: '逆向流程', patterns: ['逆向流程', '驳回', '作废', '补偿'] },
    { key: 'state_machine', label: '状态机与关键迁移', patterns: ['状态机', '状态迁移', '状态流转'] },
    { key: 'roles', label: '角色与权限边界', patterns: ['角色', '权限', '越权', '可见'] },
    { key: 'prompts', label: '异常与提示语', patterns: ['提示语', '异常', '错误码', '错误提示'] },
    { key: 'field_rules', label: '字段级业务规则', patterns: ['字段', '必填', '回写', '只读', '字段规则'] },
    { key: 'out_of_scope', label: '不在范围', patterns: ['不在.*范围', '一期不做', '范围外'] },
  ]);
  const ruleResult = {
    status: aggregateGateStatus(checks),
    score: scoreChecks(checks),
    summary: summarizeChecks(checks),
    checks,
    missing_inputs: checks.filter((check) => check.status === 'block').map((check) => check.label),
    risk_items: checks.filter((check) => check.status === 'warn').map((check) => check.label),
    uninferable_items: [],
  };
  const promptResult = await runPromptGateReview({
    gateType: 'prd_gate',
    bundle: context.bundle,
    documents: context.documents,
    candidateText: prdText,
    ruleResult,
  });
  const knowledgeExtras = await buildKnowledgeExtras({
    gateType: 'prd_gate',
    context,
    candidateText: prdText,
  });
  const mergedResult = mergeGateResult(ruleResult, promptResult, knowledgeExtras);
  return createDocGateExecution(bundleId, 'prd_gate', mergedResult);
}

async function evaluateTechSpecGate(bundleId) {
  const context = await getBundleDocuments(bundleId);
  if (!context) return null;
  const techText = normalizeText(context.documents.tech_spec?.content_text);
  const checks = [
    ...buildChecks(techText, [
      { key: 'api_entry', label: 'Controller/API 入口', patterns: ['接口设计', 'API', 'Controller', 'Path'] },
      { key: 'service_orchestration', label: 'Application/Service 编排节点', patterns: ['Service', '编排', '时序', '调用关系', '流程图'] },
      { key: 'data_responsibility', label: '数据表与字段职责', patterns: ['数据库设计', 'ER 图', '表结构', '字段'] },
      { key: 'subprocess_boundary', label: '外部/现网子流程边界', patterns: ['子流程', '现网', 'confirm', '外部'] },
      { key: 'idempotency', label: '幂等与补偿/作废顺序', patterns: ['幂等', '补偿', '作废', '乐观锁', '回滚'] },
      { key: 'formula', label: '公式/累计/闭单条件', patterns: ['公式', '累计', '闭单', '折扣', 'shipped'] },
      { key: 'db_checks', label: '必须查库点', patterns: ['查库', 'SQL', '落库', '关键字段'] },
      { key: 'observability', label: '可观测性/日志/指标', patterns: ['可观测', '日志', '指标', '告警'] },
      { key: 'risk_items', label: '风险与待确认项', patterns: ['风险', '待确认', '开放问题'] },
    ]),
    {
      key: 'api_contract_mode',
      label: '接口契约已引用或上传',
      status: context.documents.api_contract ? 'pass' : 'warn',
      required: false,
    },
    {
      key: 'ddl_mode',
      label: 'DDL 已引用或上传',
      status: context.documents.ddl ? 'pass' : 'warn',
      required: false,
    },
  ];
  const ruleResult = {
    status: aggregateGateStatus(checks),
    score: scoreChecks(checks),
    summary: summarizeChecks(checks),
    checks,
    missing_inputs: checks.filter((check) => check.status === 'block').map((check) => check.label),
    risk_items: [],
    uninferable_items: [],
  };
  const promptResult = await runPromptGateReview({
    gateType: 'tech_spec_gate',
    bundle: context.bundle,
    documents: context.documents,
    candidateText: techText,
    ruleResult,
  });
  const knowledgeExtras = await buildKnowledgeExtras({
    gateType: 'tech_spec_gate',
    context,
    candidateText: techText,
  });
  const mergedResult = mergeGateResult(ruleResult, promptResult, knowledgeExtras);
  return createDocGateExecution(bundleId, 'tech_spec_gate', mergedResult);
}

async function assertUpstreamGatesPassed(bundleId) {
  const [inputGate, prdGate, techGate] = await Promise.all([
    getLatestGateExecution(bundleId, 'input_contract'),
    getLatestGateExecution(bundleId, 'prd_gate'),
    getLatestGateExecution(bundleId, 'tech_spec_gate'),
  ]);
  const missing = [];
  if (!inputGate) missing.push('input_contract');
  if (!prdGate) missing.push('prd_gate');
  if (!techGate) missing.push('tech_spec_gate');
  if (missing.length) {
    throw new Error(`Missing upstream gates: ${missing.join(', ')}`);
  }
  const blocked = [inputGate, prdGate, techGate]
    .filter((gate) => gate.status === 'block')
    .map((gate) => gate.gate_type);
  if (blocked.length) {
    throw new Error(`Upstream gates blocked: ${blocked.join(', ')}`);
  }
  return { inputGate, prdGate, techGate };
}

async function buildCoverageGraph(bundleId) {
  const context = await getBundleDocuments(bundleId);
  if (!context) return null;
  await assertUpstreamGatesPassed(bundleId);
  const graph = buildCoverageGraphFromTexts(context.documents);
  const status = graph.missing_coverage_items.length ? 'warn' : 'ready';
  const artifactIds = ['prd', 'tech_spec', 'api_contract', 'ddl']
    .map((key) => context.documents[key]?.id)
    .filter(Boolean);
  const result = await query(
    `INSERT INTO gateway_coverage_graph_runs
     (bundle_id, status, source_artifact_ids, graph_json, missing_coverage_items, unbound_case_items, uninferable_items)
     VALUES (?, ?, CAST(? AS JSON), CAST(? AS JSON), CAST(? AS JSON), CAST(? AS JSON), CAST(? AS JSON))`,
    [
      bundleId,
      status,
      stringifyJson(artifactIds),
      stringifyJson({
        feature_flows: graph.feature_flows,
        reverse_flows: graph.reverse_flows,
        state_transitions: graph.state_transitions,
        api_contracts: graph.api_contracts,
        db_assertions: graph.db_assertions,
        error_prompts: graph.error_prompts,
        subprocess_links: graph.subprocess_links,
        coverage_obligations: graph.coverage_obligations,
      }),
      stringifyJson(graph.missing_coverage_items),
      stringifyJson(graph.unbound_case_items),
      stringifyJson(graph.uninferable_items),
    ]
  );
  await query('UPDATE gateway_doc_bundles SET status = ?, updated_at = NOW() WHERE id = ?', [
    'coverage_ready',
    bundleId,
  ]);
  const [row] = await query('SELECT * FROM gateway_coverage_graph_runs WHERE id = ? LIMIT 1', [
    result.insertId,
  ]);
  return {
    ...row,
    source_artifact_ids: parseJson(row.source_artifact_ids, []),
    graph_json: parseJson(row.graph_json, {}),
    missing_coverage_items: parseJson(row.missing_coverage_items, []),
    unbound_case_items: parseJson(row.unbound_case_items, []),
    uninferable_items: parseJson(row.uninferable_items, []),
  };
}

async function getLatestCoverageGraph(bundleId) {
  const [row] = await query(
    'SELECT * FROM gateway_coverage_graph_runs WHERE bundle_id = ? ORDER BY created_at DESC, id DESC LIMIT 1',
    [bundleId]
  );
  if (!row) return null;
  return {
    ...row,
    source_artifact_ids: parseJson(row.source_artifact_ids, []),
    graph_json: parseJson(row.graph_json, {}),
    missing_coverage_items: parseJson(row.missing_coverage_items, []),
    unbound_case_items: parseJson(row.unbound_case_items, []),
    uninferable_items: parseJson(row.uninferable_items, []),
  };
}

function buildTechSpecMarkdown(bundle, context, repoContextRun, knowledgeAssets = []) {
  const repoSummary = repoContextRun?.summary_json || {};
  const apiPaths = extractMethodPaths(context.documents.api_contract?.content_text || '');
  const fields = extractBacktickedFields(
    [context.documents.ddl?.content_text, context.documents.prd?.content_text].filter(Boolean).join('\n')
  ).slice(0, 12);
  const knowledgeNames = knowledgeAssets.map((asset) => asset.name).filter(Boolean);
  const codeTouchpoints = repoSummary.code_touchpoints || [];
  const controllerFiles = repoSummary.controller_files || [];
  const serviceFiles = repoSummary.service_files || [];
  const repositoryFiles = repoSummary.repository_files || [];
  const configFiles = repoSummary.config_files || [];

  return `# ${bundle.title}—技术方案（生成草稿）

## 1. 背景与范围

- 需求编码：${bundle.bundle_code}
- 模块：${bundle.module_name || '未命名模块'}
- 生成模式：PRD + 平台注册仓库 + 知识范围
- 本技术方案用于承接 PRD 评审通过后的实现设计、测试关注点与门禁校验。

## 2. 业务流程 / 状态机映射

- 正向主流程：结合 PRD 中的业务流程、审核、出库、确认与回写链路实现。
- 逆向与补偿：需覆盖驳回、作废、重复提交、重复 confirm、补偿失败后的回退路径。
- 状态机：应明确 created -> submitted -> approved -> outbound_confirmed -> received / cancelled 等关键迁移。

## 3. 系统上下文与架构概览

- 仓库：${repoSummary.repository?.name || context.bundle_context?.code_repository?.name || '未选择'}
- 默认分支：${repoSummary.repository?.default_branch || 'main'}
- 顶层目录：${(repoSummary.top_level_dirs || []).join('、') || '未识别'}
- README 摘要：${repoSummary.readme_excerpt || '未读取到 README，需在仓库中补充架构说明。'}

## 4. 仓库代码触点与模块职责

- Controller/API 入口：${controllerFiles.join('、') || '需在仓库中定位 controller/route/handler 文件'}
- Application/Service 编排：${serviceFiles.join('、') || '需在 service/application/usecase 文件中补足'}
- Repository/DAO/Mapper：${repositoryFiles.join('、') || '需在 repository/dao/mapper 文件中补足'}
- 关键代码触点：${codeTouchpoints.join('、') || '未识别到明确代码触点'}

## 5. API / 事件 / 契约映射

- API 入口：${apiPaths.join('、') || '需根据接口契约补充 GET/POST/PATCH 路径'}
- 契约来源：${getArtifactTitle(context.documents.api_contract, '接口契约')}
- 事件与回写：需明确审核、出库 confirm、库存扣减、外部回写的请求与回调。

## 6. 数据模型 / 表职责 / 关键字段

- DDL 来源：${getArtifactTitle(context.documents.ddl, 'DDL')}
- 表职责：主表承载单据头状态，明细表承载行项目与库存影响，日志/任务表承载补偿与重试。
- 关键字段：${fields.join('、') || 'order_no、status、approve_status、outbound_confirmed_at、updated_at'}
- 数据职责必须明确到字段回写、校验和 DB 断言。

## 7. 子流程 / 外部依赖边界

- 外部/现网子流程：仓储 confirm、库存服务、审批流、消息回写。
- 边界策略：必须明确同步/异步边界、失败重试点、幂等键来源、外部成功但本地失败时的补偿动作。

## 8. 幂等 / 补偿 / 错误处理

- 幂等键：建议使用单据号 + 状态版本号或业务请求号。
- 补偿顺序：先校验状态，再写业务表，再写重试/补偿任务，最后发送外部调用或消息。
- 错误处理：对越权、非法状态迁移、重复 confirm、库存不足、回写超时给出明确错误码与可复核日志。

## 9. 配置项 / 开关 / 兼容策略

- 配置文件：${configFiles.join('、') || '需补充 config / properties / yaml 位置'}
- 开关建议：允许通过 feature flag 控制新流程、补偿任务与告警阈值。
- 兼容策略：需说明对旧状态、旧接口、旧库存回写逻辑的兼容方式。

## 10. 可观测性 / 日志 / 指标

- 关键日志：单据状态变更日志、外部调用日志、补偿任务日志、幂等命中日志。
- 指标建议：提交成功率、confirm 成功率、补偿任务积压量、非法状态迁移次数、库存回写失败数。
- 告警建议：补偿连续失败、外部成功本地失败、长时间 pending、重复 confirm 高频命中。

## 11. 测试关注点与 DB 断言建议

- 需要覆盖正向主流程、逆向流程、状态迁移、接口断言、字段级 DB 断言、外部子流程边界。
- DB 断言字段建议：${fields.slice(0, 8).join('、') || 'status、approve_status、outbound_confirmed_at、retry_status'}
- SQL / 查库点必须随技术方案一并给出，供测试方案与门禁复用。

## 12. 风险 / 待确认项

- 若仓库代码触点不完整，需补充 README 或模块职责说明。
- 若接口契约 / DDL 缺失，则技术方案中的 API 映射与数据职责只能部分确认。
- 当前知识范围：${knowledgeNames.join('、') || '未绑定知识资产，建议至少选择平台手册和相关规范。'}
- 待确认：状态机最终枚举、外部回写时序、补偿任务归属、观测指标口径。`;
}

function buildTemplateTestPlanMarkdown(bundle, context, coverageRun, inputGate, prdGate, techGate, knowledgeContext = {}) {
  const graph = coverageRun.graph_json || {};
  const obligations = graph.coverage_obligations || [];
  const deepWikiReferences = Array.isArray(knowledgeContext.deepwiki_page_references)
    ? knowledgeContext.deepwiki_page_references
    : [];
  const deepWikiSummary = knowledgeContext.deepwiki_knowledge_context || {};
  const repoContextSummary = normalizeText(knowledgeContext.repo_context_summary);
  const cases = obligations.map((item, index) => ({
    case_id: `TP-${String(index + 1).padStart(3, '0')}`,
    name: item.name,
    priority: index < 3 ? 'P0' : 'P1',
    assertion: item.assertion || '需补充断言',
  }));
  const inputChecks = (inputGate?.result_json?.checks || [])
    .map((check) => `| ${check.label} | ${check.status} | ${check.evidence || '来自输入契约门禁'} |`)
    .join('\n');
  const traceRows = obligations
    .map((item, index) => `| ${item.name} | ${cases[index]?.case_id || '—'} | ${item.assertion || '需补充说明'} |`)
    .join('\n');
  const apiRows = (graph.api_contracts || [])
    .map((item, index) => `| ${item.name} | ${cases[index]?.case_id || 'TP-待补充'} | ${item.assertion} |`)
    .join('\n');
  const stateRows = (graph.state_transitions || [])
    .map((item, index) => `| ${item.name} | ${cases[index]?.case_id || 'TP-待补充'} | ${item.assertion} |`)
    .join('\n');
  const reverseRows = (graph.reverse_flows || [])
    .map((item, index) => `| ${item.name} | ${cases[index]?.case_id || 'TP-待补充'} | ${item.assertion} |`)
    .join('\n');
  const dbRows = (graph.db_assertions || [])
    .slice(0, 20)
    .map((item) => `| ${item.name} | ${item.assertion} |`)
    .join('\n');
  const subprocessRows = (graph.subprocess_links || [])
    .map((item, index) => `| ${item.name} | ${cases[index]?.case_id || 'TP-待补充'} | ${item.assertion} |`)
    .join('\n');
  const referenceRows = deepWikiReferences
    .map((item) => `| ${item.name} | ${item.page_slug || '-'} | ${item.page_type || '-'} | ${(item.source_files || []).join('、') || '-'} |`)
    .join('\n');
  const detailedCases = cases
    .map(
      (item) => `### ${item.case_id} ${item.name}

| 要素 | 内容 |
|------|------|
| 测试目标 | 覆盖 ${item.name} 的功能、状态迁移与断言 |
| 前置条件 | 输入契约、PRD、技术方案、接口契约、DDL 已同步到当前 bundle |
| 测试步骤 | 1. 准备数据。 2. 调用业务入口。 3. 校验接口响应。 4. 校验状态迁移。 5. 校验 DB 字段与日志。 |
| 测试数据 | 标准数据集 + 边界数据集 + 逆向数据集 |
| 预期结果 | ${item.assertion} |
| DB 断言 | 需对关键字段执行 SQL 校验，确保状态、时间、重试任务一致 |
| 优先级 | ${item.priority} |
| 发布影响 | 本用例失败则不允许正式发布 |
`
    )
    .join('\n');

  return `# ${bundle.title}—测试方案（标准模板版草稿）

## 文档信息

| 项 | 内容 |
|:---|:---|
| 任务编码 | ${bundle.bundle_code} |
| 需求名称 | ${bundle.title} |
| 模块 | ${bundle.module_name || '待补充'} |
| 版本 | ${bundle.version_label || '待补充'} |
| PRD | ${getArtifactTitle(context.documents.prd, 'PRD')} |
| 技术方案 | ${getArtifactTitle(context.documents.tech_spec, '技术方案')} |
| 接口契约 | ${getArtifactTitle(context.documents.api_contract, '接口契约')} |
| DDL | ${getArtifactTitle(context.documents.ddl, 'DDL')} |

## 1. 测试目标 / 测试范围 / 不在范围

- 测试目标：验证需求实现是否满足业务规则、接口契约、状态迁移、DB 落库和发布条件。
- 测试范围：覆盖正向主流程、逆向/异常流程、关键接口、Coverage Graph 义务、状态机与字段级 DB 断言。
- 不在范围：本期未纳入的跨域流程、财务结算、独立三方系统深度联调。

## 2. 测试对象 / 版本边界 / 变更范围

- 测试对象：${bundle.title}
- 版本边界：${bundle.version_label || '当前版本'}
- 变更范围：重点验证 PRD 与技术方案涉及的流程、接口、表字段、补偿与可观测性变更。

## 3. 假设 / 依赖 / 约束

- 假设 PRD、技术方案、接口契约、DDL 代表当前待发布版本的唯一主口径。
- 依赖测试环境具备 API 调用能力、日志查询能力与 DB 查询权限。
- 若接口契约或 DDL 缺失，则需在发布前补齐，否则仅允许门禁告警，不允许正式发布。

## 4. 风险清单与优先级

- P0：状态迁移错误、重复 confirm、幂等失效、库存/补偿回写异常、关键字段未落库。
- P1：边界值、异常提示语、配置开关兼容、日志与指标完整性。
- P2：历史缺陷复用、自动化回归覆盖面、报告口径一致性。

## 5. 进入准则 / 退出准则

- 进入准则：输入契约门禁、PRD 门禁、技术方案门禁均已通过或仅剩非阻断告警；Coverage Graph 已生成。
- 退出准则：P0/P1 用例执行完成，关键缺陷关闭或有明确豁免，测试方案门禁 pass，发布建议为“允许发布”。

## 6. 测试环境矩阵

| 环境 | 用途 | 必备能力 |
|------|------|------|
| SIT | 主流程与逆向流程验证 | API 入口、日志、DB 查询、消息/补偿任务查看 |
| UAT | 发布前回归与验收 | 与 SIT 同步的配置、样例数据、角色权限 |

## 7. 环境与依赖

- 仓库上下文：${repoContextSummary || '当前未绑定仓库上下文摘要，需结合 Deep Wiki 或仓库上下文补齐。'}
- Deep Wiki 知识范围：页面 ${Number(deepWikiSummary.asset_count || 0)} 个，模块 ${Number(deepWikiSummary.module_count || 0)} 个。
- Deep Wiki 模块：${Array.isArray(deepWikiSummary.module_names) && deepWikiSummary.module_names.length
    ? deepWikiSummary.module_names.join('、')
    : '暂无模块摘要'}
- 依赖能力：接口调试、日志检索、数据库查询、外部系统联调回执、补偿任务查看。

## 8. 测试数据策略

- 数据分层：标准正向数据、边界值数据、逆向/异常数据、补偿/重试数据。
- 数据来源：接口契约样例、DDL 字段约束、历史缺陷样板。
- 数据要求：每个 P0 场景必须能映射到至少一组可重复准备的数据集。

## 9. 模块测试策略

- 模块级优先级：${Array.isArray(deepWikiSummary.module_names) && deepWikiSummary.module_names.length
    ? deepWikiSummary.module_names.slice(0, 10).join('、')
    : '以 Coverage Graph 识别到的业务模块为准'}
- 每个核心模块至少覆盖：主流程、异常流程、状态迁移、日志断言和 DB 断言。
- 若 Deep Wiki 标记了模块页面，则用模块页面作为测试场景拆分与回归归档依据。

## 10. 接口测试策略

- 接口策略：对正向调用、重复调用、非法参数、越权访问、状态不合法调用分别建例。
- 契约来源：${getArtifactTitle(context.documents.api_contract, '接口契约')}
- 重点关注：返回码、错误文案、幂等语义、状态回写、外部调用联动。

## 11. 数据与 DDL 校验策略

- DDL 来源：${getArtifactTitle(context.documents.ddl, 'DDL')}
- 校验重点：主表/明细表状态字段、时间字段、补偿任务字段、幂等记录字段。
- 每个 P0 场景必须提供 SQL 或查库断言。

## 12. 集成联调策略

- 联调对象：外部子流程、消息/通知链路、库存或审批类外部依赖。
- 联调要求：验证外部成功本地失败、本地成功外部失败、重复回调、超时重试。
- 如 Deep Wiki 已识别外部边界，则以仓库知识页中的边界说明补全联调断言。

## 13. 风险与回归策略

- 发布前回归优先级：主流程 > 状态机 > 接口契约 > DB 断言 > 子流程边界 > 日志与指标。
- 风险来源：Coverage 缺口、Deep Wiki 未覆盖模块、外部联调不稳定、历史缺陷高频区域。
- 回归策略：阻断缺陷修复后必须至少回归同模块主链路和对应逆向链路。

## 14. 测试生成前置契约检查

| 检查项 | 状态 | 备注 |
|------|------|------|
${inputChecks || '| 未执行输入契约门禁 | warn | 请先完成前置门禁 |'}

## 15. PRD 追溯矩阵

| PRD 要求 | 绑定用例 | 说明 |
|------|------|------|
${traceRows || '| 未识别 PRD 要求 | 待补充 | 需先构建 Coverage Graph |'}

## 16. 技术方案追溯矩阵

| 技术约束 | 绑定用例 | 断言 |
|------|------|------|
${traceRows || '| 未识别技术约束 | 待补充 | 需先构建 Coverage Graph |'}

## 17. Coverage Graph / 覆盖义务矩阵

| 覆盖义务 | 绑定用例 | 说明 |
|------|------|------|
${traceRows || '| 未识别覆盖义务 | 待补充 | 需先构建 Coverage Graph |'}

## 18. 接口级验证矩阵

| 接口 | 绑定用例 | 校验重点 |
|------|------|------|
${apiRows || '| 无接口矩阵 | - | 需补充接口契约 |'}

## 19. 状态迁移矩阵

| 状态迁移 | 绑定用例 | 断言 |
|------|------|------|
${stateRows || '| 无状态迁移矩阵 | - | 需补充状态机 |'}

## 20. 逆向 / 非法 / 异常场景矩阵

| 场景 | 绑定用例 | 断言 |
|------|------|------|
${reverseRows || '| 无逆向矩阵 | - | 需补充逆向 / 非法场景 |'}

## 21. 字段级 DB 断言矩阵

| 字段 | 断言 |
|------|------|
${dbRows || '| 无字段级 DB 断言 | 需补齐 DDL 或技术方案 |'}

## 22. 子流程 / 外部系统边界验证

| 子流程 | 绑定用例 | 边界断言 |
|------|------|------|
${subprocessRows || '| 无子流程边界 | - | 本场景无外部边界 |'}

## 23. 用例汇总

| 用例ID | 用例名称 | 优先级 | 关联覆盖义务 | 测试状态 |
|------|------|------|------|------|
${cases.map((item) => `| ${item.case_id} | ${item.name} | ${item.priority} | ${item.name} | 待执行 |`).join('\n') || '| TP-001 | 默认用例 | P0 | 默认覆盖义务 | 待执行 |'}

## 24. 关键用例详述

${detailedCases || '待补充'}

## 25. 缺陷记录策略 / 回归策略

- 缺陷记录需保留步骤、数据、接口响应、日志链路与 SQL 断言结果。
- 回归优先级：先回归 P0 阻断项，再回归状态迁移、逆向与补偿链路。

## 26. 角色与职责

- 产品 / 方案：确认范围、状态机、范围外说明。
- 测试：准备环境、数据、执行用例、记录缺陷与发布建议。
- 开发：提供接口、日志、SQL 断言点与补偿链路解释。

## 27. 资源 / 工时 / 里程碑

- 资源：测试负责人 1 名、开发支持 1 名、产品确认 1 名。
- 里程碑：模板版评审 -> 环境就绪 -> P0 执行完成 -> 发布前门禁结论。

## 28. 度量与报告口径

- 度量：P0 通过率、缺陷关闭率、阻断项数量、环境与数据准备完成度。
- 报告：每日同步关键风险、阻断项和发布建议。

## 29. 自动化范围与回归策略

- 自动化优先覆盖正向主流程、关键状态迁移和重复提交幂等场景。
- 人工回归补足逆向异常、外部边界与 DB 断言核对。

## 30. 历史缺陷复用建议

- 复用历史知识资产中的缺陷样板，优先回归重复提交、外部成功本地失败、补偿重试与状态错乱场景。

## 31. 引用知识来源

| 知识来源 | 页面 slug | 类型 | 关键源文件 |
|------|------|------|------|
${referenceRows || '| 当前未绑定 Deep Wiki 页面 | - | - | - |'}

## 32. 发布建议与门禁结论

- 输入契约门禁：${inputGate?.status || '未执行'}
- PRD 门禁：${prdGate?.status || '未执行'}
- 技术方案门禁：${techGate?.status || '未执行'}
- Coverage Graph 状态：${coverageRun.status}
- 门禁遗留项：缺失覆盖项 ${coverageRun.missing_coverage_items?.length || 0} 个，未绑定义务 ${coverageRun.unbound_case_items?.length || 0} 个。
- 发布建议：${coverageRun.missing_coverage_items?.length || coverageRun.unbound_case_items?.length ? '暂不建议发布，需先补齐覆盖义务。' : '满足模板版发布主口径，可进入测试方案门禁与正式发布。'}

## 33. 发布前门禁结论

- 本文档为标准模板版草稿，是正式发布主口径。`;
}

function buildAiEnhancedTestPlanMarkdown(bundle, context, coverageRun, templateMarkdown, knowledgeContext = {}) {
  const graph = coverageRun.graph_json || {};
  const featureFlows = graph.feature_flows || [];
  const reverseFlows = graph.reverse_flows || [];
  const dbAssertions = graph.db_assertions || [];
  const apiContracts = graph.api_contracts || [];
  const subprocessLinks = graph.subprocess_links || [];
  const deepWikiReferences = Array.isArray(knowledgeContext.deepwiki_page_references)
    ? knowledgeContext.deepwiki_page_references
    : [];

  return `# ${bundle.title}—测试方案（AI 增强版草稿）

## 1. AI 增强说明

- 本文基于标准模板版扩展，只补充边界值、组合场景、异常分支、测试数据建议和 SQL / 日志 / 指标断言建议。
- 若与模板版冲突，以模板版为准；AI 增强版不单独作为发布主口径。

## 2. 边界值与组合场景

${featureFlows.map((item, index) => `${index + 1}. ${item.name}：补充最小值、最大值、空值、重复提交、并发冲突、跨仓/跨角色组合等边界验证。`).join('\n') || '1. 当前未识别边界场景，请结合模板版补充边界值矩阵。'}

## 3. 恢复路径 / 异常分支建议

${reverseFlows.map((item, index) => `${index + 1}. ${item.name}：补充非法入口、状态越权、补偿失败、重试恢复与人工回滚路径。`).join('\n') || '1. 当前未识别逆向场景，请补充恢复路径与异常分支。'}

## 4. 推荐测试数据集

| 数据组 | 场景 | 目的 |
|------|------|------|
${apiContracts
  .slice(0, 10)
  .map((item, index) => `| DATA-${String(index + 1).padStart(2, '0')} | ${item.name} | 覆盖接口、状态迁移和字段断言 |`)
  .join('\n') || '| DATA-01 | 标准主流程 | 覆盖主链路 |'}

## 5. SQL / 日志 / 指标断言建议

| 对象 | 断言建议 |
|------|------|
${dbAssertions
  .slice(0, 12)
  .map((item) => `| ${item.name} | ${item.assertion}；同时校验日志链路和指标上报是否一致 |`)
  .join('\n') || '| 默认对象 | 建议增加字段级落库校验、日志校验和指标校验 |'}

## 6. 高风险场景优先执行建议

- 优先验证重复提交、重复 confirm、补偿任务失败、外部成功本地失败、非法状态迁移、子流程边界错配。
- 子流程 / 外部依赖：${subprocessLinks.map((item) => item.name).join('、') || '无显式子流程'}

## 7. 历史知识资产缺陷复用建议

- 复用平台知识资产中的历史缺陷样板，优先对幂等、状态错乱、库存回写、配置开关切换等问题做回归。

## 8. Deep Wiki 引用补充

${deepWikiReferences.length
    ? deepWikiReferences
        .map((item, index) => `${index + 1}. ${item.name}（${item.page_slug || '未标注 slug'}）`)
        .join('\n')
    : '1. 当前未绑定 Deep Wiki 页面引用，建议补齐后重新生成。'}

## 9. 标准模板版引用

\`\`\`markdown
${truncateText(templateMarkdown, 1800)}
\`\`\`
`;
}

async function resolveKnowledgeScopeAssets(bundleContext) {
  const scope = sanitizeKnowledgeScope(bundleContext?.knowledge_scope_json);
  if (scope.knowledge_asset_ids.length) {
    return listKnowledgeAssets({ ids: scope.knowledge_asset_ids, status: 'active' });
  }
  const filters = {};
  if (scope.asset_categories[0]) filters.asset_category = scope.asset_categories[0];
  if (scope.domains[0]) filters.domain = scope.domains[0];
  if (scope.modules[0]) filters.module = scope.modules[0];
  const rows = await listKnowledgeAssets(Object.keys(filters).length ? { ...filters, status: 'active' } : { status: 'active' });
  return rows.slice(0, 12);
}

async function generateTechSpec(bundleId) {
  const context = await getBundleDocuments(bundleId);
  if (!context) return null;
  const bundleContext = context.bundle_context || {};
  if (inferWorkflowMode(bundleContext) !== 'generate_tech_spec') {
    throw new Error('Current bundle is not in generate_tech_spec mode');
  }
  const [inputGate, prdGate] = await Promise.all([
    getLatestGateExecution(bundleId, 'input_contract'),
    getLatestGateExecution(bundleId, 'prd_gate'),
  ]);
  if (!inputGate || inputGate.status === 'block') {
    throw new Error('Input contract gate must pass before tech spec generation');
  }
  if (!prdGate || prdGate.status === 'block') {
    throw new Error('PRD gate must pass before tech spec generation');
  }
  const repoContextRun = (await getLatestRepoContextRun(bundleId)) || (await buildRepoContextRun(bundleId));
  const knowledgeAssets = await resolveKnowledgeScopeAssets(bundleContext);
  const markdown = buildTechSpecMarkdown(context.bundle, context, repoContextRun, knowledgeAssets);
  const draftArtifact = await createDocArtifact(bundleId, {
    artifact_type: 'tech_spec_draft',
    source_type: 'generated',
    title: `${context.bundle.title}—技术方案（生成草稿）`,
    version_label: context.bundle.version_label || 'draft',
    status: 'draft',
    content_text: markdown,
    metadata_json: {
      repo_context_run_id: repoContextRun?.id || null,
      knowledge_asset_ids: knowledgeAssets.map((item) => item.id),
      generated_from: 'repo_context + prd + knowledge_scope',
    },
  });
  const result = await query(
    `INSERT INTO gateway_tech_spec_generation_runs
     (bundle_id, repo_context_run_id, draft_artifact_id, status, generation_summary_json)
     VALUES (?, ?, ?, ?, CAST(? AS JSON))`,
    [
      bundleId,
      repoContextRun?.id || null,
      draftArtifact.id,
      'draft',
      stringifyJson({
        repository: bundleContext.code_repository?.name || null,
        repo_context_summary: summarizeRepositoryContext(repoContextRun?.summary_json || {}),
        knowledge_assets: knowledgeAssets.map((item) => ({ id: item.id, name: item.name })),
      }),
    ]
  );
  await query('UPDATE gateway_doc_bundles SET status = ?, updated_at = NOW() WHERE id = ?', [
    'review',
    bundleId,
  ]);
  const [row] = await query(
    'SELECT * FROM gateway_tech_spec_generation_runs WHERE id = ? LIMIT 1',
    [result.insertId]
  );
  return mapTechSpecRunRow(row, {
    [draftArtifact.id]: draftArtifact,
  });
}

async function getLatestGateExecution(bundleId, gateType) {
  const [row] = await query(
    `SELECT * FROM gateway_doc_gate_executions
     WHERE bundle_id = ? AND gate_type = ?
     ORDER BY created_at DESC, id DESC
     LIMIT 1`,
    [bundleId, gateType]
  );
  if (!row) return null;
  return {
    ...row,
    result_json: parseJson(row.result_json, {}),
  };
}

async function generateTestPlan(bundleId) {
  const context = await getBundleDocuments(bundleId);
  if (!context) return null;
  const upstream = await assertUpstreamGatesPassed(bundleId);
  const coverageRun = await getLatestCoverageGraph(bundleId);
  if (!coverageRun) {
    throw new Error('Coverage Graph not found');
  }
  const { inputGate, prdGate, techGate } = upstream;
  const bundleContext = context.bundle_context || {};
  const repoContextRun =
    bundleContext.code_repository_id
      ? ((await getLatestRepoContextRun(bundleId)) || (await buildRepoContextRun(bundleId)))
      : null;
  const knowledgeContext = await buildDeepWikiKnowledgeContext(bundleContext, repoContextRun);
  const templateMarkdown = buildTemplateTestPlanMarkdown(
    context.bundle,
    context,
    coverageRun,
    inputGate,
    prdGate,
    techGate,
    knowledgeContext
  );
  const aiEnhancedMarkdown = buildAiEnhancedTestPlanMarkdown(
    context.bundle,
    context,
    coverageRun,
    templateMarkdown,
    knowledgeContext
  );
  const draftArtifact = await createDocArtifact(bundleId, {
    artifact_type: 'test_plan_draft',
    source_type: 'generated',
    title: `${context.bundle.title}—测试方案（标准模板版草稿）`,
    version_label: context.bundle.version_label || 'draft',
    status: 'draft',
    content_text: templateMarkdown,
    metadata_json: {
      coverage_graph_run_id: coverageRun.id,
      track: 'template',
      gate_statuses: {
        input_contract: inputGate?.status || null,
        prd_gate: prdGate?.status || null,
        tech_spec_gate: techGate?.status || null,
      },
      knowledge_asset_ids: knowledgeContext.knowledge_assets.map((item) => item.id),
      deepwiki_reference_count: knowledgeContext.deepwiki_page_references.length,
      repo_context_summary: knowledgeContext.repo_context_summary,
    },
  });
  const aiDraftArtifact = await createDocArtifact(bundleId, {
    artifact_type: 'test_plan_ai_draft',
    source_type: 'generated',
    title: `${context.bundle.title}—测试方案（AI 增强版草稿）`,
    version_label: context.bundle.version_label || 'draft',
    status: 'draft',
    content_text: aiEnhancedMarkdown,
    metadata_json: {
      coverage_graph_run_id: coverageRun.id,
      track: 'ai_enhanced',
      template_artifact_id: draftArtifact.id,
      knowledge_asset_ids: knowledgeContext.knowledge_assets.map((item) => item.id),
      deepwiki_reference_count: knowledgeContext.deepwiki_page_references.length,
    },
  });
  const result = await query(
    `INSERT INTO gateway_test_plan_generation_runs
     (bundle_id, coverage_graph_run_id, draft_artifact_id, ai_draft_artifact_id, status, generation_mode, generation_summary_json)
     VALUES (?, ?, ?, ?, ?, ?, CAST(? AS JSON))`,
    [
      bundleId,
      coverageRun.id,
      draftArtifact.id,
      aiDraftArtifact.id,
      'draft',
      'dual_track',
      stringifyJson({
        template_title: draftArtifact.title,
        ai_enhanced_title: aiDraftArtifact.title,
        publish_policy: 'template_pass_ai_warn_allowed',
        repo_context_summary: knowledgeContext.repo_context_summary,
        deepwiki_knowledge_context: knowledgeContext.deepwiki_knowledge_context,
        deepwiki_page_references: knowledgeContext.deepwiki_page_references.map((item) => ({
          id: item.id,
          name: item.name,
          page_slug: item.page_slug,
          page_type: item.page_type,
        })),
      }),
    ]
  );
  await query('UPDATE gateway_doc_bundles SET status = ?, updated_at = NOW() WHERE id = ?', [
    'review',
    bundleId,
  ]);
  const [row] = await query(
    'SELECT * FROM gateway_test_plan_generation_runs WHERE id = ? LIMIT 1',
    [result.insertId]
  );
  return mapTestPlanRunRow(row, {
    [draftArtifact.id]: draftArtifact,
    [aiDraftArtifact.id]: aiDraftArtifact,
  });
}

async function getLatestTestPlanRun(bundleId) {
  const [row] = await query(
    'SELECT * FROM gateway_test_plan_generation_runs WHERE bundle_id = ? ORDER BY created_at DESC, id DESC LIMIT 1',
    [bundleId]
  );
  if (!row) return null;
  const [draftArtifact, aiDraftArtifact, finalArtifact] = await Promise.all([
    row.draft_artifact_id
      ? query('SELECT * FROM gateway_doc_artifacts WHERE id = ? LIMIT 1', [row.draft_artifact_id])
      : Promise.resolve([]),
    row.ai_draft_artifact_id
      ? query('SELECT * FROM gateway_doc_artifacts WHERE id = ? LIMIT 1', [row.ai_draft_artifact_id])
      : Promise.resolve([]),
    row.final_artifact_id
      ? query('SELECT * FROM gateway_doc_artifacts WHERE id = ? LIMIT 1', [row.final_artifact_id])
      : Promise.resolve([]),
  ]);
  return mapTestPlanRunRow(row, {
    [row.draft_artifact_id]: draftArtifact[0] || null,
    [row.ai_draft_artifact_id]: aiDraftArtifact[0] || null,
    [row.final_artifact_id]: finalArtifact[0] || null,
  });
}

async function evaluateTestPlanGate(bundleId) {
  const context = await getBundleDocuments(bundleId);
  if (!context) return null;
  const latestRun = await getLatestTestPlanRun(bundleId);
  const coverageRun = await getLatestCoverageGraph(bundleId);
  const templatePlanText = normalizeText(
    latestRun?.draft_artifact?.content_text ||
      latestRun?.final_artifact?.content_text ||
      context.documents.test_plan_draft?.content_text ||
      context.documents.test_plan_final?.content_text
  );
  const aiEnhancedPlanText = normalizeText(
    latestRun?.ai_draft_artifact?.content_text || context.documents.test_plan_ai_draft?.content_text
  );
  const templateChecks = buildChecks(templatePlanText, [
    { key: 'scope_section', label: '测试目标 / 测试范围 / 不在范围', patterns: ['测试目标', '测试范围', '不在范围'] },
    { key: 'version_boundary', label: '测试对象 / 版本边界 / 变更范围', patterns: ['版本边界', '变更范围'] },
    { key: 'assumptions', label: '假设 / 依赖 / 约束', patterns: ['假设', '依赖', '约束'] },
    { key: 'risk_section', label: '风险清单与优先级', patterns: ['风险清单', '优先级'] },
    { key: 'entry_exit_criteria', label: '进入准则 / 退出准则', patterns: ['进入准则', '退出准则'] },
    { key: 'environment_matrix', label: '测试环境矩阵', patterns: ['测试环境矩阵'] },
    { key: 'data_strategy', label: '测试数据策略', patterns: ['测试数据策略'] },
    { key: 'input_contract_section', label: '测试生成前置契约检查', patterns: ['测试生成前置契约检查'] },
    { key: 'prd_traceability_section', label: 'PRD 追溯矩阵', patterns: ['PRD 追溯矩阵'] },
    { key: 'tech_traceability_section', label: '技术方案追溯矩阵', patterns: ['技术方案追溯矩阵'] },
    { key: 'coverage_graph_section', label: 'Coverage Graph / 覆盖义务矩阵', patterns: ['Coverage Graph', '覆盖义务矩阵'] },
    { key: 'api_matrix', label: '接口级验证矩阵', patterns: ['接口级验证矩阵'] },
    { key: 'state_transition', label: '状态迁移矩阵', patterns: ['状态迁移矩阵'] },
    { key: 'reverse_flow', label: '逆向 / 非法 / 异常场景矩阵', patterns: ['逆向 / 非法 / 异常场景矩阵', '逆向', '异常场景'] },
    { key: 'db_assertions', label: '字段级 DB 断言矩阵', patterns: ['字段级 DB 断言矩阵', 'SQL'] },
    { key: 'subprocess_boundary', label: '子流程 / 外部系统边界验证', patterns: ['子流程 / 外部系统边界验证'] },
    { key: 'case_summary', label: '用例汇总', patterns: ['用例汇总'] },
    { key: 'case_details', label: '关键用例详述', patterns: ['关键用例详述', '测试步骤'] },
    { key: 'defect_strategy', label: '缺陷记录策略 / 回归策略', patterns: ['缺陷记录策略', '回归策略'] },
    { key: 'publish_recommendation', label: '发布建议与门禁结论', patterns: ['发布建议', '门禁结论'] },
    { key: 'publish_conclusion', label: '发布前门禁结论', patterns: ['发布前门禁结论'] },
    { key: 'roles', label: '角色与职责', patterns: ['角色与职责'], required: false },
    { key: 'resource_plan', label: '资源 / 工时 / 里程碑', patterns: ['资源 / 工时 / 里程碑'], required: false },
    { key: 'metrics_report', label: '度量与报告口径', patterns: ['度量与报告口径'], required: false },
    { key: 'automation_strategy', label: '自动化范围与回归策略', patterns: ['自动化范围与回归策略'], required: false },
    { key: 'historical_reuse', label: '历史缺陷复用建议', patterns: ['历史缺陷复用建议'], required: false },
  ]);
  const aiChecks = buildChecks(aiEnhancedPlanText, [
    { key: 'ai_enhanced_section', label: 'AI 增强说明', patterns: ['AI 增强说明'] },
    { key: 'boundary_cases', label: '边界值与组合场景', patterns: ['边界值与组合场景'] },
    { key: 'recovery_paths', label: '恢复路径 / 异常分支建议', patterns: ['恢复路径', '异常分支建议'] },
    { key: 'recommended_test_data', label: '推荐测试数据集', patterns: ['推荐测试数据集'] },
    { key: 'sql_suggestions', label: 'SQL / 日志 / 指标断言建议', patterns: ['SQL / 日志 / 指标断言建议'] },
    { key: 'history_reuse', label: '历史知识资产缺陷复用建议', patterns: ['历史知识资产缺陷复用建议'] },
  ]).map((check) => ({ ...check, required: false, status: check.status === 'block' ? 'warn' : check.status }));
  const placeholderHits = ['待补充', 'TBD', 'TODO'].filter((marker) => templatePlanText.includes(marker));
  const graph = coverageRun || {
    missing_coverage_items: ['缺 Coverage Graph'],
    uninferable_items: ['缺 Coverage Graph'],
    graph_json: { coverage_obligations: [] },
  };
  const bundleContext = context.bundle_context || {};
  const knowledgeScope = sanitizeKnowledgeScope(bundleContext.knowledge_scope_json);
  const hasDeepWikiKnowledgeScope = Boolean(bundleContext.code_repository_id) || knowledgeScope.knowledge_asset_ids.length > 0;
  const hasDeepWikiReferenceSection =
    /引用知识来源/i.test(templatePlanText) &&
    (/Deep Wiki/i.test(templatePlanText) || /页面 slug/i.test(templatePlanText) || /仓库上下文/i.test(templatePlanText));
  const obligationNames = (graph.graph_json?.coverage_obligations || []).map((item) => item.name);
  const unboundCaseItems = obligationNames.filter((name) => !templatePlanText.includes(name));
  const missingCoverageItems = graph.missing_coverage_items || [];
  const templateBlockItems = [
    ...templateChecks.filter((check) => check.status === 'block').map((check) => check.label),
    ...missingCoverageItems,
    ...unboundCaseItems,
    ...(placeholderHits.length ? ['正式发布内容残留 TODO/TBD/待补充'] : []),
  ];
  const templateWarnItems = templateChecks
    .filter((check) => check.status === 'warn')
    .map((check) => check.label);
  if (hasDeepWikiKnowledgeScope && !hasDeepWikiReferenceSection) {
    templateWarnItems.push('已绑定 Deep Wiki 知识范围，但测试方案未体现知识引用或仓库上下文摘要');
  }
  const aiWarnings = aiChecks.filter((check) => check.status !== 'pass').map((check) => check.label);
  const templateStatus = templateBlockItems.length
    ? 'block'
    : templateWarnItems.length || (graph.uninferable_items || []).length
      ? 'warn'
      : 'pass';
  const ruleResult = {
    status: templateStatus,
    score: scoreChecks([...templateChecks, ...aiChecks]),
    summary:
      templateStatus === 'pass'
        ? aiWarnings.length
          ? '模板版满足发布主口径，AI 增强版存在告警但不阻断发布'
          : '模板版与 AI 增强版均满足当前发布要求'
        : templateStatus === 'warn'
          ? '模板版存在专业度告警，暂不建议发布'
          : '模板版存在阻断项，不能发布',
    checks: [...templateChecks, ...aiChecks],
    missing_inputs: templateBlockItems,
    risk_items: [...templateWarnItems, ...(graph.uninferable_items || []), ...aiWarnings],
    missing_coverage_items: missingCoverageItems,
    unbound_case_items: unboundCaseItems,
    uninferable_items: graph.uninferable_items || [],
  };
  const promptResult = await runPromptGateReview({
    gateType: 'test_plan_gate',
    bundle: context.bundle,
    documents: context.documents,
    candidateText: `${templatePlanText}\n\n${aiEnhancedPlanText}`,
    ruleResult,
    coverageGraph: graph,
  });
  const knowledgeExtras = await buildKnowledgeExtras({
    gateType: 'test_plan_gate',
    context,
    candidateText: `${templatePlanText}\n\n${aiEnhancedPlanText}`,
  });
  const mergedResult = {
    ...ruleResult,
    citations: knowledgeExtras.citations || [],
    evaluator_meta: {
      rule: {
        ...ruleResult,
        template_status: templateStatus,
        ai_status: aiWarnings.length ? 'warn' : 'pass',
        publish_contract: {
          template_gate: templateStatus,
          ai_gate: aiWarnings.length ? 'warn' : 'pass',
        },
      },
      prompt: promptResult?.disabled
        ? { disabled: true, reason: promptResult.reason }
        : promptResult || null,
      coverage: {
        status: coverageRun?.status || 'missing',
        missing_coverage_items: missingCoverageItems,
        unbound_case_items: unboundCaseItems,
      },
      knowledge: knowledgeExtras.knowledge || null,
    },
    risk_items: dedupeList([
      ...ruleResult.risk_items,
      ...(promptResult?.disabled ? [promptResult.reason] : []),
      ...(promptResult?.risk_items || []),
    ]),
  };
  const gateExecution = await createDocGateExecution(bundleId, 'test_plan_gate', mergedResult);
  if (latestRun) {
    await query(
      'UPDATE gateway_test_plan_generation_runs SET gate_execution_id = ?, status = ?, updated_at = NOW() WHERE id = ?',
      [gateExecution.id, mergedResult.status === 'pass' ? 'gated' : mergedResult.status === 'warn' ? 'review' : 'blocked', latestRun.id]
    );
  }
  return gateExecution;
}

async function publishTestPlan(bundleId) {
  const latestRun = await getLatestTestPlanRun(bundleId);
  if (!latestRun?.draft_artifact) {
    throw new Error('Draft test plan not found');
  }
  const latestGate = await getLatestGateExecution(bundleId, 'test_plan_gate');
  const templateGateStatus = latestGate?.result_json?.evaluator_meta?.rule?.template_status;
  if (!latestGate || (latestGate.status !== 'pass' && templateGateStatus !== 'pass')) {
    throw new Error('Test plan gate must pass before publish');
  }
  const finalArtifact = await createDocArtifact(bundleId, {
    artifact_type: 'test_plan_final',
    source_type: 'generated',
    title: latestRun.draft_artifact.title.replace('标准模板版草稿', '正式版'),
    version_label: latestRun.draft_artifact.version_label,
    status: 'published',
    content_text: normalizeText(latestRun.draft_artifact.content_text)
      .replace(/标准模板版草稿/g, '正式版')
      .replace(/本文件为标准模板版草稿，是正式发布主口径。/g, '本文件为正式发布版，可直接用于测试执行与阶段验收。'),
    metadata_json: {
      based_on_draft_artifact_id: latestRun.draft_artifact.id,
      based_on_ai_draft_artifact_id: latestRun.ai_draft_artifact?.id || null,
      gate_execution_id: latestGate.id,
    },
  });
  await query(
    'UPDATE gateway_test_plan_generation_runs SET final_artifact_id = ?, status = ?, updated_at = NOW() WHERE id = ?',
    [finalArtifact.id, 'published', latestRun.id]
  );
  await query('UPDATE gateway_doc_bundles SET status = ?, updated_at = NOW() WHERE id = ?', [
    'published',
    bundleId,
  ]);
  return finalArtifact;
}

function scoreTextPresence(text, patterns = []) {
  const checks = patterns.map((pattern) => (new RegExp(pattern, 'i').test(text) ? 1 : 0));
  if (!checks.length) return 0;
  return Math.round((checks.reduce((sum, item) => sum + item, 0) / checks.length) * 100);
}

async function runTestPlanQualityBenchmark(options = {}) {
  const bundleKeys = Array.isArray(options.bundle_codes) && options.bundle_codes.length
    ? options.bundle_codes
    : ['DEMO-SO-DOC-001', 'BENCH-EXT-SUBFLOW-001', 'BENCH-STATE-COMP-001'];
  const samples = [];

  for (const bundleCode of bundleKeys) {
    const bundle = await getDocBundleByCode(bundleCode);
    if (!bundle) {
      samples.push({
        bundle_code: bundleCode,
        status: 'missing',
        overall_score: 0,
        gaps: ['bundle not found'],
      });
      continue;
    }
    const latestRun = bundle.test_plan_generation_runs?.[0] || null;
    const latestGate = bundle.gates?.find((item) => item.gate_type === 'test_plan_gate') || null;
    const templateText = normalizeText(latestRun?.draft_artifact?.content_text);
    const overallScore = Math.round(
      (
        scoreTextPresence(templateText, ['测试目标', '测试范围', '不在范围', '风险清单', '测试环境矩阵', '测试数据策略']) * 0.18 +
        scoreTextPresence(templateText, ['PRD 追溯矩阵', '技术方案追溯矩阵', 'Coverage Graph', '覆盖义务矩阵']) * 0.18 +
        scoreTextPresence(templateText, ['用例汇总', '关键用例详述', '测试步骤', '字段级 DB 断言矩阵']) * 0.18 +
        scoreTextPresence(templateText, ['进入准则', '退出准则', '发布建议', '发布前门禁结论']) * 0.16 +
        scoreTextPresence(templateText, ['测试环境矩阵', '测试数据策略']) * 0.1 +
        scoreTextPresence(templateText, ['接口级验证矩阵', '状态迁移矩阵', '字段级 DB 断言矩阵']) * 0.1 +
        ((latestGate?.status === 'pass' ? 100 : latestGate?.status === 'warn' ? 70 : 20) * 0.1)
      )
    );
    const gaps = [];
    if (!/风险清单/i.test(templateText)) gaps.push('缺风险清单');
    if (!/测试环境矩阵/i.test(templateText)) gaps.push('缺环境矩阵');
    if (!/测试数据策略/i.test(templateText)) gaps.push('缺测试数据策略');
    if (!/进入准则/i.test(templateText) || !/退出准则/i.test(templateText)) gaps.push('缺进入/退出准则');
    if (!/字段级 DB 断言矩阵/i.test(templateText)) gaps.push('缺 DB 断言');
    if (!/发布建议/i.test(templateText)) gaps.push('缺发布建议');
    if (/TODO|TBD|待补充/i.test(templateText)) gaps.push('残留占位词');

    samples.push({
      bundle_code: bundle.bundle_code,
      status: latestGate?.status || 'unknown',
      workflow_mode: bundle.workflow_mode || 'upload_existing',
      overall_score: overallScore,
      gate_summary: latestGate?.summary || null,
      gaps,
      dimensions: {
        structure: scoreTextPresence(templateText, ['测试目标', '测试范围', '不在范围', '测试环境矩阵', '测试数据策略', '用例汇总']),
        traceability: scoreTextPresence(templateText, ['PRD 追溯矩阵', '技术方案追溯矩阵', 'Coverage Graph', '覆盖义务矩阵']),
        executability: scoreTextPresence(templateText, ['关键用例详述', '测试步骤', '字段级 DB 断言矩阵']),
        risk_entry_exit: scoreTextPresence(templateText, ['风险清单', '进入准则', '退出准则', '发布建议']),
        env_and_data: scoreTextPresence(templateText, ['测试环境矩阵', '测试数据策略']),
        assertions: scoreTextPresence(templateText, ['接口级验证矩阵', '状态迁移矩阵', '字段级 DB 断言矩阵']),
        publish_confidence: latestGate?.status === 'pass' ? 100 : latestGate?.status === 'warn' ? 70 : 20,
      },
    });
  }

  const validScores = samples.filter((item) => item.status !== 'missing').map((item) => item.overall_score);
  return {
    benchmark_key: options.benchmark_key || 'test-plan-quality-benchmark',
    sample_count: samples.length,
    average_score: validScores.length
      ? Math.round(validScores.reduce((sum, item) => sum + item, 0) / validScores.length)
      : 0,
    pass: samples.every((item) => item.status !== 'block' && item.status !== 'missing'),
    samples,
  };
}

async function getDashboardMetrics() {
  const [projectCounts, pipelineCounts, runCounts, evidenceCounts, usageCounts] = await Promise.all([
    query(
      `SELECT status, COUNT(*) AS count
       FROM gateway_program_projects
       GROUP BY status`
    ),
    query(
      `SELECT status, COUNT(*) AS count
       FROM gateway_pipeline_definitions
       GROUP BY status`
    ),
    query(
      `SELECT status, COUNT(*) AS count
       FROM gateway_pipeline_runs
       GROUP BY status`
    ),
    query(
      `SELECT review_result, COUNT(*) AS count
       FROM gateway_evidence_packs
       GROUP BY review_result`
    ),
    query(
      `SELECT DATE(created_at) AS sample_date,
              COUNT(*) AS request_count,
              COALESCE(SUM(total_tokens), 0) AS total_tokens,
              COALESCE(SUM(cost_cny), 0) AS total_cost
       FROM gateway_usage_logs
       WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
       GROUP BY DATE(created_at)
       ORDER BY sample_date ASC`
    ),
  ]);
  return {
    projects: projectCounts,
    pipelines: pipelineCounts,
    runs: runCounts,
    evidence: evidenceCounts,
    usage_trend: usageCounts,
  };
}

async function getEfficiencyReport() {
  const baselineRows = await query(
    'SELECT * FROM gateway_efficiency_baselines ORDER BY sample_date DESC LIMIT 20'
  );
  const metricRows = await query(
    `SELECT metric_name,
            AVG(metric_value) AS avg_value
     FROM gateway_metric_samples
     WHERE sample_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
     GROUP BY metric_name`
  );
  const aggregateMap = Object.fromEntries(
    metricRows.map((row) => [row.metric_name, Number(row.avg_value)])
  );
  return {
    baselines: baselineRows.map((row) => ({
      ...row,
      metric_dimension: parseJson(row.metric_dimension, {}),
    })),
    aggregates: metricRows,
    summary: {
      baseline_count: baselineRows.length,
      metric_count: metricRows.length,
      adoption_rate: aggregateMap.AdoptionRate ?? null,
      ai_gen_ratio: aggregateMap.AIGenRatio ?? null,
      rework_rate: aggregateMap.ReworkRate ?? null,
      pipeline_success_rate: aggregateMap.PipelineSuccessRate ?? null,
      human_intervention_rate: aggregateMap.HumanInterventionRate ?? null,
    },
  };
}

async function getGovernanceAcceptanceOverview(projectCode = null) {
  const [projects, milestoneRows, evidenceRows, integrationRows, valueRows, certificationRows, foundationAssetRows, baselineRows] = await Promise.all([
    listProjects(),
    query(
      `SELECT * FROM gateway_project_milestones
       ${projectCode ? 'WHERE project_code = ?' : ''}
       ORDER BY due_date ASC, id ASC`,
      projectCode ? [projectCode] : []
    ),
    listEvidencePacks(projectCode),
    listIntegrationConnections(),
    listValueAssessments(projectCode),
    listCertificationRecords(projectCode),
    query(
      `SELECT asset_key
       FROM gateway_knowledge_assets
       WHERE status = 'active'
         AND asset_key IN (${AI_RULES_FOUNDATION_ASSET_KEYS.map(() => '?').join(', ')})`,
      AI_RULES_FOUNDATION_ASSET_KEYS
    ),
    query('SELECT * FROM gateway_efficiency_baselines ORDER BY sample_date DESC LIMIT 20'),
  ]);

  const filteredProjects = projectCode
    ? projects.filter((item) => item.code === projectCode)
    : projects;
  const milestoneMap = new Map();
  milestoneRows.forEach((row) => {
    if (!milestoneMap.has(row.project_code)) {
      milestoneMap.set(row.project_code, []);
    }
    milestoneMap.get(row.project_code).push(mapMilestoneRow(row));
  });
  const evidenceCountByProject = new Map();
  evidenceRows.forEach((row) => {
    const count = evidenceCountByProject.get(row.project_code) || 0;
    evidenceCountByProject.set(row.project_code, count + 1);
  });

  const checkpoints = ACCEPTANCE_CHECKPOINTS.map((checkpoint) => {
    const applicableProjects = filteredProjects.filter((project) => {
      if (checkpoint.key === '4_30_gate') {
        return project.okr_stage === '阶段一' || project.okr_stage === '跨阶段';
      }
      if (checkpoint.key === '5_31_check') {
        return project.okr_stage === '跨阶段' || project.okr_stage === '阶段二';
      }
      return true;
    });
    const projectRows = applicableProjects.map((project) => {
      const milestones = milestoneMap.get(project.code) || [];
      const matched = milestones.find((item) => item.milestone_type === checkpoint.key);
      return {
        code: project.code,
        name: project.name,
        okr_stage: project.okr_stage,
        owner_role: project.owner_role,
        wave_name: project.wave_name,
        risk_level: project.risk_level,
        title: matched?.title || `${project.code} ${checkpoint.label}`,
        status: matched?.status || 'pending',
        due_date: normalizeDateValue(matched?.due_date) || checkpoint.due_date,
        acceptance_rule: matched?.acceptance_rule || project.acceptance_rule,
        evidence_count: evidenceCountByProject.get(project.code) || 0,
      };
    });
    return {
      key: checkpoint.key,
      label: checkpoint.label,
      due_date: checkpoint.due_date,
      total_count: projectRows.length,
      completed_count: projectRows.filter((item) => item.status === 'completed').length,
      blocked_count: projectRows.filter((item) => ['failed', 'blocked'].includes(item.status)).length,
      projects: projectRows,
    };
  });

  return {
    checkpoints,
    summary: {
      total_projects: filteredProjects.length,
      evidence_pack_count: evidenceRows.length,
      integration_count: integrationRows.length,
      value_assessment_count: valueRows.length,
      certification_count: certificationRows.length,
      baseline_count: baselineRows.length,
      foundation_asset_target: AI_RULES_FOUNDATION_ASSET_KEYS.length,
      foundation_asset_ready: foundationAssetRows.length,
      knowledge_coverage_rate: Math.round((foundationAssetRows.length / AI_RULES_FOUNDATION_ASSET_KEYS.length) * 100),
    },
  };
}

async function listStandardNodes() {
  const rows = await query(
    'SELECT * FROM gateway_standard_nodes ORDER BY sort_order ASC, id ASC'
  );
  return rows.map(mapStandardNodeRow);
}

async function getStandardNodeByKey(nodeKey) {
  const [row] = await query(
    'SELECT * FROM gateway_standard_nodes WHERE node_key = ? LIMIT 1',
    [nodeKey]
  );
  return mapStandardNodeRow(row);
}

function getDocGateOutputSchema() {
  return DOC_GATE_OUTPUT_SCHEMA;
}

async function getProjectOpsSummary(projectCode) {
  if (!projectCode) return null;
  const [bundles, runs, ragLogs] = await Promise.all([
    query(
      'SELECT * FROM gateway_doc_bundles WHERE project_code = ? ORDER BY updated_at DESC, id DESC LIMIT 50',
      [projectCode]
    ),
    query(
      `SELECT r.*, p.name AS pipeline_name, p.pipeline_key
       FROM gateway_pipeline_runs r
       LEFT JOIN gateway_pipeline_definitions p ON r.pipeline_definition_id = p.id
       WHERE r.project_code = ?
       ORDER BY r.id DESC LIMIT 40`,
      [projectCode]
    ),
    query(
      'SELECT * FROM gateway_rag_query_logs WHERE project_code = ? ORDER BY id DESC LIMIT 40',
      [projectCode]
    ),
  ]);
  return {
    project_code: projectCode,
    doc_bundles: bundles,
    pipeline_runs: runs,
    rag_query_logs: ragLogs,
  };
}

async function logRagQuery(data) {
  const result = await query(
    `INSERT INTO gateway_rag_query_logs
     (trace_id, project_code, knowledge_asset_id, query_text, result_count, latency_ms)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      data.trace_id || null,
      data.project_code || null,
      data.knowledge_asset_id != null ? Number(data.knowledge_asset_id) : null,
      data.query_text || null,
      data.result_count != null ? Number(data.result_count) : 0,
      data.latency_ms != null ? Number(data.latency_ms) : null,
    ]
  );
  const [row] = await query('SELECT * FROM gateway_rag_query_logs WHERE id = ? LIMIT 1', [result.insertId]);
  return row;
}

async function listRagQueries(projectCode = null) {
  const rows = await query(
    `SELECT q.*, a.asset_key, a.name AS asset_name
     FROM gateway_rag_query_logs q
     LEFT JOIN gateway_knowledge_assets a ON a.id = q.knowledge_asset_id
     ${projectCode ? 'WHERE q.project_code = ?' : ''}
     ORDER BY q.id DESC
     LIMIT 100`,
    projectCode ? [projectCode] : []
  );
  return rows;
}

function resolveKnowledgeCollection(asset) {
  const meta = parseJson(asset?.metadata_json, {});
  return normalizeText(meta.collection) || DEFAULT_KNOWLEDGE_COLLECTION;
}

async function getKnowledgeAssetById(id) {
  const rows = await listKnowledgeAssets({ id });
  return rows[0] || null;
}

async function listKnowledgeAssets(options = {}) {
  const conditions = [];
  const params = [];
  let limitClause = 'LIMIT 100';
  if (Array.isArray(options.ids) && options.ids.length) {
    const ids = options.ids.map((item) => Number(item)).filter((item) => Number.isFinite(item));
    if (ids.length) {
      conditions.push(`a.id IN (${ids.map(() => '?').join(', ')})`);
      params.push(...ids);
    }
  }
  if (options.id != null) {
    conditions.push('a.id = ?');
    params.push(Number(options.id));
    limitClause = 'LIMIT 1';
  }
  if (options.asset_category) {
    conditions.push('a.asset_category = ?');
    params.push(String(options.asset_category));
  }
  if (options.domain) {
    conditions.push('a.domain = ?');
    params.push(String(options.domain));
  }
  if (options.module) {
    conditions.push('a.module = ?');
    params.push(String(options.module));
  }
  if (options.asset_type) {
    conditions.push('a.asset_type = ?');
    params.push(String(options.asset_type));
  }
  if (options.status) {
    conditions.push('a.status = ?');
    params.push(String(options.status));
  }
  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = await query(
    `SELECT a.*,
            ki.index_type AS latest_index_type,
            ki.status AS latest_index_status,
            ki.index_meta AS latest_index_meta,
            ki.created_at AS latest_index_created_at
     FROM gateway_knowledge_assets a
     LEFT JOIN gateway_knowledge_indexes ki
       ON ki.id = (
         SELECT i.id
         FROM gateway_knowledge_indexes i
         WHERE i.knowledge_asset_id = a.id
         ORDER BY i.id DESC
         LIMIT 1
       )
     ${whereClause}
     ORDER BY a.updated_at DESC, a.id DESC
     ${limitClause}`,
    params
  );
  return rows.map(mapKnowledgeAssetRow);
}

const KNOWLEDGE_ASSET_INGEST_PASSTHROUGH_KEYS = Object.freeze([
  'repo_url',
  'repo_slug',
  'branch',
  'commit_sha',
  'page_slug',
  'page_type',
  'run_id',
  'source_files',
  'object_keys',
  'thread_key',
  'thread_level',
  'domain_key',
]);

function buildKnowledgeAssetIngestMetadata(asset, assetMeta = {}) {
  const metadata = {
    knowledge_asset_id: asset?.id ?? null,
    asset_key: asset?.asset_key ?? null,
    asset_name: asset?.name ?? null,
    asset_category: asset?.asset_category || null,
    domain: asset?.domain || null,
    module: asset?.module || null,
    version: asset?.version || null,
    owner: asset?.owner || null,
    source_uri: asset?.source_uri || null,
  };
  for (const key of KNOWLEDGE_ASSET_INGEST_PASSTHROUGH_KEYS) {
    if (assetMeta && assetMeta[key] !== undefined) {
      metadata[key] = assetMeta[key];
    }
  }
  return metadata;
}

async function ingestKnowledgeAsset(id, options = {}) {
  const asset = await getKnowledgeAssetById(id);
  if (!asset) return null;
  const content = readTextIfExists(asset.source_uri);
  if (!normalizeText(content)) {
    throw new Error(`Knowledge asset source not found or empty: ${asset.source_uri}`);
  }
  const ingestUrl = (process.env.KNOWLEDGE_BASE_INGEST_URL || 'http://127.0.0.1:8000/api/v1/ingest').trim();
  const collection = options.collection || resolveKnowledgeCollection(asset);
  const assetMeta = parseJson(asset.metadata_json, {});
  const metadata = buildKnowledgeAssetIngestMetadata(asset, assetMeta);

  try {
    const response = await axios.post(
      ingestUrl,
      {
        content,
        metadata,
        collection,
        chunk_size: Number(options.chunk_size || process.env.KNOWLEDGE_BASE_CHUNK_SIZE || 500),
        chunk_overlap: Number(options.chunk_overlap || process.env.KNOWLEDGE_BASE_CHUNK_OVERLAP || 50),
      },
      {
        timeout: Number(process.env.KNOWLEDGE_BASE_TIMEOUT_MS || 20000),
        headers: { 'Content-Type': 'application/json' },
      }
    );
    const data = response.data || {};
    const result = await query(
      `INSERT INTO gateway_knowledge_indexes
       (knowledge_asset_id, index_type, status, index_meta)
       VALUES (?, ?, ?, CAST(? AS JSON))`,
      [
        asset.id,
        'semantic_chunk',
        'ready',
        stringifyJson({
          collection,
          chunks_ingested: data.chunks_ingested || 0,
          document_ids: data.document_ids || [],
          source_uri: asset.source_uri,
        }),
      ]
    );
    await query(
      `INSERT INTO gateway_audit_events
       (event_type, trace_id, project_code, payload_json, source_system)
       VALUES (?, ?, ?, CAST(? AS JSON), ?)`,
      [
        'knowledge_asset_ingested',
        null,
        null,
        stringifyJson({
          knowledge_asset_id: asset.id,
          collection,
          chunk_count: data.chunks_ingested || 0,
          index_id: result.insertId,
        }),
        'control-plane',
      ]
    );
    const [indexRow] = await query('SELECT * FROM gateway_knowledge_indexes WHERE id = ? LIMIT 1', [result.insertId]);
    return {
      asset,
      index: {
        ...indexRow,
        index_meta: parseJson(indexRow.index_meta, {}),
      },
      ingest_result: data,
    };
  } catch (error) {
    await query(
      `INSERT INTO gateway_knowledge_indexes
       (knowledge_asset_id, index_type, status, index_meta)
       VALUES (?, ?, ?, CAST(? AS JSON))`,
      [
        asset.id,
        'semantic_chunk',
        'failed',
        stringifyJson({
          collection,
          source_uri: asset.source_uri,
          error: error.message,
        }),
      ]
    );
    throw error;
  }
}

function buildDeepWikiAssetKey(repoSlug, commitSha, pageSlug) {
  return `dw-${hashText(`${repoSlug}:${commitSha}:${pageSlug}`).slice(0, 20)}`;
}

function buildDeepWikiOutputRoot(repoSlug, branch, commitSha) {
  return path.join(
    getDeepWikiStorageRoot(),
    'deepwiki',
    repoSlug,
    sanitizePathSegment(branch || 'default-branch'),
    commitSha
  );
}

const DEEPWIKI_STAGE_WEIGHTS = {
  repo_prepare: 10,
  repo_inventory: 10,
  module_digest: 25,
  deep_research_outline: 22,
  diagram_synthesis: 12,
  wiki_render: 8,
  knowledge_extract: 8,
  coverage_check: 4,
  coverage_repair: 4,
  doc_projection_md: 4,
  knowledge_register: 10,
  community_index: 5,
  rag_ingest: 8,
  retrieval_eval: 5,
  publish: 2,
};

const DEEPWIKI_STATIC_STAGE_BUDGET_MS = {
  repo_prepare: 45_000,
  repo_inventory: 45_000,
  module_digest: 180_000,
  deep_research_outline: DEEPWIKI_DEEP_RESEARCH_TIMEOUT_MS,
  diagram_synthesis: DEEPWIKI_DIAGRAM_SYNTHESIS_TIMEOUT_MS,
  wiki_render: 45_000,
  knowledge_extract: 45_000,
  coverage_check: 30_000,
  coverage_repair: 30_000,
  doc_projection_md: 30_000,
  knowledge_register: 60_000,
  community_index: 45_000,
  rag_ingest: 120_000,
  retrieval_eval: 60_000,
  publish: 15_000,
};

function parseIsoTime(value) {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function buildDefaultDeepWikiStageProgress(summary = {}) {
  const raw = summary.stage_progress && typeof summary.stage_progress === 'object'
    ? summary.stage_progress
    : {};
  return DEEPWIKI_STAGE_ORDER.reduce((acc, stage) => {
    const current = raw[stage] && typeof raw[stage] === 'object' ? raw[stage] : {};
    acc[stage] = {
      status: normalizeText(current.status) || 'pending',
      processed: Number.isFinite(Number(current.processed)) ? Number(current.processed) : 0,
      total: Number.isFinite(Number(current.total)) ? Number(current.total) : 0,
      started_at: current.started_at || null,
      completed_at: current.completed_at || null,
      duration_ms: Number.isFinite(Number(current.duration_ms)) ? Number(current.duration_ms) : null,
      last_message: normalizeText(current.last_message) || '',
    };
    return acc;
  }, {});
}

function getDeepWikiExpectedPageCount(summary = {}) {
  const manifest = summary.manifest && typeof summary.manifest === 'object' ? summary.manifest : null;
  if (Number.isFinite(Number(manifest?.page_count)) && Number(manifest.page_count) > 0) {
    return Number(manifest.page_count);
  }
  const moduleCount = Array.isArray(summary.module_digests) ? summary.module_digests.length : 0;
  const baseCount = 7;
  return moduleCount > 1 ? baseCount + moduleCount : baseCount;
}

function getDeepWikiStageBudgetMs(stage, summary = {}) {
  const base = DEEPWIKI_STATIC_STAGE_BUDGET_MS[stage] || 60_000;
  const moduleCount = Array.isArray(summary.inventory?.modules) ? summary.inventory.modules.length : 0;
  const pageCount = getDeepWikiExpectedPageCount(summary);
  if (stage === 'module_digest') {
    return Math.max(base, moduleCount * Math.max(12_000, DEEPWIKI_SUMMARY_TIMEOUT_MS + 2_000));
  }
  if (stage === 'wiki_render') {
    return Math.max(base, pageCount * 2_000);
  }
  if (stage === 'knowledge_register') {
    return Math.max(base, pageCount * 2_500);
  }
  if (stage === 'community_index') {
    return Math.max(base, pageCount * 1_500);
  }
  if (stage === 'rag_ingest') {
    return Math.max(base, pageCount * 4_000);
  }
  if (stage === 'retrieval_eval') {
    return Math.max(base, pageCount * 2_000);
  }
  return base;
}

function getDeepWikiStageTimeoutMs(stage, summary = {}) {
  if (stage === 'module_digest') {
    return Math.max(15 * 60_000, getDeepWikiStageBudgetMs(stage, summary) * 1.2);
  }
  if (stage === 'deep_research_outline') {
    return Math.max(20 * 60_000, getDeepWikiStageBudgetMs(stage, summary) * 1.2);
  }
  if (stage === 'diagram_synthesis') {
    return Math.max(DEEPWIKI_DIAGRAM_SYNTHESIS_TIMEOUT_MS + 60_000, getDeepWikiStageBudgetMs(stage, summary) * 1.2);
  }
  return Math.max(60_000, getDeepWikiStageBudgetMs(stage, summary) * 1.2);
}

function getDeepWikiStageFraction(stageInfo = {}) {
  const processed = Number(stageInfo.processed || 0);
  const total = Number(stageInfo.total || 0);
  if (total > 0) {
    return Math.max(0, Math.min(1, processed / total));
  }
  if (stageInfo.status === 'completed') return 1;
  if (stageInfo.status === 'running') return 0.35;
  if (stageInfo.status === 'failed' || stageInfo.status === 'stalled') return 0.35;
  return 0;
}

function computeDeepWikiProgressPercent(summary = {}, status = 'queued', currentStage = '') {
  if (status === 'completed') return 100;
  const stageProgress = buildDefaultDeepWikiStageProgress(summary);
  const totalWeight = DEEPWIKI_STAGE_ORDER.reduce((sum, stage) => sum + Number(DEEPWIKI_STAGE_WEIGHTS[stage] || 0), 0) || 100;
  let completedWeight = 0;

  DEEPWIKI_STAGE_ORDER.forEach((stage) => {
    const info = stageProgress[stage] || {};
    const weight = Number(DEEPWIKI_STAGE_WEIGHTS[stage] || 0);
    if (info.status === 'completed') {
      completedWeight += weight;
      return;
    }
    if (
      (stage === currentStage && ['running', 'failed', 'stalled'].includes(status)) ||
      info.status === 'running' ||
      info.status === 'failed' ||
      info.status === 'stalled'
    ) {
      completedWeight += weight * getDeepWikiStageFraction(info);
    }
  });

  return Math.max(0, Math.min(100, Number(((completedWeight / totalWeight) * 100).toFixed(2))));
}

function computeDeepWikiElapsedSeconds(summary = {}) {
  const startedAt = parseIsoTime(summary.run_started_at);
  if (!startedAt) return 0;
  return Math.max(0, Math.round((Date.now() - startedAt) / 1000));
}

function estimateDeepWikiRemainingSeconds(summary = {}, status = 'queued', currentStage = '') {
  if (status === 'completed') return 0;
  const stageProgress = buildDefaultDeepWikiStageProgress(summary);
  let totalRemainingMs = 0;

  DEEPWIKI_STAGE_ORDER.forEach((stage) => {
    const info = stageProgress[stage] || {};
    if (info.status === 'completed') {
      return;
    }
    const budget = getDeepWikiStageBudgetMs(stage, summary);
    if (stage === currentStage || info.status === 'running' || info.status === 'failed' || info.status === 'stalled') {
      totalRemainingMs += budget * (1 - getDeepWikiStageFraction(info));
      return;
    }
    totalRemainingMs += budget;
  });

  if (!totalRemainingMs) return null;
  return Math.max(0, Math.round(totalRemainingMs / 1000));
}

function buildDeepWikiSummaryState(summary = {}, options = {}) {
  const status = normalizeText(options.status) || normalizeText(summary.runtime_result) || 'queued';
  const currentStage = normalizeText(options.current_stage) || '';
  const stageProgress = buildDefaultDeepWikiStageProgress(summary);
  const runtimeResult = summary.stalled ? 'stalled' : (normalizeText(summary.runtime_result) || status);
  const elapsedSeconds = computeDeepWikiElapsedSeconds(summary);
  const estimatedRemainingSeconds = estimateDeepWikiRemainingSeconds(
    { ...summary, stage_progress: stageProgress },
    runtimeResult,
    currentStage
  );
  const progressPercent = computeDeepWikiProgressPercent(
    { ...summary, stage_progress: stageProgress },
    runtimeResult,
    currentStage
  );
  return {
    ...summary,
    logs: Array.isArray(summary.logs) ? summary.logs : [],
    preflight: summary.preflight || null,
    inventory: summary.inventory || null,
    module_digests: Array.isArray(summary.module_digests) ? summary.module_digests : [],
    research: summary.research || null,
    manifest: summary.manifest || null,
    sources: summary.sources || null,
    last_error: summary.last_error || null,
    focus_prompt: normalizeText(summary.focus_prompt),
    research_provider: normalizeText(summary.research_provider) || 'qwen_dashscope_native',
    research_model: normalizeText(summary.research_model),
    provider_strategy: normalizeText(summary.provider_strategy) || 'default',
    output_profile: normalizeText(summary.output_profile) || 'engineering_architecture_pack',
    diagram_profile: normalizeText(summary.diagram_profile) || 'full',
    run_started_at: summary.run_started_at || null,
    current_stage_started_at: summary.current_stage_started_at || null,
    heartbeat_at: summary.heartbeat_at || null,
    stalled: Boolean(summary.stalled),
    queue_position: summary.queue_position != null ? Number(summary.queue_position) : null,
    runtime_result: runtimeResult,
    stage_progress: stageProgress,
    elapsed_seconds: elapsedSeconds,
    estimated_remaining_seconds: estimatedRemainingSeconds,
    progress_percent: progressPercent,
  };
}

function deepWikiSummaryDefaults(summary = {}) {
  return {
    ...buildDeepWikiSummaryState(summary),
  };
}

async function getRepoSourceById(id) {
  const [row] = await query('SELECT * FROM gateway_repo_sources WHERE id = ? LIMIT 1', [Number(id)]);
  return mapRepoSourceRow(row);
}

async function getRepoSourceByUrl(repoUrl) {
  const [row] = await query('SELECT * FROM gateway_repo_sources WHERE repo_url = ? LIMIT 1', [repoUrl]);
  return mapRepoSourceRow(row);
}

async function getRepoSourceBySlug(repoSlug) {
  const [row] = await query('SELECT * FROM gateway_repo_sources WHERE repo_slug = ? LIMIT 1', [repoSlug]);
  return mapRepoSourceRow(row);
}

function buildRepoUrlCandidates(repoUrl) {
  const normalized = normalizeText(repoUrl);
  if (!normalized) return [];
  const withoutTrailingSlash = normalized.replace(/\/+$/, '');
  const withoutGitSuffix = withoutTrailingSlash.replace(/\.git$/i, '');
  const withGitSuffix = withoutGitSuffix ? `${withoutGitSuffix}.git` : withoutTrailingSlash;
  return uniqueStrings([normalized, withoutTrailingSlash, withoutGitSuffix, withGitSuffix]);
}

async function findRepoSourceForWebhook(repoCandidates = []) {
  const seenUrls = uniqueStrings(
    repoCandidates.flatMap((item) => buildRepoUrlCandidates(item))
  );

  for (const repoUrl of seenUrls) {
    const byUrl = await getRepoSourceByUrl(repoUrl);
    if (byUrl) {
      return byUrl;
    }
  }

  const slugs = uniqueStrings(
    seenUrls
      .map((item) => {
        try {
          return deriveRepoSlug(item);
        } catch {
          return null;
        }
      })
      .filter(Boolean)
  );

  for (const repoSlug of slugs) {
    const bySlug = await getRepoSourceBySlug(repoSlug);
    if (bySlug) {
      return bySlug;
    }
  }

  return null;
}

async function getDeepWikiRepoBranches(id) {
  const repoSource = await getRepoSourceById(id);
  if (!repoSource) return null;
  const preflight = await preflightRepository(repoSource.repo_url, '');
  await upsertRepoSource({
    repo_url: repoSource.repo_url,
    repo_slug: preflight.repo_slug,
    default_branch: preflight.default_branch,
    auth_mode: preflight.auth_mode,
    status: repoSource.status,
    metadata_json: {
      ...parseJson(repoSource.metadata_json, {}),
      latest_preflight: preflight,
    },
  });
  return {
    repo_source_id: repoSource.id,
    repo_url: repoSource.repo_url,
    repo_slug: preflight.repo_slug,
    default_branch: preflight.default_branch,
    available_branches: preflight.available_branches || [],
  };
}

async function getLatestDeepWikiRunForRepo(repoSourceId, branch = null) {
  const params = [Number(repoSourceId)];
  let branchClause = '';
  if (branch) {
    branchClause = `
      AND (
        rs.branch = ?
        OR JSON_UNQUOTE(JSON_EXTRACT(r.summary_json, '$.preflight.resolved_branch')) = ?
      )`;
    params.push(branch, branch);
  }
  const [row] = await query(
    `SELECT r.*,
            rs.branch,
            rs.commit_sha
     FROM gateway_deepwiki_runs r
     LEFT JOIN gateway_repo_snapshots rs ON rs.id = r.snapshot_id
     WHERE r.repo_source_id = ?
     ${branchClause}
     ORDER BY r.id DESC
     LIMIT 1`,
    params
  );
  return row
    ? {
        ...mapDeepWikiRunRow(row),
        branch: row.branch || null,
        commit_sha: row.commit_sha || null,
      }
    : null;
}

function normalizeDeepWikiSyncMetadata(value = {}, fallback = {}) {
  const merged = {
    ...parseJson(fallback, {}),
    ...parseJson(value, {}),
  };
  const interval = Number(merged.interval_minutes);
  return {
    ...merged,
    enabled: Boolean(merged.enabled),
    branch: normalizeText(merged.branch),
    webhook_secret: normalizeText(merged.webhook_secret),
    auto_ingest: merged.auto_ingest !== false,
    focus_prompt: normalizeText(merged.focus_prompt),
    project_code: normalizeText(merged.project_code),
    research_provider: normalizeText(merged.research_provider) || '',
    research_model: normalizeText(merged.research_model) || '',
    output_profile: normalizeText(merged.output_profile) || 'engineering_architecture_pack',
    diagram_profile: normalizeText(merged.diagram_profile) || 'full',
    interval_minutes: Number.isFinite(interval) ? Math.min(1440, Math.max(5, Math.round(interval))) : 30,
  };
}

async function mergeRepoSourceSyncMetadata(id, syncPatch = {}, options = {}) {
  const repoSource = await getRepoSourceById(id);
  if (!repoSource) return null;
  const existingMeta = parseJson(repoSource.metadata_json, {});
  const existingSync = normalizeDeepWikiSyncMetadata(existingMeta.sync, {});
  const nextSync = normalizeDeepWikiSyncMetadata(syncPatch, existingSync);
  if (options.touchUpdatedAt) {
    nextSync.updated_at = new Date().toISOString();
  }
  const updated = await upsertRepoSource({
    repo_url: repoSource.repo_url,
    repo_slug: repoSource.repo_slug,
    default_branch: options.updateDefaultBranch ? nextSync.branch || repoSource.default_branch : repoSource.default_branch,
    auth_mode: repoSource.auth_mode,
    status: repoSource.status,
    metadata_json: {
      ...existingMeta,
      sync: nextSync,
    },
  });
  return {
    repo_source: updated,
    sync_config: normalizeDeepWikiSyncMetadata(updated?.metadata_json?.sync, nextSync),
  };
}

async function updateRepoSourceSyncConfig(id, syncConfig = {}) {
  return mergeRepoSourceSyncMetadata(id, syncConfig, {
    touchUpdatedAt: true,
    updateDefaultBranch: true,
  });
}

async function updateRepoSourceSyncState(id, syncState = {}) {
  return mergeRepoSourceSyncMetadata(id, syncState, {
    touchUpdatedAt: false,
    updateDefaultBranch: false,
  });
}

async function listDeepWikiRepoSourcesForScheduling() {
  const rows = await query(
    `SELECT *
     FROM gateway_repo_sources
     WHERE status = 'active'
     ORDER BY updated_at ASC, id ASC`
  );
  return rows
    .map(mapRepoSourceRow)
    .map((row) => ({
      ...row,
      sync_config: normalizeDeepWikiSyncMetadata(row.metadata_json?.sync, {}),
    }))
    .filter((row) => row.sync_config.enabled);
}

async function upsertRepoSource(data = {}) {
  const existing = await getRepoSourceByUrl(data.repo_url);
  if (existing) {
    await query(
      `UPDATE gateway_repo_sources
       SET repo_slug = ?, default_branch = ?, auth_mode = ?, status = ?, metadata_json = CAST(? AS JSON), updated_at = NOW()
       WHERE id = ?`,
      [
        data.repo_slug,
        data.default_branch || existing.default_branch || 'main',
        data.auth_mode || existing.auth_mode || 'local_git',
        data.status || existing.status || 'active',
        stringifyJson({
          ...parseJson(existing.metadata_json, {}),
          ...parseJson(data.metadata_json, {}),
        }),
        existing.id,
      ]
    );
    return getRepoSourceById(existing.id);
  }

  const result = await query(
    `INSERT INTO gateway_repo_sources
     (repo_url, repo_slug, default_branch, auth_mode, status, metadata_json)
     VALUES (?, ?, ?, ?, ?, CAST(? AS JSON))`,
    [
      data.repo_url,
      data.repo_slug,
      data.default_branch || 'main',
      data.auth_mode || 'local_git',
      data.status || 'active',
      stringifyJson(data.metadata_json || {}),
    ]
  );
  return getRepoSourceById(result.insertId);
}

async function createRepoSnapshot(data = {}) {
  const [existing] = await query(
    `SELECT * FROM gateway_repo_snapshots
     WHERE repo_source_id = ? AND branch = ? AND commit_sha = ?
     LIMIT 1`,
    [Number(data.repo_source_id), data.branch, data.commit_sha]
  );
  if (existing) {
    await query(
      `UPDATE gateway_repo_snapshots
       SET local_path = ?, manifest_json = CAST(? AS JSON)
       WHERE id = ?`,
      [data.local_path, stringifyJson(data.manifest_json || {}), existing.id]
    );
    const [row] = await query('SELECT * FROM gateway_repo_snapshots WHERE id = ? LIMIT 1', [existing.id]);
    return mapRepoSnapshotRow(row);
  }

  const result = await query(
    `INSERT INTO gateway_repo_snapshots
     (repo_source_id, branch, commit_sha, local_path, manifest_json)
     VALUES (?, ?, ?, ?, CAST(? AS JSON))`,
    [
      Number(data.repo_source_id),
      data.branch,
      data.commit_sha,
      data.local_path,
      stringifyJson(data.manifest_json || {}),
    ]
  );
  const [row] = await query('SELECT * FROM gateway_repo_snapshots WHERE id = ? LIMIT 1', [result.insertId]);
  return mapRepoSnapshotRow(row);
}

async function getRepoSnapshotById(id) {
  const [row] = await query('SELECT * FROM gateway_repo_snapshots WHERE id = ? LIMIT 1', [Number(id)]);
  return mapRepoSnapshotRow(row);
}

async function getDeepWikiProjectByCode(projectCode) {
  const [row] = await query('SELECT * FROM gateway_wiki_projects WHERE project_code = ? LIMIT 1', [projectCode]);
  return mapWikiProjectRow(row);
}

async function getDeepWikiProjectByIdRecord(id) {
  const [row] = await query('SELECT * FROM gateway_wiki_projects WHERE id = ? LIMIT 1', [Number(id)]);
  return mapWikiProjectRow(row);
}

async function upsertDeepWikiProject(data = {}) {
  const projectCode = deriveDeepWikiProjectCode({}, data.project_code);
  const existing = await getDeepWikiProjectByCode(projectCode);
  if (existing) {
    await query(
      `UPDATE gateway_wiki_projects
       SET project_name = ?, default_branch = ?, mission = ?, lifecycle_status = ?, owners_json = CAST(? AS JSON), metadata_json = CAST(? AS JSON), updated_at = NOW()
       WHERE id = ?`,
      [
        deriveDeepWikiProjectName({}, data.project_name || existing.project_name),
        normalizeText(data.default_branch || existing.default_branch) || 'main',
        normalizeText(data.mission || existing.mission) || null,
        normalizeText(data.lifecycle_status || existing.lifecycle_status) || 'active',
        stringifyJson(data.owners_json != null ? data.owners_json : existing.owners_json || {}),
        stringifyJson({
          ...parseJson(existing.metadata_json, {}),
          ...parseJson(data.metadata_json, {}),
        }),
        existing.id,
      ]
    );
    return getDeepWikiProjectByIdRecord(existing.id);
  }

  const result = await query(
    `INSERT INTO gateway_wiki_projects
     (project_code, project_name, default_branch, mission, lifecycle_status, owners_json, metadata_json)
     VALUES (?, ?, ?, ?, ?, CAST(? AS JSON), CAST(? AS JSON))`,
    [
      projectCode,
      deriveDeepWikiProjectName({}, data.project_name),
      normalizeText(data.default_branch) || 'main',
      normalizeText(data.mission) || null,
      normalizeText(data.lifecycle_status) || 'active',
      stringifyJson(data.owners_json || {}),
      stringifyJson(data.metadata_json || {}),
    ]
  );
  return getDeepWikiProjectByIdRecord(result.insertId);
}

async function bindRepoSourceToDeepWikiProject(projectId, repoSourceId, data = {}) {
  const [existing] = await query(
    `SELECT * FROM gateway_wiki_project_repos
     WHERE project_id = ? AND repo_source_id = ?
     LIMIT 1`,
    [Number(projectId), Number(repoSourceId)]
  );
  if (existing) {
    await query(
      `UPDATE gateway_wiki_project_repos
       SET repo_role = ?, is_primary = ?, metadata_json = CAST(? AS JSON), updated_at = NOW()
       WHERE id = ?`,
      [
        normalizeText(data.repo_role || existing.repo_role) || 'service',
        data.is_primary ? 1 : Number(existing.is_primary || 0),
        stringifyJson({
          ...parseJson(existing.metadata_json, {}),
          ...parseJson(data.metadata_json, {}),
        }),
        existing.id,
      ]
    );
    const [row] = await query('SELECT * FROM gateway_wiki_project_repos WHERE id = ? LIMIT 1', [existing.id]);
    return mapWikiProjectRepoRow(row);
  }

  const result = await query(
    `INSERT INTO gateway_wiki_project_repos
     (project_id, repo_source_id, repo_role, is_primary, metadata_json)
     VALUES (?, ?, ?, ?, CAST(? AS JSON))`,
    [
      Number(projectId),
      Number(repoSourceId),
      normalizeText(data.repo_role) || 'service',
      data.is_primary ? 1 : 0,
      stringifyJson(data.metadata_json || {}),
    ]
  );
  const [row] = await query('SELECT * FROM gateway_wiki_project_repos WHERE id = ? LIMIT 1', [result.insertId]);
  return mapWikiProjectRepoRow(row);
}

async function ensureDeepWikiProjectForRepoSource(repoSource, data = {}) {
  if (!repoSource?.id) return null;
  const project = await upsertDeepWikiProject({
    project_code: deriveDeepWikiProjectCode(repoSource, data.project_code),
    project_name: deriveDeepWikiProjectName(repoSource, data.project_name),
    default_branch: normalizeText(data.default_branch || data.branch || repoSource.default_branch) || 'main',
    mission: data.mission || null,
    owners_json: data.owners_json || {},
    metadata_json: {
      repo_source_id: repoSource.id,
      repo_slug: repoSource.repo_slug,
      repo_url: repoSource.repo_url,
      created_from: data.created_from || 'repo_source',
      ...parseJson(data.metadata_json, {}),
    },
  });
  await bindRepoSourceToDeepWikiProject(project.id, repoSource.id, {
    repo_role: data.repo_role || 'service',
    is_primary: data.is_primary !== false,
    metadata_json: {
      default_branch: normalizeText(data.branch || repoSource.default_branch) || 'main',
      repo_slug: repoSource.repo_slug,
    },
  });
  return project;
}

async function getDeepWikiProjectRepoBindings(projectId) {
  const rows = await query(
    `SELECT pr.*,
            rs.repo_url,
            rs.repo_slug,
            rs.default_branch,
            rs.status AS repo_status,
            rs.metadata_json AS repo_metadata_json
     FROM gateway_wiki_project_repos pr
     INNER JOIN gateway_repo_sources rs ON rs.id = pr.repo_source_id
     WHERE pr.project_id = ?
     ORDER BY pr.is_primary DESC, pr.id ASC`,
    [Number(projectId)]
  );
  return rows.map((row) => ({
    ...mapWikiProjectRepoRow(row),
    repo_source: mapRepoSourceRow({
      id: row.repo_source_id,
      repo_url: row.repo_url,
      repo_slug: row.repo_slug,
      default_branch: row.default_branch,
      status: row.repo_status,
      metadata_json: row.repo_metadata_json,
    }),
  }));
}

async function upsertDeepWikiBranch(projectId, branchName, data = {}) {
  const normalizedBranch = normalizeText(branchName || data.branch_name);
  if (!normalizedBranch) {
    throw new Error('branch_name is required');
  }
  const [existing] = await query(
    `SELECT * FROM gateway_wiki_branches
     WHERE project_id = ? AND branch_name = ?
     LIMIT 1`,
    [Number(projectId), normalizedBranch]
  );
  if (existing) {
    await query(
      `UPDATE gateway_wiki_branches
       SET display_name = ?, status = ?, metadata_json = CAST(? AS JSON), updated_at = NOW()
       WHERE id = ?`,
      [
        normalizeText(data.display_name || existing.display_name) || null,
        normalizeText(data.status || existing.status) || 'active',
        stringifyJson({
          ...parseJson(existing.metadata_json, {}),
          ...parseJson(data.metadata_json, {}),
        }),
        existing.id,
      ]
    );
    const [row] = await query('SELECT * FROM gateway_wiki_branches WHERE id = ? LIMIT 1', [existing.id]);
    return mapWikiBranchRow(row);
  }
  const result = await query(
    `INSERT INTO gateway_wiki_branches
     (project_id, branch_name, display_name, status, metadata_json)
     VALUES (?, ?, ?, ?, CAST(? AS JSON))`,
    [
      Number(projectId),
      normalizedBranch,
      normalizeText(data.display_name) || null,
      normalizeText(data.status) || 'active',
      stringifyJson(data.metadata_json || {}),
    ]
  );
  const [row] = await query('SELECT * FROM gateway_wiki_branches WHERE id = ? LIMIT 1', [result.insertId]);
  return mapWikiBranchRow(row);
}

async function listDeepWikiBranchRepoMappings(branchId) {
  const rows = await query(
    `SELECT m.*,
            pr.repo_role,
            pr.is_primary,
            rs.repo_slug,
            rs.repo_url
     FROM gateway_wiki_branch_repo_mappings m
     INNER JOIN gateway_wiki_project_repos pr ON pr.id = m.project_repo_id
     INNER JOIN gateway_repo_sources rs ON rs.id = pr.repo_source_id
     WHERE m.branch_id = ?
     ORDER BY pr.is_primary DESC, pr.id ASC`,
    [Number(branchId)]
  );
  return rows.map((row) => ({
    ...mapWikiBranchRepoMappingRow(row),
    repo_role: row.repo_role,
    is_primary: Boolean(row.is_primary),
    repo_slug: row.repo_slug,
    repo_url: row.repo_url,
  }));
}

async function upsertDeepWikiBranchRepoMapping(branchId, projectRepoId, data = {}) {
  const repoBranchName = normalizeText(data.repo_branch_name || data.branch_name);
  if (!repoBranchName) {
    throw new Error('repo_branch_name is required');
  }
  const [existing] = await query(
    `SELECT * FROM gateway_wiki_branch_repo_mappings
     WHERE branch_id = ? AND project_repo_id = ?
     LIMIT 1`,
    [Number(branchId), Number(projectRepoId)]
  );
  if (existing) {
    await query(
      `UPDATE gateway_wiki_branch_repo_mappings
       SET repo_branch_name = ?, metadata_json = CAST(? AS JSON), updated_at = NOW()
       WHERE id = ?`,
      [
        repoBranchName,
        stringifyJson({
          ...parseJson(existing.metadata_json, {}),
          ...parseJson(data.metadata_json, {}),
        }),
        existing.id,
      ]
    );
    const [row] = await query('SELECT * FROM gateway_wiki_branch_repo_mappings WHERE id = ? LIMIT 1', [existing.id]);
    return mapWikiBranchRepoMappingRow(row);
  }
  const result = await query(
    `INSERT INTO gateway_wiki_branch_repo_mappings
     (branch_id, project_repo_id, repo_branch_name, metadata_json)
     VALUES (?, ?, ?, CAST(? AS JSON))`,
    [
      Number(branchId),
      Number(projectRepoId),
      repoBranchName,
      stringifyJson(data.metadata_json || {}),
    ]
  );
  const [row] = await query('SELECT * FROM gateway_wiki_branch_repo_mappings WHERE id = ? LIMIT 1', [result.insertId]);
  return mapWikiBranchRepoMappingRow(row);
}

async function updateDeepWikiBranchRepoMapping(branchId, data = {}) {
  const branch = await query('SELECT * FROM gateway_wiki_branches WHERE id = ? LIMIT 1', [Number(branchId)]);
  const branchRow = mapWikiBranchRow(branch[0]);
  if (!branchRow) return null;
  const mappings = Array.isArray(data.mappings) ? data.mappings : [];
  for (const item of mappings) {
    await upsertDeepWikiBranchRepoMapping(branchId, Number(item.project_repo_id), {
      repo_branch_name: item.repo_branch_name,
      metadata_json: item.metadata_json || {},
    });
  }
  return {
    ...branchRow,
    repo_mappings: await listDeepWikiBranchRepoMappings(branchId),
  };
}

async function upsertDeepWikiSnapshotRepoRevision(snapshotId, projectRepoId, data = {}) {
  const [existing] = await query(
    `SELECT * FROM gateway_wiki_snapshot_repo_revisions
     WHERE snapshot_id = ? AND project_repo_id = ?
     LIMIT 1`,
    [Number(snapshotId), Number(projectRepoId)]
  );
  if (existing) {
    await query(
      `UPDATE gateway_wiki_snapshot_repo_revisions
       SET repo_role = ?, repo_slug = ?, branch_name = ?, commit_sha = ?, metadata_json = CAST(? AS JSON)
       WHERE id = ?`,
      [
        normalizeText(data.repo_role || existing.repo_role) || 'service',
        normalizeText(data.repo_slug || existing.repo_slug),
        normalizeText(data.branch_name || existing.branch_name),
        normalizeText(data.commit_sha || existing.commit_sha),
        stringifyJson({
          ...parseJson(existing.metadata_json, {}),
          ...parseJson(data.metadata_json, {}),
        }),
        existing.id,
      ]
    );
    const [row] = await query('SELECT * FROM gateway_wiki_snapshot_repo_revisions WHERE id = ? LIMIT 1', [existing.id]);
    return mapWikiSnapshotRepoRevisionRow(row);
  }
  const result = await query(
    `INSERT INTO gateway_wiki_snapshot_repo_revisions
     (snapshot_id, project_repo_id, repo_role, repo_slug, branch_name, commit_sha, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, CAST(? AS JSON))`,
    [
      Number(snapshotId),
      Number(projectRepoId),
      normalizeText(data.repo_role) || 'service',
      normalizeText(data.repo_slug),
      normalizeText(data.branch_name),
      normalizeText(data.commit_sha),
      stringifyJson(data.metadata_json || {}),
    ]
  );
  const [row] = await query('SELECT * FROM gateway_wiki_snapshot_repo_revisions WHERE id = ? LIMIT 1', [result.insertId]);
  return mapWikiSnapshotRepoRevisionRow(row);
}

async function listDeepWikiSnapshotRepoRevisions(snapshotId) {
  const rows = await query(
    `SELECT *
     FROM gateway_wiki_snapshot_repo_revisions
     WHERE snapshot_id = ?
     ORDER BY repo_role ASC, repo_slug ASC`,
    [Number(snapshotId)]
  );
  return rows.map(mapWikiSnapshotRepoRevisionRow);
}

async function upsertDeepWikiProjectSourceBinding(projectId, data = {}) {
  const sourceType = normalizeDeepWikiSourceType(data.source_type, 'repo');
  const sourceKey = normalizeText(data.source_key) || `${sourceType}:${data.source_ref_id || hashText(JSON.stringify(data)).slice(0, 12)}`;
  const [existing] = await query(
    `SELECT *
     FROM gateway_wiki_project_source_bindings
     WHERE project_id = ? AND source_type = ? AND source_key = ?
     LIMIT 1`,
    [Number(projectId), sourceType, sourceKey]
  );
  if (existing) {
    await query(
      `UPDATE gateway_wiki_project_source_bindings
       SET source_ref_id = ?, title = ?, status = ?, metadata_json = CAST(? AS JSON), updated_at = NOW()
       WHERE id = ?`,
      [
        data.source_ref_id || existing.source_ref_id || null,
        normalizeText(data.title || existing.title) || null,
        normalizeText(data.status || existing.status) || 'active',
        stringifyJson({
          ...parseJson(existing.metadata_json, {}),
          ...parseJson(data.metadata_json, {}),
        }),
        existing.id,
      ]
    );
    const [row] = await query('SELECT * FROM gateway_wiki_project_source_bindings WHERE id = ? LIMIT 1', [existing.id]);
    return mapWikiProjectSourceBindingRow(row);
  }
  const result = await query(
    `INSERT INTO gateway_wiki_project_source_bindings
     (project_id, source_type, source_key, source_ref_id, title, status, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, CAST(? AS JSON))`,
    [
      Number(projectId),
      sourceType,
      sourceKey,
      data.source_ref_id || null,
      normalizeText(data.title) || null,
      normalizeText(data.status) || 'active',
      stringifyJson(data.metadata_json || {}),
    ]
  );
  const [row] = await query('SELECT * FROM gateway_wiki_project_source_bindings WHERE id = ? LIMIT 1', [result.insertId]);
  return mapWikiProjectSourceBindingRow(row);
}

async function listDeepWikiProjectSourceBindings(projectId) {
  const rows = await query(
    `SELECT *
     FROM gateway_wiki_project_source_bindings
     WHERE project_id = ?
     ORDER BY source_type ASC, title ASC, id ASC`,
    [Number(projectId)]
  );
  return rows.map(mapWikiProjectSourceBindingRow);
}

async function replaceDeepWikiSnapshotDocumentRevisions(snapshotId, revisions = []) {
  await query('DELETE FROM gateway_wiki_snapshot_document_revisions WHERE snapshot_id = ?', [Number(snapshotId)]);
  for (const revision of revisions) {
    await query(
      `INSERT INTO gateway_wiki_snapshot_document_revisions
       (snapshot_id, source_binding_id, document_type, title, source_uri, version_label, knowledge_asset_id, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON))`,
      [
        Number(snapshotId),
        revision.source_binding_id || null,
        normalizeDeepWikiSourceType(revision.document_type, inferDocumentSourceType(revision.document_type)),
        normalizeText(revision.title) || null,
        normalizeText(revision.source_uri) || null,
        normalizeText(revision.version_label) || null,
        revision.knowledge_asset_id || null,
        stringifyJson(revision.metadata_json || {}),
      ]
    );
  }
}

async function listDeepWikiSnapshotDocumentRevisions(snapshotId) {
  const rows = await query(
    `SELECT d.*, b.source_type AS binding_source_type, b.source_key, b.title AS binding_title
     FROM gateway_wiki_snapshot_document_revisions d
     LEFT JOIN gateway_wiki_project_source_bindings b ON b.id = d.source_binding_id
     WHERE d.snapshot_id = ?
     ORDER BY d.document_type ASC, d.id ASC`,
    [Number(snapshotId)]
  );
  return rows.map(mapWikiSnapshotDocumentRevisionRow);
}

async function replaceDeepWikiThreads(snapshotId, threads = []) {
  await query('DELETE FROM gateway_wiki_threads WHERE snapshot_id = ?', [Number(snapshotId)]);
  for (const thread of threads) {
    await query(
      `INSERT INTO gateway_wiki_threads
       (snapshot_id, thread_key, parent_thread_key, thread_level, domain_key, domain_context_key, behavior_key, title, summary_markdown, entry_points_json, steps_json, branch_points_json, command_keys_json, event_keys_json, object_keys_json, repo_roles_json, evidence_json, metrics_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), CAST(? AS JSON), CAST(? AS JSON), CAST(? AS JSON), CAST(? AS JSON), CAST(? AS JSON), CAST(? AS JSON), CAST(? AS JSON), CAST(? AS JSON))`,
      [
        Number(snapshotId),
        normalizeText(thread.thread_key),
        normalizeText(thread.parent_thread_key) || null,
        normalizeText(thread.thread_level) || 'core_thread',
        normalizeText(thread.domain_key) || null,
        normalizeText(thread.domain_context_key) || null,
        normalizeText(thread.behavior_key) || null,
        normalizeText(thread.title) || normalizeText(thread.thread_key),
        normalizeText(thread.summary_markdown) || null,
        stringifyJson(thread.entry_points_json || []),
        stringifyJson(thread.steps_json || []),
        stringifyJson(thread.branch_points_json || []),
        stringifyJson(thread.command_keys_json || []),
        stringifyJson(thread.event_keys_json || []),
        stringifyJson(thread.object_keys_json || []),
        stringifyJson(thread.repo_roles_json || []),
        stringifyJson(thread.evidence_json || []),
        stringifyJson(thread.metrics_json || {}),
      ]
    );
  }
}

async function listDeepWikiThreads(snapshotId, filters = {}) {
  const conditions = ['snapshot_id = ?'];
  const params = [Number(snapshotId)];
  if (normalizeText(filters.thread_level)) {
    conditions.push('thread_level = ?');
    params.push(normalizeText(filters.thread_level));
  }
  if (normalizeText(filters.domain_key)) {
    conditions.push('domain_key = ?');
    params.push(normalizeText(filters.domain_key));
  }
  if (normalizeText(filters.domain_context_key)) {
    conditions.push('domain_context_key = ?');
    params.push(normalizeText(filters.domain_context_key));
  }
  if (normalizeText(filters.behavior_key)) {
    conditions.push('behavior_key = ?');
    params.push(normalizeText(filters.behavior_key));
  }
  const rows = await query(
    `SELECT *
     FROM gateway_wiki_threads
     WHERE ${conditions.join(' AND ')}
     ORDER BY FIELD(thread_level, 'project_trunk', 'domain', 'core_thread', 'branch_thread', 'exception_thread', 'frontend_journey'), domain_key ASC, id ASC`,
    params
  );
  return rows.map(mapWikiThreadRow);
}

async function getDeepWikiThreadByKey(snapshotId, threadKey) {
  const [row] = await query(
    `SELECT *
     FROM gateway_wiki_threads
     WHERE snapshot_id = ? AND thread_key = ?
     LIMIT 1`,
    [Number(snapshotId), normalizeText(threadKey)]
  );
  return mapWikiThreadRow(row);
}

function buildDeepWikiDomainModel(snapshotId, graph = {}, threadRows = [], pageRows = [], diagrams = []) {
  const objects = Array.isArray(graph.objects) ? graph.objects : [];
  const relations = Array.isArray(graph.relations) ? graph.relations : [];
  const objectByCompositeKey = new Map(
    objects.map((item) => [`${item.object_type}:${item.object_key}`, item])
  );
  const behaviorObjects = objects.filter((item) => item.object_type === 'domain_behavior');
  const aggregateObjects = objects.filter((item) => item.object_type === 'aggregate');
  const commandObjects = objects.filter((item) => item.object_type === 'command');
  const eventObjects = objects.filter((item) => item.object_type === 'domain_event');
  const explicitDomains = objects.filter((item) => item.object_type === 'domain_context');
  const fallbackDomains = explicitDomains.length
    ? []
    : (threadRows || [])
        .filter((item) => item.thread_level === 'domain')
        .map((thread) => ({
          id: null,
          object_type: 'domain_context',
          object_key: normalizeText(thread.domain_key || thread.thread_key),
          title: normalizeText(thread.title) || normalizeText(thread.domain_key || thread.thread_key),
          payload_json: {
            domain_key: normalizeText(thread.domain_key || thread.thread_key),
            domain_label: normalizeText(thread.title) || normalizeText(thread.domain_key || thread.thread_key),
            domain_tier: 'supporting',
            ubiquitous_language: [],
            aggregates: [],
            upstream_contexts: [],
            downstream_contexts: [],
            behaviors: [],
          },
          confidence: 0.45,
        }));
  const domainObjects = [...explicitDomains, ...fallbackDomains];
  return domainObjects.map((domain) => {
    const payload = getDeepWikiObjectPayload(domain);
    const domainKey = normalizeText(payload.domain_key || domain.object_key || domain.title);
    const relationMatch = (relation, targetType, direction) => {
      const fromKey = `${relation.from_object_type}:${relation.from_object_key}`;
      const toKey = `${relation.to_object_type}:${relation.to_object_key}`;
      if (direction === 'outgoing') {
        return fromKey === `domain_context:${domain.object_key}` && relation.to_object_type === targetType;
      }
      return toKey === `domain_context:${domain.object_key}` && relation.from_object_type === targetType;
    };
    const ownedBehaviors = relations
      .filter((relation) => relationMatch(relation, 'domain_behavior', 'outgoing'))
      .map((relation) => objectByCompositeKey.get(`domain_behavior:${relation.to_object_key}`))
      .filter(Boolean);
    const behaviorPool = ownedBehaviors.length
      ? ownedBehaviors
      : behaviorObjects.filter((item) => normalizeText(getDeepWikiObjectPayload(item).domain_key) === domainKey);
    const aggregatePool = relations
      .filter((relation) => relationMatch(relation, 'aggregate', 'outgoing'))
      .map((relation) => objectByCompositeKey.get(`aggregate:${relation.to_object_key}`))
      .filter(Boolean);
    const finalAggregates = aggregatePool.length
      ? aggregatePool
      : aggregateObjects.filter((item) => normalizeText(getDeepWikiObjectPayload(item).domain_key) === domainKey);
    const commands = commandObjects.filter((item) => normalizeText(getDeepWikiObjectPayload(item).domain_key) === domainKey);
    const events = eventObjects.filter((item) => normalizeText(getDeepWikiObjectPayload(item).domain_key) === domainKey);
    const domainThreads = (threadRows || []).filter((item) => normalizeText(item.domain_key) === domainKey);
    const domainPages = (pageRows || []).filter((item) => {
      const pageSlug = normalizeText(item.page_slug);
      const meta = getRecordLike(item.metadata_json, {});
      return pageSlug.startsWith(`10-domains/${domainKey}/`) || (normalizeText(meta.scope_key) === domainKey && normalizeText(meta.scope_type) === 'domain');
    });
    const domainDiagrams = (diagrams || []).filter((item) => normalizeText(item.scope_type) === 'domain' && normalizeText(item.scope_key) === domainKey);
    const upstreamContexts = Array.isArray(payload.upstream_contexts) ? payload.upstream_contexts : [];
    const downstreamContexts = Array.isArray(payload.downstream_contexts) ? payload.downstream_contexts : [];
    return {
      snapshot_id: Number(snapshotId),
      domain_key: domainKey,
      title: normalizeText(payload.domain_label || domain.title) || domainKey,
      bounded_context_name: normalizeText(domain.title) || normalizeText(payload.domain_label) || domainKey,
      domain_tier: normalizeText(payload.domain_tier) || 'supporting',
      ubiquitous_language: Array.isArray(payload.ubiquitous_language) ? payload.ubiquitous_language : [],
      aggregates: finalAggregates.map((item) => ({
        object_key: item.object_key,
        title: item.title,
      })),
      behaviors: behaviorPool.map((item) => {
        const behaviorPayload = getDeepWikiObjectPayload(item);
        return {
          object_key: item.object_key,
          title: item.title,
          description: normalizeText(behaviorPayload.description) || null,
          api_endpoints: Array.isArray(behaviorPayload.source_apis) ? behaviorPayload.source_apis : [],
          tables: Array.isArray(behaviorPayload.source_tables) ? behaviorPayload.source_tables : [],
          aggregate_name: normalizeText(behaviorPayload.aggregate_name) || null,
          command_name: normalizeText(behaviorPayload.command_name) || null,
          event_name: normalizeText(behaviorPayload.event_name) || null,
        };
      }),
      commands: commands.map((item) => ({ object_key: item.object_key, title: item.title })),
      events: events.map((item) => ({ object_key: item.object_key, title: item.title })),
      upstream_contexts: upstreamContexts,
      downstream_contexts: downstreamContexts,
      thread_keys: domainThreads.map((item) => item.thread_key),
      page_slugs: domainPages.map((item) => item.page_slug),
      diagram_keys: domainDiagrams.map((item) => item.diagram_key),
      repo_roles: uniqueStrings(domainThreads.flatMap((item) => Array.isArray(item.repo_roles_json) ? item.repo_roles_json : [])),
      evidence_json: Array.isArray(domain.evidence) ? domain.evidence : [],
      confidence: Number.isFinite(Number(domain.confidence)) ? Number(Number(domain.confidence).toFixed(4)) : null,
    };
  });
}

async function listDeepWikiDomains(snapshotId, filters = {}) {
  const [graph, threadRows, pageRows, diagrams] = await Promise.all([
    loadDeepWikiKnowledgeGraphBySnapshotId(Number(snapshotId)).catch(() => ({ objects: [], relations: [] })),
    listDeepWikiThreads(Number(snapshotId)).catch(() => []),
    listDeepWikiPagesBySnapshotId(Number(snapshotId)).catch(() => []),
    listDeepWikiSnapshotDiagrams(Number(snapshotId)).catch(() => []),
  ]);
  let domains = buildDeepWikiDomainModel(Number(snapshotId), graph, threadRows, pageRows, diagrams);
  if (normalizeText(filters.domain_tier)) {
    domains = domains.filter((item) => normalizeText(item.domain_tier) === normalizeText(filters.domain_tier));
  }
  if (normalizeText(filters.domain_key)) {
    domains = domains.filter((item) => normalizeText(item.domain_key) === normalizeText(filters.domain_key));
  }
  return domains.sort((left, right) => String(left.title || '').localeCompare(String(right.title || ''), 'zh-CN'));
}

async function getDeepWikiDomainByKey(snapshotId, domainKey) {
  const domains = await listDeepWikiDomains(Number(snapshotId), { domain_key: domainKey });
  return domains[0] || null;
}

async function replaceDeepWikiSnapshotDiagrams(snapshotId, diagrams = []) {
  await query('DELETE FROM gateway_wiki_snapshot_diagrams WHERE snapshot_id = ?', [Number(snapshotId)]);
  for (const diagram of diagrams) {
    const defaults = getDeepWikiDiagramDefaults(diagram.diagram_type);
    await query(
      `INSERT INTO gateway_wiki_snapshot_diagrams
       (snapshot_id, diagram_type, diagram_key, scope_type, scope_key, parent_scope_key, sort_order, title, format, content, render_status, source_page_id, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON))`,
      [
        Number(snapshotId),
        defaults.diagram_type,
        normalizeText(diagram.diagram_key) || defaults.diagram_type,
        normalizeDeepWikiScopeType(diagram.scope_type, 'project'),
        normalizeText(diagram.scope_key) || 'project',
        normalizeText(diagram.parent_scope_key) || null,
        Number.isFinite(Number(diagram.sort_order)) ? Number(diagram.sort_order) : 0,
        normalizeText(diagram.title) || defaults.title,
        normalizeText(diagram.format) || 'mermaid',
        diagram.content || null,
        normalizeText(diagram.render_status) || 'ready',
        diagram.source_page_id || null,
        stringifyJson(diagram.metadata_json || {}),
      ]
    );
  }
}

async function listDeepWikiSnapshotDiagrams(snapshotId) {
  const rows = await query(
    `SELECT *
     FROM gateway_wiki_snapshot_diagrams
     WHERE snapshot_id = ?
     ORDER BY FIELD(scope_type, 'project', 'domain', 'thread', 'branch'), sort_order ASC, diagram_key ASC, id ASC`,
    [Number(snapshotId)]
  );
  return rows.map((row) => {
    const mapped = mapWikiSnapshotDiagramRow(row);
    const defaults = getDeepWikiDiagramDefaults(mapped.diagram_type);
    return {
      ...mapped,
      title: normalizeText(mapped.title) || defaults.title,
    };
  });
}

async function upsertDeepWikiProjectSnapshot(data = {}) {
  const snapshotVersion = normalizeText(data.snapshot_version) || buildDeepWikiSnapshotVersion(data.branch, data.commit_sha);
  const snapshotId = Number(data.id || 0);
  const writeSnapshotRecord = async (persisted, existingId = null) => {
    const fullUpdateSql = `UPDATE gateway_wiki_snapshots
       SET repo_snapshot_id = ?, run_id = ?, snapshot_version = ?, status = ?, publish_ready = ?, quality_gate_blocked = ?,
           approval_status = ?, source_snapshot_id = ?, lineage_json = CAST(? AS JSON), publish_status = ?, quality_status = ?,
           source_manifest_json = CAST(? AS JSON), metadata_json = CAST(? AS JSON), published_at = ?, updated_at = NOW()
       WHERE id = ?`;
    const fallbackUpdateSql = `UPDATE gateway_wiki_snapshots
       SET repo_snapshot_id = ?, run_id = ?, snapshot_version = ?, publish_status = ?, quality_status = ?,
           source_manifest_json = CAST(? AS JSON), metadata_json = CAST(? AS JSON), published_at = ?, updated_at = NOW()
       WHERE id = ?`;
    const fullInsertSql = `INSERT INTO gateway_wiki_snapshots
       (project_id, repo_source_id, repo_snapshot_id, run_id, branch, commit_sha, snapshot_version, status, publish_ready,
        quality_gate_blocked, approval_status, source_snapshot_id, lineage_json, publish_status, quality_status,
        source_manifest_json, metadata_json, published_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), ?, ?, CAST(? AS JSON), CAST(? AS JSON), ?)`;
    const fallbackInsertSql = `INSERT INTO gateway_wiki_snapshots
       (project_id, repo_source_id, repo_snapshot_id, run_id, branch, commit_sha, snapshot_version, publish_status, quality_status,
        source_manifest_json, metadata_json, published_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), CAST(? AS JSON), ?)`;
    const fullUpdateParams = [
      persisted.repo_snapshot_id,
      persisted.run_id,
      persisted.snapshot_version,
      persisted.status,
      persisted.publish_ready ? 1 : 0,
      persisted.quality_gate_blocked ? 1 : 0,
      persisted.approval_status,
      persisted.source_snapshot_id,
      stringifyJson(persisted.lineage_json || {}, '{}'),
      persisted.publish_status,
      persisted.quality_status,
      stringifyJson(persisted.source_manifest_json || {}, '{}'),
      stringifyJson(persisted.metadata_json || {}, '{}'),
      persisted.published_at,
      existingId,
    ];
    const fallbackUpdateParams = [
      persisted.repo_snapshot_id,
      persisted.run_id,
      persisted.snapshot_version,
      persisted.publish_status,
      persisted.quality_status,
      stringifyJson(persisted.source_manifest_json || {}, '{}'),
      stringifyJson(persisted.metadata_json || {}, '{}'),
      persisted.published_at,
      existingId,
    ];
    const fullInsertParams = [
      persisted.project_id,
      persisted.repo_source_id,
      persisted.repo_snapshot_id,
      persisted.run_id,
      persisted.branch,
      persisted.commit_sha,
      persisted.snapshot_version,
      persisted.status,
      persisted.publish_ready ? 1 : 0,
      persisted.quality_gate_blocked ? 1 : 0,
      persisted.approval_status,
      persisted.source_snapshot_id,
      stringifyJson(persisted.lineage_json || {}, '{}'),
      persisted.publish_status,
      persisted.quality_status,
      stringifyJson(persisted.source_manifest_json || {}, '{}'),
      stringifyJson(persisted.metadata_json || {}, '{}'),
      persisted.published_at,
    ];
    const fallbackInsertParams = [
      persisted.project_id,
      persisted.repo_source_id,
      persisted.repo_snapshot_id,
      persisted.run_id,
      persisted.branch,
      persisted.commit_sha,
      persisted.snapshot_version,
      persisted.publish_status,
      persisted.quality_status,
      stringifyJson(persisted.source_manifest_json || {}, '{}'),
      stringifyJson(persisted.metadata_json || {}, '{}'),
      persisted.published_at,
    ];

    if (existingId) {
      try {
        await query(fullUpdateSql, fullUpdateParams);
      } catch (error) {
        if (String(error?.code || '') !== 'ER_BAD_FIELD_ERROR') {
          throw error;
        }
        await query(fallbackUpdateSql, fallbackUpdateParams);
      }
      return { id: existingId };
    }

    try {
      return await query(fullInsertSql, fullInsertParams);
    } catch (error) {
      if (String(error?.code || '') !== 'ER_BAD_FIELD_ERROR') {
        throw error;
      }
      return query(fallbackInsertSql, fallbackInsertParams);
    }
  };
  const buildPersistedSnapshot = (existingRow = null) => {
    const existingSnapshot = existingRow ? mapWikiSnapshotRow(existingRow) : {};
    const mergedSourceManifest =
      data.source_manifest_json != null
        ? data.source_manifest_json
        : parseJson(existingRow?.source_manifest_json, {});
    const mergedMetadata = {
      ...parseJson(existingRow?.metadata_json, {}),
      ...parseJson(data.metadata_json, {}),
    };
    const baseSnapshot = {
      ...existingSnapshot,
      ...data,
      project_id: Number(data.project_id || existingSnapshot.project_id || 0),
      repo_source_id: Number(data.repo_source_id || existingSnapshot.repo_source_id || 0),
      repo_snapshot_id: data.repo_snapshot_id || existingSnapshot.repo_snapshot_id || null,
      run_id: data.run_id || existingSnapshot.run_id || null,
      branch: data.branch || existingSnapshot.branch || null,
      commit_sha: data.commit_sha || existingSnapshot.commit_sha || null,
      snapshot_version: snapshotVersion,
      source_manifest_json: mergedSourceManifest,
      metadata_json: mergedMetadata,
      gates: data.gates || data.gate_decisions || existingSnapshot.gates || [],
    };
    const normalized = backfillSnapshotRecord(baseSnapshot);
    const publishedAt =
      normalized.status === 'published'
        ? (data.published_at || existingSnapshot.published_at || new Date().toISOString().slice(0, 19).replace('T', ' '))
        : null;
    return {
      ...baseSnapshot,
      ...normalized,
      published_at: publishedAt,
    };
  };
  if (snapshotId > 0) {
    const [existingById] = await query(
      `SELECT * FROM gateway_wiki_snapshots
       WHERE id = ?
       LIMIT 1`,
      [snapshotId]
    );
    if (!existingById) return null;
    const persisted = buildPersistedSnapshot(existingById);
    await writeSnapshotRecord(persisted, snapshotId);
    const [row] = await query('SELECT * FROM gateway_wiki_snapshots WHERE id = ? LIMIT 1', [snapshotId]);
    return mapWikiSnapshotRow(row);
  }
  if (data.force_new) {
    const persisted = buildPersistedSnapshot();
    const result = await writeSnapshotRecord(persisted);
    const [row] = await query('SELECT * FROM gateway_wiki_snapshots WHERE id = ? LIMIT 1', [result.insertId]);
    return mapWikiSnapshotRow(row);
  }
  const [existing] = await query(
    `SELECT * FROM gateway_wiki_snapshots
     WHERE project_id = ? AND repo_source_id = ? AND branch = ? AND commit_sha = ?
     LIMIT 1`,
    [Number(data.project_id), Number(data.repo_source_id), data.branch, data.commit_sha]
  );
  if (existing) {
    const persisted = buildPersistedSnapshot(existing);
    await writeSnapshotRecord(persisted, existing.id);
    const [row] = await query('SELECT * FROM gateway_wiki_snapshots WHERE id = ? LIMIT 1', [existing.id]);
    return mapWikiSnapshotRow(row);
  }

  const persisted = buildPersistedSnapshot();
  const result = await writeSnapshotRecord(persisted);
  const [row] = await query('SELECT * FROM gateway_wiki_snapshots WHERE id = ? LIMIT 1', [result.insertId]);
  return mapWikiSnapshotRow(row);
}

async function getDeepWikiSnapshotByRunId(runId) {
  const [row] = await query('SELECT * FROM gateway_wiki_snapshots WHERE run_id = ? LIMIT 1', [Number(runId)]);
  return mapWikiSnapshotRow(row);
}

async function replaceDeepWikiConsistencyChecks(snapshotId, checks = []) {
  await query('DELETE FROM gateway_wiki_consistency_checks WHERE snapshot_id = ?', [Number(snapshotId)]);
  for (const check of checks) {
    try {
      await query(
        `INSERT INTO gateway_wiki_consistency_checks
         (snapshot_id, check_type, source_object_type, source_object_id, target_object_type, target_object_id, status, score, issue_code, issue_level, detail_json, evidence_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), CAST(? AS JSON))`,
        [
          Number(snapshotId),
          normalizeText(check.check_type) || 'consistency',
          normalizeText(check.source_object_type) || null,
          check.source_object_id || null,
          normalizeText(check.target_object_type) || null,
          check.target_object_id || null,
          normalizeText(check.status) || 'pending',
          Number(check.score || 0),
          normalizeText(check.issue_code) || null,
          normalizeText(check.issue_level) || 'info',
          stringifyJson(check.detail_json || {}),
          stringifyJson(check.evidence_json || []),
        ]
      );
    } catch (error) {
      if (!isUnknownColumnError(error, 'status')) {
        throw error;
      }
      await query(
        `INSERT INTO gateway_wiki_consistency_checks
         (snapshot_id, check_type, source_object_type, source_object_id, target_object_type, target_object_id, score, issue_code, issue_level, detail_json, evidence_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), CAST(? AS JSON))`,
        [
          Number(snapshotId),
          normalizeText(check.check_type) || 'consistency',
          normalizeText(check.source_object_type) || null,
          check.source_object_id || null,
          normalizeText(check.target_object_type) || null,
          check.target_object_id || null,
          Number(check.score || 0),
          normalizeText(check.issue_code) || null,
          normalizeText(check.issue_level) || 'info',
          stringifyJson(check.detail_json || {}),
          stringifyJson(check.evidence_json || []),
        ]
      );
    }
  }
}

async function listDeepWikiConsistencyChecks(snapshotId) {
  const rows = await query(
    `SELECT *
     FROM gateway_wiki_consistency_checks
     WHERE snapshot_id = ?
     ORDER BY issue_level DESC, id ASC`,
    [Number(snapshotId)]
  );
  return rows.map(mapWikiConsistencyCheckRow);
}

async function replaceDeepWikiFlows(snapshotId, flows = []) {
  const existingFlowRows = await query('SELECT id FROM gateway_wiki_flows WHERE snapshot_id = ?', [Number(snapshotId)]);
  const existingFlowIds = existingFlowRows.map((row) => Number(row.id));
  if (existingFlowIds.length) {
    await query(`DELETE FROM gateway_wiki_flow_steps WHERE flow_id IN (${existingFlowIds.map(() => '?').join(', ')})`, existingFlowIds);
  }
  await query('DELETE FROM gateway_wiki_flows WHERE snapshot_id = ?', [Number(snapshotId)]);
  const flowIdMap = new Map();
  for (const flow of flows) {
    let result;
    try {
      result = await query(
        `INSERT INTO gateway_wiki_flows
         (snapshot_id, flow_code, flow_name, flow_type, feature_object_id, trigger_type, preconditions_json, postconditions_json, status, evidence_json)
         VALUES (?, ?, ?, ?, ?, ?, CAST(? AS JSON), CAST(? AS JSON), ?, CAST(? AS JSON))`,
        [
          Number(snapshotId),
          normalizeText(flow.flow_code),
          normalizeText(flow.flow_name) || normalizeText(flow.flow_code),
          normalizeText(flow.flow_type) || 'feature_flow',
          flow.feature_object_id || null,
          normalizeText(flow.trigger_type) || null,
          stringifyJson(flow.preconditions_json || []),
          stringifyJson(flow.postconditions_json || []),
          normalizeText(flow.status) || 'draft',
          stringifyJson(flow.evidence_json || []),
        ]
      );
    } catch (error) {
      if (!isUnknownColumnError(error, 'status')) {
        throw error;
      }
      result = await query(
        `INSERT INTO gateway_wiki_flows
         (snapshot_id, flow_code, flow_name, flow_type, feature_object_id, trigger_type, preconditions_json, postconditions_json, evidence_json)
         VALUES (?, ?, ?, ?, ?, ?, CAST(? AS JSON), CAST(? AS JSON), CAST(? AS JSON))`,
        [
          Number(snapshotId),
          normalizeText(flow.flow_code),
          normalizeText(flow.flow_name) || normalizeText(flow.flow_code),
          normalizeText(flow.flow_type) || 'feature_flow',
          flow.feature_object_id || null,
          normalizeText(flow.trigger_type) || null,
          stringifyJson(flow.preconditions_json || []),
          stringifyJson(flow.postconditions_json || []),
          stringifyJson(flow.evidence_json || []),
        ]
      );
    }
    const flowId = Number(result.insertId);
    flowIdMap.set(flow.flow_code, flowId);
    const steps = Array.isArray(flow.steps) ? flow.steps : [];
    for (const step of steps) {
      await query(
        `INSERT INTO gateway_wiki_flow_steps
         (flow_id, step_order, step_type, step_name, service_object_id, api_object_id, table_object_id, event_object_id, input_schema_ref, output_schema_ref, assertion_ref, on_failure, evidence_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON))`,
        [
          flowId,
          Number(step.step_order || 0),
          normalizeText(step.step_type) || 'step',
          normalizeText(step.step_name) || 'step',
          step.service_object_id || null,
          step.api_object_id || null,
          step.table_object_id || null,
          step.event_object_id || null,
          normalizeText(step.input_schema_ref) || null,
          normalizeText(step.output_schema_ref) || null,
          normalizeText(step.assertion_ref) || null,
          normalizeText(step.on_failure) || null,
          stringifyJson(step.evidence_json || []),
        ]
      );
    }
  }
  return flowIdMap;
}

async function listDeepWikiFlows(snapshotId) {
  const flowRows = await query(
    `SELECT *
     FROM gateway_wiki_flows
     WHERE snapshot_id = ?
     ORDER BY id ASC`,
    [Number(snapshotId)]
  );
  const flows = flowRows.map(mapWikiFlowRow);
  const flowIds = flows.map((item) => Number(item.id)).filter(Number.isFinite);
  if (!flowIds.length) return [];
  const stepRows = await query(
    `SELECT *
     FROM gateway_wiki_flow_steps
     WHERE flow_id IN (${flowIds.map(() => '?').join(', ')})
     ORDER BY flow_id ASC, step_order ASC, id ASC`,
    flowIds
  );
  const stepsByFlowId = new Map();
  stepRows.map(mapWikiFlowStepRow).forEach((row) => {
    const bucket = stepsByFlowId.get(Number(row.flow_id)) || [];
    bucket.push(row);
    stepsByFlowId.set(Number(row.flow_id), bucket);
  });
  return flows.map((flow) => ({
    ...flow,
    steps: stepsByFlowId.get(Number(flow.id)) || [],
  }));
}

async function replaceDeepWikiAssertions(snapshotId, assertions = []) {
  await query('DELETE FROM gateway_wiki_assertions WHERE snapshot_id = ?', [Number(snapshotId)]);
  for (const assertion of assertions) {
    await query(
      `INSERT INTO gateway_wiki_assertions
       (snapshot_id, assertion_code, assertion_type, expression, expected_result_json, evidence_json)
       VALUES (?, ?, ?, ?, CAST(? AS JSON), CAST(? AS JSON))`,
      [
        Number(snapshotId),
        normalizeText(assertion.assertion_code),
        normalizeText(assertion.assertion_type) || 'expected_result',
        normalizeText(assertion.expression) || null,
        stringifyJson(assertion.expected_result_json || {}),
        stringifyJson(assertion.evidence_json || []),
      ]
    );
  }
}

async function listDeepWikiAssertions(snapshotId) {
  const rows = await query(
    `SELECT *
     FROM gateway_wiki_assertions
     WHERE snapshot_id = ?
     ORDER BY id ASC`,
    [Number(snapshotId)]
  );
  return rows.map(mapWikiAssertionRow);
}

async function replaceDeepWikiScenarios(snapshotId, scenarios = []) {
  await query('DELETE FROM gateway_wiki_scenarios WHERE snapshot_id = ?', [Number(snapshotId)]);
  for (const scenario of scenarios) {
    try {
      await query(
        `INSERT INTO gateway_wiki_scenarios
         (snapshot_id, scenario_code, scenario_name, feature_object_id, flow_id, input_fixture_json, expected_assertions_json, linked_test_asset_object_id, status)
         VALUES (?, ?, ?, ?, ?, CAST(? AS JSON), CAST(? AS JSON), ?, ?)`,
        [
          Number(snapshotId),
          normalizeText(scenario.scenario_code),
          normalizeText(scenario.scenario_name) || normalizeText(scenario.scenario_code),
          scenario.feature_object_id || null,
          scenario.flow_id || null,
          stringifyJson(scenario.input_fixture_json || {}),
          stringifyJson(scenario.expected_assertions_json || []),
          scenario.linked_test_asset_object_id || null,
          normalizeText(scenario.status) || 'draft',
        ]
      );
    } catch (error) {
      if (!isUnknownColumnError(error, 'status')) {
        throw error;
      }
      await query(
        `INSERT INTO gateway_wiki_scenarios
         (snapshot_id, scenario_code, scenario_name, feature_object_id, flow_id, input_fixture_json, expected_assertions_json, linked_test_asset_object_id)
         VALUES (?, ?, ?, ?, ?, CAST(? AS JSON), CAST(? AS JSON), ?)`,
        [
          Number(snapshotId),
          normalizeText(scenario.scenario_code),
          normalizeText(scenario.scenario_name) || normalizeText(scenario.scenario_code),
          scenario.feature_object_id || null,
          scenario.flow_id || null,
          stringifyJson(scenario.input_fixture_json || {}),
          stringifyJson(scenario.expected_assertions_json || []),
          scenario.linked_test_asset_object_id || null,
        ]
      );
    }
  }
}

async function listDeepWikiScenarios(snapshotId) {
  const rows = await query(
    `SELECT *
     FROM gateway_wiki_scenarios
     WHERE snapshot_id = ?
     ORDER BY id ASC`,
    [Number(snapshotId)]
  );
  return rows.map(mapWikiScenarioRow);
}

async function replaceDeepWikiSemanticScores(snapshotId, scores = []) {
  await query('DELETE FROM gateway_wiki_semantic_scores WHERE snapshot_id = ?', [Number(snapshotId)]);
  for (const score of scores) {
    try {
      await query(
        `INSERT INTO gateway_wiki_semantic_scores
         (snapshot_id, target_type, target_id, business_completeness_score, architecture_coherence_score, data_contract_score, test_alignment_score, flow_executability_score, evidence_trust_score, final_score, status, detail_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON))`,
        [
          Number(snapshotId),
          normalizeText(score.target_type) || 'snapshot',
          score.target_id || null,
          Number(score.business_completeness_score || 0),
          Number(score.architecture_coherence_score || 0),
          Number(score.data_contract_score || 0),
          Number(score.test_alignment_score || 0),
          Number(score.flow_executability_score || 0),
          Number(score.evidence_trust_score || 0),
          Number(score.final_score || 0),
          normalizeText(score.status) || 'draft',
          stringifyJson(score.detail_json || {}),
        ]
      );
    } catch (error) {
      if (!isUnknownColumnError(error, 'status')) {
        throw error;
      }
      await query(
        `INSERT INTO gateway_wiki_semantic_scores
         (snapshot_id, target_type, target_id, business_completeness_score, architecture_coherence_score, data_contract_score, test_alignment_score, flow_executability_score, evidence_trust_score, final_score, detail_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON))`,
        [
          Number(snapshotId),
          normalizeText(score.target_type) || 'snapshot',
          score.target_id || null,
          Number(score.business_completeness_score || 0),
          Number(score.architecture_coherence_score || 0),
          Number(score.data_contract_score || 0),
          Number(score.test_alignment_score || 0),
          Number(score.flow_executability_score || 0),
          Number(score.evidence_trust_score || 0),
          Number(score.final_score || 0),
          stringifyJson(score.detail_json || {}),
        ]
      );
    }
  }
}

async function listDeepWikiSemanticScores(snapshotId) {
  const rows = await query(
    `SELECT *
     FROM gateway_wiki_semantic_scores
     WHERE snapshot_id = ?
     ORDER BY final_score DESC, id ASC`,
    [Number(snapshotId)]
  );
  return rows.map(mapWikiSemanticScoreRow);
}

async function replaceDeepWikiCommunityReports(snapshotId, reports = []) {
  await query('DELETE FROM gateway_wiki_community_reports WHERE snapshot_id = ?', [Number(snapshotId)]);
  for (const report of reports) {
    await query(
      `INSERT INTO gateway_wiki_community_reports
       (snapshot_id, community_key, title, summary_markdown, object_ids_json, page_slugs_json, community_score, metadata_json)
       VALUES (?, ?, ?, ?, CAST(? AS JSON), CAST(? AS JSON), ?, CAST(? AS JSON))`,
      [
        Number(snapshotId),
        normalizeText(report.community_key) || `community-${Date.now()}`,
        normalizeText(report.title) || '未命名社区',
        report.summary_markdown || '',
        stringifyJson(report.object_ids_json || []),
        stringifyJson(report.page_slugs_json || []),
        Number(report.community_score || 0),
        stringifyJson(report.metadata_json || {}),
      ]
    );
  }
}

async function listDeepWikiCommunityReports(snapshotId) {
  const rows = await query(
    `SELECT *
     FROM gateway_wiki_community_reports
     WHERE snapshot_id = ?
     ORDER BY community_score DESC, id ASC`,
    [Number(snapshotId)]
  );
  return rows.map(mapWikiCommunityReportRow);
}

async function createDeepWikiQueryLog(data = {}) {
  const result = await query(
    `INSERT INTO gateway_wiki_query_logs
     (project_id, snapshot_id, run_id, query_text, query_mode, resolved_mode, status, answer_text, citations_json, trace_json, provider, model, latency_ms, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), CAST(? AS JSON), ?, ?, ?, CAST(? AS JSON))`,
    [
      data.project_id || null,
      Number(data.snapshot_id),
      data.run_id || null,
      normalizeText(data.query_text),
      normalizeText(data.query_mode) || 'auto',
      normalizeText(data.resolved_mode) || 'local',
      normalizeText(data.status) || 'completed',
      data.answer_text || '',
      stringifyJson(data.citations_json || []),
      stringifyJson(data.trace_json || {}),
      normalizeText(data.provider) || null,
      normalizeText(data.model) || null,
      Number.isFinite(Number(data.latency_ms)) ? Number(data.latency_ms) : null,
      stringifyJson(data.metadata_json || {}),
    ]
  );
  const [row] = await query('SELECT * FROM gateway_wiki_query_logs WHERE id = ? LIMIT 1', [result.insertId]);
  return mapWikiQueryLogRow(row);
}

async function createDeepWikiFeedbackEvent(data = {}) {
  const result = await query(
    `INSERT INTO gateway_wiki_feedback_events
     (project_id, snapshot_id, source_pipeline, feedback_type, source_ref_id, payload_json, evidence_json, status)
     VALUES (?, ?, ?, ?, ?, CAST(? AS JSON), CAST(? AS JSON), ?)`,
    [
      Number(data.project_id),
      data.snapshot_id || null,
      normalizeText(data.source_pipeline),
      normalizeText(data.feedback_type),
      normalizeText(data.source_ref_id) || null,
      stringifyJson(data.payload_json || {}),
      stringifyJson(data.evidence_json || []),
      normalizeText(data.status) || 'accepted',
    ]
  );
  const [row] = await query('SELECT * FROM gateway_wiki_feedback_events WHERE id = ? LIMIT 1', [result.insertId]);
  return mapWikiFeedbackEventRow(row);
}

async function listDeepWikiFeedbackEvents(filters = {}) {
  const where = [];
  const params = [];
  if (filters.project_id) {
    where.push('project_id = ?');
    params.push(Number(filters.project_id));
  }
  if (filters.snapshot_id) {
    where.push('snapshot_id = ?');
    params.push(Number(filters.snapshot_id));
  }
  if (normalizeText(filters.source_pipeline)) {
    where.push('source_pipeline = ?');
    params.push(normalizeText(filters.source_pipeline));
  }
  const rows = await query(
    `SELECT *
     FROM gateway_wiki_feedback_events
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY created_at DESC, id DESC
     LIMIT 100`,
    params
  );
  return rows.map(mapWikiFeedbackEventRow);
}

async function listDeepWikiSnapshotObjects(snapshotId, objectType = null) {
  const where = ['s.id = ?'];
  const params = [Number(snapshotId)];
  if (normalizeText(objectType)) {
    where.push('o.object_type = ?');
    params.push(normalizeText(objectType));
  }
  const rows = await query(
    `SELECT o.*
     FROM gateway_wiki_snapshots s
     INNER JOIN gateway_wiki_objects o ON o.run_id = s.run_id
     WHERE ${where.join(' AND ')}
     ORDER BY o.object_type ASC, o.title ASC, o.id ASC`,
    params
  );
  return rows.map(mapWikiObjectRow);
}

async function loadDeepWikiKnowledgeGraphByRunId(runId) {
  const [objectRows, evidenceRows, relationRows] = await Promise.all([
    query(
      `SELECT *
       FROM gateway_wiki_objects
       WHERE run_id = ?
       ORDER BY id ASC`,
      [Number(runId)]
    ),
    query(
      `SELECT *
       FROM gateway_wiki_evidence
       WHERE run_id = ?
       ORDER BY id ASC`,
      [Number(runId)]
    ),
    query(
      `SELECT r.*,
              fo.object_type AS from_object_type,
              fo.object_key AS from_object_key,
              tobj.object_type AS to_object_type,
              tobj.object_key AS to_object_key
       FROM gateway_wiki_relations r
       INNER JOIN gateway_wiki_objects fo ON fo.id = r.from_object_id
       INNER JOIN gateway_wiki_objects tobj ON tobj.id = r.to_object_id
       WHERE r.run_id = ?
       ORDER BY r.id ASC`,
      [Number(runId)]
    ),
  ]);

  const evidenceByObjectId = new Map();
  evidenceRows.map(mapWikiEvidenceRow).forEach((row) => {
    const key = Number(row.object_id);
    const bucket = evidenceByObjectId.get(key) || [];
    bucket.push({
      evidence_type: row.evidence_type,
      source_uri: row.source_uri,
      source_ref: row.source_ref,
      source_commit_sha: row.source_commit_sha,
      quote_text: row.quote_text,
      meta_json: row.meta_json || {},
    });
    evidenceByObjectId.set(key, bucket);
  });

  const objects = objectRows.map((row) => {
    const objectRow = mapWikiObjectRow(row);
    return {
      ...objectRow,
      evidence: evidenceByObjectId.get(Number(objectRow.id)) || [],
    };
  });

  const objectIdMap = {};
  objects.forEach((item) => {
    objectIdMap[`${item.object_type}:${item.object_key}`] = Number(item.id);
  });

  return {
    objects,
    relations: relationRows.map((row) => ({
      from_object_type: row.from_object_type,
      from_object_key: row.from_object_key,
      relation_type: row.relation_type,
      to_object_type: row.to_object_type,
      to_object_key: row.to_object_key,
      meta_json: parseJson(row.meta_json, {}),
    })),
    object_id_map: objectIdMap,
  };
}

async function loadDeepWikiKnowledgeGraphBySnapshotId(snapshotId) {
  const [objectRows, evidenceRows, relationRows] = await Promise.all([
    query(
      `SELECT o.*
       FROM gateway_wiki_snapshots s
       INNER JOIN gateway_wiki_objects o ON o.run_id = s.run_id
       WHERE s.id = ?
       ORDER BY id ASC`,
      [Number(snapshotId)]
    ),
    query(
      `SELECT e.*
       FROM gateway_wiki_snapshots s
       INNER JOIN gateway_wiki_objects o ON o.run_id = s.run_id
       INNER JOIN gateway_wiki_evidence e ON e.object_id = o.id
       INNER JOIN gateway_wiki_objects eo ON eo.id = e.object_id
       WHERE s.id = ? AND eo.run_id = s.run_id
       ORDER BY e.id ASC`,
      [Number(snapshotId)]
    ),
    query(
      `SELECT r.*,
              fo.object_type AS from_object_type,
              fo.object_key AS from_object_key,
              tobj.object_type AS to_object_type,
              tobj.object_key AS to_object_key
       FROM gateway_wiki_relations r
       INNER JOIN gateway_wiki_snapshots s ON s.run_id = r.run_id
       INNER JOIN gateway_wiki_objects fo ON fo.id = r.from_object_id
       INNER JOIN gateway_wiki_objects tobj ON tobj.id = r.to_object_id
       WHERE s.id = ? AND fo.run_id = s.run_id AND tobj.run_id = s.run_id
       ORDER BY r.id ASC`,
      [Number(snapshotId)]
    ),
  ]);
  const evidenceByObjectId = new Map();
  evidenceRows.map(mapWikiEvidenceRow).forEach((row) => {
    const key = Number(row.object_id);
    const bucket = evidenceByObjectId.get(key) || [];
    bucket.push({
      evidence_type: row.evidence_type,
      source_uri: row.source_uri,
      source_ref: row.source_ref,
      source_commit_sha: row.source_commit_sha,
      quote_text: row.quote_text,
      meta_json: row.meta_json || {},
    });
    evidenceByObjectId.set(key, bucket);
  });
  const objects = objectRows.map((row) => {
    const objectRow = mapWikiObjectRow(row);
    return {
      ...objectRow,
      evidence: evidenceByObjectId.get(Number(objectRow.id)) || [],
    };
  });
  const objectIdMap = {};
  objects.forEach((item) => {
    objectIdMap[`${item.object_type}:${item.object_key}`] = Number(item.id);
  });
  return {
    objects,
    relations: relationRows.map((row) => ({
      from_object_type: row.from_object_type,
      from_object_key: row.from_object_key,
      relation_type: row.relation_type,
      to_object_type: row.to_object_type,
      to_object_key: row.to_object_key,
      meta_json: parseJson(row.meta_json, {}),
    })),
    object_id_map: objectIdMap,
  };
}

async function getDeepWikiKnowledgeGraphSummaryBySnapshotId(snapshotId) {
  let objectRows;
  let relationRows;
  let coverageRow;
  try {
    objectRows = await query(
      `SELECT object_type, COUNT(*) AS total
       FROM gateway_wiki_snapshots s
       INNER JOIN gateway_wiki_objects o ON o.run_id = s.run_id
       WHERE s.id = ?
       GROUP BY object_type`,
      [Number(snapshotId)]
    );
    relationRows = await query(
      `SELECT r.relation_type, COUNT(*) AS total
       FROM gateway_wiki_relations r
       INNER JOIN gateway_wiki_snapshots s ON s.run_id = r.run_id
       INNER JOIN gateway_wiki_objects o ON o.id = r.from_object_id
       WHERE s.id = ? AND o.run_id = s.run_id
       GROUP BY r.relation_type`,
      [Number(snapshotId)]
    );
    [coverageRow] = await query(
      `SELECT COUNT(*) AS object_count,
              COUNT(DISTINCT CASE WHEN e.id IS NOT NULL THEN o.id END) AS covered_object_count
       FROM gateway_wiki_snapshots s
       INNER JOIN gateway_wiki_objects o ON o.run_id = s.run_id
       LEFT JOIN gateway_wiki_evidence e ON e.object_id = o.id
       WHERE s.id = ?`,
      [Number(snapshotId)]
    );
  } catch (error) {
    if (String(error.code || '') === 'ER_NO_SUCH_TABLE') {
      return {
        object_counts: {},
        relation_counts: {},
        evidence_coverage: { object_count: 0, covered_object_count: 0, percent: 0 },
      };
    }
    throw error;
  }
  const objectCounts = {};
  objectRows.forEach((row) => {
    objectCounts[row.object_type] = Number(row.total || 0);
  });
  const relationCounts = {};
  relationRows.forEach((row) => {
    relationCounts[row.relation_type] = Number(row.total || 0);
  });
  const objectCount = Number(coverageRow?.object_count || 0);
  const coveredObjectCount = Number(coverageRow?.covered_object_count || 0);
  return {
    object_counts: objectCounts,
    relation_counts: relationCounts,
    evidence_coverage: {
      object_count: objectCount,
      covered_object_count: coveredObjectCount,
      percent: objectCount ? Number(((coveredObjectCount / objectCount) * 100).toFixed(2)) : 0,
    },
  };
}

function getWikiGraphObjectNodeId(objectType, objectKey) {
  return `${normalizeText(objectType)}:${normalizeText(objectKey)}`;
}

function getWikiGraphPageNodeId(page) {
  const type = page?.page_type === 'diagram' ? 'diagram' : 'page';
  return `${type}:${normalizeText(page?.page_slug)}`;
}

function getWikiGraphArray(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean);
  }
  return [];
}

function getWikiGraphNodeLabel(node) {
  return normalizeText(node.label || node.title || node.id).slice(0, 48) || node.id;
}

function escapeMermaidLabel(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, ' ')
    .slice(0, 80);
}

function buildDeepWikiGraphMermaid(nodes = [], edges = []) {
  const typeOrder = ['page', 'diagram', 'feature', 'service', 'api', 'table', 'test_asset'];
  const typeLabels = {
    page: 'Pages',
    diagram: 'Diagrams',
    feature: 'Features',
    service: 'Services',
    api: 'APIs',
    table: 'Tables',
    test_asset: 'Tests',
  };
  const degree = new Map();
  edges.forEach((edge) => {
    degree.set(edge.source, Number(degree.get(edge.source) || 0) + 1);
    degree.set(edge.target, Number(degree.get(edge.target) || 0) + 1);
  });
  const sortedNodes = (Array.isArray(nodes) ? nodes : [])
    .slice()
    .sort((left, right) => {
      const degreeDiff = Number(degree.get(right.id) || 0) - Number(degree.get(left.id) || 0);
      if (degreeDiff) return degreeDiff;
      return Number(right.confidence || 0) - Number(left.confidence || 0);
    });
  const selectedNodes = sortedNodes.slice(0, 60);
  const selectedIds = new Set(selectedNodes.map((node) => node.id));
  const nodeIdMap = new Map(selectedNodes.map((node, index) => [node.id, `N${index + 1}`]));
  const lines = ['flowchart LR'];

  typeOrder.forEach((type) => {
    const bucket = selectedNodes.filter((node) => node.type === type);
    if (!bucket.length) return;
    lines.push(`  subgraph ${typeLabels[type] || type}`);
    bucket.forEach((node) => {
      lines.push(`    ${nodeIdMap.get(node.id)}["${escapeMermaidLabel(getWikiGraphNodeLabel(node))}"]`);
    });
    lines.push('  end');
  });

  const selectedEdges = (Array.isArray(edges) ? edges : [])
    .filter((edge) => selectedIds.has(edge.source) && selectedIds.has(edge.target))
    .slice(0, 120);
  selectedEdges.forEach((edge) => {
    const sourceId = nodeIdMap.get(edge.source);
    const targetId = nodeIdMap.get(edge.target);
    if (!sourceId || !targetId) return;
    const label = escapeMermaidLabel(edge.label || edge.type);
    const dashed = edge.metadata?.source === 'fallback_index';
    lines.push(`  ${sourceId} ${dashed ? '-.->' : '--'}|${label}| ${targetId}`);
  });

  if (nodes.length > selectedNodes.length) {
    lines.push(`  Cropped["已裁剪 ${nodes.length - selectedNodes.length} 个低连接节点"]`);
  }
  if (!selectedNodes.length) {
    lines.push('  Empty["当前 run 尚未生成 Wiki Graph"]');
  }
  return lines.join('\n');
}

function buildDeepWikiGraphPayloadFromRows({ run, repoSource, snapshot, pages, graph, graphSummary }) {
  const warnings = [];
  const objectIdToNodeId = new Map();
  const objectKeyToNodeId = new Map();
  const nodes = [];
  const edges = [];
  const edgeKeys = new Set();
  const objects = Array.isArray(graph.objects) ? graph.objects : [];
  const relations = Array.isArray(graph.relations) ? graph.relations : [];
  const pageRows = Array.isArray(pages) ? pages : [];

  objects.forEach((object) => {
    const payload = object.payload_json || {};
    const nodeId = getWikiGraphObjectNodeId(object.object_type, object.object_key);
    const objectKey = `${object.object_type}:${object.object_key}`;
    objectIdToNodeId.set(Number(object.id), nodeId);
    objectKeyToNodeId.set(objectKey, nodeId);
    nodes.push({
      id: nodeId,
      type: normalizeText(object.object_type),
      label: normalizeText(object.title || object.object_key),
      title: normalizeText(object.title || object.object_key),
      status: object.status || 'ready',
      confidence: Number(object.confidence || 0),
      source_files: getWikiGraphArray(payload.source_files),
      source_apis: getWikiGraphArray(payload.source_apis),
      source_tables: getWikiGraphArray(payload.source_tables),
      page_slugs: [],
      evidence_count: Array.isArray(object.evidence) ? object.evidence.length : 0,
      payload,
    });
  });

  pageRows.forEach((page) => {
    const metadata = page.metadata_json || {};
    const nodeId = getWikiGraphPageNodeId(page);
    const nodeType = page.page_type === 'diagram' ? 'diagram' : 'page';
    nodes.push({
      id: nodeId,
      type: nodeType,
      label: page.title || page.page_slug,
      title: page.title || page.page_slug,
      status: page.ingest_status || 'pending',
      confidence: 1,
      source_files: getWikiGraphArray(metadata.source_files),
      source_apis: getWikiGraphArray(metadata.source_apis),
      source_tables: getWikiGraphArray(metadata.source_tables),
      page_slugs: [page.page_slug],
      evidence_count: Number(page.knowledge_asset_id ? 1 : 0),
      payload: {
        page_id: Number(page.id),
        page_slug: page.page_slug,
        page_type: page.page_type,
        source_uri: page.source_uri,
        knowledge_asset_id: page.knowledge_asset_id || null,
        metadata_json: metadata,
      },
    });
  });

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const addEdge = (edge) => {
    if (!edge.source || !edge.target || !nodeById.has(edge.source) || !nodeById.has(edge.target)) return;
    const key = `${edge.source}->${edge.type}->${edge.target}`;
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push({
      id: `edge-${edges.length + 1}`,
      source: edge.source,
      target: edge.target,
      type: edge.type,
      label: edge.label || edge.type,
      metadata: edge.metadata || {},
    });
  };

  relations.forEach((relation) => {
    addEdge({
      source: getWikiGraphObjectNodeId(relation.from_object_type, relation.from_object_key),
      target: getWikiGraphObjectNodeId(relation.to_object_type, relation.to_object_key),
      type: relation.relation_type,
      label: String(relation.relation_type || '').replaceAll('_', ' '),
      metadata: relation.meta_json || {},
    });
  });

  pageRows.forEach((page) => {
    const metadata = page.metadata_json || {};
    const source = getWikiGraphPageNodeId(page);
    const objectKeys = getWikiGraphArray(metadata.object_keys);
    const objectRefs = Array.isArray(metadata.object_refs) ? metadata.object_refs.map((item) => Number(item)).filter(Number.isFinite) : [];
    const targets = uniqueStrings([
      ...objectKeys.map((key) => objectKeyToNodeId.get(key)).filter(Boolean),
      ...objectRefs.map((id) => objectIdToNodeId.get(id)).filter(Boolean),
    ]);
    targets.slice(0, 24).forEach((target) => {
      addEdge({
        source,
        target,
        type: 'page_documents_object',
        label: 'documents',
        metadata: { source: objectKeys.length ? 'page_object_keys' : 'page_object_refs' },
      });
      const targetNode = nodeById.get(target);
      if (targetNode) {
        targetNode.page_slugs = uniqueStrings([...(targetNode.page_slugs || []), page.page_slug]);
      }
    });
  });

  if (!objects.length) warnings.push('该 run 尚未生成 gateway_wiki_objects，请重新生成或执行 graph backfill。');
  if (!relations.length) warnings.push('该 run 尚未生成 gateway_wiki_relations，图谱仅展示页面与对象引用。');
  if (!edges.length) warnings.push('当前 Wiki Graph 没有可展示关系边。');

  const mermaid = buildDeepWikiGraphMermaid(nodes, edges);
  return {
    run_id: Number(run?.id || 0),
    snapshot_id: run?.snapshot_id == null ? null : Number(run.snapshot_id),
    repo: {
      repo_source_id: run?.repo_source_id == null ? null : Number(run.repo_source_id),
      repo_slug: repoSource?.repo_slug || run?.repo_slug || null,
      repo_url: repoSource?.repo_url || run?.repo_url || null,
      branch: snapshot?.branch || run?.branch || null,
      commit_sha: snapshot?.commit_sha || run?.commit_sha || null,
    },
    summary: {
      node_count: nodes.length,
      edge_count: edges.length,
      object_counts: graphSummary?.object_counts || {},
      relation_counts: graphSummary?.relation_counts || {},
      evidence_coverage: graphSummary?.evidence_coverage || {},
    },
    nodes,
    edges,
    pages: pageRows,
    mermaid,
    warnings,
  };
}

async function getDeepWikiAlgorithmGraphPayload(snapshotId) {
  const projection = await getDeepWikiTemplateProjectionBySnapshotId(Number(snapshotId)).catch(() => null);
  const asset = Array.isArray(projection?.assets)
    ? projection.assets.find((item) => normalizeText(item.assetKey) === 'knowledge_graph_projection')
    : null;
  if (!asset?.payload || typeof asset.payload !== 'object') {
    return null;
  }
  return {
    ...asset.payload,
    snapshot_id: Number(snapshotId),
  };
}

async function getDeepWikiGraphByRunId(runId) {
  const run = await getDeepWikiRunRecord(runId);
  if (!run) return null;
  const [repoSource, snapshot, pages, graphSummary] = await Promise.all([
    getRepoSourceById(run.repo_source_id),
    run.snapshot_id ? getRepoSnapshotById(run.snapshot_id) : Promise.resolve(null),
    listDeepWikiPages(run.id),
    getDeepWikiKnowledgeGraphSummary(run.id),
  ]);
  let graph = { objects: [], relations: [], object_id_map: {} };
  try {
    graph = await loadDeepWikiKnowledgeGraphByRunId(run.id);
  } catch (error) {
    if (String(error.code || '') !== 'ER_NO_SUCH_TABLE') {
      throw error;
    }
  }
  return buildDeepWikiGraphPayloadFromRows({ run, repoSource, snapshot, pages, graph, graphSummary });
}

async function getDeepWikiGraphBySnapshotId(snapshotId) {
  const algorithmPayload = await getDeepWikiAlgorithmGraphPayload(snapshotId);
  if (algorithmPayload?.nodes?.length) {
    return algorithmPayload;
  }
  const wikiSnapshot = await getDeepWikiSnapshotRecord(snapshotId);
  if (!wikiSnapshot?.run_id) return null;
  const [run, repoSource, repoSnapshot, pages, graphSummary] = await Promise.all([
    getDeepWikiRunRecord(Number(wikiSnapshot.run_id)),
    getRepoSourceById(Number(wikiSnapshot.repo_source_id)),
    wikiSnapshot.repo_snapshot_id ? getRepoSnapshotById(Number(wikiSnapshot.repo_snapshot_id)) : Promise.resolve(null),
    listDeepWikiPagesBySnapshotId(Number(snapshotId)),
    getDeepWikiKnowledgeGraphSummaryBySnapshotId(Number(snapshotId)),
  ]);
  if (!run) return null;
  let graph = { objects: [], relations: [], object_id_map: {} };
  try {
    graph = await loadDeepWikiKnowledgeGraphBySnapshotId(Number(snapshotId));
  } catch (error) {
    if (String(error.code || '') !== 'ER_NO_SUCH_TABLE') {
      throw error;
    }
  }
  const payload = buildDeepWikiGraphPayloadFromRows({
    run: {
      ...run,
      snapshot_id: Number(snapshotId),
      branch: wikiSnapshot.branch,
      commit_sha: wikiSnapshot.commit_sha,
    },
    repoSource,
    snapshot: repoSnapshot || {
      branch: wikiSnapshot.branch,
      commit_sha: wikiSnapshot.commit_sha,
    },
    pages,
    graph,
    graphSummary,
  });
  return {
    ...payload,
    snapshot_id: Number(snapshotId),
  };
}

async function upsertDeepWikiGenerationJob(data = {}) {
  const [existing] = await query(
    `SELECT * FROM gateway_wiki_generation_jobs
     WHERE run_id = ? AND job_type = ?
     ORDER BY id DESC
     LIMIT 1`,
    [Number(data.run_id || 0), normalizeText(data.job_type) || 'deepwiki_generate']
  );
  if (existing) {
    await query(
      `UPDATE gateway_wiki_generation_jobs
       SET project_id = ?, snapshot_id = ?, status = ?, requested_by = ?, request_json = CAST(? AS JSON),
           result_json = CAST(? AS JSON), error_json = CAST(? AS JSON), started_at = ?, ended_at = ?, updated_at = NOW()
       WHERE id = ?`,
      [
        Number(data.project_id || existing.project_id),
        data.snapshot_id || existing.snapshot_id || null,
        normalizeText(data.status || existing.status) || 'queued',
        normalizeText(data.requested_by || existing.requested_by) || 'system',
        stringifyJson(data.request_json != null ? data.request_json : parseJson(existing.request_json, {})),
        stringifyJson(data.result_json != null ? data.result_json : parseJson(existing.result_json, {})),
        stringifyJson(data.error_json != null ? data.error_json : parseJson(existing.error_json, {})),
        data.started_at || existing.started_at || null,
        data.ended_at || existing.ended_at || null,
        existing.id,
      ]
    );
    const [row] = await query('SELECT * FROM gateway_wiki_generation_jobs WHERE id = ? LIMIT 1', [existing.id]);
    return mapWikiGenerationJobRow(row);
  }

  const result = await query(
    `INSERT INTO gateway_wiki_generation_jobs
     (project_id, snapshot_id, run_id, job_type, status, requested_by, request_json, result_json, error_json, started_at, ended_at)
     VALUES (?, ?, ?, ?, ?, ?, CAST(? AS JSON), CAST(? AS JSON), CAST(? AS JSON), ?, ?)`,
    [
      Number(data.project_id),
      data.snapshot_id || null,
      data.run_id || null,
      normalizeText(data.job_type) || 'deepwiki_generate',
      normalizeText(data.status) || 'queued',
      normalizeText(data.requested_by) || 'system',
      stringifyJson(data.request_json || {}),
      stringifyJson(data.result_json || {}),
      stringifyJson(data.error_json || {}),
      data.started_at || null,
      data.ended_at || null,
    ]
  );
  const [row] = await query('SELECT * FROM gateway_wiki_generation_jobs WHERE id = ? LIMIT 1', [result.insertId]);
  return mapWikiGenerationJobRow(row);
}

async function getDeepWikiGenerationJobById(jobId) {
  const [row] = await query('SELECT * FROM gateway_wiki_generation_jobs WHERE id = ? LIMIT 1', [Number(jobId)]);
  return mapWikiGenerationJobRow(row);
}

async function listDeepWikiGenerationJobs(filters = {}) {
  const conditions = [];
  const params = [];
  if (normalizeText(filters.job_type)) {
    conditions.push('job_type = ?');
    params.push(normalizeText(filters.job_type));
  }
  if (Number.isFinite(Number(filters.project_id)) && Number(filters.project_id) > 0) {
    conditions.push('project_id = ?');
    params.push(Number(filters.project_id));
  }
  if (Number.isFinite(Number(filters.snapshot_id)) && Number(filters.snapshot_id) > 0) {
    conditions.push('snapshot_id = ?');
    params.push(Number(filters.snapshot_id));
  }
  const statuses = uniqueStrings(filters.statuses || []);
  if (statuses.length) {
    conditions.push(`status IN (${statuses.map(() => '?').join(', ')})`);
    params.push(...statuses);
  }
  const limit = Math.max(1, Math.min(100, Number(filters.limit || 20)));
  const rows = await query(
    `SELECT *
     FROM gateway_wiki_generation_jobs
     ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
     ORDER BY updated_at DESC, id DESC
     LIMIT ${limit}`,
    params
  );
  return rows.map(mapWikiGenerationJobRow);
}

async function upsertDeepWikiQualityReport(data = {}) {
  const [existing] = await query(
    `SELECT * FROM gateway_wiki_quality_reports
     WHERE snapshot_id = ?
     LIMIT 1`,
    [Number(data.snapshot_id)]
  );
  const payload = {
    status: normalizeText(data.status) || 'draft',
    schema_pass_rate: Number(data.schema_pass_rate || 0),
    evidence_coverage_rate: Number(data.evidence_coverage_rate || 0),
    core_service_coverage_rate: Number(data.core_service_coverage_rate || 0),
    core_api_contract_rate: Number(data.core_api_contract_rate || 0),
    core_table_field_coverage_rate: Number(data.core_table_field_coverage_rate || 0),
    relation_connectivity_rate: Number(data.relation_connectivity_rate || 0),
    quality_json: data.quality_json || {},
  };
  if (existing) {
    await query(
      `UPDATE gateway_wiki_quality_reports
       SET project_id = ?, run_id = ?, status = ?, schema_pass_rate = ?, evidence_coverage_rate = ?,
           core_service_coverage_rate = ?, core_api_contract_rate = ?, core_table_field_coverage_rate = ?,
           relation_connectivity_rate = ?, quality_json = CAST(? AS JSON), updated_at = NOW()
       WHERE id = ?`,
      [
        Number(data.project_id || existing.project_id),
        data.run_id || existing.run_id || null,
        payload.status,
        payload.schema_pass_rate,
        payload.evidence_coverage_rate,
        payload.core_service_coverage_rate,
        payload.core_api_contract_rate,
        payload.core_table_field_coverage_rate,
        payload.relation_connectivity_rate,
        stringifyJson(payload.quality_json),
        existing.id,
      ]
    );
    const [row] = await query('SELECT * FROM gateway_wiki_quality_reports WHERE id = ? LIMIT 1', [existing.id]);
    return mapWikiQualityReportRow(row);
  }

  const result = await query(
    `INSERT INTO gateway_wiki_quality_reports
     (project_id, snapshot_id, run_id, status, schema_pass_rate, evidence_coverage_rate, core_service_coverage_rate,
      core_api_contract_rate, core_table_field_coverage_rate, relation_connectivity_rate, quality_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON))`,
    [
      Number(data.project_id),
      Number(data.snapshot_id),
      data.run_id || null,
      payload.status,
      payload.schema_pass_rate,
      payload.evidence_coverage_rate,
      payload.core_service_coverage_rate,
      payload.core_api_contract_rate,
      payload.core_table_field_coverage_rate,
      payload.relation_connectivity_rate,
      stringifyJson(payload.quality_json),
    ]
  );
  const [row] = await query('SELECT * FROM gateway_wiki_quality_reports WHERE id = ? LIMIT 1', [result.insertId]);
  return mapWikiQualityReportRow(row);
}

async function getDeepWikiQualityReportBySnapshotId(snapshotId) {
  const [row] = await query('SELECT * FROM gateway_wiki_quality_reports WHERE snapshot_id = ? LIMIT 1', [Number(snapshotId)]);
  return mapWikiQualityReportRow(row);
}

async function getDeepWikiRunRecord(id) {
  const [row] = await query('SELECT * FROM gateway_deepwiki_runs WHERE id = ? LIMIT 1', [Number(id)]);
  return mapDeepWikiRunRow(row);
}

async function patchDeepWikiRun(id, patch = {}) {
  const current = await getDeepWikiRunRecord(id);
  if (!current) return null;
  const sets = [];
  const params = [];

  if (patch.snapshot_id !== undefined) {
    sets.push('snapshot_id = ?');
    params.push(patch.snapshot_id || null);
  }
  if (patch.pipeline_run_id !== undefined) {
    sets.push('pipeline_run_id = ?');
    params.push(patch.pipeline_run_id || null);
  }
  if (patch.status !== undefined) {
    sets.push('status = ?');
    params.push(patch.status);
  }
  if (patch.current_stage !== undefined) {
    sets.push('current_stage = ?');
    params.push(patch.current_stage);
  }
  if (patch.output_root !== undefined) {
    sets.push('output_root = ?');
    params.push(patch.output_root || null);
  }
  if (patch.summary_json !== undefined) {
    const nextSummary = buildDeepWikiSummaryState(
      {
        ...deepWikiSummaryDefaults(current.summary_json || {}),
        ...patch.summary_json,
      },
      {
        status: patch.status || current.status,
        current_stage: patch.current_stage || current.current_stage,
      }
    );
    sets.push('summary_json = CAST(? AS JSON)');
    params.push(stringifyJson(nextSummary));
  }

  if (!sets.length) return current;
  sets.push('updated_at = NOW()');
  await query(
    `UPDATE gateway_deepwiki_runs
     SET ${sets.join(', ')}
     WHERE id = ?`,
    [...params, Number(id)]
  );
  return getDeepWikiRunRecord(id);
}

async function appendDeepWikiRunLog(runId, message, stage, level = 'info') {
  const current = await getDeepWikiRunRecord(runId);
  if (!current) return null;
  const summary = deepWikiSummaryDefaults(current.summary_json || {});
  const heartbeatAt = new Date().toISOString();
  const nextLogs = [...summary.logs, {
    timestamp: heartbeatAt,
    level,
    stage: stage || current.current_stage || null,
    message,
  }].slice(-60);
  return patchDeepWikiRun(runId, {
    summary_json: {
      ...summary,
      logs: nextLogs,
      heartbeat_at: heartbeatAt,
      elapsed_seconds: computeDeepWikiElapsedSeconds(summary),
    },
  });
}

function buildDeepWikiStageProgress(summary = {}, stage, patch = {}) {
  const current = buildDefaultDeepWikiStageProgress(summary);
  current[stage] = {
    ...(current[stage] || {
      status: 'pending',
      processed: 0,
      total: 0,
      started_at: null,
      completed_at: null,
      duration_ms: null,
      last_message: '',
    }),
    ...patch,
  };
  return current;
}

async function upsertKnowledgeAsset(data = {}) {
  const [existing] = await query('SELECT id FROM gateway_knowledge_assets WHERE asset_key = ? LIMIT 1', [
    data.asset_key,
  ]);
  const mergedMeta = stringifyJson(data.metadata_json || {});
  const safeName = truncateText(data.name || data.asset_key || 'knowledge-asset', 120) || 'knowledge-asset';

  if (existing) {
    try {
      await query(
        `UPDATE gateway_knowledge_assets
         SET name = ?, asset_type = ?, asset_category = ?, domain = ?, module = ?, version = ?, owner = ?, status = ?, source_uri = ?, metadata_json = CAST(? AS JSON), updated_at = NOW()
         WHERE id = ?`,
        [
          safeName,
          data.asset_type,
          data.asset_category || null,
          data.domain || null,
          data.module || null,
          data.version || '1.0',
          data.owner || null,
          data.status || 'active',
          data.source_uri || null,
          mergedMeta,
          existing.id,
        ]
      );
    } catch (error) {
      if (String(error?.code || '') !== 'ER_BAD_FIELD_ERROR') {
        throw error;
      }
      await query(
        `UPDATE gateway_knowledge_assets
         SET name = ?, asset_type = ?, source_uri = ?, metadata_json = CAST(? AS JSON), updated_at = NOW()
         WHERE id = ?`,
        [
          safeName,
          data.asset_type,
          data.source_uri || null,
          mergedMeta,
          existing.id,
        ]
      );
    }
    return getKnowledgeAssetById(existing.id);
  }

  let result;
  try {
    result = await query(
      `INSERT INTO gateway_knowledge_assets
       (asset_key, name, asset_type, asset_category, domain, module, version, owner, status, source_uri, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON))`,
      [
        data.asset_key,
        safeName,
        data.asset_type,
        data.asset_category || null,
        data.domain || null,
        data.module || null,
        data.version || '1.0',
        data.owner || null,
        data.status || 'active',
        data.source_uri || null,
        mergedMeta,
      ]
    );
  } catch (error) {
    if (String(error?.code || '') !== 'ER_BAD_FIELD_ERROR') {
      throw error;
    }
    result = await query(
      `INSERT INTO gateway_knowledge_assets
       (asset_key, name, asset_type, source_uri, metadata_json)
       VALUES (?, ?, ?, ?, CAST(? AS JSON))`,
      [
        data.asset_key,
        safeName,
        data.asset_type,
        data.source_uri || null,
        mergedMeta,
      ]
    );
  }
  return getKnowledgeAssetById(result.insertId);
}

async function listDeepWikiPages(runId) {
  const rows = await query(
    'SELECT * FROM gateway_deepwiki_pages WHERE run_id = ? ORDER BY page_slug ASC, id ASC',
    [Number(runId)]
  );
  return rows.map(mapDeepWikiPageRow);
}

async function clearDeepWikiKnowledgeGraph(runId) {
  try {
    await query('DELETE FROM gateway_wiki_relations WHERE run_id = ?', [Number(runId)]);
    await query('DELETE FROM gateway_wiki_evidence WHERE run_id = ?', [Number(runId)]);
    await query('DELETE FROM gateway_wiki_objects WHERE run_id = ?', [Number(runId)]);
  } catch (error) {
    if (String(error.code || '') === 'ER_NO_SUCH_TABLE') {
      return;
    }
    throw error;
  }
}

async function persistDeepWikiKnowledgeGraph(run, graph = {}, pageMetadataBySlug = {}) {
  if (!run?.id) {
    return {
      object_counts: {},
      relation_counts: {},
      evidence_coverage: { object_count: 0, covered_object_count: 0, percent: 0 },
      object_id_map: {},
    };
  }

  try {
    await clearDeepWikiKnowledgeGraph(run.id);
  } catch (error) {
    if (String(error.code || '') === 'ER_NO_SUCH_TABLE') {
      return {
        object_counts: {},
        relation_counts: {},
        evidence_coverage: { object_count: 0, covered_object_count: 0, percent: 0 },
        object_id_map: {},
      };
    }
    throw error;
  }
  try {
    const objectIdMap = new Map();
    const objectCounts = {};
    const relationCounts = {};
    let coveredObjectCount = 0;
    const objects = Array.isArray(graph.objects) ? graph.objects : [];
    const relations = Array.isArray(graph.relations) ? graph.relations : [];

    for (const item of objects) {
      let result;
      try {
        result = await query(
          `INSERT INTO gateway_wiki_objects
           (run_id, repo_source_id, snapshot_id, object_type, object_key, title, payload_json, confidence, status)
           VALUES (?, ?, ?, ?, ?, ?, CAST(? AS JSON), ?, ?)`,
          [
            Number(run.id),
            Number(run.repo_source_id),
            run.snapshot_id ? Number(run.snapshot_id) : null,
            item.object_type,
            item.object_key,
            item.title,
            stringifyJson(item.payload_json || {}),
            Number(item.confidence || 0),
            item.status || 'ready',
          ]
        );
      } catch (error) {
        if (!isUnknownColumnError(error, 'status')) {
          throw error;
        }
        result = await query(
          `INSERT INTO gateway_wiki_objects
           (run_id, repo_source_id, snapshot_id, object_type, object_key, title, payload_json, confidence)
           VALUES (?, ?, ?, ?, ?, ?, CAST(? AS JSON), ?)`,
          [
            Number(run.id),
            Number(run.repo_source_id),
            run.snapshot_id ? Number(run.snapshot_id) : null,
            item.object_type,
            item.object_key,
            item.title,
            stringifyJson(item.payload_json || {}),
            Number(item.confidence || 0),
          ]
        );
      }
      const objectId = Number(result.insertId);
      objectIdMap.set(`${item.object_type}:${item.object_key}`, objectId);
      objectCounts[item.object_type] = Number(objectCounts[item.object_type] || 0) + 1;
      const evidenceItems = Array.isArray(item.evidence) ? item.evidence : [];
      if (evidenceItems.length) {
        coveredObjectCount += 1;
      }
      for (const evidence of evidenceItems) {
        await query(
          `INSERT INTO gateway_wiki_evidence
           (run_id, object_id, evidence_type, source_uri, source_ref, source_commit_sha, quote_text, meta_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON))`,
          [
            Number(run.id),
            objectId,
            evidence.evidence_type || 'code',
            evidence.source_uri || null,
            evidence.source_ref || null,
            evidence.source_commit_sha || null,
            evidence.quote_text || null,
            stringifyJson(evidence.meta_json || {}),
          ]
        );
      }
    }

    for (const relation of relations) {
      const fromObjectId = objectIdMap.get(`${relation.from_object_type}:${relation.from_object_key}`);
      const toObjectId = objectIdMap.get(`${relation.to_object_type}:${relation.to_object_key}`);
      if (!fromObjectId || !toObjectId) continue;
      await query(
        `INSERT INTO gateway_wiki_relations
         (run_id, from_object_id, relation_type, to_object_id, meta_json)
         VALUES (?, ?, ?, ?, CAST(? AS JSON))`,
        [
          Number(run.id),
          fromObjectId,
          relation.relation_type,
          toObjectId,
          stringifyJson(relation.meta_json || {}),
        ]
      );
      relationCounts[relation.relation_type] = Number(relationCounts[relation.relation_type] || 0) + 1;
    }

    const pageObjectKeys = graph.page_object_keys && typeof graph.page_object_keys === 'object'
      ? graph.page_object_keys
      : {};
    const objectIdPayload = Object.fromEntries(objectIdMap.entries());
    Object.keys(pageMetadataBySlug).forEach((pageSlug) => {
      const objectKeys = Array.isArray(pageObjectKeys[pageSlug]) ? pageObjectKeys[pageSlug] : [];
      pageMetadataBySlug[pageSlug] = {
        ...pageMetadataBySlug[pageSlug],
        object_keys: objectKeys,
        object_refs: objectKeys.map((item) => objectIdMap.get(item)).filter(Boolean),
      };
    });

    return {
      object_counts: objectCounts,
      relation_counts: relationCounts,
      evidence_coverage: {
        object_count: objects.length,
        covered_object_count: coveredObjectCount,
        percent: objects.length ? Number(((coveredObjectCount / objects.length) * 100).toFixed(2)) : 0,
      },
      object_id_map: objectIdPayload,
    };
  } catch (error) {
    if (String(error.code || '') === 'ER_NO_SUCH_TABLE') {
      return {
        object_counts: {},
        relation_counts: {},
        evidence_coverage: { object_count: 0, covered_object_count: 0, percent: 0 },
        object_id_map: {},
      };
    }
    throw error;
  }
}

async function getDeepWikiKnowledgeGraphSummary(runId) {
  let objectRows;
  let relationRows;
  let coverageRow;
  try {
    objectRows = await query(
      `SELECT object_type, COUNT(*) AS total
       FROM gateway_wiki_objects
       WHERE run_id = ?
       GROUP BY object_type`,
      [Number(runId)]
    );
    relationRows = await query(
      `SELECT relation_type, COUNT(*) AS total
       FROM gateway_wiki_relations
       WHERE run_id = ?
       GROUP BY relation_type`,
      [Number(runId)]
    );
    [coverageRow] = await query(
      `SELECT COUNT(*) AS object_count,
              COUNT(DISTINCT CASE WHEN e.id IS NOT NULL THEN o.id END) AS covered_object_count
       FROM gateway_wiki_objects o
       LEFT JOIN gateway_wiki_evidence e ON e.object_id = o.id
       WHERE o.run_id = ?`,
      [Number(runId)]
    );
  } catch (error) {
    if (String(error.code || '') === 'ER_NO_SUCH_TABLE') {
      return {
        object_counts: {},
        relation_counts: {},
        evidence_coverage: { object_count: 0, covered_object_count: 0, percent: 0 },
      };
    }
    throw error;
  }
  const objectCounts = {};
  objectRows.forEach((row) => {
    objectCounts[row.object_type] = Number(row.total || 0);
  });
  const relationCounts = {};
  relationRows.forEach((row) => {
    relationCounts[row.relation_type] = Number(row.total || 0);
  });
  const objectCount = Number(coverageRow?.object_count || 0);
  const coveredObjectCount = Number(coverageRow?.covered_object_count || 0);
  return {
    object_counts: objectCounts,
    relation_counts: relationCounts,
    evidence_coverage: {
      object_count: objectCount,
      covered_object_count: coveredObjectCount,
      percent: objectCount ? Number(((coveredObjectCount / objectCount) * 100).toFixed(2)) : 0,
    },
  };
}

function validateDeepWikiObjectSchema(object = {}) {
  const payload = parseJson(object.payload_json, {});
  const detail = getRecordLike(payload.detail, payload);
  const evidence = Array.isArray(object.evidence) ? object.evidence : [];
  const requiredByType = {
    project: ['project_code'],
    domain: ['domain_name'],
    feature: ['feature_name'],
    service: ['service_name'],
    api: ['method', 'path'],
    table: ['table_name'],
    state_machine: ['entity_name'],
    test_asset: ['asset_name'],
    runbook: ['title'],
    decision: ['title'],
  };
  const requiredKeys = requiredByType[object.object_type] || [];
  const detailValid = requiredKeys.every((key) => {
    const value = detail[key];
    if (value == null) return false;
    if (Array.isArray(value)) return value.length > 0;
    return String(value).trim().length > 0;
  });
  return detailValid && evidence.length > 0;
}

function getRecordLike(value, fallback = {}) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : fallback;
}

function buildDeepWikiPageObjectKeyIndex(pageRows = []) {
  const pageMap = new Map();
  (pageRows || []).forEach((page) => {
    const keys = Array.isArray(page?.object_keys)
      ? page.object_keys
      : Array.isArray(page?.metadata_json?.object_keys)
        ? page.metadata_json.object_keys
        : [];
    keys.forEach((key) => {
      const bucket = pageMap.get(String(key)) || [];
      bucket.push(String(page.page_slug || ''));
      pageMap.set(String(key), uniqueStrings(bucket));
    });
  });
  return pageMap;
}

function runSingleLayerLouvainLikeCommunityDetection(objects = [], relations = []) {
  const objectKeys = (objects || []).map((item) => `${item.object_type}:${item.object_key}`);
  const adjacency = new Map();
  objectKeys.forEach((key) => adjacency.set(key, new Map()));
  (relations || []).forEach((relation) => {
    const fromKey = `${relation.from_object_type}:${relation.from_object_key}`;
    const toKey = `${relation.to_object_type}:${relation.to_object_key}`;
    if (!adjacency.has(fromKey)) adjacency.set(fromKey, new Map());
    if (!adjacency.has(toKey)) adjacency.set(toKey, new Map());
    adjacency.get(fromKey).set(toKey, Number(adjacency.get(fromKey).get(toKey) || 0) + 1);
    adjacency.get(toKey).set(fromKey, Number(adjacency.get(toKey).get(fromKey) || 0) + 1);
  });

  const labels = new Map(objectKeys.map((key) => [key, key]));
  for (let iteration = 0; iteration < 8; iteration += 1) {
    let changed = false;
    for (const key of objectKeys) {
      const neighbors = adjacency.get(key) || new Map();
      if (!neighbors.size) continue;
      const scores = new Map();
      neighbors.forEach((weight, neighborKey) => {
        const label = labels.get(neighborKey) || neighborKey;
        scores.set(label, Number(scores.get(label) || 0) + Number(weight || 1));
      });
      const best = [...scores.entries()].sort((left, right) => {
        if (right[1] !== left[1]) return right[1] - left[1];
        return String(left[0]).localeCompare(String(right[0]));
      })[0];
      if (best && labels.get(key) !== best[0]) {
        labels.set(key, best[0]);
        changed = true;
      }
    }
    if (!changed) break;
  }

  const grouped = new Map();
  objectKeys.forEach((key) => {
    const label = labels.get(key) || key;
    const bucket = grouped.get(label) || [];
    bucket.push(key);
    grouped.set(label, bucket);
  });
  return [...grouped.values()]
    .sort((left, right) => right.length - left.length)
    .map((objectKeyList, index) => ({
      community_key: `community-${index + 1}`,
      object_keys: objectKeyList,
    }));
}

function buildDeepWikiCommunityReportsFromGraph(snapshotId, graph = {}, pageRows = []) {
  const objects = Array.isArray(graph.objects) ? graph.objects : [];
  const relations = Array.isArray(graph.relations) ? graph.relations : [];
  const objectByKey = new Map(objects.map((item) => [`${item.object_type}:${item.object_key}`, item]));
  const pageIndex = buildDeepWikiPageObjectKeyIndex(pageRows);
  const adjacencyCount = new Map();
  relations.forEach((relation) => {
    const fromKey = `${relation.from_object_type}:${relation.from_object_key}`;
    adjacencyCount.set(fromKey, Number(adjacencyCount.get(fromKey) || 0) + 1);
    const toKey = `${relation.to_object_type}:${relation.to_object_key}`;
    adjacencyCount.set(toKey, Number(adjacencyCount.get(toKey) || 0) + 1);
  });

  return runSingleLayerLouvainLikeCommunityDetection(objects, relations).map((community) => {
    const communityObjects = community.object_keys
      .map((key) => objectByKey.get(key))
      .filter(Boolean);
    const typeCounts = {};
    const pageSlugs = [];
    communityObjects.forEach((item) => {
      typeCounts[item.object_type] = Number(typeCounts[item.object_type] || 0) + 1;
      pageSlugs.push(...(pageIndex.get(`${item.object_type}:${item.object_key}`) || []));
    });
    const topObjects = [...communityObjects].sort((left, right) => {
      const leftDegree = Number(adjacencyCount.get(`${left.object_type}:${left.object_key}`) || 0);
      const rightDegree = Number(adjacencyCount.get(`${right.object_type}:${right.object_key}`) || 0);
      if (rightDegree !== leftDegree) return rightDegree - leftDegree;
      return String(left.title || left.object_key).localeCompare(String(right.title || right.object_key));
    });
    const topType = Object.entries(typeCounts).sort((left, right) => right[1] - left[1])[0]?.[0] || 'object';
    const edgeCount = relations.filter((relation) => {
      const fromKey = `${relation.from_object_type}:${relation.from_object_key}`;
      const toKey = `${relation.to_object_type}:${relation.to_object_key}`;
      return community.object_keys.includes(fromKey) && community.object_keys.includes(toKey);
    }).length;
    return {
      snapshot_id: Number(snapshotId),
      community_key: community.community_key,
      title: `${topObjects[0]?.title || topType} 社区`,
      summary_markdown: [
        `# ${topObjects[0]?.title || topType} 社区`,
        '',
        `- 对象数量：${communityObjects.length}`,
        `- 关系数量：${edgeCount}`,
        `- 主要对象类型：${Object.entries(typeCounts).map(([type, total]) => `${type}(${total})`).join('、') || '无'}`,
        `- 代表对象：${topObjects.slice(0, 5).map((item) => item.title || item.object_key).join('、') || '无'}`,
        `- 关联页面：${uniqueStrings(pageSlugs).slice(0, 6).join('、') || '无'}`,
      ].join('\n'),
      object_ids_json: communityObjects.map((item) => Number(item.id)).filter(Number.isFinite),
      page_slugs_json: uniqueStrings(pageSlugs),
      community_score: Number((communityObjects.length * 1.5 + edgeCount).toFixed(4)),
      metadata_json: {
        object_keys: community.community_key ? community.object_keys : [],
        object_type_counts: typeCounts,
        top_object_titles: topObjects.slice(0, 8).map((item) => item.title || item.object_key),
        edge_count: edgeCount,
      },
    };
  });
}

function normalizeDeepWikiThreadKey(value, fallback = 'thread') {
  const normalized = normalizeProjectCode(String(value || '').replace(/\//g, '-'), fallback).replace(/[/.]+/g, '-');
  if (!normalized) return fallback;
  if (normalized.length <= 96) return normalized;
  const digest = hashText(normalized).slice(0, 8);
  return `${normalized.slice(0, 87)}-${digest}`;
}

function getDeepWikiObjectPayload(object = {}) {
  return getRecordLike(parseJson(object.payload_json, object.payload_json || {}), {});
}

function getDeepWikiObjectSourceFiles(object = {}) {
  const payload = getDeepWikiObjectPayload(object);
  return uniqueStrings([
    ...toArray(payload.source_files),
    ...toArray(payload.detail?.source_files),
  ]);
}

function getDeepWikiObjectSourceApis(object = {}) {
  const payload = getDeepWikiObjectPayload(object);
  return uniqueStrings([
    ...toArray(payload.source_apis),
    ...toArray(payload.detail?.source_apis),
    payload.endpoint,
    payload.detail?.endpoint,
  ]);
}

function getDeepWikiObjectSourceTables(object = {}) {
  const payload = getDeepWikiObjectPayload(object);
  return uniqueStrings([
    ...toArray(payload.source_tables),
    ...toArray(payload.detail?.source_tables),
    payload.table_name,
    payload.detail?.table_name,
  ]);
}

function toArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function buildModuleSearchTokens(moduleName = '') {
  return uniqueStrings(
    String(moduleName || '')
      .toLowerCase()
      .split(/[^a-z0-9\u4e00-\u9fff]+/)
      .filter((token) => token && token.length >= 3 && !['lime', 'service', 'module', 'basic', 'core', 'job', 'server', 'backend'].includes(token))
  );
}

function buildDeepWikiRelationIndexes(relations = []) {
  const outgoing = new Map();
  const incoming = new Map();
  relations.forEach((relation) => {
    const fromKey = `${relation.from_object_type}:${relation.from_object_key}`;
    const toKey = `${relation.to_object_type}:${relation.to_object_key}`;
    if (!outgoing.has(fromKey)) outgoing.set(fromKey, []);
    if (!incoming.has(toKey)) incoming.set(toKey, []);
    outgoing.get(fromKey).push(relation);
    incoming.get(toKey).push(relation);
  });
  return { outgoing, incoming };
}

function selectModuleObjects(moduleInfo = {}, objects = []) {
  const moduleFiles = uniqueStrings(toArray(moduleInfo.source_files));
  const moduleTokens = buildModuleSearchTokens(moduleInfo.name);
  const scoreObject = (object) => {
    const sourceFiles = getDeepWikiObjectSourceFiles(object);
    const sourceText = [object.title, object.object_key, ...sourceFiles].join(' ').toLowerCase();
    let score = 0;
    if (moduleFiles.length && sourceFiles.some((file) => moduleFiles.some((moduleFile) => file.startsWith(moduleFile) || moduleFile.startsWith(file)))) {
      score += 3;
    }
    if (moduleTokens.length && moduleTokens.some((token) => sourceText.includes(token))) {
      score += 1;
    }
    return score;
  };
  return (objects || [])
    .map((object) => ({ object, score: scoreObject(object) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return String(left.object.title || left.object.object_key).localeCompare(String(right.object.title || right.object.object_key));
    })
    .map((item) => item.object);
}

function uniqueDeepWikiObjects(objects = []) {
  const seen = new Set();
  return (objects || []).filter((item) => {
    if (!item?.object_type || !item?.object_key) return false;
    const compositeKey = `${item.object_type}:${item.object_key}`;
    if (seen.has(compositeKey)) return false;
    seen.add(compositeKey);
    return true;
  });
}

function buildDeepWikiThreadMatchTokens(values = []) {
  const rawValues = values.flatMap((value) => (Array.isArray(value) ? value : [value]));
  return uniqueStrings(
    rawValues.flatMap((value) =>
      String(value || '')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .toLowerCase()
        .split(/[^a-z0-9\u4e00-\u9fff]+/)
        .filter((token) => token && token.length >= 2 && !['api', 'erp', 'bill', 'list', 'post', 'get'].includes(token))
    )
  );
}

function getDeepWikiSourceFileBasenames(sourceFiles = []) {
  return uniqueStrings(
    (sourceFiles || [])
      .map((item) => path.basename(String(item || '')).replace(/\.[^.]+$/, '').toLowerCase())
      .filter(Boolean)
  );
}

function scoreDeepWikiThreadCandidate(candidate, context = {}) {
  if (!candidate) return 0;
  const candidateFiles = getDeepWikiObjectSourceFiles(candidate);
  const candidateFileSet = new Set(candidateFiles);
  const candidateBasenames = getDeepWikiSourceFileBasenames(candidateFiles);
  const candidateTokens = buildDeepWikiThreadMatchTokens([
    candidate.object_key,
    candidate.title,
    ...candidateFiles,
    ...getDeepWikiObjectSourceApis(candidate),
    ...getDeepWikiObjectSourceTables(candidate),
  ]);
  const contextFiles = uniqueStrings(toArray(context.source_files));
  const contextFileSet = new Set(contextFiles);
  const contextBasenames = new Set(getDeepWikiSourceFileBasenames(contextFiles));
  const contextTokens = new Set(buildDeepWikiThreadMatchTokens(context.tokens || []));
  const sharedFiles = candidateFiles.filter((item) => contextFileSet.has(item)).length;
  const sharedBasenames = candidateBasenames.filter((item) => contextBasenames.has(item)).length;
  const sharedTokens = candidateTokens.filter((item) => contextTokens.has(item)).length;
  return (sharedFiles * 20) + (sharedBasenames * 8) + (sharedTokens * 3);
}

function selectDeepWikiThreadCandidates(candidates = [], context = {}, limit = 1) {
  return uniqueDeepWikiObjects(candidates)
    .map((candidate) => ({
      candidate,
      score: scoreDeepWikiThreadCandidate(candidate, context),
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return String(left.candidate.title || left.candidate.object_key).localeCompare(String(right.candidate.title || right.candidate.object_key), 'zh-CN');
    })
    .slice(0, limit)
    .map((item) => item.candidate);
}

function buildThreadSteps(seedObject, related = {}) {
  const steps = [];
  const pushStep = (stepType, item, extra = {}) => {
    if (!item) return;
    steps.push({
      step_order: steps.length + 1,
      step_type: stepType,
      title: item.title || item.object_key,
      object_key: `${item.object_type}:${item.object_key}`,
      source_files: getDeepWikiObjectSourceFiles(item).slice(0, 6),
      ...extra,
    });
  };
  if (seedObject.object_type === 'api') {
    pushStep('entry_api', seedObject, { entry_points: getDeepWikiObjectSourceApis(seedObject).slice(0, 4) });
  } else if (related.api) {
    pushStep('entry_api', related.api, { entry_points: [related.api.title, ...getDeepWikiObjectSourceApis(related.api)].filter(Boolean).slice(0, 4) });
  }
  if (seedObject.object_type === 'domain_behavior') {
    pushStep('behavior', seedObject);
  }
  pushStep(seedObject.object_type === 'service' ? 'service_entry' : 'service', related.service || (seedObject.object_type === 'service' ? seedObject : null));
  pushStep('aggregate', related.aggregate);
  pushStep('api', seedObject.object_type === 'api' ? seedObject : related.api);
  pushStep('table', related.table);
  pushStep('test', related.test);
  return steps;
}

function buildThreadBranchPoints(seedObject, related = {}) {
  const points = [];
  const extras = [
    ...(related.extraApis || []),
    ...(related.extraTables || []),
    ...(related.extraServices || []),
    ...(related.extraAggregates || []),
  ];
  extras.slice(0, 6).forEach((item) => {
    points.push({
      branch_type: item.object_type === 'table'
        ? 'data_branch'
        : item.object_type === 'api'
          ? 'api_branch'
          : item.object_type === 'aggregate'
            ? 'entity_branch'
            : 'service_branch',
      title: item.title || item.object_key,
      object_key: `${item.object_type}:${item.object_key}`,
    });
  });
  if (!points.length && ['api', 'domain_behavior'].includes(seedObject.object_type)) {
    points.push({
      branch_type: 'exception_branch',
      title: `${seedObject.title || seedObject.object_key} 异常与补偿路径待确认`,
      object_key: `${seedObject.object_type}:${seedObject.object_key}`,
    });
  }
  return points;
}

function summarizeThread(thread) {
  return [
    `# ${thread.title}`,
    '',
    `- 线程级别：${thread.thread_level}`,
    `- 归属域：${thread.domain_key || 'project'}`,
    `- 仓库角色：${(thread.repo_roles_json || []).join('、') || '待确认'}`,
    `- 入口：${(thread.entry_points_json || []).map((item) => item.label || item.path || item.endpoint || item.title).filter(Boolean).join('、') || '待确认'}`,
    `- 关键对象：${(thread.object_keys_json || []).join('、') || '待确认'}`,
    '',
    thread.summary_markdown || '证据不足，需要结合源码进一步确认。',
  ].join('\n');
}

function buildThreadFlowMermaid(thread, title = '主链路') {
  const nodes = toArray(thread.steps_json);
  const statements = ['flowchart LR'];
  if (!nodes.length) {
    statements.push(`A["${thread.title}"] --> B["证据不足"]`);
    return statements.join('\n');
  }
  nodes.forEach((step, index) => {
    statements.push(`N${index}["${String(step.title || step.object_key || `步骤${index + 1}`).replace(/"/g, "'")}"]`);
    if (index > 0) {
      statements.push(`N${index - 1} -->|"${title}"| N${index}`);
    }
  });
  return statements.join('\n');
}

function buildThreadSequenceMermaid(thread) {
  const nodes = toArray(thread.steps_json);
  const participants = nodes.map((step, index) => ({
    id: `P${index}`,
    label: String(step.title || step.object_key || `Step ${index + 1}`).replace(/"/g, "'"),
  }));
  const lines = ['sequenceDiagram'];
  if (!participants.length) {
    lines.push(`participant P0 as "${thread.title}"`);
    return lines.join('\n');
  }
  participants.forEach((item) => {
    lines.push(`participant ${item.id} as "${item.label}"`);
  });
  for (let index = 1; index < participants.length; index += 1) {
    lines.push(`${participants[index - 1].id}->>${participants[index].id}: ${String(nodes[index].step_type || 'next').replace(/"/g, "'")}`);
  }
  return lines.join('\n');
}

function buildThreadBindingMermaid(thread, frontendBound) {
  const lines = ['flowchart LR'];
  if (!frontendBound) {
    lines.push(`A["前端仓缺失"] --> B["BFF / 前端入口待补充"] --> C["${String(thread.title || '线程').replace(/"/g, "'")}"]`);
    return lines.join('\n');
  }
  const entry = toArray(thread.entry_points_json)[0];
  const steps = toArray(thread.steps_json);
  lines.push(`A["${String(entry?.label || '前端入口').replace(/"/g, "'")}"]`);
  steps.forEach((step, index) => {
    lines.push(`N${index}["${String(step.title || step.object_key || `节点${index + 1}`).replace(/"/g, "'")}"]`);
    lines.push(index === 0 ? `A --> N${index}` : `N${index - 1} --> N${index}`);
  });
  return lines.join('\n');
}

function buildDomainContextMermaid(domain = {}) {
  const lines = ['flowchart LR'];
  lines.push(`Domain["${String(domain.title || domain.domain_key || '业务域').replace(/"/g, "'")}"]`);
  lines.push(`Domain --> Context["${String(domain.bounded_context_name || domain.title || '上下文').replace(/"/g, "'")}"]`);
  (domain.upstream_contexts || []).slice(0, 3).forEach((item, index) => {
    lines.push(`Up${index}["${String(item.domain_label || item.domain_key || '上游上下文').replace(/"/g, "'")}"] --> Context`);
  });
  (domain.downstream_contexts || []).slice(0, 3).forEach((item, index) => {
    lines.push(`Context --> Down${index}["${String(item.domain_label || item.domain_key || '下游上下文').replace(/"/g, "'")}"]`);
  });
  if (Array.isArray(domain.behaviors) && domain.behaviors.length) {
    lines.push(`Context --> Behavior["核心行为<br/>${domain.behaviors.slice(0, 3).map((item) => String(item.title || '').replace(/"/g, "'")).join('<br/>')}"]`);
  }
  return lines.join('\n');
}

function buildDomainBehaviorMermaid(domain = {}) {
  const lines = ['flowchart TD'];
  const behaviors = Array.isArray(domain.behaviors) ? domain.behaviors : [];
  if (!behaviors.length) {
    lines.push(`A["${String(domain.title || '业务域').replace(/"/g, "'")}"] --> B["待补齐核心行为"]`);
    return lines.join('\n');
  }
  lines.push(`D["${String(domain.title || '业务域').replace(/"/g, "'")}"]`);
  behaviors.slice(0, 4).forEach((behavior, index) => {
    lines.push(`B${index}["${String(behavior.title || behavior.object_key || `行为${index + 1}`).replace(/"/g, "'")}"]`);
    lines.push(`D --> B${index}`);
    if (behavior.command_name) {
      lines.push(`C${index}["命令<br/>${String(behavior.command_name).replace(/"/g, "'")}"] --> B${index}`);
    }
    if (behavior.event_name) {
      lines.push(`B${index} --> E${index}["事件<br/>${String(behavior.event_name).replace(/"/g, "'")}"]`);
    }
  });
  return lines.join('\n');
}

function buildDomainAggregateMermaid(domain = {}) {
  const lines = ['flowchart LR'];
  const aggregates = Array.isArray(domain.aggregates) ? domain.aggregates : [];
  if (!aggregates.length) {
    lines.push(`A["${String(domain.title || '业务域').replace(/"/g, "'")}"] --> B["待补齐聚合 / 实体关系"]`);
    return lines.join('\n');
  }
  lines.push(`D["${String(domain.title || '业务域').replace(/"/g, "'")}"]`);
  aggregates.slice(0, 4).forEach((aggregate, index) => {
    lines.push(`A${index}["${String(aggregate.title || aggregate.object_key || `聚合${index + 1}`).replace(/"/g, "'")}"]`);
    lines.push(`D --> A${index}`);
  });
  return lines.join('\n');
}

function buildDeepWikiThreadsFromGraph({ inventory = {}, graph = {} } = {}) {
  const objects = Array.isArray(graph.objects) ? graph.objects : [];
  const relations = Array.isArray(graph.relations) ? graph.relations : [];
  const businessModules = Array.isArray(inventory.business_modules) && inventory.business_modules.length
    ? inventory.business_modules
    : Array.isArray(inventory.modules) ? inventory.modules : [];
  const repoRoles = uniqueStrings([...(inventory.repo_roles || []), ...(inventory.repo_units || []).map((item) => item.repo_role).filter(Boolean)]);
  const frontendBound = repoRoles.some((role) => ['frontend', 'bff'].includes(String(role || '').toLowerCase()));
  const apiObjects = objects.filter((item) => item.object_type === 'api');
  const serviceObjects = objects.filter((item) => item.object_type === 'service');
  const tableObjects = objects.filter((item) => item.object_type === 'table');
  const testObjects = objects.filter((item) => item.object_type === 'test_asset');
  const relationIndex = buildDeepWikiRelationIndexes(relations);
  const objectByCompositeKey = new Map(objects.map((item) => [`${item.object_type}:${item.object_key}`, item]));
  const domainModels = buildDeepWikiDomainModel(0, graph, [], [], []);
  const threads = [];
  const pushThread = (thread) => {
    if (!thread || !normalizeText(thread.thread_key) || !DEEPWIKI_THREAD_LEVELS.has(thread.thread_level)) return;
    if (threads.some((item) => item.thread_key === thread.thread_key)) return;
    threads.push(thread);
  };

  pushThread({
    thread_key: 'project-trunk',
    parent_thread_key: null,
    thread_level: 'project_trunk',
    domain_key: 'project',
    title: '项目主干与关键链路',
    summary_markdown: [
      `项目共识别 ${businessModules.length || 0} 个业务模块，${objects.length || 0} 个结构化对象，${relations.length || 0} 条关系。`,
      frontendBound ? '已绑定前端/BFF 视角，可生成前后端联动线程。' : '当前仅绑定后端仓，前端旅程会显式标记缺口。',
      (inventory.noise_modules || []).length ? `已从主业务域中排除噪声目录：${(inventory.noise_modules || []).join('、')}` : '',
    ].filter(Boolean).join('\n'),
    entry_points_json: toArray(inventory.entry_candidates).slice(0, 8).map((item) => ({ type: 'entry', path: item, label: path.basename(item) })),
    steps_json: [],
    branch_points_json: frontendBound ? [] : [{ branch_type: 'frontend_gap', title: '前端 / BFF 仓缺失', object_key: null }],
    object_keys_json: objects.slice(0, 12).map((item) => `${item.object_type}:${item.object_key}`),
    repo_roles_json: repoRoles,
    evidence_json: toArray(inventory.entry_candidates).slice(0, 8).map((item) => ({ evidence_type: 'entry', source_uri: item })),
    metrics_json: {
      business_module_count: businessModules.length,
      object_count: objects.length,
      relation_count: relations.length,
      frontend_repo_bound: frontendBound,
    },
  });

  const modulesForDomains = domainModels.length
    ? domainModels.map((domain) => ({
        name: domain.domain_key,
        title: domain.title,
        domain_model: domain,
        source_files: uniqueStrings((domain.evidence_json || []).map((item) => item.source_uri)).slice(0, 12),
        file_count: (domain.page_slugs || []).length || (domain.thread_keys || []).length || 0,
      }))
    : businessModules.length
      ? businessModules
      : [{ name: 'application', source_files: uniqueStrings(toArray(inventory.entry_candidates).slice(0, 12)), file_count: Number(inventory.readable_files || 0) }];

  modulesForDomains.forEach((moduleInfo, moduleIndex) => {
    const domainModel = moduleInfo.domain_model || domainModels.find((item) => normalizeText(item.domain_key) === normalizeText(moduleInfo.name));
    const domainKey = normalizeDeepWikiThreadKey(domainModel?.domain_key || moduleInfo.name, `domain-${moduleIndex + 1}`);
    const domainContextKey = domainModel?.domain_key || domainKey;
    const moduleObjects = domainModel
      ? objects.filter((item) => normalizeText(getDeepWikiObjectPayload(item).domain_key) === normalizeText(domainModel.domain_key) || [`domain_context:${domainModel.domain_key}`, ...((domainModel.behaviors || []).map((behavior) => `domain_behavior:${behavior.object_key}`))].includes(`${item.object_type}:${item.object_key}`))
      : selectModuleObjects(moduleInfo, objects);
    const domainObjectKeys = moduleObjects.slice(0, 16).map((item) => `${item.object_type}:${item.object_key}`);
    pushThread({
      thread_key: `domain-${domainKey}`,
      parent_thread_key: 'project-trunk',
      thread_level: 'domain',
      domain_key: domainKey,
      domain_context_key: domainModel?.domain_key || domainKey,
      behavior_key: null,
      title: domainModel?.title || moduleInfo.title || `${moduleInfo.name} 领域`,
      summary_markdown: domainModel
        ? `${domainModel.title} 作为 ${domainModel.domain_tier === 'core' ? '核心域' : domainModel.domain_tier === 'generic' ? '通用域' : '支撑域'}，围绕 ${domainModel.behaviors.map((item) => item.title).slice(0, 3).join('、') || '关键行为'} 组织主干和分支线程。`
        : `${moduleInfo.name} 领域覆盖 ${moduleObjects.length} 个结构化对象，优先围绕其主流程、分支流程与数据落点展开。`,
      entry_points_json: toArray(moduleInfo.source_files).slice(0, 6).map((item) => ({ type: 'module_file', path: item, label: path.basename(item) })),
      steps_json: [],
      branch_points_json: [],
      command_keys_json: domainModel?.commands?.map((item) => item.object_key).slice(0, 6) || [],
      event_keys_json: domainModel?.events?.map((item) => item.object_key).slice(0, 6) || [],
      object_keys_json: domainObjectKeys,
      repo_roles_json: repoRoles,
      evidence_json: toArray(moduleInfo.source_files).slice(0, 8).map((item) => ({ evidence_type: 'module', source_uri: item })),
      metrics_json: {
        module_name: moduleInfo.name,
        domain_context_key: domainContextKey,
        domain_tier: domainModel?.domain_tier || null,
        object_count: moduleObjects.length,
      },
    });

    const behaviorSeeds = uniqueDeepWikiObjects([
      ...(relations
        .filter((relation) =>
          relation.from_object_type === 'domain_context' &&
          relation.to_object_type === 'domain_behavior' &&
          normalizeText(relation.from_object_key) === normalizeText(domainContextKey)
        )
        .map((relation) => objectByCompositeKey.get(`domain_behavior:${relation.to_object_key}`))
        .filter(Boolean)),
      ...((domainModel?.behaviors || [])
        .map((behavior) => objectByCompositeKey.get(`domain_behavior:${behavior.object_key}`))
        .filter(Boolean)),
      ...moduleObjects.filter((item) => item.object_type === 'domain_behavior'),
    ]);
    const domainFeaturePool = uniqueDeepWikiObjects(
      relations
        .filter((relation) =>
          relation.from_object_type === 'feature' &&
          relation.to_object_type === 'domain_context' &&
          normalizeText(relation.to_object_key) === normalizeText(domainContextKey)
        )
        .map((relation) => objectByCompositeKey.get(`feature:${relation.from_object_key}`))
        .filter(Boolean)
    );
    const domainServicePool = uniqueDeepWikiObjects(
      domainFeaturePool.flatMap((feature) =>
        (relationIndex.outgoing.get(`feature:${feature.object_key}`) || [])
          .filter((relation) => relation.to_object_type === 'service')
          .map((relation) => objectByCompositeKey.get(`service:${relation.to_object_key}`))
          .filter(Boolean)
      )
    );

    if (behaviorSeeds.length) {
      behaviorSeeds.slice(0, 8).forEach((behaviorSeed, behaviorIndex) => {
        const matchedBehavior = (domainModel?.behaviors || []).find((item) => normalizeText(item.object_key) === normalizeText(behaviorSeed.object_key)) || null;
        const behaviorKey = `domain_behavior:${behaviorSeed.object_key}`;
        const incoming = relationIndex.incoming.get(behaviorKey) || [];
        const outgoing = relationIndex.outgoing.get(behaviorKey) || [];
        const relatedCommands = uniqueDeepWikiObjects(
          incoming
            .filter((relation) => relation.from_object_type === 'command')
            .map((relation) => objectByCompositeKey.get(`command:${relation.from_object_key}`))
            .filter(Boolean)
        );
        const relatedEvents = uniqueDeepWikiObjects(
          outgoing
            .filter((relation) => relation.to_object_type === 'domain_event')
            .map((relation) => objectByCompositeKey.get(`domain_event:${relation.to_object_key}`))
            .filter(Boolean)
        );
        const relatedAggregates = uniqueDeepWikiObjects(
          outgoing
            .filter((relation) => relation.to_object_type === 'aggregate')
            .map((relation) => objectByCompositeKey.get(`aggregate:${relation.to_object_key}`))
            .filter(Boolean)
        );
        const behaviorFiles = getDeepWikiObjectSourceFiles(behaviorSeed);
        const aggregateContextFiles = uniqueStrings(relatedAggregates.flatMap((item) => getDeepWikiObjectSourceFiles(item)));
        const behaviorTokens = [
          domainContextKey,
          behaviorSeed.object_key,
          behaviorSeed.title,
          ...behaviorFiles,
          ...relatedAggregates.flatMap((item) => [item.object_key, item.title, ...getDeepWikiObjectSourceFiles(item)]),
          ...relatedCommands.map((item) => item.title || item.object_key),
          ...relatedEvents.map((item) => item.title || item.object_key),
        ];
        const matchedApis = selectDeepWikiThreadCandidates(apiObjects, {
          source_files: behaviorFiles,
          tokens: behaviorTokens,
        }, 2);
        const matchedServices = selectDeepWikiThreadCandidates(domainServicePool.length ? domainServicePool : serviceObjects, {
          source_files: behaviorFiles,
          tokens: behaviorTokens,
        }, 2);
        const matchedTables = selectDeepWikiThreadCandidates(tableObjects, {
          source_files: aggregateContextFiles,
          tokens: [
            ...behaviorTokens,
            ...relatedAggregates.flatMap((item) => [item.object_key, item.title, ...getDeepWikiObjectSourceTables(item)]),
            ...getDeepWikiObjectSourceTables(behaviorSeed),
          ],
        }, 2);
        const matchedTests = selectDeepWikiThreadCandidates(testObjects, {
          source_files: [...behaviorFiles, ...matchedApis.flatMap((item) => getDeepWikiObjectSourceFiles(item))],
          tokens: [...behaviorTokens, ...matchedApis.map((item) => item.title || item.object_key)],
        }, 1);
        const relatedApi = matchedApis[0] || null;
        const relatedService = matchedServices[0] || null;
        const relatedAggregate = relatedAggregates[0] || null;
        const relatedTable = matchedTables[0] || null;
        const relatedTest = matchedTests[0] || null;
        const steps = buildThreadSteps(behaviorSeed, {
          api: relatedApi,
          service: relatedService,
          aggregate: relatedAggregate,
          table: relatedTable,
          test: relatedTest,
        });
        const branchPoints = buildThreadBranchPoints(behaviorSeed, {
          extraApis: matchedApis.slice(1),
          extraTables: matchedTables.slice(1),
          extraServices: matchedServices.slice(1),
          extraAggregates: relatedAggregates.slice(1),
        });
        const threadKey = normalizeDeepWikiThreadKey(`${domainKey}-${behaviorSeed.object_key}`, `thread-${moduleIndex + 1}-${behaviorIndex + 1}`);
        const objectKeys = uniqueStrings([
          `domain_behavior:${behaviorSeed.object_key}`,
          relatedApi ? `api:${relatedApi.object_key}` : null,
          relatedService ? `service:${relatedService.object_key}` : null,
          relatedAggregate ? `aggregate:${relatedAggregate.object_key}` : null,
          relatedTable ? `table:${relatedTable.object_key}` : null,
          relatedTest ? `test_asset:${relatedTest.object_key}` : null,
          ...relatedCommands.map((item) => `command:${item.object_key}`),
          ...relatedEvents.map((item) => `domain_event:${item.object_key}`),
          ...matchedApis.slice(1).map((item) => `api:${item.object_key}`),
          ...matchedTables.slice(1).map((item) => `table:${item.object_key}`),
          ...matchedServices.slice(1).map((item) => `service:${item.object_key}`),
          ...relatedAggregates.slice(1).map((item) => `aggregate:${item.object_key}`),
        ]);
        pushThread({
          thread_key: threadKey,
          parent_thread_key: `domain-${domainKey}`,
          thread_level: 'core_thread',
          domain_key: domainKey,
          domain_context_key: domainContextKey,
          behavior_key: behaviorSeed.object_key,
          title: matchedBehavior?.title || behaviorSeed.title || `${behaviorSeed.object_key} 主流程`,
          summary_markdown: normalizeText(matchedBehavior?.description) || `${behaviorSeed.title || behaviorSeed.object_key} 线程围绕行为、命令、聚合与 API 证据重建主链路。`,
          entry_points_json: [
            ...matchedApis.slice(0, 2).map((item) => ({ type: 'api', endpoint: item.title, label: item.title })),
            ...behaviorFiles.slice(0, 3).map((item) => ({ type: 'code', path: item, label: path.basename(item) })),
          ],
          steps_json: steps,
          branch_points_json: branchPoints,
          command_keys_json: relatedCommands.map((item) => item.object_key).slice(0, 4),
          event_keys_json: relatedEvents.map((item) => item.object_key).slice(0, 4),
          object_keys_json: objectKeys,
          repo_roles_json: repoRoles,
          evidence_json: objectKeys
            .map((key) => objectByCompositeKey.get(key))
            .filter(Boolean)
            .flatMap((item) => getDeepWikiObjectSourceFiles(item).slice(0, 2).map((sourceUri) => ({ evidence_type: item.object_type, source_uri: sourceUri })))
            .slice(0, 12),
          metrics_json: {
            step_count: steps.length,
            branch_count: branchPoints.length,
            domain_context_key: domainContextKey,
            behavior_key: behaviorSeed.object_key,
            frontend_repo_bound: frontendBound,
          },
        });
        pushThread({
          thread_key: `${threadKey}-branches`,
          parent_thread_key: threadKey,
          thread_level: 'branch_thread',
          domain_key: domainKey,
          domain_context_key: domainContextKey,
          behavior_key: behaviorSeed.object_key,
          title: `${matchedBehavior?.title || behaviorSeed.title || behaviorSeed.object_key} 分支与异常`,
          summary_markdown: `该线程拆出了 ${branchPoints.length} 个分支 / 异常点，用于补齐状态分叉、异常补偿与数据分叉。`,
          entry_points_json: matchedApis.slice(0, 2).map((item) => ({ type: 'api', endpoint: item.title, label: item.title })),
          steps_json: steps,
          branch_points_json: branchPoints,
          command_keys_json: relatedCommands.map((item) => item.object_key).slice(0, 4),
          event_keys_json: relatedEvents.map((item) => item.object_key).slice(0, 4),
          object_keys_json: objectKeys,
          repo_roles_json: repoRoles,
          evidence_json: toArray(moduleInfo.source_files).slice(0, 6).map((item) => ({ evidence_type: 'module', source_uri: item })),
          metrics_json: {
            branch_count: branchPoints.length,
            domain_context_key: domainContextKey,
            behavior_key: behaviorSeed.object_key,
            exception_count: branchPoints.filter((item) => item.branch_type === 'exception_branch').length,
          },
        });
        if (frontendBound) {
          pushThread({
            thread_key: `${threadKey}-frontend`,
            parent_thread_key: threadKey,
            thread_level: 'frontend_journey',
            domain_key: domainKey,
            domain_context_key: domainContextKey,
            behavior_key: behaviorSeed.object_key,
            title: `${matchedBehavior?.title || behaviorSeed.title || behaviorSeed.object_key} 前后端联动`,
            summary_markdown: '该线程用于串联前端入口、BFF、后端 API、服务与数据库实体；若证据不足，会保留待确认标记。',
            entry_points_json: toArray(inventory.frontend_pages).slice(0, 4).map((item) => ({ type: 'frontend', path: item, label: path.basename(item) })),
            steps_json: steps,
            branch_points_json: [],
            command_keys_json: relatedCommands.map((item) => item.object_key).slice(0, 4),
            event_keys_json: relatedEvents.map((item) => item.object_key).slice(0, 4),
            object_keys_json: objectKeys,
            repo_roles_json: repoRoles,
            evidence_json: toArray(inventory.frontend_pages).slice(0, 4).map((item) => ({ evidence_type: 'frontend', source_uri: item })),
            metrics_json: {
              frontend_repo_bound: true,
              domain_context_key: domainContextKey,
              behavior_key: behaviorSeed.object_key,
              binding_step_count: steps.length,
            },
          });
        }
      });
      return;
    }

    const apiSeeds = moduleObjects.filter((item) => item.object_type === 'api').slice(0, 2);
    const serviceSeeds = moduleObjects.filter((item) => item.object_type === 'service').slice(0, apiSeeds.length ? 0 : 2);
      const seeds = [...apiSeeds, ...serviceSeeds];
      seeds.forEach((seed, seedIndex) => {
      const matchedBehavior = domainModel
        ? (domainModel.behaviors || []).find((behavior) =>
            (behavior.api_endpoints || []).some((endpoint) => getDeepWikiObjectSourceApis(seed).includes(endpoint)) ||
            String(behavior.title || '').includes(String(seed.title || '')) ||
            String(seed.title || '').includes(String(behavior.title || ''))
          ) || (domainModel.behaviors || [])[seedIndex] || null
        : null;
      const seedKey = `${seed.object_type}:${seed.object_key}`;
      const incoming = relationIndex.incoming.get(seedKey) || [];
      const outgoing = relationIndex.outgoing.get(seedKey) || [];
      const incomingServiceRelation = incoming.find((relation) => relation.from_object_type === 'service');
      const outgoingApiRelation = outgoing.find((relation) => relation.to_object_type === 'api');
      const relatedService = seed.object_type === 'service'
        ? seed
        : incomingServiceRelation
          ? objectByCompositeKey.get(`service:${incomingServiceRelation.from_object_key}`)
          : null;
      const relatedApi = seed.object_type === 'api'
        ? seed
        : outgoingApiRelation
          ? objectByCompositeKey.get(`api:${outgoingApiRelation.to_object_key}`)
          : null;
      const serviceOutgoing = relatedService ? relationIndex.outgoing.get(`service:${relatedService.object_key}`) || [] : [];
      const serviceTableRelation = serviceOutgoing.find((relation) => relation.to_object_type === 'table');
      const relatedTable = serviceTableRelation
        ? objectByCompositeKey.get(`table:${serviceTableRelation.to_object_key}`)
        : null;
      const apiOutgoing = relatedApi ? relationIndex.outgoing.get(`api:${relatedApi.object_key}`) || [] : [];
      const apiTestRelation = apiOutgoing.find((relation) => relation.to_object_type === 'test_asset');
      const relatedTest = apiTestRelation
        ? objectByCompositeKey.get(`test_asset:${apiTestRelation.to_object_key}`)
        : null;
      const extraApis = serviceOutgoing
        .filter((relation) => relation.to_object_type === 'api' && relation.to_object_key !== relatedApi?.object_key)
        .map((relation) => objectByCompositeKey.get(`api:${relation.to_object_key}`))
        .filter(Boolean);
      const extraTables = serviceOutgoing
        .filter((relation) => relation.to_object_type === 'table' && relation.to_object_key !== relatedTable?.object_key)
        .map((relation) => objectByCompositeKey.get(`table:${relation.to_object_key}`))
        .filter(Boolean);
      const steps = buildThreadSteps(seed, {
        service: relatedService,
        api: relatedApi,
        table: relatedTable,
        test: relatedTest,
      });
      const branchPoints = buildThreadBranchPoints(seed, {
        extraApis,
        extraTables,
      });
      const threadKey = normalizeDeepWikiThreadKey(`${domainKey}-${seed.object_key}`, `thread-${moduleIndex + 1}-${seedIndex + 1}`);
      const objectKeys = uniqueStrings([
        `${seed.object_type}:${seed.object_key}`,
        relatedService ? `service:${relatedService.object_key}` : null,
        relatedApi ? `api:${relatedApi.object_key}` : null,
        relatedTable ? `table:${relatedTable.object_key}` : null,
        relatedTest ? `test_asset:${relatedTest.object_key}` : null,
        matchedBehavior ? `domain_behavior:${matchedBehavior.object_key}` : null,
        ...extraApis.map((item) => `api:${item.object_key}`),
        ...extraTables.map((item) => `table:${item.object_key}`),
      ]);
      pushThread({
        thread_key: threadKey,
        parent_thread_key: `domain-${domainKey}`,
        thread_level: 'core_thread',
        domain_key: domainKey,
        domain_context_key: domainModel?.domain_key || domainKey,
        behavior_key: matchedBehavior?.object_key || null,
        title: matchedBehavior?.title || `${seed.title || seed.object_key} 主流程`,
        summary_markdown: normalizeText(matchedBehavior?.description) || `${seed.title || seed.object_key} 线程围绕 API / Service / Table 的主链路展开，优先展示真实入口、核心服务与数据落点。`,
        entry_points_json: [
          ...(matchedBehavior?.api_endpoints || []).slice(0, 4).map((item) => ({ type: 'api', endpoint: item, label: item })),
          ...getDeepWikiObjectSourceApis(relatedApi || seed).slice(0, 4).map((item) => ({ type: 'api', endpoint: item, label: item })),
          ...getDeepWikiObjectSourceFiles(seed).slice(0, 3).map((item) => ({ type: 'code', path: item, label: path.basename(item) })),
        ],
        steps_json: steps,
        branch_points_json: branchPoints,
        command_keys_json: matchedBehavior?.command_name
          ? (domainModel?.commands || []).filter((item) => String(item.title || '').includes(String(matchedBehavior.command_name || ''))).map((item) => item.object_key).slice(0, 4)
          : [],
        event_keys_json: matchedBehavior?.event_name
          ? (domainModel?.events || []).filter((item) => String(item.title || '').includes(String(matchedBehavior.event_name || ''))).map((item) => item.object_key).slice(0, 4)
          : [],
        object_keys_json: objectKeys,
        repo_roles_json: repoRoles,
        evidence_json: objectKeys
          .map((key) => objectByCompositeKey.get(key))
          .filter(Boolean)
          .flatMap((item) => getDeepWikiObjectSourceFiles(item).slice(0, 2).map((sourceUri) => ({ evidence_type: item.object_type, source_uri: sourceUri })))
          .slice(0, 12),
        metrics_json: {
          step_count: steps.length,
          branch_count: branchPoints.length,
          domain_context_key: domainModel?.domain_key || domainKey,
          behavior_key: matchedBehavior?.object_key || null,
          frontend_repo_bound: frontendBound,
        },
      });
      if (branchPoints.length) {
        pushThread({
          thread_key: `${threadKey}-branches`,
          parent_thread_key: threadKey,
          thread_level: 'branch_thread',
          domain_key: domainKey,
          domain_context_key: domainModel?.domain_key || domainKey,
          behavior_key: matchedBehavior?.object_key || null,
          title: `${matchedBehavior?.title || seed.title || seed.object_key} 分支与异常`,
          summary_markdown: `该线程拆出了 ${branchPoints.length} 个分支 / 异常点，用于补齐状态分叉、数据分叉或补偿链路。`,
          entry_points_json: toArray(getDeepWikiObjectSourceApis(relatedApi || seed)).slice(0, 2).map((item) => ({ type: 'api', endpoint: item, label: item })),
          steps_json: steps,
          branch_points_json: branchPoints,
          command_keys_json: matchedBehavior?.command_name
            ? (domainModel?.commands || []).filter((item) => String(item.title || '').includes(String(matchedBehavior.command_name || ''))).map((item) => item.object_key).slice(0, 4)
            : [],
          event_keys_json: matchedBehavior?.event_name
            ? (domainModel?.events || []).filter((item) => String(item.title || '').includes(String(matchedBehavior.event_name || ''))).map((item) => item.object_key).slice(0, 4)
            : [],
          object_keys_json: objectKeys,
          repo_roles_json: repoRoles,
          evidence_json: toArray(moduleInfo.source_files).slice(0, 6).map((item) => ({ evidence_type: 'module', source_uri: item })),
          metrics_json: {
            branch_count: branchPoints.length,
            domain_context_key: domainModel?.domain_key || domainKey,
            behavior_key: matchedBehavior?.object_key || null,
            exception_count: branchPoints.filter((item) => item.branch_type === 'exception_branch').length,
          },
        });
      }
      if (frontendBound) {
        pushThread({
          thread_key: `${threadKey}-frontend`,
          parent_thread_key: threadKey,
          thread_level: 'frontend_journey',
          domain_key: domainKey,
          domain_context_key: domainModel?.domain_key || domainKey,
          behavior_key: matchedBehavior?.object_key || null,
          title: `${matchedBehavior?.title || seed.title || seed.object_key} 前后端联动`,
          summary_markdown: '该线程用于串联前端入口、BFF、后端 API、服务与数据库实体；若证据不足，会保留待确认标记。',
          entry_points_json: toArray(inventory.frontend_pages).slice(0, 4).map((item) => ({ type: 'frontend', path: item, label: path.basename(item) })),
          steps_json: steps,
          branch_points_json: [],
          command_keys_json: matchedBehavior?.command_name
            ? (domainModel?.commands || []).filter((item) => String(item.title || '').includes(String(matchedBehavior.command_name || ''))).map((item) => item.object_key).slice(0, 4)
            : [],
          event_keys_json: matchedBehavior?.event_name
            ? (domainModel?.events || []).filter((item) => String(item.title || '').includes(String(matchedBehavior.event_name || ''))).map((item) => item.object_key).slice(0, 4)
            : [],
          object_keys_json: objectKeys,
          repo_roles_json: repoRoles,
          evidence_json: toArray(inventory.frontend_pages).slice(0, 4).map((item) => ({ evidence_type: 'frontend', source_uri: item })),
          metrics_json: {
            frontend_repo_bound: true,
            domain_context_key: domainModel?.domain_key || domainKey,
            behavior_key: matchedBehavior?.object_key || null,
            binding_step_count: steps.length,
          },
        });
      }
    });
  });

  return threads;
}

function buildPreferredThreadCitations(retrievedThreads = [], pageRows = [], resolvedMode = 'local') {
  const pageBuckets = new Map();
  (pageRows || []).forEach((page) => {
    const threadKey = normalizeText(page?.metadata_json?.thread_key);
    if (!threadKey) return;
    const bucket = pageBuckets.get(threadKey) || [];
    bucket.push(page);
    pageBuckets.set(threadKey, bucket);
  });
  const suffixPriority = resolvedMode === 'local'
    ? ['01-main-flow', '00-summary', '04-front-back-data-binding', '03-sequence', '02-branch-flows']
    : ['00-summary', '01-main-flow', '02-branch-flows', '03-sequence', '04-front-back-data-binding'];
  const citations = [];
  retrievedThreads.slice(0, 4).forEach((thread, threadIndex) => {
    const bucket = pageBuckets.get(normalizeText(thread.thread_key)) || [];
    const sorted = bucket.slice().sort((left, right) => {
      const leftSlug = normalizeText(left.page_slug);
      const rightSlug = normalizeText(right.page_slug);
      const leftRank = suffixPriority.findIndex((suffix) => leftSlug.endsWith(`/${suffix}`));
      const rightRank = suffixPriority.findIndex((suffix) => rightSlug.endsWith(`/${suffix}`));
      return (leftRank < 0 ? 99 : leftRank) - (rightRank < 0 ? 99 : rightRank);
    });
    const page = sorted[0];
    if (!page) return;
    citations.push({
      page_slug: page.page_slug,
      title: page.title,
      source_uri: page.source_uri,
      knowledge_asset_id: page.knowledge_asset_id || null,
      score: Number((100 - threadIndex).toFixed(2)),
      excerpt: truncateText(readTextIfExists(page.source_uri) || page.title || '', 280),
    });
  });
  return citations;
}

function mergeDeepWikiCitations(preferred = [], existing = [], limit = 6) {
  const merged = [];
  const seen = new Set();
  [...preferred, ...existing].forEach((item) => {
    const key = normalizeText(item?.page_slug || item?.source_uri);
    if (!key || seen.has(key)) return;
    seen.add(key);
    merged.push(item);
  });
  return merged.slice(0, Math.max(1, Number(limit || 6)));
}

function rewriteDeepWikiBusinessQuery(queryText = '') {
  const normalizedQuery = normalizeText(queryText);
  const lowered = normalizedQuery.toLowerCase();
  const rewriteTerms = [];
  const intents = [];
  if (/核心逻辑|主干|主流程|核心流程/.test(normalizedQuery)) {
    rewriteTerms.push('主流程', '核心行为', '关键步骤');
    intents.push('main_flow');
  }
  if (/分支|异常|补偿|回滚|取消|失败/.test(normalizedQuery)) {
    rewriteTerms.push('分支流程', '异常补偿', '回滚路径');
    intents.push('branch_flow');
  }
  if (/前端.*数据库|落到数据库|前后端/.test(normalizedQuery)) {
    rewriteTerms.push('前后端联动', '入口到数据库', '实体绑定');
    intents.push('front_back_binding');
  }
  if (/创建|新增|提交|审核|确认|作废|反审核|取消/.test(normalizedQuery)) {
    rewriteTerms.push('命令', '状态流转', '领域事件');
    intents.push('command_lifecycle');
  }
  if (/业务域|领域|上下文|bounded context/i.test(normalizedQuery)) {
    rewriteTerms.push('业务域', 'bounded context', '上下游');
    intents.push('domain_context');
  }
  const nounMatches = normalizedQuery.match(/[\u4e00-\u9fffA-Za-z0-9_-]{2,24}/g) || [];
  const focusTerms = uniqueStrings([...nounMatches.slice(0, 6), ...rewriteTerms]).slice(0, 10);
  return {
    original_query: normalizedQuery,
    rewritten_query: uniqueStrings([normalizedQuery, ...rewriteTerms]).join('；'),
    intents: uniqueStrings(intents),
    focus_terms: focusTerms,
  };
}

function rankDeepWikiDomainsAgainstQuery(queryText, domains = []) {
  return (domains || [])
    .map((domain) => {
      const text = [
        domain.title,
        domain.domain_key,
        domain.bounded_context_name,
        ...(domain.ubiquitous_language || []),
        ...(domain.behaviors || []).map((item) => `${item.title} ${item.description || ''}`),
        ...(domain.aggregates || []).map((item) => item.title || item.object_key),
      ].join('\n');
      return {
        ...domain,
        rank_score: Number(rankTextAgainstQuery(queryText, text).toFixed(4)),
      };
    })
    .filter((item) => item.rank_score > 0)
    .sort((left, right) => right.rank_score - left.rank_score)
    .slice(0, 6);
}

function rankDeepWikiBehaviorsAgainstQuery(queryText, domains = []) {
  const behaviors = [];
  (domains || []).forEach((domain) => {
    (domain.behaviors || []).forEach((behavior) => {
      behaviors.push({
        domain_key: domain.domain_key,
        domain_title: domain.title,
        ...behavior,
      });
    });
  });
  return behaviors
    .map((behavior) => ({
      ...behavior,
      rank_score: Number(rankTextAgainstQuery(queryText, [
        behavior.title,
        behavior.description,
        behavior.domain_title,
        ...(behavior.api_endpoints || []),
        ...(behavior.tables || []),
      ].filter(Boolean).join('\n')).toFixed(4)),
    }))
    .filter((item) => item.rank_score > 0)
    .sort((left, right) => right.rank_score - left.rank_score)
    .slice(0, 8);
}

function buildPreferredDomainCitations(retrievedDomains = [], pageRows = [], resolvedMode = 'global') {
  const citations = [];
  const suffixPriority = resolvedMode === 'global'
    ? ['00-summary', '01-context-map', '02-behavior-map', '03-aggregate-map']
    : ['01-context-map', '00-summary', '02-behavior-map', '03-aggregate-map'];
  retrievedDomains.slice(0, 3).forEach((domain, domainIndex) => {
    const bucket = (pageRows || []).filter((page) => normalizeText(page.page_slug).startsWith(`10-domains/${normalizeText(domain.domain_key)}/`));
    const page = bucket
      .slice()
      .sort((left, right) => {
        const leftRank = suffixPriority.findIndex((suffix) => normalizeText(left.page_slug).endsWith(`/${suffix}`));
        const rightRank = suffixPriority.findIndex((suffix) => normalizeText(right.page_slug).endsWith(`/${suffix}`));
        return (leftRank < 0 ? 99 : leftRank) - (rightRank < 0 ? 99 : rightRank);
      })[0];
    if (!page) return;
    citations.push({
      page_slug: page.page_slug,
      title: page.title,
      source_uri: page.source_uri,
      knowledge_asset_id: page.knowledge_asset_id || null,
      score: Number((120 - domainIndex).toFixed(2)),
      excerpt: truncateText(readTextIfExists(page.source_uri) || page.title || '', 280),
    });
  });
  return citations;
}

function linkQueryToDeepWikiObjects(query, objects = [], limit = 5) {
  const normalizedQuery = normalizeText(query).toLowerCase();
  return (objects || [])
    .map((item) => {
      const searchText = buildDeepWikiObjectSearchText(item).toLowerCase();
      const overlapScore = rankTextAgainstQuery(normalizedQuery, searchText);
      const exactMatch =
        normalizedQuery && (
          searchText.includes(normalizedQuery) ||
          normalizedQuery.includes(String(item.object_key || '').toLowerCase()) ||
          normalizedQuery.includes(String(item.title || '').toLowerCase())
        )
          ? 0.6
          : 0;
      const typeHint =
        (DEEPWIKI_LOCAL_QUERY_HINTS.some((hint) => normalizedQuery.includes(hint)) && ['api', 'service', 'table'].includes(item.object_type))
          ? 0.15
          : 0;
      const linkScore = Number((overlapScore + exactMatch + typeHint).toFixed(4));
      return {
        ...item,
        link_score: linkScore,
      };
    })
    .filter((item) => item.link_score > 0)
    .sort((left, right) => right.link_score - left.link_score)
    .slice(0, Math.max(1, Number(limit || 5)));
}

function decideDeepWikiQueryMode(query, linkedObjects = [], requestedMode = 'auto') {
  const normalizedMode = normalizeText(requestedMode) || 'auto';
  if (normalizedMode === 'local' || normalizedMode === 'global') {
    return normalizedMode;
  }
  const normalizedQuery = normalizeText(query).toLowerCase();
  if (DEEPWIKI_GLOBAL_QUERY_HINTS.some((hint) => normalizedQuery.includes(String(hint).toLowerCase()))) {
    return 'global';
  }
  if (linkedObjects.length && Number(linkedObjects[0].link_score || 0) >= 0.35) {
    return 'local';
  }
  if (DEEPWIKI_LOCAL_QUERY_HINTS.some((hint) => normalizedQuery.includes(String(hint).toLowerCase()))) {
    return 'local';
  }
  return 'global';
}

function expandDeepWikiNeighborhood(linkedObjects = [], relations = [], limit = 12) {
  const seeds = linkedObjects.map((item) => `${item.object_type}:${item.object_key}`);
  const visited = new Set(seeds);
  let frontier = [...seeds];
  for (let hop = 0; hop < 2; hop += 1) {
    const next = [];
    frontier.forEach((key) => {
      (relations || []).forEach((relation) => {
        const fromKey = `${relation.from_object_type}:${relation.from_object_key}`;
        const toKey = `${relation.to_object_type}:${relation.to_object_key}`;
        if (fromKey === key && !visited.has(toKey)) {
          visited.add(toKey);
          next.push(toKey);
        }
        if (toKey === key && !visited.has(fromKey)) {
          visited.add(fromKey);
          next.push(fromKey);
        }
      });
    });
    frontier = next;
  }
  return [...visited].slice(0, Math.max(limit, seeds.length));
}

function buildDeepWikiRetrievalProbeQueries(graph = {}, pageRows = [], communityReports = []) {
  const objects = Array.isArray(graph.objects) ? graph.objects : [];
  const pageIndex = buildDeepWikiPageObjectKeyIndex(pageRows);
  const probes = [];
  ['api', 'service', 'table', 'feature', 'domain_context', 'domain_behavior'].forEach((type) => {
    const item = objects.find((candidate) => candidate.object_type === type);
    if (!item) return;
    const objectKey = `${item.object_type}:${item.object_key}`;
    probes.push({
      scope: 'local',
      query: `${item.title || item.object_key} 的关键职责和上下游依赖是什么？`,
      expected_object_keys: [objectKey],
      expected_page_slugs: pageIndex.get(objectKey) || [],
    });
  });
  (communityReports || []).slice(0, 2).forEach((report) => {
    probes.push({
      scope: 'global',
      query: `${report.title} 涉及哪些核心模块、对象和主要关系？`,
      expected_object_keys: Array.isArray(report.metadata_json?.object_keys) ? report.metadata_json.object_keys : [],
      expected_page_slugs: Array.isArray(report.page_slugs_json) ? report.page_slugs_json : [],
    });
  });
  return probes.slice(0, 6);
}

function buildDeepWikiQualityReport({
  project = null,
  run = null,
  graph = {},
  pages = [],
  inventory = {},
  retrieval_eval = null,
  threads = [],
  coverage_report = null,
} = {}) {
  const objects = Array.isArray(graph.objects) ? graph.objects : [];
  const relations = Array.isArray(graph.relations) ? graph.relations : [];
  const pageRows = Array.isArray(pages) ? pages : [];
  const threadRows = Array.isArray(threads) ? threads : [];
  const evidenceCoveredObjects = objects.filter((item) => Array.isArray(item.evidence) && item.evidence.length > 0);
  const schemaPassedObjects = objects.filter((item) => validateDeepWikiObjectSchema(item));
  const objectTypes = new Set(objects.map((item) => item.object_type));
  const coreTypes = ['service', 'api', 'table', 'feature', 'test_asset'];
  const presentCoreTypes = coreTypes.filter((type) => objectTypes.has(type));
  const apiObjects = objects.filter((item) => item.object_type === 'api');
  const tableObjects = objects.filter((item) => item.object_type === 'table');
  const serviceObjects = objects.filter((item) => item.object_type === 'service');
  const domainContextObjects = objects.filter((item) => item.object_type === 'domain_context');
  const domainBehaviorObjects = objects.filter((item) => item.object_type === 'domain_behavior');
  const hasFeatureServiceApiTestChain = relations.some((relationA) => {
    if (!(relationA.from_object_type === 'feature' && relationA.to_object_type === 'service')) return false;
    const downstreamApi = relations.find((relationB) =>
      relationB.from_object_type === 'service' &&
      relationB.from_object_key === relationA.to_object_key &&
      relationB.to_object_type === 'api'
    );
    if (!downstreamApi) return false;
    return relations.some((relationC) =>
      relationC.from_object_type === 'api' &&
      relationC.from_object_key === downstreamApi.to_object_key &&
      relationC.to_object_type === 'test_asset'
    );
  });
  const relationConnectivity = objects.length
    ? Number(Math.min(100, ((relations.length / Math.max(objects.length, 1)) * 100)).toFixed(2))
    : 0;
  const evidenceCoverage = objects.length
    ? Number(((evidenceCoveredObjects.length / objects.length) * 100).toFixed(2))
    : 0;
  const schemaPassRate = objects.length
    ? Number(((schemaPassedObjects.length / objects.length) * 100).toFixed(2))
    : 0;
  const retrievalRecall = Number(retrieval_eval?.top5_recall || 0);
  const threadCount = threadRows.length;
  const coreThreadCount = threadRows.filter((item) => item.thread_level === 'core_thread').length;
  const branchThreadCount = threadRows.filter((item) => ['branch_thread', 'exception_thread'].includes(item.thread_level)).length;
  const frontendJourneyCount = threadRows.filter((item) => item.thread_level === 'frontend_journey').length;
  const frontendRepoBound = !(inventory.missing_repo_roles || []).includes('frontend_view');
  const noiseModules = Array.isArray(inventory.noise_modules) ? inventory.noise_modules : [];
  const threadCoverageScore = Number(Math.min(100, (
    (threadRows.some((item) => item.thread_level === 'project_trunk') ? 20 : 0) +
    (threadRows.filter((item) => item.thread_level === 'domain').length * 15) +
    (coreThreadCount * 20)
  )).toFixed(2));
  const branchCoverageScore = Number(Math.min(100, branchThreadCount * 20).toFixed(2));
  const diagramDepthScore = Number(Math.min(100, pageRows.filter((item) => normalizeText(item.page_slug).startsWith('10-domains/')).length * 6).toFixed(2));
  const frontBackendBindingScore = frontendRepoBound
    ? Number(Math.min(100, 40 + frontendJourneyCount * 20).toFixed(2))
    : 20;
  const noisePenalty = Number(Math.min(40, noiseModules.length * 5).toFixed(2));
  const boundedContextScore = Number(Math.min(100, domainContextObjects.length * 20).toFixed(2));
  const domainModelScore = Number(Math.min(100, boundedContextScore * 0.6 + domainBehaviorObjects.length * 8 + Math.max(0, 20 - noisePenalty)).toFixed(2));
  const behaviorThreadScore = Number(Math.min(100, coreThreadCount * 12 + domainBehaviorObjects.length * 10).toFixed(2));
  const businessReadabilityScore = Number(Math.min(100, pageRows.filter((item) => normalizeText(item.page_slug).startsWith('10-domains/')).length * 8 + coreThreadCount * 6).toFixed(2));
  const queryBusinessHitScore = retrievalRecall;
  let status =
    schemaPassRate === 100 && evidenceCoverage >= 95 && relationConnectivity >= 70 && hasFeatureServiceApiTestChain
      ? 'published'
      : schemaPassRate >= 80 && evidenceCoverage >= 60
        ? 'review'
        : 'draft';
  if (retrieval_eval) {
    if (retrievalRecall < 60) {
      status = 'draft';
    } else if (retrievalRecall < 85 && status === 'published') {
      status = 'review';
    }
  }
  if (coverage_report && coverage_report.pass === false) {
    if (normalizeText(process.env.DEEPWIKI_BLOCK_PUBLISH_ON_COVERAGE) === '1') {
      status = 'draft';
    } else if (status === 'published') {
      status = 'review';
    }
  }

  return {
    status,
    schema_pass_rate: schemaPassRate,
    evidence_coverage_rate: evidenceCoverage,
    core_service_coverage_rate: serviceObjects.length ? 100 : 0,
    core_api_contract_rate: apiObjects.length ? 100 : 0,
    core_table_field_coverage_rate: tableObjects.length ? 100 : 0,
    relation_connectivity_rate: relationConnectivity,
    quality_json: {
      project_code: project?.project_code || run?.project_code || null,
      run_id: run?.id || null,
      snapshot_id: run?.snapshot_id || null,
      object_count: objects.length,
      page_count: pageRows.length,
      object_types: Array.from(objectTypes),
      core_types_present: presentCoreTypes,
      required_core_types: coreTypes,
      missing_core_types: coreTypes.filter((type) => !objectTypes.has(type)),
      evidence_covered_object_count: evidenceCoveredObjects.length,
      schema_passed_object_count: schemaPassedObjects.length,
      relation_count: relations.length,
      relation_chain_verified: hasFeatureServiceApiTestChain,
      thread_count: threadCount,
      core_thread_count: coreThreadCount,
      branch_thread_count: branchThreadCount,
      frontend_repo_bound: frontendRepoBound,
      noise_modules: noiseModules,
      coverage_gaps: [
        ...(frontendRepoBound ? [] : ['missing_frontend_repo_view']),
        ...(branchThreadCount ? [] : ['missing_branch_threads']),
        ...(threadCount >= 4 ? [] : ['insufficient_thread_depth']),
        ...(domainContextObjects.length ? [] : ['missing_domain_contexts']),
        ...(domainBehaviorObjects.length ? [] : ['missing_domain_behaviors']),
      ],
      domain_count: domainContextObjects.length,
      domain_behavior_count: domainBehaviorObjects.length,
      thread_coverage_score: threadCoverageScore,
      branch_coverage_score: branchCoverageScore,
      diagram_depth_score: diagramDepthScore,
      front_backend_binding_score: frontBackendBindingScore,
      domain_model_score: domainModelScore,
      behavior_thread_score: behaviorThreadScore,
      bounded_context_score: boundedContextScore,
      business_readability_score: businessReadabilityScore,
      query_business_hit_score: queryBusinessHitScore,
      noise_penalty: noisePenalty,
      missing_repo_roles: Array.isArray(inventory.missing_repo_roles) ? inventory.missing_repo_roles : [],
      inventory_summary: {
        readable_files: Number(inventory.readable_files || 0),
        api_count: Array.isArray(inventory.api_endpoints) ? inventory.api_endpoints.length : 0,
        table_count: Array.isArray(inventory.tables) ? inventory.tables.length : 0,
        module_count: Array.isArray(inventory.modules) ? inventory.modules.length : 0,
        test_file_count: Array.isArray(inventory.test_files) ? inventory.test_files.length : 0,
      },
      retrieval_eval: retrieval_eval || null,
      coverage_os: coverage_report
        ? {
            pass: coverage_report.pass,
            scores: coverage_report.scores,
            gaps: coverage_report.gaps,
            weak_graph_issues: coverage_report.weak_graph?.issues || [],
          }
        : null,
    },
  };
}

function buildDeepWikiConsistencyChecksFromGraph(graph = {}, objectIdMap = {}) {
  const relations = Array.isArray(graph.relations) ? graph.relations : [];
  const checks = [];
  const makeCheck = (checkType, fromRelation, toRelation, issueCode, status, detailJson) => {
    const sourceKey = fromRelation ? `${fromRelation.from_object_type}:${fromRelation.from_object_key}` : null;
    const targetKey = toRelation ? `${toRelation.to_object_type}:${toRelation.to_object_key}` : null;
    checks.push({
      check_type: checkType,
      source_object_type: fromRelation?.from_object_type || null,
      source_object_id: sourceKey ? objectIdMap[sourceKey] || null : null,
      target_object_type: toRelation?.to_object_type || null,
      target_object_id: targetKey ? objectIdMap[targetKey] || null : null,
      status,
      score: status === 'passed' ? 100 : status === 'review' ? 60 : 20,
      issue_code: issueCode,
      issue_level: status === 'passed' ? 'info' : status === 'review' ? 'warning' : 'error',
      detail_json: detailJson || {},
      evidence_json: [],
    });
  };

  relations
    .filter((relation) => relation.from_object_type === 'feature' && relation.to_object_type === 'service')
    .forEach((relation) => {
      const downstreamApi = relations.find((item) =>
        item.from_object_type === 'service' &&
        item.from_object_key === relation.to_object_key &&
        item.to_object_type === 'api'
      );
      if (!downstreamApi) {
        makeCheck('feature_service_api', relation, null, 'missing_service_api_link', 'failed', {
          feature_key: relation.from_object_key,
          service_key: relation.to_object_key,
        });
        return;
      }
      const coveredByTest = relations.find((item) =>
        item.from_object_type === 'api' &&
        item.from_object_key === downstreamApi.to_object_key &&
        item.to_object_type === 'test_asset'
      );
      makeCheck(
        'feature_service_api_test',
        relation,
        downstreamApi,
        coveredByTest ? 'feature_chain_verified' : 'missing_api_test_link',
        coveredByTest ? 'passed' : 'review',
        {
          feature_key: relation.from_object_key,
          service_key: relation.to_object_key,
          api_key: downstreamApi.to_object_key,
          test_asset_key: coveredByTest?.to_object_key || null,
        }
      );
    });

  return checks;
}

function buildDeepWikiExecutableKnowledge(graph = {}, objectIdMap = {}) {
  const relations = Array.isArray(graph.relations) ? graph.relations : [];
  const featureObjects = Array.isArray(graph.objects) ? graph.objects.filter((item) => item.object_type === 'feature') : [];
  const flows = [];
  const assertions = [];
  const scenarios = [];

  featureObjects.forEach((feature, index) => {
    const featureKey = `${feature.object_type}:${feature.object_key}`;
    const relatedService = relations.find((relation) =>
      relation.from_object_type === 'feature' &&
      relation.from_object_key === feature.object_key &&
      relation.to_object_type === 'service'
    );
    const relatedApi = relatedService
      ? relations.find((relation) =>
          relation.from_object_type === 'service' &&
          relation.from_object_key === relatedService.to_object_key &&
          relation.to_object_type === 'api'
        )
      : null;
    const relatedTable = relatedService
      ? relations.find((relation) =>
          relation.from_object_type === 'service' &&
          relation.from_object_key === relatedService.to_object_key &&
          relation.to_object_type === 'table'
        )
      : null;
    const relatedTest = relatedApi
      ? relations.find((relation) =>
          relation.from_object_type === 'api' &&
          relation.from_object_key === relatedApi.to_object_key &&
          relation.to_object_type === 'test_asset'
        )
      : null;
    const flowCode = `flow-${feature.object_key || index + 1}`;
    const assertionCode = `assert-${feature.object_key || index + 1}`;
    flows.push({
      flow_code: flowCode,
      flow_name: feature.title,
      flow_type: 'feature_flow',
      feature_object_id: objectIdMap[featureKey] || null,
      trigger_type: relatedApi ? 'api' : 'manual',
      status: relatedApi ? 'review' : 'draft',
      preconditions_json: [{ type: 'feature_ready', ref: feature.object_key }],
      postconditions_json: relatedTest ? [{ type: 'test_covered', ref: relatedTest.to_object_key }] : [],
      evidence_json: feature.evidence || [],
      steps: [
        {
          step_order: 1,
          step_type: 'feature',
          step_name: feature.title,
        },
        relatedApi
          ? {
              step_order: 2,
              step_type: 'api',
              step_name: relatedApi.to_object_key,
              api_object_id: objectIdMap[`api:${relatedApi.to_object_key}`] || null,
              assertion_ref: assertionCode,
            }
          : null,
        relatedService
          ? {
              step_order: 3,
              step_type: 'service',
              step_name: relatedService.to_object_key,
              service_object_id: objectIdMap[`service:${relatedService.to_object_key}`] || null,
            }
          : null,
        relatedTable
          ? {
              step_order: 4,
              step_type: 'table',
              step_name: relatedTable.to_object_key,
              table_object_id: objectIdMap[`table:${relatedTable.to_object_key}`] || null,
            }
          : null,
      ].filter(Boolean),
    });
    assertions.push({
      assertion_code: assertionCode,
      assertion_type: 'feature_chain',
      expression: `${feature.object_key} should map to a service/api/test chain`,
      expected_result_json: {
        feature_key: feature.object_key,
        api_key: relatedApi?.to_object_key || null,
        service_key: relatedService?.to_object_key || null,
        table_key: relatedTable?.to_object_key || null,
        test_asset_key: relatedTest?.to_object_key || null,
      },
      evidence_json: feature.evidence || [],
    });
    scenarios.push({
      scenario_code: `scenario-${feature.object_key || index + 1}`,
      scenario_name: feature.title,
      feature_object_id: objectIdMap[featureKey] || null,
      input_fixture_json: {
        feature_key: feature.object_key,
      },
      expected_assertions_json: [{ assertion_code: assertionCode }],
      linked_test_asset_object_id: relatedTest ? objectIdMap[`test_asset:${relatedTest.to_object_key}`] || null : null,
      status: relatedTest ? 'review' : 'draft',
    });
  });

  return { flows, assertions, scenarios };
}

function buildDeepWikiSemanticScores(qualityReport = {}, snapshotId = null) {
  const evidenceScore = Number(qualityReport.evidence_coverage_rate || 0);
  const relationScore = Number(qualityReport.relation_connectivity_rate || 0);
  const serviceScore = Number(qualityReport.core_service_coverage_rate || 0);
  const apiScore = Number(qualityReport.core_api_contract_rate || 0);
  const tableScore = Number(qualityReport.core_table_field_coverage_rate || 0);
  const structuralScore = Number(((evidenceScore + relationScore + serviceScore + apiScore + tableScore) / 5).toFixed(2));
  const retrievalScore = Number(qualityReport?.quality_json?.retrieval_eval?.top5_recall || 0);
  const threadCoverageScore = Number(qualityReport?.quality_json?.thread_coverage_score || 0);
  const branchCoverageScore = Number(qualityReport?.quality_json?.branch_coverage_score || 0);
  const diagramDepthScore = Number(qualityReport?.quality_json?.diagram_depth_score || 0);
  const frontBackendBindingScore = Number(qualityReport?.quality_json?.front_backend_binding_score || 0);
  const domainModelScore = Number(qualityReport?.quality_json?.domain_model_score || 0);
  const behaviorThreadScore = Number(qualityReport?.quality_json?.behavior_thread_score || 0);
  const boundedContextScore = Number(qualityReport?.quality_json?.bounded_context_score || 0);
  const businessReadabilityScore = Number(qualityReport?.quality_json?.business_readability_score || 0);
  const queryBusinessHitScore = Number(qualityReport?.quality_json?.query_business_hit_score || 0);
  const noisePenalty = Number(qualityReport?.quality_json?.noise_penalty || 0);
  const depthScore = Number(((threadCoverageScore + branchCoverageScore + diagramDepthScore + frontBackendBindingScore + behaviorThreadScore) / 5).toFixed(2));
  const domainScore = Number(((domainModelScore + boundedContextScore + businessReadabilityScore + queryBusinessHitScore) / 4).toFixed(2));
  const finalScore = Number(Math.max(0, ((structuralScore * 0.35) + (retrievalScore * 0.15) + (depthScore * 0.2) + (domainScore * 0.3) - noisePenalty)).toFixed(2));
  return [{
    snapshot_id: snapshotId,
    target_type: 'snapshot',
    target_id: null,
    business_completeness_score: serviceScore,
    architecture_coherence_score: relationScore,
    data_contract_score: tableScore,
    test_alignment_score: apiScore,
    flow_executability_score: relationScore,
    evidence_trust_score: evidenceScore,
    final_score: finalScore,
    status: qualityReport.status || 'draft',
    detail_json: {
      ...(qualityReport.quality_json || {}),
      structural_score: structuralScore,
      retrieval_grounding_score: retrievalScore,
      depth_score: depthScore,
      domain_score: domainScore,
    },
  }];
}

async function getDeepWikiRunProjectionMap(runIds = []) {
  const ids = uniqueStrings((runIds || []).map((item) => Number(item)).filter((item) => Number.isFinite(item)).map(String))
    .map((item) => Number(item));
  if (!ids.length) return new Map();
  const placeholders = ids.map(() => '?').join(', ');
  const rows = await query(
    `SELECT s.run_id,
            s.id AS snapshot_row_id,
            s.project_id,
            s.branch AS snapshot_branch,
            s.commit_sha AS snapshot_commit_sha,
            s.snapshot_version,
            s.publish_status AS status,
            s.publish_status,
            s.quality_status,
            s.published_at,
            p.project_code,
            p.project_name,
            qr.id AS quality_report_id,
            qr.status AS quality_report_status,
            qr.schema_pass_rate,
            qr.evidence_coverage_rate,
            qr.core_service_coverage_rate,
            qr.core_api_contract_rate,
            qr.core_table_field_coverage_rate,
            qr.relation_connectivity_rate,
            qr.quality_json
     FROM gateway_wiki_snapshots s
     INNER JOIN gateway_wiki_projects p ON p.id = s.project_id
     LEFT JOIN gateway_wiki_quality_reports qr ON qr.snapshot_id = s.id
     WHERE s.run_id IN (${placeholders})`,
    ids
  );
  const map = new Map();
  rows.forEach((row) => {
    map.set(Number(row.run_id), {
      project_id: Number(row.project_id),
      project_code: row.project_code,
      project_name: row.project_name,
      branch: row.snapshot_branch || null,
      commit_sha: row.snapshot_commit_sha || null,
      snapshot_version: row.snapshot_version || null,
      status: row.status || null,
      publish_status: row.publish_status || null,
      quality_status: row.quality_status || null,
      published_at: row.published_at || null,
      quality_report: row.quality_report_id
        ? mapWikiQualityReportRow({
            id: row.quality_report_id,
            project_id: row.project_id,
            snapshot_id: row.snapshot_row_id,
            run_id: row.run_id,
            status: row.quality_report_status,
            schema_pass_rate: row.schema_pass_rate,
            evidence_coverage_rate: row.evidence_coverage_rate,
            core_service_coverage_rate: row.core_service_coverage_rate,
            core_api_contract_rate: row.core_api_contract_rate,
            core_table_field_coverage_rate: row.core_table_field_coverage_rate,
            relation_connectivity_rate: row.relation_connectivity_rate,
            quality_json: row.quality_json,
          })
        : null,
    });
  });
  return map;
}

async function getDeepWikiPageContent(runId, pageId) {
  const [row] = await query(
    'SELECT * FROM gateway_deepwiki_pages WHERE run_id = ? AND id = ? LIMIT 1',
    [Number(runId), Number(pageId)]
  );
  const page = mapDeepWikiPageRow(row);
  if (!page) return null;
  return {
    ...page,
    content: readTextIfExists(page.source_uri) || '',
  };
}

async function listDeepWikiRuns(filters = {}) {
  const where = [];
  const params = [];
  if (filters.repo_source_id) {
    where.push('r.repo_source_id = ?');
    params.push(Number(filters.repo_source_id));
  }
  const rows = await query(
    `SELECT r.*,
            s.repo_url,
            s.repo_slug,
            p.pipeline_key,
            pr.project_code,
            rs.branch,
            rs.commit_sha,
            COALESCE(pc.page_count, 0) AS page_count,
            COALESCE(pc.ingested_page_count, 0) AS ingested_page_count
     FROM gateway_deepwiki_runs r
     INNER JOIN gateway_repo_sources s ON s.id = r.repo_source_id
     LEFT JOIN gateway_repo_snapshots rs ON rs.id = r.snapshot_id
     LEFT JOIN gateway_pipeline_runs pr ON pr.id = r.pipeline_run_id
     LEFT JOIN gateway_pipeline_definitions p ON p.id = pr.pipeline_definition_id
     LEFT JOIN (
       SELECT run_id,
              COUNT(*) AS page_count,
              SUM(CASE WHEN ingest_status = 'ready' THEN 1 ELSE 0 END) AS ingested_page_count
       FROM gateway_deepwiki_pages
       GROUP BY run_id
     ) pc ON pc.run_id = r.id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY r.updated_at DESC, r.id DESC
     LIMIT 100`
    ,
    params
  );
  const baseRows = rows.map((row) => ({
    ...mapDeepWikiRunRow(row),
    page_count: Number(row.page_count || 0),
    ingested_page_count: Number(row.ingested_page_count || 0),
    project_code: row.project_code || null,
    repo_url: row.repo_url,
    repo_slug: row.repo_slug,
    branch: row.branch || null,
    commit_sha: row.commit_sha || null,
    pipeline_key: row.pipeline_key || null,
    research_provider: normalizeText(parseJson(row.summary_json, {})?.research_provider) || 'qwen_dashscope_native',
    research_model: normalizeText(parseJson(row.summary_json, {})?.research_model),
    output_profile: normalizeText(parseJson(row.summary_json, {})?.output_profile) || 'engineering_architecture_pack',
    diagram_profile: normalizeText(parseJson(row.summary_json, {})?.diagram_profile) || 'full',
    diagram_count: Number(parseJson(row.summary_json, {})?.manifest?.diagram_count || 0),
  }));
  const projectionMap = await getDeepWikiRunProjectionMap(baseRows.map((item) => item.id));
  return baseRows.map((item) => {
    const projection = projectionMap.get(Number(item.id)) || {};
    return {
      ...item,
      project_id: projection.project_id || null,
      project_code: projection.project_code || item.project_code || null,
      project_name: projection.project_name || null,
      branch: projection.branch || item.branch || null,
      commit_sha: projection.commit_sha || item.commit_sha || null,
      snapshot_version: projection.snapshot_version || null,
      publish_status: projection.publish_status || null,
      quality_status: projection.quality_status || null,
      quality_report: projection.quality_report || null,
    };
  });
}

async function listDeepWikiRepos() {
  const [repoRows, runRows] = await Promise.all([
    query(
      `SELECT *
       FROM gateway_repo_sources
       WHERE status = 'active'
       ORDER BY updated_at DESC, id DESC`
    ),
    query(
      `SELECT r.id,
              r.repo_source_id,
              r.trace_id,
              r.status,
              r.current_stage,
              r.updated_at,
              rs.branch,
              rs.commit_sha,
              COALESCE(pc.page_count, 0) AS page_count,
              COALESCE(pc.ingested_page_count, 0) AS ingested_page_count
       FROM gateway_deepwiki_runs r
       LEFT JOIN gateway_repo_snapshots rs ON rs.id = r.snapshot_id
       LEFT JOIN (
         SELECT run_id,
                COUNT(*) AS page_count,
                SUM(CASE WHEN ingest_status = 'ready' THEN 1 ELSE 0 END) AS ingested_page_count
         FROM gateway_deepwiki_pages
         GROUP BY run_id
       ) pc ON pc.run_id = r.id
       ORDER BY r.id DESC`
    ),
  ]);

  const runsByRepoSourceId = new Map();
  runRows.forEach((row) => {
    const key = Number(row.repo_source_id);
    const bucket = runsByRepoSourceId.get(key) || [];
    bucket.push({
      id: Number(row.id),
      trace_id: row.trace_id,
      status: row.status,
      current_stage: row.current_stage,
      updated_at: row.updated_at,
      branch: row.branch || null,
      commit_sha: row.commit_sha || null,
      page_count: Number(row.page_count || 0),
      ingested_page_count: Number(row.ingested_page_count || 0),
    });
    runsByRepoSourceId.set(key, bucket);
  });

  return repoRows.map((row) => {
    const repo = mapRepoSourceRow(row);
    const runs = runsByRepoSourceId.get(repo.id) || [];
    const latestRun = runs[0] || null;
    const latestPreflight = parseJson(repo.metadata_json?.latest_preflight, {});
    const branches = uniqueStrings([
      ...(Array.isArray(latestPreflight?.available_branches)
        ? latestPreflight.available_branches.map((item) => normalizeText(item)).filter(Boolean)
        : []),
      ...runs.map((item) => item.branch).filter(Boolean),
      repo.default_branch,
    ]);
    return {
      ...repo,
      sync_config: normalizeDeepWikiSyncMetadata(repo.metadata_json?.sync, {}),
      latest_run: latestRun,
      run_count: runs.length,
      branch_count: branches.length,
      available_branches: branches,
    };
  });
}

async function getDeepWikiRunById(id) {
  const run = await getDeepWikiRunRecord(id);
  if (!run) return null;
  const [repoSource, snapshot, pages, pipelineRunRows, runNodes, docBundles, graphSummary, projectionMap, generationJobRows] = await Promise.all([
    getRepoSourceById(run.repo_source_id),
    run.snapshot_id ? getRepoSnapshotById(run.snapshot_id) : Promise.resolve(null),
    listDeepWikiPages(run.id),
    run.pipeline_run_id ? query('SELECT * FROM gateway_pipeline_runs WHERE id = ? LIMIT 1', [run.pipeline_run_id]) : Promise.resolve([]),
    run.pipeline_run_id
      ? query('SELECT * FROM gateway_run_nodes WHERE pipeline_run_id = ? ORDER BY id ASC', [run.pipeline_run_id])
      : Promise.resolve([]),
    listDocBundlesByDeepWikiRunId(run.id),
    getDeepWikiKnowledgeGraphSummary(run.id),
    getDeepWikiRunProjectionMap([run.id]),
    query('SELECT * FROM gateway_wiki_generation_jobs WHERE run_id = ? ORDER BY id DESC', [run.id]),
  ]);
  const projection = projectionMap.get(Number(run.id)) || {};

  return {
    ...run,
    repo_source: repoSource,
    snapshot,
    pipeline_run: pipelineRunRows[0] || null,
    nodes: runNodes,
    pages,
    doc_bundles: docBundles,
    project_id: projection.project_id || null,
    project_code: projection.project_code || run.project_code || null,
    project_name: projection.project_name || null,
    branch: projection.branch || snapshot?.branch || run.branch || null,
    commit_sha: projection.commit_sha || snapshot?.commit_sha || run.commit_sha || null,
    snapshot_version: projection.snapshot_version || null,
    publish_status: projection.publish_status || null,
    quality_status: projection.quality_status || null,
    quality_report: projection.quality_report || null,
    generation_jobs: generationJobRows.map(mapWikiGenerationJobRow),
    object_counts: graphSummary.object_counts,
    evidence_coverage: graphSummary.evidence_coverage,
    relation_counts: graphSummary.relation_counts,
  };
}

async function listDeepWikiProjects() {
  const rows = await query(
    `SELECT p.*,
            COUNT(DISTINCT pr.repo_source_id) AS repo_count,
            COUNT(DISTINCT s.id) AS snapshot_count,
            COUNT(DISTINCT s.branch) AS branch_count,
            COUNT(DISTINCT b.id) AS version_line_count,
            (
              SELECT snapshot.id
              FROM gateway_wiki_snapshots snapshot
              WHERE snapshot.project_id = p.id AND snapshot.publish_status = 'published'
              ORDER BY snapshot.id DESC
              LIMIT 1
            ) AS latest_published_snapshot_id,
            (
              SELECT snapshot.branch
              FROM gateway_wiki_snapshots snapshot
              WHERE snapshot.project_id = p.id AND snapshot.publish_status = 'published'
              ORDER BY snapshot.id DESC
              LIMIT 1
            ) AS latest_published_snapshot_branch,
            (
              SELECT snapshot.commit_sha
              FROM gateway_wiki_snapshots snapshot
              WHERE snapshot.project_id = p.id AND snapshot.publish_status = 'published'
              ORDER BY snapshot.id DESC
              LIMIT 1
            ) AS latest_published_snapshot_commit_sha,
            (
              SELECT snapshot.snapshot_version
              FROM gateway_wiki_snapshots snapshot
              WHERE snapshot.project_id = p.id AND snapshot.publish_status = 'published'
              ORDER BY snapshot.id DESC
              LIMIT 1
            ) AS latest_published_snapshot_version,
            (
              SELECT snapshot.publish_status
              FROM gateway_wiki_snapshots snapshot
              WHERE snapshot.project_id = p.id AND snapshot.publish_status = 'published'
              ORDER BY snapshot.id DESC
              LIMIT 1
            ) AS latest_published_snapshot_status,
            (
              SELECT snapshot.quality_status
              FROM gateway_wiki_snapshots snapshot
              WHERE snapshot.project_id = p.id AND snapshot.publish_status = 'published'
              ORDER BY snapshot.id DESC
              LIMIT 1
            ) AS latest_published_snapshot_quality_status,
            (
              SELECT branch.id
              FROM gateway_wiki_branches branch
              WHERE branch.project_id = p.id
                AND branch.branch_name = (
                  SELECT snapshot.branch
                  FROM gateway_wiki_snapshots snapshot
                  WHERE snapshot.project_id = p.id AND snapshot.publish_status = 'published'
                  ORDER BY snapshot.id DESC
                  LIMIT 1
                )
              LIMIT 1
            ) AS latest_published_snapshot_version_line_id,
            (
              SELECT COALESCE(branch.display_name, branch.branch_name)
              FROM gateway_wiki_branches branch
              WHERE branch.project_id = p.id
                AND branch.branch_name = (
                  SELECT snapshot.branch
                  FROM gateway_wiki_snapshots snapshot
                  WHERE snapshot.project_id = p.id AND snapshot.publish_status = 'published'
                  ORDER BY snapshot.id DESC
                  LIMIT 1
                )
              LIMIT 1
            ) AS latest_published_snapshot_version_line_display_name,
            (
              SELECT snapshot.published_at
              FROM gateway_wiki_snapshots snapshot
              WHERE snapshot.project_id = p.id AND snapshot.publish_status = 'published'
              ORDER BY snapshot.id DESC
              LIMIT 1
            ) AS latest_published_snapshot_published_at
     FROM gateway_wiki_projects p
     LEFT JOIN gateway_wiki_project_repos pr ON pr.project_id = p.id
     LEFT JOIN gateway_wiki_snapshots s ON s.project_id = p.id
     LEFT JOIN gateway_wiki_branches b ON b.project_id = p.id
     GROUP BY p.id
     ORDER BY p.updated_at DESC, p.id DESC`
  );
  return rows.map((row) => {
    const {
      latest_published_snapshot_id,
      latest_published_snapshot_branch,
      latest_published_snapshot_commit_sha,
      latest_published_snapshot_version,
      latest_published_snapshot_status,
      latest_published_snapshot_quality_status,
      latest_published_snapshot_version_line_id,
      latest_published_snapshot_version_line_display_name,
      latest_published_snapshot_published_at,
      ...projectRow
    } = row;
    const latestPublishedSnapshot = row.latest_published_snapshot_id
      ? {
          id: Number(row.latest_published_snapshot_id),
          branch: row.latest_published_snapshot_branch || null,
          commit_sha: row.latest_published_snapshot_commit_sha || null,
          snapshot_version: row.latest_published_snapshot_version || null,
          status: row.latest_published_snapshot_status || 'published',
          publish_status: 'published',
          quality_status: row.latest_published_snapshot_quality_status || null,
          version_line_id: row.latest_published_snapshot_version_line_id != null
            ? Number(row.latest_published_snapshot_version_line_id)
            : null,
          version_line_display_name:
            row.latest_published_snapshot_version_line_display_name ||
            row.latest_published_snapshot_branch ||
            null,
          published_at: row.latest_published_snapshot_published_at || null,
        }
      : null;
    return {
      ...mapWikiProjectRow(projectRow),
      repo_count: Number(row.repo_count || 0),
      snapshot_count: Number(row.snapshot_count || 0),
      branch_count: Number(row.branch_count || 0),
      version_line_count: Number(row.version_line_count || row.branch_count || 0),
      latest_published_snapshot: latestPublishedSnapshot,
      latest_published_snapshot_summary: latestPublishedSnapshot,
    };
  });
}

async function getDeepWikiSnapshotRecord(snapshotId) {
  const [row] = await query(
    `SELECT s.*,
            b.id AS version_line_id,
            b.branch_name AS version_line_name,
            b.display_name AS version_line_display_name
     FROM gateway_wiki_snapshots s
     LEFT JOIN gateway_wiki_branches b
       ON b.project_id = s.project_id
      AND b.branch_name = s.branch
     WHERE s.id = ?
     LIMIT 1`,
    [Number(snapshotId)]
  );
  if (!row) return null;
  const snapshot = mapWikiSnapshotRow(row);
  return {
    ...snapshot,
    version_line_id: row.version_line_id != null ? Number(row.version_line_id) : null,
    version_line_name: row.version_line_name || snapshot.branch,
    version_line_display_name: row.version_line_display_name || row.version_line_name || snapshot.branch,
  };
}

async function listDeepWikiProjectSnapshots(projectId, filters = {}) {
  const where = ['s.project_id = ?'];
  const params = [Number(projectId)];
  if (normalizeText(filters.branch)) {
    where.push('s.branch = ?');
    params.push(normalizeText(filters.branch));
  }
  if (filters.version_line_id) {
    where.push('b.id = ?');
    params.push(Number(filters.version_line_id));
  }
  const rows = await query(
    `SELECT s.*,
            b.id AS version_line_id,
            b.branch_name AS version_line_name,
            b.display_name AS version_line_display_name,
            rs.repo_slug,
            rs.repo_url,
            dr.status AS run_status,
            dr.current_stage AS run_current_stage,
            dr.trace_id,
            qr.id AS quality_report_id,
            qr.status AS quality_report_status,
            qr.schema_pass_rate,
            qr.evidence_coverage_rate,
            qr.core_service_coverage_rate,
            qr.core_api_contract_rate,
            qr.core_table_field_coverage_rate,
            qr.relation_connectivity_rate,
            qr.quality_json
     FROM gateway_wiki_snapshots s
     LEFT JOIN gateway_wiki_branches b
       ON b.project_id = s.project_id
      AND b.branch_name = s.branch
     INNER JOIN gateway_repo_sources rs ON rs.id = s.repo_source_id
     LEFT JOIN gateway_deepwiki_runs dr ON dr.id = s.run_id
     LEFT JOIN gateway_wiki_quality_reports qr ON qr.snapshot_id = s.id
     WHERE ${where.join(' AND ')}
     ORDER BY
       CASE WHEN s.publish_status = 'published' THEN 0 ELSE 1 END ASC,
       CASE WHEN s.publish_status = 'published' THEN s.published_at ELSE NULL END DESC,
       s.updated_at DESC,
       s.id DESC`,
    params
  );
  return rows.map((row) => {
    const mapped = mapWikiSnapshotRow(row);
    return {
    ...mapped,
    version_line_id: row.version_line_id != null ? Number(row.version_line_id) : null,
    version_line_name: row.version_line_name || mapped.branch,
    version_line_display_name: row.version_line_display_name || row.version_line_name || mapped.branch,
    repo_slug: row.repo_slug,
    repo_url: row.repo_url,
    run_status: row.run_status || null,
    current_stage: row.run_current_stage || null,
    trace_id: row.trace_id || null,
    quality_report: row.quality_report_id
      ? mapWikiQualityReportRow({
          id: row.quality_report_id,
          project_id: row.project_id,
          snapshot_id: row.id,
          run_id: row.run_id,
          status: row.quality_report_status,
          schema_pass_rate: row.schema_pass_rate,
          evidence_coverage_rate: row.evidence_coverage_rate,
          core_service_coverage_rate: row.core_service_coverage_rate,
          core_api_contract_rate: row.core_api_contract_rate,
          core_table_field_coverage_rate: row.core_table_field_coverage_rate,
          relation_connectivity_rate: row.relation_connectivity_rate,
          quality_json: row.quality_json,
        })
      : null,
    page_status: row.quality_status || null,
  };
  });
}

async function listDeepWikiProjectBranches(projectId) {
  const project = await getDeepWikiProjectByIdRecord(projectId);
  if (!project) return null;
  const bindings = await getDeepWikiProjectRepoBindings(projectId);
  const branchRows = await query(
    `SELECT *
     FROM gateway_wiki_branches
     WHERE project_id = ?
     ORDER BY branch_name ASC`,
    [Number(projectId)]
  );
  const snapshots = await listDeepWikiProjectSnapshots(projectId);
  const branchMap = new Map();

  branchRows.map(mapWikiBranchRow).forEach((branchRow) => {
    branchMap.set(branchRow.branch_name, {
      id: Number(branchRow.id),
      project_id: Number(project.id),
      branch: branchRow.branch_name,
      display_name: branchRow.display_name || branchRow.branch_name,
      status: branchRow.status,
      metadata_json: branchRow.metadata_json || {},
      repo_source_ids: [],
      repo_slugs: [],
      snapshot_count: 0,
      latest_snapshot: null,
      published_snapshot: null,
      last_generated_commit: null,
      repo_mappings: [],
    });
  });

  bindings.forEach((binding) => {
    const repoSource = binding.repo_source || {};
    const latestPreflight = getRecordLike(repoSource.metadata_json?.latest_preflight, {});
    const availableBranches = uniqueStrings([
      ...(Array.isArray(latestPreflight.available_branches) ? latestPreflight.available_branches : []),
      normalizeText(binding.metadata_json?.default_branch),
      normalizeText(repoSource.default_branch),
    ]);
    availableBranches.forEach((branch) => {
      if (!branchMap.has(branch)) {
        branchMap.set(branch, {
          id: null,
          project_id: Number(project.id),
          branch,
          display_name: branch,
          status: 'active',
          metadata_json: {},
          repo_source_ids: [],
          repo_slugs: [],
          snapshot_count: 0,
          latest_snapshot: null,
          published_snapshot: null,
          last_generated_commit: null,
          repo_mappings: [],
        });
      }
      const entry = branchMap.get(branch);
      entry.repo_source_ids = uniqueStrings([...entry.repo_source_ids, String(repoSource.id)]).map(Number);
      entry.repo_slugs = uniqueStrings([...entry.repo_slugs, repoSource.repo_slug]);
    });
  });

  snapshots.forEach((snapshot) => {
    const branch = normalizeText(snapshot.branch);
    if (!branchMap.has(branch)) {
      branchMap.set(branch, {
        id: null,
        project_id: Number(project.id),
        branch,
        display_name: branch,
        status: 'active',
        metadata_json: {},
        repo_source_ids: [Number(snapshot.repo_source_id)],
        repo_slugs: [snapshot.repo_slug],
        snapshot_count: 0,
        latest_snapshot: null,
        published_snapshot: null,
        last_generated_commit: null,
        repo_mappings: [],
      });
    }
    const entry = branchMap.get(branch);
    entry.snapshot_count += 1;
    entry.repo_source_ids = uniqueStrings([...entry.repo_source_ids, String(snapshot.repo_source_id)]).map(Number);
    entry.repo_slugs = uniqueStrings([...entry.repo_slugs, snapshot.repo_slug]);
    if (!entry.latest_snapshot) {
      entry.latest_snapshot = snapshot;
      entry.last_generated_commit = snapshot.commit_sha;
    }
    if (!entry.published_snapshot && isPublishedSnapshot(snapshot)) {
      entry.published_snapshot = snapshot;
    }
  });

  for (const entry of branchMap.values()) {
    if (entry.id) {
      entry.repo_mappings = await listDeepWikiBranchRepoMappings(entry.id);
    }
  }

  return {
    project_id: Number(project.id),
    project_code: project.project_code,
    default_branch: project.default_branch || 'main',
    branches: Array.from(branchMap.values()).sort((a, b) => a.branch.localeCompare(b.branch, 'zh-Hans-CN')),
  };
}

async function listDeepWikiVersionLines(projectId) {
  const result = await listDeepWikiProjectBranches(projectId);
  if (!result) return null;
  const branches = Array.isArray(result.branches) ? result.branches : [];
  return {
    project_id: result.project_id,
    project_code: result.project_code,
    default_version_line: result.default_branch,
    version_lines: branches
      .filter((branch) => branch.id != null)
      .map((branch) => ({
        ...branch,
        version_line_name: branch.branch,
        branch_name: branch.branch,
      })),
    diagnostic_version_lines: branches
      .filter((branch) => branch.id == null)
      .map((branch) => ({
        ...branch,
        version_line_name: branch.branch,
        branch_name: branch.branch,
      })),
  };
}

async function createDeepWikiVersionLine(projectId, data = {}) {
  const project = await getDeepWikiProjectByIdRecord(projectId);
  if (!project) return null;
  const branch = await upsertDeepWikiBranch(projectId, data.branch_name || data.version_line_name || data.branch, {
    display_name: data.display_name || data.version_line_name || data.branch_name || data.branch,
    status: data.status || 'active',
    metadata_json: data.metadata_json || {},
  });
  const projectRepos = await getDeepWikiProjectRepoBindings(projectId);
  const repoMappings = Array.isArray(data.repo_mappings) ? data.repo_mappings : [];
  const mappingByProjectRepoId = new Map(
    repoMappings
      .filter((mapping) => Number.isFinite(Number(mapping?.project_repo_id)))
      .map((mapping) => [Number(mapping.project_repo_id), mapping])
  );

  const resolveProjectRepoBranch = (projectRepo, preferredBranch) => {
    const normalizedPreferred = normalizeText(preferredBranch);
    const latestPreflight = getRecordLike(projectRepo?.repo_source?.metadata_json?.latest_preflight, {});
    const availableBranches = Array.isArray(latestPreflight.available_branches)
      ? latestPreflight.available_branches.map((item) => normalizeText(item)).filter(Boolean)
      : [];
    const preferredCandidates = uniqueStrings([
      normalizedPreferred,
      normalizedPreferred ? normalizedPreferred.replace(/_/g, '-') : '',
      normalizedPreferred ? normalizedPreferred.replace(/-/g, '_') : '',
    ]);
    const matchedPreferred = preferredCandidates.find((candidate) => availableBranches.includes(candidate));
    return (
      matchedPreferred ||
      normalizeText(projectRepo?.metadata_json?.default_branch) ||
      normalizeText(projectRepo?.repo_source?.default_branch) ||
      normalizedPreferred
    );
  };

  for (const projectRepo of projectRepos) {
    const mapping = mappingByProjectRepoId.get(Number(projectRepo.id));
    const repoBranchName =
      normalizeText(mapping?.repo_branch_name || mapping?.branch_name) ||
      resolveProjectRepoBranch(projectRepo, branch.branch_name);
    await upsertDeepWikiBranchRepoMapping(Number(branch.id), Number(projectRepo.id), {
      repo_branch_name: repoBranchName,
      metadata_json: mapping?.metadata_json || {},
    });
  }
  const result = await listDeepWikiVersionLines(projectId);
  return result?.version_lines?.find((item) => Number(item.id) === Number(branch.id)) || null;
}

async function ensureDeepWikiProjectDefaultVersionLine(projectId, options = {}) {
  const project = await getDeepWikiProjectByIdRecord(projectId);
  if (!project) return null;
  const existing = await listDeepWikiVersionLines(projectId);
  if (!options.force && Array.isArray(existing?.version_lines) && existing.version_lines.length) {
    const preferredBranch = normalizeText(options.branch_name || project.default_branch);
    return (
      existing.version_lines.find((item) => normalizeText(item.branch) === preferredBranch) ||
      existing.version_lines[0]
    );
  }

  const projectRepos = await getDeepWikiProjectRepoBindings(projectId);
  if (!projectRepos.length) return null;

  const preferredBranch = normalizeText(options.branch_name || project.default_branch);
  if (!preferredBranch) return null;

  const resolveProjectRepoBranch = (projectRepo) => {
    const latestPreflight = getRecordLike(projectRepo?.repo_source?.metadata_json?.latest_preflight, {});
    const availableBranches = Array.isArray(latestPreflight.available_branches)
      ? latestPreflight.available_branches.map((item) => normalizeText(item)).filter(Boolean)
      : [];
    const preferredCandidates = uniqueStrings([
      preferredBranch,
      preferredBranch.replace(/_/g, '-'),
      preferredBranch.replace(/-/g, '_'),
    ]);
    const matchedPreferred = preferredCandidates.find((candidate) => availableBranches.includes(candidate));
    return (
      matchedPreferred ||
      normalizeText(projectRepo.metadata_json?.default_branch) ||
      normalizeText(projectRepo.repo_source?.default_branch) ||
      preferredBranch
    );
  };

  const payload = {
    branch_name: preferredBranch,
    display_name: normalizeText(options.display_name) || preferredBranch,
    metadata_json: {
      source: options.source || 'auto_init_default_version_line',
    },
    repo_mappings: projectRepos.map((projectRepo) => ({
      project_repo_id: Number(projectRepo.id),
      repo_branch_name: resolveProjectRepoBranch(projectRepo),
    })),
  };
  return createDeepWikiVersionLine(projectId, payload);
}

async function getDeepWikiVersionLineById(versionLineId) {
  const [branch] = await query(
    `SELECT *
     FROM gateway_wiki_branches
     WHERE id = ?
     LIMIT 1`,
    [Number(versionLineId)]
  );
  if (!branch) return null;
  const result = await listDeepWikiVersionLines(Number(branch.project_id));
  return result?.version_lines?.find((item) => Number(item.id) === Number(versionLineId)) || null;
}

async function listDeepWikiSnapshotsByVersionLine(versionLineId) {
  const [branch] = await query('SELECT * FROM gateway_wiki_branches WHERE id = ? LIMIT 1', [Number(versionLineId)]);
  if (!branch) return null;
  return listDeepWikiProjectSnapshots(Number(branch.project_id), {
    branch: branch.branch_name,
    version_line_id: Number(versionLineId),
  });
}

async function getDeepWikiProjectById(id) {
  const project = await getDeepWikiProjectByIdRecord(id);
  if (!project) return null;
  const [repos, versionLineResult, snapshots, jobs, sourceBindings] = await Promise.all([
    getDeepWikiProjectRepoBindings(id),
    listDeepWikiVersionLines(id),
    listDeepWikiProjectSnapshots(id),
    query(
      `SELECT *
       FROM gateway_wiki_generation_jobs
       WHERE project_id = ?
       ORDER BY created_at DESC, id DESC
      LIMIT 30`,
      [Number(id)]
    ),
    listDeepWikiProjectSourceBindings(id).catch(() => []),
  ]);
  const latestPublishedSnapshot = pickPublishedSnapshot(snapshots);
  return {
    ...project,
    repos,
    branches: versionLineResult?.version_lines || [],
    version_lines: versionLineResult?.version_lines || [],
    diagnostic_version_lines: versionLineResult?.diagnostic_version_lines || [],
    version_line_count: Array.isArray(versionLineResult?.version_lines) ? versionLineResult.version_lines.length : 0,
    snapshots,
    generation_jobs: jobs.map(mapWikiGenerationJobRow),
    latest_snapshot: snapshots[0] || null,
    latest_published_snapshot: latestPublishedSnapshot,
    source_bindings: sourceBindings,
  };
}

async function getDeepWikiProjectDefaultPublishedSnapshot(projectId, branch = '') {
  const rows = await listDeepWikiProjectSnapshots(projectId, {
    branch: normalizeText(branch) || null,
  });
  return pickPublishedSnapshot(rows);
}

const DEEPWIKI_PROJECT_PAGE_ORDER = [
  '00-overview',
  '01-architecture-backbone',
  '03-product-architecture',
  '04-business-domain',
  '05-db-schema-and-data-model',
  '06-core-flows',
  '07-key-sequence-diagrams',
  '08-module-flow',
];

function compareTuple(left = [], right = []) {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const leftValue = left[index] ?? '';
    const rightValue = right[index] ?? '';
    if (leftValue === rightValue) continue;
    if (typeof leftValue === 'number' && typeof rightValue === 'number') {
      return leftValue - rightValue;
    }
    return String(leftValue).localeCompare(String(rightValue));
  }
  return 0;
}

function buildDeepWikiPageSortTuple(page = {}) {
  const slug = normalizeText(page.page_slug);
  const projectIndex = DEEPWIKI_PROJECT_PAGE_ORDER.indexOf(slug);
  if (projectIndex >= 0) {
    return [0, projectIndex];
  }
  const parts = slug.split('/').filter(Boolean);
  const threadIndex = parts.indexOf('10-threads');
  if (threadIndex >= 0) {
    const domainKey = parts[1] || '';
    const threadKey = parts[threadIndex + 1] || '';
    const pageLeaf = parts[threadIndex + 2] || '';
    const threadBase = threadKey
      .replace(/-branch-\d+$/i, '')
      .replace(/-exception-\d+$/i, '');
    const threadRank = /-exception-\d+$/i.test(threadKey) ? 2 : /-branch-\d+$/i.test(threadKey) ? 1 : 0;
    const pageRank = /^00-/.test(pageLeaf) ? 0 : /^01-/.test(pageLeaf) ? 1 : 9;
    return [2, domainKey, threadBase, threadRank, threadKey, pageRank, slug];
  }
  if (slug.startsWith('10-domains/')) {
    const domainKey = parts[1] || '';
    const pageLeaf = parts[2] || '';
    const pageRank = /^00-/.test(pageLeaf) ? 0 : /^01-/.test(pageLeaf) ? 1 : 9;
    return [1, domainKey, pageRank, slug];
  }
  return [3, slug];
}

async function listDeepWikiPagesBySnapshotId(snapshotId) {
  const snapshot = await getDeepWikiSnapshotRecord(snapshotId);
  if (!snapshot?.run_id) return [];
  const rows = await query(
    `SELECT p.*
     FROM gateway_deepwiki_pages p
     INNER JOIN gateway_wiki_snapshots s ON s.run_id = p.run_id
     WHERE s.id = ?
     ORDER BY p.page_slug ASC, p.id ASC`,
    [Number(snapshotId)]
  );
  return rows
    .map(mapDeepWikiPageRow)
    .sort((left, right) => compareTuple(buildDeepWikiPageSortTuple(left), buildDeepWikiPageSortTuple(right)));
}

async function getDeepWikiPageContentBySnapshotId(snapshotId, pageId) {
  const [row] = await query(
    `SELECT p.*
     FROM gateway_deepwiki_pages p
     INNER JOIN gateway_wiki_snapshots s ON s.run_id = p.run_id
     WHERE s.id = ? AND p.id = ?
     LIMIT 1`,
    [Number(snapshotId), Number(pageId)]
  );
  const page = mapDeepWikiPageRow(row);
  if (!page) return null;
  return {
    ...page,
    content: readTextIfExists(page.source_uri) || '',
  };
}

function buildAutoSupplementedPrdMarkdown({ project, snapshot, repoRevisions, pages, diagrams, qualityReport }) {
  const snapshotLabel = normalizeText(snapshot?.snapshot_version) || normalizeText(snapshot?.commit_sha) || `snapshot-${snapshot?.id}`;
  const inventory = qualityReport?.quality_json?.inventory_summary || {};
  const featurePages = pages
    .filter((page) => !['diagram', 'graph'].includes(normalizeText(page.page_type)))
    .slice(0, 12)
    .map((page) => `- ${page.title || page.page_slug}`);
  const importantDiagrams = diagrams
    .filter((diagram) => ['business_flow', 'core_logic', 'technical_architecture', 'product_architecture'].includes(normalizeDeepWikiDiagramType(diagram.diagram_type, 'overview')))
    .map((diagram) => `- ${diagram.title || diagram.diagram_type}${diagram.summary ? `：${diagram.summary}` : ''}`);
  const repoLines = repoRevisions.map((repo) => `- ${repo.repo_role || 'repo'} · ${repo.repo_slug} · ${repo.branch_name || repo.branch || '-'} @ ${repo.commit_sha || '-'}`);
  return [
    `# ${project?.project_name || project?.project_code || '项目'} 自动补全产品方案`,
    '',
    '> 本文档由 DeepWiki 根据当前代码快照自动补全生成，作为 code-first 场景下的正式产品基线；后续若补充人工 PRD，可按版本覆盖。',
    '',
    '## 1. 当前基线',
    `- 项目：${project?.project_name || '-'}`,
    `- 项目编码：${project?.project_code || '-'}`,
    `- 版本线：${snapshot?.version_line_display_name || snapshot?.version_line_name || snapshot?.branch || '-'}`,
    `- Snapshot：${snapshotLabel}`,
    '',
    '## 2. 已识别代码输入',
    ...(repoLines.length ? repoLines : ['- 暂无代码修订记录']),
    '',
    '## 3. 系统能力盘点',
    `- 模块数：${inventory.module_count || 0}`,
    `- 接口数：${inventory.api_count || 0}`,
    `- 表数：${inventory.table_count || 0}`,
    `- 测试文件数：${inventory.test_file_count || 0}`,
    '',
    '## 4. 自动识别的页面/能力范围',
    ...(featurePages.length ? featurePages : ['- 暂未从页面中提取到可读能力']),
    '',
    '## 5. 业务流程与架构线索',
    ...(importantDiagrams.length ? importantDiagrams : ['- 当前尚未生成可用图表，建议补跑 diagram/context 链路']),
    '',
    '## 6. 业务目标',
    '- 基于当前代码实现还原主要业务对象、操作入口、关键接口与数据持久化关系。',
    '- 为后续技术方案、测试方案和代码生成提供最小可用的产品上下文。',
    '',
    '## 7. 待确认事项',
    '- 需补充真实业务目标、角色边界、关键公式与异常处理规则。',
    '- 若后续上传正式 PRD，应以正式文档为准并覆盖当前自动补全基线。',
    '',
  ].join('\n');
}

function buildAutoSupplementedBizSpecMarkdown({ project, snapshot, diagrams, pages }) {
  const snapshotLabel = normalizeText(snapshot?.snapshot_version) || normalizeText(snapshot?.commit_sha) || `snapshot-${snapshot?.id}`;
  const processDiagrams = diagrams
    .filter((diagram) => ['business_flow', 'module_flow', 'core_logic'].includes(normalizeDeepWikiDiagramType(diagram.diagram_type, 'overview')))
    .map((diagram) => `- ${diagram.title || diagram.diagram_type}${diagram.summary ? `：${diagram.summary}` : ''}`);
  const modulePages = pages
    .filter((page) => normalizeText(page.page_type) === 'module')
    .slice(0, 12)
    .map((page) => `- ${page.title || page.page_slug}`);
  return [
    `# ${project?.project_name || project?.project_code || '项目'} 自动补全业务流程基线`,
    '',
    '> 本文档由 DeepWiki 根据当前代码快照自动生成，作为缺少业务方案时的正式业务流程基线。',
    '',
    '## 1. 适用范围',
    `- 项目：${project?.project_name || '-'}`,
    `- Snapshot：${snapshotLabel}`,
    '',
    '## 2. 主流程线索',
    ...(processDiagrams.length ? processDiagrams : ['- 当前尚未抽取出可靠流程图，建议重跑高质量 diagram/context 生成']),
    '',
    '## 3. 模块拆分',
    ...(modulePages.length ? modulePages : ['- 当前模块页面不足，建议补充页面摘要或重新生成模块页']),
    '',
    '## 4. 核心规则待补齐',
    '- 状态流转条件',
    '- 核心业务公式与金额/数量计算',
    '- 关键接口入参与返回约束',
    '- 表级/字段级约束与异常分支',
    '',
    '## 5. 使用说明',
    '- 本基线用于先行打通技术方案、测试方案链路。',
    '- 后续若补充正式业务方案，应以正式业务方案覆盖当前自动补全基线。',
    '',
  ].join('\n');
}

async function ensureAutoSupplementedSnapshotDocuments(snapshotId) {
  const snapshot = await getDeepWikiSnapshotRecord(Number(snapshotId));
  if (!snapshot) return [];
  const [project, repoRevisions, existingRevisions, pages, diagrams, qualityReport, run] = await Promise.all([
    getDeepWikiProjectByIdRecord(Number(snapshot.project_id)),
    listDeepWikiSnapshotRepoRevisions(Number(snapshotId)).catch(() => []),
    listDeepWikiSnapshotDocumentRevisions(Number(snapshotId)).catch(() => []),
    listDeepWikiPagesBySnapshotId(Number(snapshotId)).catch(() => []),
    listDeepWikiSnapshotDiagrams(Number(snapshotId)).catch(() => []),
    getDeepWikiQualityReportBySnapshotId(Number(snapshotId)).catch(() => null),
    snapshot.run_id ? getDeepWikiRunById(Number(snapshot.run_id)).catch(() => null) : Promise.resolve(null),
  ]);
  if (!repoRevisions.length) {
    return existingRevisions;
  }
  const outputRoot =
    normalizeText(snapshot.metadata_json?.output_root) ||
    normalizeText(run?.output_root) ||
    path.join(
      getStorageRoot(),
      'deepwiki',
      sanitizePathSegment(project?.project_code || `project-${snapshot.project_id}`),
      sanitizePathSegment(snapshot.snapshot_version || snapshot.commit_sha || String(snapshot.id))
    );
  const autoDir = path.join(outputRoot, 'autofill');
  ensureDir(autoDir);

  const retainedRevisions = existingRevisions.filter(
    (item) => normalizeText(item.metadata_json?.auto_generated_by) !== 'deepwiki_autofill'
  );
  const retainedTypes = new Set(retainedRevisions.map((item) => normalizeDeepWikiSourceType(item.document_type, 'review')));
  const existingAutoRevisions = existingRevisions.filter(
    (item) => normalizeText(item.metadata_json?.auto_generated_by) === 'deepwiki_autofill'
  );
  if (retainedTypes.has('prd') && retainedTypes.has('biz_spec') && !existingAutoRevisions.length) {
    return existingRevisions;
  }
  const nextRevisions = [...retainedRevisions];
  const versionLabel = normalizeText(snapshot.snapshot_version) || normalizeText(snapshot.commit_sha) || null;

  if (!retainedTypes.has('prd')) {
    const prdPath = path.join(autoDir, 'auto-prd.md');
    fs.writeFileSync(
      prdPath,
      buildAutoSupplementedPrdMarkdown({ project, snapshot, repoRevisions, pages, diagrams, qualityReport }),
      'utf8'
    );
    nextRevisions.push({
      document_type: 'prd',
      title: `${project?.project_name || project?.project_code || '项目'} 自动补全产品方案`,
      source_uri: prdPath,
      version_label: versionLabel,
      metadata_json: {
        auto_generated: true,
        auto_generated_by: 'deepwiki_autofill',
        autofill_kind: 'prd',
        snapshot_id: Number(snapshotId),
        origin: 'generated_from_code',
        confidence: 0.72,
        source_snapshot_id: Number(snapshotId),
      },
    });
  }

  if (!retainedTypes.has('biz_spec')) {
    const bizSpecPath = path.join(autoDir, 'auto-biz-spec.md');
    fs.writeFileSync(
      bizSpecPath,
      buildAutoSupplementedBizSpecMarkdown({ project, snapshot, diagrams, pages }),
      'utf8'
    );
    nextRevisions.push({
      document_type: 'biz_spec',
      title: `${project?.project_name || project?.project_code || '项目'} 自动补全业务流程基线`,
      source_uri: bizSpecPath,
      version_label: versionLabel,
      metadata_json: {
        auto_generated: true,
        auto_generated_by: 'deepwiki_autofill',
        autofill_kind: 'biz_spec',
        snapshot_id: Number(snapshotId),
        origin: 'generated_from_code',
        confidence: 0.68,
        source_snapshot_id: Number(snapshotId),
      },
    });
  }

  const normalizedExisting = JSON.stringify(
    existingRevisions.map((item) => ({
      document_type: normalizeDeepWikiSourceType(item.document_type, 'review'),
      title: normalizeText(item.title),
      source_uri: normalizeText(item.source_uri),
      version_label: normalizeText(item.version_label),
      auto_generated_by: normalizeText(item.metadata_json?.auto_generated_by),
    }))
  );
  const normalizedNext = JSON.stringify(
    nextRevisions.map((item) => ({
      document_type: normalizeDeepWikiSourceType(item.document_type, 'review'),
      title: normalizeText(item.title),
      source_uri: normalizeText(item.source_uri),
      version_label: normalizeText(item.version_label),
      auto_generated_by: normalizeText(item.metadata_json?.auto_generated_by),
    }))
  );
  if (normalizedExisting === normalizedNext) {
    return existingRevisions;
  }
  await replaceDeepWikiSnapshotDocumentRevisions(Number(snapshotId), nextRevisions);
  return listDeepWikiSnapshotDocumentRevisions(Number(snapshotId));
}

async function getDeepWikiDiagramContextBySnapshotId(snapshotId) {
  const snapshot = await getDeepWikiSnapshotRecord(snapshotId);
  if (!snapshot?.run_id) return null;
  const run = await getDeepWikiRunById(Number(snapshot.run_id));
  const outputRoot = normalizeText(run?.output_root);
  if (!outputRoot) return null;
  const jsonPath = path.join(outputRoot, 'diagram_context.json');
  const text = readTextIfExists(jsonPath);
  return parseJson(text, null);
}

async function downloadDeepWikiDiagramAssetBySnapshotId(snapshotId, diagramType, format = 'mmd') {
  const diagrams = await listDeepWikiSnapshotDiagrams(snapshotId);
  const normalizedType = normalizeDeepWikiDiagramType(diagramType, diagramType);
  const asset = diagrams.find((item) => normalizeDeepWikiDiagramType(item.diagram_type, 'overview') === normalizedType);
  if (!asset) return null;
  const metadata = asset.metadata_json && typeof asset.metadata_json === 'object' ? asset.metadata_json : {};
  if (format === 'mmd') {
    return {
      filename: `${normalizedType}.mmd`,
      contentType: 'text/plain; charset=utf-8',
      buffer: Buffer.from(String(asset.content || ''), 'utf8'),
    };
  }
  const exportAssets = metadata.export_assets && typeof metadata.export_assets === 'object' ? metadata.export_assets : {};
  if (format === 'svg' && normalizeText(exportAssets.rendered_svg)) {
    return {
      filename: `${normalizedType}.svg`,
      contentType: 'image/svg+xml; charset=utf-8',
      buffer: Buffer.from(String(exportAssets.rendered_svg), 'utf8'),
    };
  }
  if (format === 'png' && normalizeText(exportAssets.rendered_png_base64)) {
    return {
      filename: `${normalizedType}.png`,
      contentType: 'image/png',
      buffer: Buffer.from(String(exportAssets.rendered_png_base64), 'base64'),
    };
  }
  return null;
}

async function computeDeepWikiSnapshotReadiness(snapshotId) {
  const [snapshot, repoRevisions, documentRevisions, diagrams, qualityReport, pages, projection] = await Promise.all([
    getDeepWikiSnapshotRecord(snapshotId),
    listDeepWikiSnapshotRepoRevisions(snapshotId).catch(() => []),
    ensureAutoSupplementedSnapshotDocuments(snapshotId).catch(() => []),
    listDeepWikiSnapshotDiagrams(snapshotId).catch(() => []),
    getDeepWikiQualityReportBySnapshotId(snapshotId).catch(() => null),
    listDeepWikiPagesBySnapshotId(snapshotId).catch(() => []),
    getDeepWikiTemplateProjectionBySnapshotId(snapshotId).catch(() => null),
  ]);
  if (!snapshot) {
    return {
      blockers: ['snapshot_not_found'],
      warnings: [],
    };
  }
  const blockers = [];
  const warnings = [];
  const gateDecisions = Array.isArray(projection?.gateDecisions) ? projection.gateDecisions : [];
  const blockingGateKeys = gateDecisions
    .filter((item) => Boolean(item?.is_blocking))
    .map((item) => item.gate_key || item.reason || 'quality_gate_blocked');
  if (!repoRevisions.length) blockers.push('missing_repo_revisions');
  if (!pages.length) blockers.push('missing_pages');
  const readyDiagramTypes = new Set(
    diagrams
      .filter((item) => item.render_status === 'ready')
      .map((item) => normalizeDeepWikiDiagramType(item.diagram_type, 'overview'))
  );
  if (!diagrams.length || readyDiagramTypes.size < 4) {
    warnings.push('missing_diagram_assets');
  }
  const criticalDiagramTypes = [
    'code_layered_architecture',
    'technical_architecture',
    'business_flow',
    'core_logic',
    'database_er',
  ];
  if (criticalDiagramTypes.some((diagramType) => !readyDiagramTypes.has(diagramType))) {
    warnings.push('missing_critical_diagrams');
  }
  const criticalDiagrams = diagrams.filter((item) => criticalDiagramTypes.includes(normalizeDeepWikiDiagramType(item.diagram_type, 'overview')));
  if (criticalDiagrams.some((item) => normalizeText(item.render_source) === 'fallback_heuristic')) {
    warnings.push('diagram_fallback_detected');
  }
  if (criticalDiagrams.some((item) => !(item.covered_evidence || []).length)) {
    warnings.push('diagram_missing_evidence');
  }
  if (criticalDiagrams.some((item) => !normalizeText(item.summary))) {
    warnings.push('diagram_low_business_specificity');
  }
  if (criticalDiagrams.some((item) => normalizeText(item.format || 'mermaid') === 'mermaid' && !normalizeText(item.content))) {
    warnings.push('diagram_not_exportable');
  }
  if (!qualityReport) warnings.push('missing_quality_report');
  else if (!['published', 'review', 'ready'].includes(normalizeText(qualityReport.status))) warnings.push('quality_gate_blocked');
  if (snapshot.quality_gate_blocked || blockingGateKeys.length) {
    warnings.push('quality_gate_blocked');
  }
  const qualityJson = getRecordLike(qualityReport?.quality_json, {});
  if (Number(qualityJson.thread_count || 0) < 2) warnings.push('missing_thread_views');
  if (Number(qualityJson.branch_thread_count || 0) < 1) warnings.push('missing_branch_threads');
  if (Array.isArray(qualityJson.noise_modules) && qualityJson.noise_modules.length) warnings.push('inventory_noise_detected');
  if (qualityJson.frontend_repo_bound === false) warnings.push('missing_frontend_repo_view');
  const documentTypes = new Set(documentRevisions.map((item) => normalizeDeepWikiSourceType(item.document_type, 'review')));
  if (!documentTypes.has('prd') && !documentTypes.has('biz_spec')) warnings.push('missing_prd_or_biz_spec');
  return {
    blockers: Array.from(new Set(blockers)),
    warnings: Array.from(new Set(warnings)),
    gate_decisions: gateDecisions,
  };
}

async function computeDeepWikiSnapshotPublishBlockers(snapshotId) {
  const snapshot = await getDeepWikiSnapshotRecord(snapshotId);
  if (!snapshot) return ['snapshot_not_found'];
  if (isPublishedSnapshot(snapshot)) return [];
  const readiness = await computeDeepWikiSnapshotReadiness(snapshotId);
  const publish = evaluatePublishEligibility(
    {
      ...snapshot,
      quality_gate_blocked: snapshot.quality_gate_blocked || readiness.blockers.length > 0,
    },
    readiness.gate_decisions || [],
    snapshot.approval_status
  );
  return uniqueStrings([
    ...readiness.blockers,
    ...publish.blockers,
  ]);
}

async function getDeepWikiSnapshotOverview(snapshotId) {
  const snapshot = await getDeepWikiSnapshotRecord(snapshotId);
  if (!snapshot) return null;
  const readiness = await computeDeepWikiSnapshotReadiness(snapshotId);
  const [repoRevisions, documentRevisions, diagrams, project, relatedBundles, generationJobs] = await Promise.all([
    listDeepWikiSnapshotRepoRevisions(snapshotId).catch(() => []),
    listDeepWikiSnapshotDocumentRevisions(snapshotId).catch(() => []),
    listDeepWikiSnapshotDiagrams(snapshotId).catch(() => []),
    getDeepWikiProjectByIdRecord(Number(snapshot.project_id)).catch(() => null),
    listDocBundlesByDeepWikiSnapshotId(snapshotId).catch(() => []),
    query(
      `SELECT *
       FROM gateway_wiki_generation_jobs
       WHERE snapshot_id = ?
       ORDER BY created_at DESC, id DESC
       LIMIT 20`,
      [Number(snapshotId)]
    ).catch(() => []),
  ]);
  return {
    snapshot,
    project,
    repo_revisions: repoRevisions,
    document_revisions: documentRevisions,
    diagram_assets: diagrams,
    related_doc_bundles: relatedBundles,
    generation_jobs: generationJobs.map(mapWikiGenerationJobRow),
    publish_blockers: readiness.blockers,
    publish_warnings: readiness.warnings,
    source_coverage: {
      repo_count: repoRevisions.length,
      document_count: documentRevisions.length,
      diagram_count: diagrams.length,
    },
  };
}

async function getDeepWikiSnapshotQuality(snapshotId) {
  const [snapshot, qualityReport, consistencyChecks, semanticScores, readiness, projection] = await Promise.all([
    getDeepWikiSnapshotRecord(snapshotId).catch(() => null),
    getDeepWikiQualityReportBySnapshotId(snapshotId).catch(() => null),
    listDeepWikiConsistencyChecks(snapshotId).catch(() => []),
    listDeepWikiSemanticScores(snapshotId).catch(() => []),
    computeDeepWikiSnapshotReadiness(snapshotId),
    getDeepWikiTemplateProjectionBySnapshotId(snapshotId).catch(() => null),
  ]);
  const qualityAsset = Array.isArray(projection?.assets)
    ? projection.assets.find((item) => normalizeText(item.assetKey) === 'quality_report')
    : null;
  const diagramQualityAsset = Array.isArray(projection?.assets)
    ? projection.assets.find((item) => normalizeText(item.assetKey) === 'diagram_quality_report')
    : null;
  const snapshotScore = Array.isArray(projection?.scores?.snapshotScores) ? projection.scores.snapshotScores[0] : null;
  return {
    quality_report: qualityAsset?.payload
      ? {
          ...qualityReport,
          ...qualityAsset.payload,
          quality_json: {
            ...(qualityReport?.quality_json || {}),
            algorithm_quality: qualityAsset.payload,
          },
        }
      : qualityReport,
    consistency_checks: Array.isArray(diagramQualityAsset?.payload)
      ? diagramQualityAsset.payload.map((item) => ({
          check_type: 'diagram_quality',
          status: item.passed ? 'passed' : 'failed',
          issue_code: item.diagram_type,
          issue_level: item.passed ? 'info' : 'warn',
          detail_json: item.checks || {},
          evidence_json: [],
        }))
      : consistencyChecks,
    semantic_scores: snapshotScore
      ? [
          {
            target_type: 'snapshot',
            target_id: snapshotId,
            score_type: 'algorithm_snapshot_score',
            score: Number(snapshotScore.overall_score || 0) * 100,
            status: snapshot?.publish_status || 'draft',
          },
        ]
      : semanticScores,
    publish_blockers: readiness.blockers,
    publish_warnings: readiness.warnings,
    publish_ready: snapshot?.publish_ready != null ? Boolean(snapshot.publish_ready) : readiness.blockers.length === 0,
  };
}

function hasQualityBlockingGateDecision(gates = []) {
  return (Array.isArray(gates) ? gates : []).some((gate) => {
    const decision = normalizeText(gate?.decision_status || gate?.decision || gate?.status).toLowerCase();
    const isBlocking = Boolean(gate?.is_blocking) || ['block', 'blocked', 'fail', 'failed', 'error'].includes(decision);
    if (!isBlocking) return false;
    const gateKey = normalizeText(gate?.gate_key).toLowerCase();
    if (gateKey === 'publish_gate') {
      const detail = getRecordLike(gate?.decision_json, {});
      const blockers = Array.isArray(detail.blockers)
        ? detail.blockers.map((item) => normalizeText(item).toLowerCase())
        : [];
      return blockers.some((item) => !['approval_not_approved', 'missing_lineage', 'snapshot_not_ready'].includes(item));
    }
    return ![
      'blocker:approval_not_approved',
      'blocker:missing_lineage',
      'approval_not_approved',
      'missing_lineage',
    ].includes(gateKey);
  });
}

function extractPublishGateDecision(projection = null) {
  const fromAssets = Array.isArray(projection?.assets)
    ? projection.assets.find((asset) => normalizeText(asset.assetKey) === 'gate_decisions')
    : null;
  const assetPayload = getRecordLike(fromAssets?.payload, {});
  if (Object.keys(assetPayload).length) {
    return assetPayload;
  }
  const fromRows = Array.isArray(projection?.gateDecisions)
    ? projection.gateDecisions.find((gate) => normalizeText(gate.gate_key) === 'publish_gate')
    : null;
  return getRecordLike(fromRows?.decision_json, {});
}

function normalizeSnapshotLifecycleTarget(currentStatus, desiredStatus) {
  const current = normalizeSnapshotStatus(currentStatus, 'queued');
  const desired = normalizeSnapshotStatus(desiredStatus, current);
  if (current === desired) return desired;
  if (current === 'ready' && ['queued', 'generated', 'analyzed', 'validated'].includes(desired)) {
    return 'needs_review';
  }
  if (current === 'needs_review' && ['queued', 'generated'].includes(desired)) {
    return 'validated';
  }
  return desired;
}

async function reconcileDeepWikiSnapshotLifecycle(snapshotId, options = {}) {
  const normalizedSnapshotId = Number(snapshotId || 0);
  if (!normalizedSnapshotId) return null;
  const snapshot = await getDeepWikiSnapshotRecord(normalizedSnapshotId);
  if (!snapshot) return null;
  if (isPublishedSnapshot(snapshot)) return snapshot;

  const [repoRevisions, pages, diagrams, qualityReport, projection] = await Promise.all([
    listDeepWikiSnapshotRepoRevisions(normalizedSnapshotId).catch(() => []),
    listDeepWikiPagesBySnapshotId(normalizedSnapshotId).catch(() => []),
    listDeepWikiSnapshotDiagrams(normalizedSnapshotId).catch(() => []),
    getDeepWikiQualityReportBySnapshotId(normalizedSnapshotId).catch(() => null),
    getDeepWikiTemplateProjectionBySnapshotId(normalizedSnapshotId).catch(() => null),
  ]);

  const gateRows = Array.isArray(options.gates)
    ? options.gates
    : Array.isArray(projection?.gateDecisions)
      ? projection.gateDecisions
      : [];
  const publishGate = {
    ...extractPublishGateDecision(projection),
    ...getRecordLike(options.publish_gate, {}),
  };
  const qualityStatus = normalizeText(options.quality_status || qualityReport?.status || snapshot.quality_status || 'pending') || 'pending';
  const qualityGateBlocked =
    options.quality_gate_blocked != null
      ? Boolean(options.quality_gate_blocked)
      : Boolean(publishGate.qualityGateBlocked) || hasQualityBlockingGateDecision(gateRows);
  const publishReadySignal =
    options.publish_ready != null
      ? Boolean(options.publish_ready)
      : Boolean(publishGate.publishReady) || (qualityStatus === 'ready' && !qualityGateBlocked);

  const desiredStatus = normalizeSnapshotLifecycleTarget(
    snapshot.status,
    normalizeText(options.target_status) ||
      computeSnapshotStatus({
        ...snapshot,
        status: '',
        quality_status: qualityStatus,
        publish_ready: publishReadySignal,
        quality_gate_blocked: qualityGateBlocked,
        approval_status: snapshot.approval_status,
        has_quality_report: Boolean(qualityReport) || ['ready', 'review', 'published'].includes(qualityStatus),
        page_count: Array.isArray(pages) ? pages.length : 0,
        diagram_count: Array.isArray(diagrams) ? diagrams.length : 0,
        projection_asset_count: Array.isArray(projection?.assets) ? projection.assets.length : 0,
        repo_revision_count: Array.isArray(repoRevisions) ? repoRevisions.length : 0,
        run_id: Number(snapshot.run_id || 0),
        gates: gateRows,
      })
  );

  let nextStatus = normalizeSnapshotStatus(snapshot.status, 'queued');
  const transitionPath = resolveTransitionPath(nextStatus, desiredStatus);
  if (transitionPath.length > 1) {
    for (const candidate of transitionPath.slice(1)) {
      assertTransition(nextStatus, candidate, {
        approval_status: snapshot.approval_status,
        lineage_json: snapshot.lineage_json,
        quality_gate_blocked: qualityGateBlocked,
        gates: gateRows,
      });
      nextStatus = candidate;
    }
  }

  const legacyFields = deriveLegacySnapshotFields({ status: nextStatus });
  return upsertDeepWikiProjectSnapshot({
    id: Number(snapshot.id),
    project_id: Number(snapshot.project_id),
    repo_source_id: Number(snapshot.repo_source_id),
    repo_snapshot_id: snapshot.repo_snapshot_id || null,
    run_id: snapshot.run_id || null,
    branch: snapshot.branch,
    commit_sha: snapshot.commit_sha,
    snapshot_version: snapshot.snapshot_version,
    status: nextStatus,
    publish_ready: ['ready', 'published'].includes(nextStatus) && publishReadySignal,
    quality_gate_blocked: qualityGateBlocked,
    approval_status: snapshot.approval_status,
    source_snapshot_id: snapshot.source_snapshot_id || null,
    lineage_json: snapshot.lineage_json || {},
    publish_status: legacyFields.publish_status,
    quality_status: qualityStatus || legacyFields.quality_status,
    source_manifest_json: snapshot.source_manifest_json || {},
    metadata_json: snapshot.metadata_json || {},
    published_at: snapshot.published_at || null,
  });
}

async function publishDeepWikiSnapshot(snapshotId) {
  const snapshot = await getDeepWikiSnapshotRecord(snapshotId);
  if (!snapshot) return null;
  if (isPublishedSnapshot(snapshot)) {
    return getDeepWikiSnapshotOverview(snapshotId);
  }
  const blockers = await computeDeepWikiSnapshotPublishBlockers(snapshotId);
  if (blockers.length) {
    const error = new Error(`Snapshot publish blocked: ${blockers.join(', ')}`);
    error.status = 409;
    error.blockers = blockers;
    throw error;
  }
  if (!canTransition(snapshot.status, 'published', {
    approval_status: snapshot.approval_status,
    lineage_json: snapshot.lineage_json,
    quality_gate_blocked: snapshot.quality_gate_blocked,
  })) {
    const error = new Error('Snapshot publish blocked: invalid transition');
    error.status = 409;
    throw error;
  }
  await upsertDeepWikiProjectSnapshot({
    id: Number(snapshot.id),
    project_id: Number(snapshot.project_id),
    repo_source_id: Number(snapshot.repo_source_id),
    repo_snapshot_id: snapshot.repo_snapshot_id || null,
    run_id: snapshot.run_id || null,
    branch: snapshot.branch,
    commit_sha: snapshot.commit_sha,
    snapshot_version: snapshot.snapshot_version,
    status: 'published',
    publish_ready: true,
    quality_gate_blocked: false,
    approval_status: normalizeApprovalStatus(snapshot.approval_status, 'approved'),
    source_snapshot_id: snapshot.source_snapshot_id || null,
    lineage_json: {
      ...(snapshot.lineage_json || {}),
      publish_decision: {
        status: 'published',
        published_via: 'snapshot_publish_api',
        published_at: new Date().toISOString(),
      },
    },
    source_manifest_json: snapshot.source_manifest_json || {},
    metadata_json: {
      ...(snapshot.metadata_json || {}),
      publish_blockers: [],
      published_via: 'snapshot_publish_api',
    },
    published_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
  });
  return getDeepWikiSnapshotOverview(snapshotId);
}

async function updateDeepWikiSnapshotApprovalStatus(snapshotId, approvalStatus, metadata = {}) {
  const snapshot = await getDeepWikiSnapshotRecord(snapshotId);
  if (!snapshot) return null;
  const nextApprovalStatus = normalizeApprovalStatus(approvalStatus, 'pending');
  await upsertDeepWikiProjectSnapshot({
    id: Number(snapshot.id),
    project_id: Number(snapshot.project_id),
    repo_source_id: Number(snapshot.repo_source_id),
    repo_snapshot_id: snapshot.repo_snapshot_id || null,
    run_id: snapshot.run_id || null,
    branch: snapshot.branch,
    commit_sha: snapshot.commit_sha,
    snapshot_version: snapshot.snapshot_version,
    status: snapshot.status,
    publish_ready: Boolean(snapshot.publish_ready),
    quality_gate_blocked: Boolean(snapshot.quality_gate_blocked),
    approval_status: nextApprovalStatus,
    source_snapshot_id: snapshot.source_snapshot_id || null,
    lineage_json: snapshot.lineage_json || {},
    source_manifest_json: snapshot.source_manifest_json || {},
    metadata_json: {
      ...(snapshot.metadata_json || {}),
      approval_updated_at: new Date().toISOString(),
      approval_updated_via: metadata.approval_updated_via || 'snapshot_approval_api',
      approval_note: metadata.approval_note || null,
    },
    published_at: snapshot.published_at || null,
  });
  return getDeepWikiSnapshotOverview(snapshotId);
}

async function createDocBundleFromDeepWikiSnapshot(snapshotId, data = {}) {
  const snapshot = await getDeepWikiSnapshotRecord(snapshotId);
  if (!snapshot) return null;
  try {
    assertPublishedBaseline(snapshot);
  } catch (_error) {
    const baselineError = new Error('Only published snapshot can generate formal doc bundles');
    baselineError.status = 409;
    throw baselineError;
  }
  const project = await getDeepWikiProjectByIdRecord(Number(snapshot.project_id));
  await ensureAutoSupplementedSnapshotDocuments(snapshotId).catch(() => []);
  const overview = await getDeepWikiSnapshotOverview(snapshotId);
  const documentRevisions = overview?.document_revisions || [];
  const techSpecDoc = documentRevisions.find((item) => normalizeDeepWikiSourceType(item.document_type, 'review') === 'tech_spec');
  const prdDoc = documentRevisions.find((item) => ['prd', 'biz_spec'].includes(normalizeDeepWikiSourceType(item.document_type, 'review')));
  const mode = normalizeText(data.mode || data.workflow_mode);
  const bundlePayload = {
    project_code: project?.project_code || data.project_code || null,
    workflow_mode: mode === 'test_plan' ? 'upload_existing' : 'generate_tech_spec',
    title: normalizeText(data.title) || `${project?.project_name || project?.project_code || '项目'} ${snapshot.snapshot_version} ${mode === 'test_plan' ? '测试方案' : '技术方案'}`,
    version_label: snapshot.snapshot_version || snapshot.commit_sha?.slice(0, 8) || null,
    create_prd_artifact: false,
  };
  const result = await createDocBundleFromDeepWikiRun(Number(snapshot.run_id), bundlePayload);
  if (!result?.bundle) return result;
  if (prdDoc?.source_uri) {
    await createDocArtifact(result.bundle.id, {
      artifact_type: 'prd',
      source_type: 'import',
      title: prdDoc.title || '产品方案',
      version_label: prdDoc.version_label || snapshot.snapshot_version || null,
      storage_uri: prdDoc.source_uri,
      content_text: normalizeText(prdDoc.metadata_json?.content_text || ''),
      metadata_json: {
        imported_from_snapshot_id: Number(snapshotId),
      },
    }).catch(() => null);
  } else if (normalizeText(prdDoc?.metadata_json?.content_text)) {
    await createDocArtifact(result.bundle.id, {
      artifact_type: 'prd',
      source_type: 'import',
      title: prdDoc?.title || '产品方案',
      version_label: prdDoc?.version_label || snapshot.snapshot_version || null,
      content_text: normalizeText(prdDoc?.metadata_json?.content_text || ''),
      metadata_json: {
        imported_from_snapshot_id: Number(snapshotId),
      },
    }).catch(() => null);
  }
  if (mode === 'test_plan' && techSpecDoc?.source_uri) {
    await createDocArtifact(result.bundle.id, {
      artifact_type: 'tech_spec',
      source_type: 'import',
      title: techSpecDoc.title || '技术方案',
      version_label: techSpecDoc.version_label || snapshot.snapshot_version || null,
      storage_uri: techSpecDoc.source_uri,
      content_text: normalizeText(techSpecDoc.metadata_json?.content_text || ''),
      metadata_json: {
        imported_from_snapshot_id: Number(snapshotId),
      },
    }).catch(() => null);
  } else if (mode === 'test_plan' && normalizeText(techSpecDoc?.metadata_json?.content_text)) {
    await createDocArtifact(result.bundle.id, {
      artifact_type: 'tech_spec',
      source_type: 'import',
      title: techSpecDoc?.title || '技术方案',
      version_label: techSpecDoc?.version_label || snapshot.snapshot_version || null,
      content_text: normalizeText(techSpecDoc?.metadata_json?.content_text || ''),
      metadata_json: {
        imported_from_snapshot_id: Number(snapshotId),
      },
    }).catch(() => null);
  }
  return {
    ...result,
    generation_base: {
      snapshot_id: Number(snapshotId),
      prd_asset_ids: documentRevisions
        .filter((item) => ['prd', 'biz_spec'].includes(normalizeDeepWikiSourceType(item.document_type, 'review')))
        .map((item) => Number(item.id)),
      tech_spec_asset_id: techSpecDoc?.id ? Number(techSpecDoc.id) : null,
      gate_status: 'ready',
    },
  };
}

async function ensureDeepWikiSnapshotProjection(snapshot, options = {}) {
  if (!snapshot?.id || !snapshot?.run_id) return null;
  const force = Boolean(options.force);
  const [existingQuality, existingFlows, run, project] = await Promise.all([
    getDeepWikiQualityReportBySnapshotId(Number(snapshot.id)).catch(() => null),
    listDeepWikiFlows(Number(snapshot.id)).catch(() => []),
    getDeepWikiRunById(Number(snapshot.run_id)),
    getDeepWikiProjectByIdRecord(Number(snapshot.project_id)),
  ]);
  if (!run) return null;
  if (!force && existingQuality && Array.isArray(existingFlows) && existingFlows.length) {
    return {
      snapshot,
      quality_report: existingQuality,
      flows: existingFlows,
      skipped: true,
    };
  }

  const graph = await loadDeepWikiKnowledgeGraphByRunId(Number(run.id));
  if (!Array.isArray(graph.objects) || !graph.objects.length) {
    return {
      snapshot,
      quality_report: existingQuality,
      flows: existingFlows,
      skipped: true,
      reason: 'no_graph_objects',
    };
  }

  const objectIdMap = graph.object_id_map || {};
  const consistencyChecks = buildDeepWikiConsistencyChecksFromGraph(graph, objectIdMap);
  await replaceDeepWikiConsistencyChecks(Number(snapshot.id), consistencyChecks);

  const executableKnowledge = buildDeepWikiExecutableKnowledge(graph, objectIdMap);
  const flowIdMap = await replaceDeepWikiFlows(Number(snapshot.id), executableKnowledge.flows);
  await replaceDeepWikiAssertions(Number(snapshot.id), executableKnowledge.assertions);
  await replaceDeepWikiScenarios(Number(snapshot.id), executableKnowledge.scenarios.map((item) => ({
    ...item,
    flow_id: flowIdMap.get(`flow-${String(item.scenario_code || '').replace(/^scenario-/, '')}`) || null,
  })));

  const qualityReport = buildDeepWikiQualityReport({
    project,
    run,
    graph,
    pages: run.pages || [],
    inventory: getRecordLike(run.summary_json?.inventory, {}),
    threads: await listDeepWikiThreads(Number(snapshot.id)).catch(() => []),
  });
  await upsertDeepWikiQualityReport({
    project_id: Number(snapshot.project_id),
    snapshot_id: Number(snapshot.id),
    run_id: Number(run.id),
    ...qualityReport,
  });
  await replaceDeepWikiSemanticScores(Number(snapshot.id), buildDeepWikiSemanticScores(qualityReport, Number(snapshot.id)));

  const nextSnapshotStatus = computeSnapshotStatus({
    ...snapshot,
    quality_status: qualityReport.status || snapshot.quality_status,
    publish_status: normalizeText(run.summary_json?.publish_status),
    has_quality_report: true,
    page_count: (run.pages || []).length,
    repo_revision_count: 1,
    run_id: Number(run.id),
  });
  const updatedSnapshot = await upsertDeepWikiProjectSnapshot({
    id: Number(snapshot.id),
    project_id: Number(snapshot.project_id),
    repo_source_id: Number(snapshot.repo_source_id),
    repo_snapshot_id: snapshot.repo_snapshot_id || run.snapshot_id || null,
    run_id: Number(run.id),
    branch: normalizeText(snapshot.branch || run.branch) || 'main',
    commit_sha: normalizeText(snapshot.commit_sha || run.commit_sha),
    snapshot_version: normalizeText(snapshot.snapshot_version),
    status: nextSnapshotStatus,
    quality_status: qualityReport.status || 'draft',
    source_manifest_json: snapshot.source_manifest_json || {},
    metadata_json: snapshot.metadata_json || {},
  });

  return {
    snapshot: updatedSnapshot,
    quality_report: qualityReport,
    flows: executableKnowledge.flows,
    skipped: false,
  };
}

async function bootstrapDeepWikiProjects(options = {}) {
  const rows = await query(
    `SELECT id
     FROM gateway_deepwiki_runs
     ${options.completed_only === false ? '' : "WHERE status = 'completed'"}
     ORDER BY id ASC`
  );

  const summary = {
    scanned_runs: rows.length,
    processed_runs: 0,
    created_or_updated_projects: 0,
    created_or_updated_snapshots: 0,
    rebuilt_snapshot_projections: 0,
    projects: [],
  };
  const touchedProjects = new Set();

  for (const row of rows) {
    const run = await getDeepWikiRunById(Number(row.id));
    if (!run?.repo_source) continue;
    const runSummary = deepWikiSummaryDefaults(run.summary_json || {});
    const manifest = getRecordLike(runSummary.project_manifest, {});
    const primarySnapshot = run.snapshot || (run.snapshot_id ? await getRepoSnapshotById(Number(run.snapshot_id)) : null);
    if (!primarySnapshot) continue;

    const projectCode = deriveDeepWikiProjectCode(run.repo_source, manifest.project_code || run.project_code || null);
    const projectName = deriveDeepWikiProjectName(run.repo_source, manifest.project_name || null);
    const project = await upsertDeepWikiProject({
      project_code: projectCode,
      project_name: projectName,
      default_branch: normalizeText(manifest.branch || run.branch || primarySnapshot.branch) || 'main',
      metadata_json: {
        bootstrap_source: 'existing_runs',
        last_bootstrapped_run_id: Number(run.id),
      },
    });
    touchedProjects.add(Number(project.id));

    const manifestRepos = Array.isArray(manifest.repos) && manifest.repos.length
      ? manifest.repos
      : [{
          repo_source_id: Number(run.repo_source_id),
          repo_role: inferDeepWikiRepoRole(run.repo_source),
          repo_slug: run.repo_source.repo_slug,
          repo_url: run.repo_source.repo_url,
          branch: normalizeText(run.branch || primarySnapshot.branch) || 'main',
          commit_sha: primarySnapshot.commit_sha,
        }];

    const preparedRepos = [];
    for (let index = 0; index < manifestRepos.length; index += 1) {
      const manifestRepo = manifestRepos[index] || {};
      const repoSource =
        (manifestRepo.repo_source_id ? await getRepoSourceById(Number(manifestRepo.repo_source_id)) : null) ||
        (manifestRepo.repo_url ? await getRepoSourceByUrl(normalizeText(manifestRepo.repo_url)) : null) ||
        (index === 0 ? run.repo_source : null);
      if (!repoSource && !manifestRepo.repo_url) continue;
      const boundRepoSource = repoSource || await upsertRepoSource({
        repo_url: normalizeText(manifestRepo.repo_url),
        repo_slug: normalizeText(manifestRepo.repo_slug) || deriveRepoSlug(manifestRepo.repo_url),
        default_branch: normalizeText(manifestRepo.branch) || 'main',
        auth_mode: 'local_git',
        status: 'active',
        metadata_json: {
          bootstrap_source: 'existing_runs',
        },
      });
      const projectRepo = await bindRepoSourceToDeepWikiProject(project.id, boundRepoSource.id, {
        repo_role: inferDeepWikiRepoRole(boundRepoSource, manifestRepo.repo_role),
        is_primary: index === 0,
        metadata_json: {
          default_branch: normalizeText(manifestRepo.branch || boundRepoSource.default_branch) || 'main',
        },
      });
      preparedRepos.push({
        project_repo: projectRepo,
        repo_source: boundRepoSource,
        repo_role: projectRepo.repo_role,
        branch_name: normalizeText(manifestRepo.branch || manifestRepo.repo_branch_name || boundRepoSource.default_branch) || 'main',
        commit_sha: normalizeText(manifestRepo.commit_sha || (index === 0 ? primarySnapshot.commit_sha : '')) || primarySnapshot.commit_sha,
      });
    }

    const branchName = normalizeText(manifest.branch || run.branch || primarySnapshot.branch) || 'main';
    const branch = await upsertDeepWikiBranch(project.id, branchName, {
      display_name: branchName,
      metadata_json: {
        source: 'bootstrap_existing_runs',
      },
    });

    for (const repo of preparedRepos) {
      await upsertDeepWikiBranchRepoMapping(branch.id, Number(repo.project_repo.id), {
        repo_branch_name: repo.branch_name,
        metadata_json: {
          repo_role: repo.repo_role,
          source: 'bootstrap_existing_runs',
        },
      });
    }

    const snapshot = await upsertDeepWikiProjectSnapshot({
      project_id: Number(project.id),
      repo_source_id: Number(preparedRepos[0]?.repo_source?.id || run.repo_source_id),
      repo_snapshot_id: primarySnapshot.id,
      run_id: Number(run.id),
      branch: branchName,
      commit_sha: normalizeText(primarySnapshot.commit_sha || run.commit_sha),
      snapshot_version:
        normalizeText(run.snapshot_version) ||
        buildDeepWikiSnapshotVersion(branchName, normalizeText(primarySnapshot.commit_sha || run.commit_sha)),
      publish_status: normalizeText(run.publish_status || runSummary.publish_status) || 'draft',
      quality_status: normalizeText(run.quality_status) || 'pending',
      source_manifest_json: {
        project_manifest: {
          project_id: Number(project.id),
          project_code: project.project_code,
          project_name: project.project_name,
          branch: branchName,
        },
        repos: preparedRepos.map((item) => ({
          project_repo_id: Number(item.project_repo.id),
          repo_source_id: Number(item.repo_source.id),
          repo_role: item.repo_role,
          repo_slug: item.repo_source.repo_slug,
          branch_name: item.branch_name,
          commit_sha: item.commit_sha,
        })),
      },
      metadata_json: {
        output_root: run.output_root || null,
        bootstrap_source: 'existing_runs',
      },
      published_at:
        normalizeText(run.publish_status || runSummary.publish_status) === 'published'
          ? (normalizeText(runSummary.published_at) || new Date().toISOString().slice(0, 19).replace('T', ' '))
          : null,
    });

    for (const repo of preparedRepos) {
      await upsertDeepWikiSnapshotRepoRevision(Number(snapshot.id), Number(repo.project_repo.id), {
        repo_role: repo.repo_role,
        repo_slug: repo.repo_source.repo_slug,
        branch_name: repo.branch_name,
        commit_sha: repo.commit_sha,
        metadata_json: {
          repo_source_id: Number(repo.repo_source.id),
        },
      });
    }
    await syncDeepWikiProjectSourceBindings(Number(project.id)).catch(() => []);
    await syncDeepWikiSnapshotDocumentRevisions(Number(snapshot.id)).catch(() => []);
    await syncDeepWikiSnapshotDiagrams(Number(snapshot.id)).catch(() => []);

    const projection = await ensureDeepWikiSnapshotProjection(snapshot, {
      force: Boolean(options.force_projection),
    });

    summary.processed_runs += 1;
    summary.created_or_updated_snapshots += 1;
    if (projection && !projection.skipped) {
      summary.rebuilt_snapshot_projections += 1;
    }
  }

  summary.created_or_updated_projects = touchedProjects.size;
  summary.projects = await listDeepWikiProjects();
  const [coverageRow] = await query(
    `SELECT COUNT(*) AS snapshot_count,
            SUM(CASE WHEN repo_stats.repo_revision_count = 0 THEN 1 ELSE 0 END) AS missing_repo_revision_snapshots,
            SUM(CASE WHEN doc_stats.document_revision_count = 0 THEN 1 ELSE 0 END) AS missing_document_revision_snapshots,
            SUM(CASE WHEN diagram_stats.diagram_count = 0 THEN 1 ELSE 0 END) AS missing_diagram_snapshots
     FROM gateway_wiki_snapshots s
     LEFT JOIN (
       SELECT snapshot_id, COUNT(*) AS repo_revision_count
       FROM gateway_wiki_snapshot_repo_revisions
       GROUP BY snapshot_id
     ) repo_stats ON repo_stats.snapshot_id = s.id
     LEFT JOIN (
       SELECT snapshot_id, COUNT(*) AS document_revision_count
       FROM gateway_wiki_snapshot_document_revisions
       GROUP BY snapshot_id
     ) doc_stats ON doc_stats.snapshot_id = s.id
     LEFT JOIN (
       SELECT snapshot_id, COUNT(*) AS diagram_count
       FROM gateway_wiki_snapshot_diagrams
       GROUP BY snapshot_id
     ) diagram_stats ON diagram_stats.snapshot_id = s.id`
  );
  summary.migration_report = {
    project_count: summary.projects.length,
    version_line_count: summary.projects.reduce((total, item) => total + Number(item.version_line_count || 0), 0),
    snapshot_count: Number(coverageRow?.snapshot_count || 0),
    missing_repo_revision_snapshots: Number(coverageRow?.missing_repo_revision_snapshots || 0),
    missing_document_revision_snapshots: Number(coverageRow?.missing_document_revision_snapshots || 0),
    missing_diagram_snapshots: Number(coverageRow?.missing_diagram_snapshots || 0),
  };
  return summary;
}

async function createDeepWikiProject(data = {}) {
  const project = await upsertDeepWikiProject({
    project_code: data.project_code,
    project_name: data.project_name,
    default_branch: data.default_branch,
    mission: data.mission,
    lifecycle_status: data.lifecycle_status,
    owners_json: data.owners_json || {},
    metadata_json: data.metadata_json || {},
  });

  const repoBindings = Array.isArray(data.repo_bindings)
    ? data.repo_bindings
        .map((item) => ({
          repo_source_id: Number(item?.repo_source_id),
          repo_role: normalizeText(item?.repo_role) || 'service',
          branch: normalizeText(item?.branch) || '',
          is_primary: Boolean(item?.is_primary),
        }))
        .filter((item) => Number.isFinite(item.repo_source_id) && item.repo_source_id > 0)
    : [];
  if (repoBindings.length) {
    const hasPrimary = repoBindings.some((item) => item.is_primary);
    for (let index = 0; index < repoBindings.length; index += 1) {
      const binding = repoBindings[index];
      const repoSource = await getRepoSourceById(binding.repo_source_id);
      if (!repoSource) continue;
      await bindRepoSourceToDeepWikiProject(project.id, binding.repo_source_id, {
        repo_role: binding.repo_role,
        is_primary: hasPrimary ? binding.is_primary : index === 0,
        metadata_json: {
          default_branch: binding.branch || normalizeText(data.default_branch || repoSource.default_branch) || 'main',
        },
      });
    }
    await syncDeepWikiProjectSourceBindings(Number(project.id)).catch(() => []);
    await ensureDeepWikiProjectDefaultVersionLine(Number(project.id), {
      branch_name: normalizeText(data.default_branch),
      display_name: normalizeText(data.default_branch),
      source: 'project_create_auto_init',
    }).catch(() => null);
    return getDeepWikiProjectById(project.id);
  }

  const repoSourceIds = Array.isArray(data.repo_source_ids) ? data.repo_source_ids.map(Number).filter(Number.isFinite) : [];
  for (const repoSourceId of repoSourceIds) {
    await bindRepoSourceToDeepWikiProject(project.id, repoSourceId, {
      repo_role: data.repo_role || 'service',
      is_primary: repoSourceIds.length === 1,
    });
  }
  await syncDeepWikiProjectSourceBindings(Number(project.id)).catch(() => []);
  await ensureDeepWikiProjectDefaultVersionLine(Number(project.id), {
    branch_name: normalizeText(data.default_branch),
    display_name: normalizeText(data.default_branch),
    source: 'project_create_auto_init',
  }).catch(() => null);
  return getDeepWikiProjectById(project.id);
}

async function addRepoToDeepWikiProject(projectId, data = {}) {
  const project = await getDeepWikiProjectByIdRecord(projectId);
  if (!project) return null;
  let repoSource = null;
  if (data.repo_source_id) {
    repoSource = await getRepoSourceById(data.repo_source_id);
  } else if (normalizeText(data.repo_url)) {
    const preflight = await preflightRepository(data.repo_url, data.branch || '');
    repoSource = await upsertRepoSource({
      repo_url: preflight.repo_url,
      repo_slug: preflight.repo_slug,
      default_branch: preflight.default_branch,
      auth_mode: preflight.auth_mode,
      status: 'active',
      metadata_json: {
        latest_preflight: preflight,
      },
    });
  }
  if (!repoSource) {
    throw new Error('repo_source_id or repo_url is required');
  }
  await bindRepoSourceToDeepWikiProject(project.id, repoSource.id, {
    repo_role: data.repo_role || 'service',
    is_primary: Boolean(data.is_primary),
    metadata_json: {
      default_branch: normalizeText(data.branch || repoSource.default_branch) || 'main',
    },
  });
  await syncDeepWikiProjectSourceBindings(Number(project.id)).catch(() => []);
  await ensureDeepWikiProjectDefaultVersionLine(Number(project.id), {
    branch_name: normalizeText(project.default_branch || data.branch || repoSource.default_branch),
    display_name: normalizeText(project.default_branch || data.branch || repoSource.default_branch),
    source: 'project_repo_auto_init',
  }).catch(() => null);
  return getDeepWikiProjectById(project.id);
}

function buildDeepWikiInventoryFromSummary(summary = {}, run = {}) {
  const inventory = parseJson(summary.inventory, {});
  const sources = parseJson(summary.sources, {});
  const moduleDigests = Array.isArray(summary.module_digests) ? summary.module_digests : [];
  const pages = Array.isArray(run.pages) ? run.pages : [];
  const pageSourceFiles = uniqueStrings(
    pages.flatMap((page) => Array.isArray(page.metadata_json?.source_files) ? page.metadata_json.source_files : [])
  );
  const pageSourceApis = uniqueStrings(
    pages.flatMap((page) => Array.isArray(page.metadata_json?.source_apis) ? page.metadata_json.source_apis : [])
  );
  const pageSourceTables = uniqueStrings(
    pages.flatMap((page) => Array.isArray(page.metadata_json?.source_tables) ? page.metadata_json.source_tables : [])
  );
  const pageSourceSymbols = uniqueStrings(
    pages.flatMap((page) => Array.isArray(page.metadata_json?.source_symbols) ? page.metadata_json.source_symbols : [])
  );
  return {
    ...(inventory && typeof inventory === 'object' ? inventory : {}),
    modules: Array.isArray(inventory.modules) && inventory.modules.length
      ? inventory.modules.map((item) => ({
          ...item,
          source_files: Array.isArray(item.source_files) && item.source_files.length
            ? item.source_files
            : pageSourceFiles.filter((file) => file.includes(`/${item.name}/`) || file.startsWith(`${item.name}/`)).slice(0, 12),
        }))
      : moduleDigests.map((item) => ({
          name: item.name,
          file_count: Array.isArray(item.source_files) ? item.source_files.length : 0,
          source_files: Array.isArray(item.source_files) ? item.source_files : pageSourceFiles.filter((file) => file.includes(`/${item.name}/`) || file.startsWith(`${item.name}/`)).slice(0, 12),
        })),
    business_modules: Array.isArray(inventory.business_modules) ? inventory.business_modules : [],
    support_modules: Array.isArray(inventory.support_modules) ? inventory.support_modules : [],
    noise_modules: Array.isArray(inventory.noise_modules) ? inventory.noise_modules : [],
    repo_roles: Array.isArray(inventory.repo_roles) ? inventory.repo_roles : [],
    missing_repo_roles: Array.isArray(inventory.missing_repo_roles) ? inventory.missing_repo_roles : [],
    services: Array.isArray(sources.services) && sources.services.length
      ? sources.services
      : pageSourceSymbols.slice(0, 24).map((symbol) => ({
          class_name: symbol,
          path: pageSourceFiles.find((file) => file.toLowerCase().includes(String(symbol).toLowerCase())) || '',
        })),
    controllers: Array.isArray(sources.controllers) ? sources.controllers : [],
    repositories: Array.isArray(sources.repositories) ? sources.repositories : [],
    entities: Array.isArray(sources.entities) ? sources.entities : [],
    sql_tables: Array.isArray(sources.tables)
      ? sources.tables.map((tableName) => ({ table_name: tableName, path: '' }))
      : [],
    api_endpoints: Array.isArray(sources.api_endpoints) && sources.api_endpoints.length ? sources.api_endpoints : pageSourceApis,
    tables: Array.isArray(sources.tables) && sources.tables.length ? sources.tables : pageSourceTables,
    test_files: Array.isArray(sources.test_files) && sources.test_files.length
      ? sources.test_files
      : pageSourceFiles.filter((file) => /(^|\/)(__tests__|tests?|specs?)\/|(\.|-|_)(test|spec)\./i.test(file)),
    package_json: null,
  };
}

async function rebuildDeepWikiKnowledgeGraphForRun(runId) {
  const run = await getDeepWikiRunById(runId);
  if (!run) return null;
  const summary = deepWikiSummaryDefaults(run.summary_json || {});
  const snapshot = run.snapshot || {};
  const repoSource = run.repo_source || {};
  const inventory = buildDeepWikiInventoryFromSummary(summary, run);
  const pageInputs = (Array.isArray(run.pages) ? run.pages : []).map((page) => ({
    page_slug: page.page_slug,
    title: page.title,
    page_type: page.page_type,
    metadata_json: page.metadata_json || {},
    source_files: page.metadata_json?.source_files || [],
    source_apis: page.metadata_json?.source_apis || [],
    source_tables: page.metadata_json?.source_tables || [],
    source_symbols: page.metadata_json?.source_symbols || [],
  }));
  const graph = buildDeepWikiKnowledgeGraph({
    repo: {
      repo_url: repoSource.repo_url || run.repo_url || '',
      repo_slug: repoSource.repo_slug || run.repo_slug || '',
      branch: snapshot.branch || run.branch || summary.preflight?.resolved_branch || '',
      commit_sha: snapshot.commit_sha || run.commit_sha || summary.preflight?.commit_sha || '',
    },
    inventory,
    pages: pageInputs,
    moduleDigests: Array.isArray(summary.module_digests) ? summary.module_digests : [],
    researchProvider: summary.research_provider,
    researchModel: summary.research_model,
    outputProfile: summary.output_profile,
    diagramProfile: summary.diagram_profile,
  });
  const pageMetadataBySlug = {};
  pageInputs.forEach((page) => {
    pageMetadataBySlug[page.page_slug] = {
      ...(page.metadata_json || {}),
    };
  });
  const graphSummary = await persistDeepWikiKnowledgeGraph(run, graph, pageMetadataBySlug);
  for (const page of run.pages) {
    const nextMeta = pageMetadataBySlug[page.page_slug];
    if (!nextMeta) continue;
    await query(
      'UPDATE gateway_deepwiki_pages SET metadata_json = CAST(? AS JSON), updated_at = NOW() WHERE id = ?',
      [stringifyJson(nextMeta), Number(page.id)]
    );
  }
  const relationCounts = {};
  (graph.relations || []).forEach((item) => {
    relationCounts[item.relation_type] = Number(relationCounts[item.relation_type] || 0) + 1;
  });
  const graphPayload = buildDeepWikiGraphPayloadFromRows({
    run,
    repoSource,
    snapshot,
    pages: run.pages.map((page) => ({
      ...page,
      metadata_json: pageMetadataBySlug[page.page_slug] || page.metadata_json || {},
    })),
    graph,
    graphSummary: {
      object_counts: graphSummary.object_counts,
      relation_counts: relationCounts,
      evidence_coverage: graphSummary.evidence_coverage,
    },
  });
  const outputRoot = normalizeText(run.output_root);
  let nextManifest = getRecordLike(summary.manifest, {});
  if (outputRoot) {
    const wikiGraphPage = {
      page_slug: 'diagrams/wiki-knowledge-graph',
      title: 'Wiki 知识图谱 · Mermaid',
      page_type: 'diagram',
      format: 'mmd',
      diagram_type: 'wiki_knowledge_graph',
      metadata_json: {
        repo_url: repoSource.repo_url || run.repo_url || '',
        repo_slug: repoSource.repo_slug || run.repo_slug || '',
        branch: snapshot.branch || run.branch || '',
        commit_sha: snapshot.commit_sha || run.commit_sha || '',
        section_type: 'diagram',
        page_slug: 'diagrams/wiki-knowledge-graph',
        diagram_type: 'wiki_knowledge_graph',
        source_files: [],
        source_tables: inventory.tables || [],
        source_apis: inventory.api_endpoints || [],
        source_symbols: (inventory.modules || []).map((module) => module.name),
        output_profile: summary.output_profile || 'engineering_architecture_pack',
        diagram_profile: summary.diagram_profile || 'full',
        generated_from: 'gateway_wiki_objects_relations_backfill',
      },
    };
    const sourceUri = buildDeepWikiPageFilePath(outputRoot, wikiGraphPage);
    const storedSourceUri = toWorkspaceRelativePath(sourceUri);
    ensureDir(path.dirname(sourceUri));
    fs.writeFileSync(sourceUri, graphPayload.mermaid, 'utf8');
    const asset = await upsertKnowledgeAsset({
      asset_key: buildDeepWikiAssetKey(repoSource.repo_slug || run.repo_slug || 'deepwiki', snapshot.commit_sha || run.commit_sha || String(run.id), wikiGraphPage.page_slug),
      name: `${repoSource.repo_slug || run.repo_slug || 'Deep Wiki'} · ${wikiGraphPage.title}`,
      asset_type: 'deep_wiki_page',
      asset_category: '代码库类',
      version: String(snapshot.commit_sha || run.commit_sha || run.id).slice(0, 12),
      owner: 'deepwiki-pipeline',
      source_uri: storedSourceUri,
      metadata_json: {
        ...wikiGraphPage.metadata_json,
        collection: DEFAULT_DEEPWIKI_COLLECTION,
        run_id: run.id,
        trace_id: run.trace_id,
        title: wikiGraphPage.title,
      },
    });
    const [existingPage] = await query(
      'SELECT id FROM gateway_deepwiki_pages WHERE run_id = ? AND page_slug = ? LIMIT 1',
      [Number(run.id), wikiGraphPage.page_slug]
    );
    if (existingPage) {
      await query(
        `UPDATE gateway_deepwiki_pages
         SET title = ?, page_type = ?, source_uri = ?, knowledge_asset_id = ?, metadata_json = CAST(? AS JSON), updated_at = NOW()
         WHERE id = ?`,
        [wikiGraphPage.title, wikiGraphPage.page_type, storedSourceUri, asset.id, stringifyJson(wikiGraphPage.metadata_json), existingPage.id]
      );
    } else {
      await query(
        `INSERT INTO gateway_deepwiki_pages
         (run_id, page_slug, title, page_type, source_uri, knowledge_asset_id, ingest_status, metadata_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON))`,
        [Number(run.id), wikiGraphPage.page_slug, wikiGraphPage.title, wikiGraphPage.page_type, storedSourceUri, asset.id, 'pending', stringifyJson(wikiGraphPage.metadata_json)]
      );
    }
    const pagesForManifest = [
      ...(Array.isArray(nextManifest.pages) ? nextManifest.pages.filter((page) => page.page_slug !== wikiGraphPage.page_slug) : []),
      {
        page_slug: wikiGraphPage.page_slug,
        title: wikiGraphPage.title,
        page_type: wikiGraphPage.page_type,
        source_files: [],
        format: 'mmd',
      },
    ];
    nextManifest = {
      ...nextManifest,
      page_count: pagesForManifest.length || Number(nextManifest.page_count || run.pages.length + 1),
      diagram_count: pagesForManifest.filter((page) => page.page_type === 'diagram').length,
      pages: pagesForManifest,
    };
    fs.writeFileSync(path.join(outputRoot, 'manifest.json'), JSON.stringify(nextManifest, null, 2), 'utf8');
  }
  await patchDeepWikiRun(run.id, {
    summary_json: {
      manifest: nextManifest,
      knowledge_graph: {
        object_counts: graphSummary.object_counts,
        relation_counts: graphSummary.relation_counts,
        evidence_coverage: graphSummary.evidence_coverage,
        wiki_graph_page_slug: 'diagrams/wiki-knowledge-graph',
        rebuilt_at: new Date().toISOString(),
      },
    },
  });
  return getDeepWikiRunById(run.id);
}

async function callDeepWikiGateway(payload = {}, timeoutMs = 600000) {
  const url = (process.env.DEEPWIKI_RESEARCH_URL || 'http://127.0.0.1:3001/api/v1/research/deepwiki').trim();
  try {
    const { data } = await axios.post(url, payload, {
      timeout: timeoutMs,
      headers: {
        'Content-Type': 'application/json',
      },
    });
    return data?.data || data;
  } catch (error) {
    const status = Number(error?.response?.status || error?.status || 0) || null;
    const responseBody = (() => {
      try {
        return truncateText(JSON.stringify(error?.response?.data || null), 3000);
      } catch {
        return truncateText(String(error?.response?.data || ''), 3000);
      }
    })();
    const enriched = new Error(
      [
        `DeepWiki gateway request failed`,
        status ? `status=${status}` : '',
        url ? `url=${url}` : '',
        error?.message ? `message=${error.message}` : '',
        responseBody ? `response=${responseBody}` : '',
      ]
        .filter(Boolean)
        .join(' | ')
    );
    enriched.status = status || undefined;
    enriched.response = error?.response;
    enriched.cause = error;
    throw enriched;
  }
}

async function getDeepWikiProviders() {
  const url = (process.env.DEEPWIKI_PROVIDERS_URL || 'http://127.0.0.1:3001/api/v1/research/deepwiki/providers').trim();
  const { data } = await axios.get(url, {
    timeout: 30000,
    headers: {
      Accept: 'application/json',
    },
  });
  return data?.data || data;
}

async function getDeepWikiModels(provider) {
  const url = (process.env.DEEPWIKI_MODELS_URL || 'http://127.0.0.1:3001/api/v1/research/deepwiki/models').trim();
  const { data } = await axios.get(url, {
    timeout: 30000,
    params: provider ? { provider } : undefined,
    headers: {
      Accept: 'application/json',
    },
  });
  return data?.data || data;
}

function fallbackDeepWikiPageSearch(queryText, pageRows = [], limit = 5) {
  return (pageRows || [])
    .map((page) => {
      const content = readTextIfExists(page.source_uri) || '';
      const text = `${page.title || ''}\n${page.page_slug || ''}\n${truncateText(content, 2400)}`;
      return {
        id: String(page.id),
        score: rankTextAgainstQuery(queryText, text),
        text: truncateText(content, 800),
        metadata: {
          page_slug: page.page_slug,
          source_uri: page.source_uri,
          knowledge_asset_id: page.knowledge_asset_id || null,
          object_keys: Array.isArray(page.object_keys) ? page.object_keys : [],
        },
      };
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, Math.max(1, Number(limit || 5)));
}

async function searchDeepWikiKnowledgeBase(queryText, options = {}) {
  const url = (process.env.KNOWLEDGE_BASE_SEARCH_URL || 'http://127.0.0.1:8000/api/v1/search').trim();
  const payload = {
    query: queryText,
    collection: options.collection || DEFAULT_DEEPWIKI_COLLECTION,
    top_k: Math.max(1, Number(options.top_k || 5)),
    retrieval_mode: normalizeText(options.retrieval_mode) || 'hybrid',
    candidate_k: Math.max(1, Number(options.candidate_k || 12)),
    rerank_top_k: Math.max(1, Number(options.rerank_top_k || 8)),
    query_mode: normalizeText(options.query_mode) || 'auto',
    filters: {
      ...(getRecordLike(options.filters, {})),
      ...(options.run_id ? { run_id: Number(options.run_id) } : {}),
    },
  };
  const { data } = await axios.post(url, payload, {
    timeout: Number(process.env.KNOWLEDGE_BASE_TIMEOUT_MS || 20000),
    headers: {
      'Content-Type': 'application/json',
    },
  });
  const output = data?.data || data || {};
  return {
    results: Array.isArray(output.results) ? output.results : [],
    trace: getRecordLike(output.trace, {}),
  };
}

function buildDeepWikiQueryCitations(searchResults = [], pageRows = []) {
  const pageBySlug = new Map((pageRows || []).map((item) => [String(item.page_slug || ''), item]));
  const seen = new Set();
  return (searchResults || [])
    .map((item) => {
      const slug = normalizeText(item?.metadata?.page_slug || item?.page_slug);
      const page = slug ? pageBySlug.get(slug) : null;
      const key = slug || normalizeText(item?.source_uri);
      if (!key || seen.has(key)) return null;
      seen.add(key);
      return {
        page_slug: slug || page?.page_slug || null,
        title: page?.title || null,
        source_uri: item?.source_uri || item?.metadata?.source_uri || page?.source_uri || null,
        knowledge_asset_id: item?.knowledge_asset_id || item?.metadata?.knowledge_asset_id || page?.knowledge_asset_id || null,
        score: Number(item?.score || 0),
        excerpt: truncateText(item?.text || '', 280),
      };
    })
    .filter(Boolean)
    .slice(0, 6);
}

function buildFallbackDeepWikiAnswer(queryText, citations = [], resolvedMode = 'local') {
  if (!citations.length) {
    return `未能为“${queryText}”检索到足够证据，当前只能给出保守结论：请先检查该 Snapshot 是否完成 RAG 入库，或改成更具体的对象/接口/表名查询。`;
  }
  return [
    `围绕“${queryText}”的${resolvedMode === 'global' ? '全局' : '局部'}检索已命中 ${citations.length} 条证据。`,
    '',
    ...citations.map((item, index) => `${index + 1}. ${item.title || item.page_slug || item.source_uri || '未知页面'}：${item.excerpt || '无摘录'}`),
  ].join('\n');
}

async function buildDeepWikiAnswerFromContext(queryText, retrievalContext = {}, options = {}) {
  const prompt = [
    '你是 DeepWiki 项目检索助手，只能基于给定证据回答，不要编造不存在的服务、表、接口或流程。',
    '',
    `## 用户问题`,
    queryText,
    '',
    `## 检索模式`,
    normalizeText(retrievalContext.resolved_mode) || 'local',
    '',
    '## 命中对象',
    JSON.stringify(retrievalContext.retrieved_objects || [], null, 2),
    '',
    '## 命中业务域',
    JSON.stringify(retrievalContext.retrieved_domains || [], null, 2),
    '',
    '## 命中业务行为',
    JSON.stringify(retrievalContext.retrieved_behaviors || [], null, 2),
    '',
    '## 命中社区',
    JSON.stringify(retrievalContext.community_hits || [], null, 2),
    '',
    '## 命中线程',
    JSON.stringify(retrievalContext.retrieved_threads || [], null, 2),
    '',
    '## 项目长期记忆',
    retrievalContext.memory_context?.recall_text || '无',
    '',
    '## 页面证据',
    JSON.stringify(retrievalContext.citations || [], null, 2),
    '',
    '输出要求：',
    '- 先给出直接结论；',
    '- 再简述关键依据；',
    '- 如果证据不足，要明确说“证据不足”；',
    '- 不要输出 JSON。',
  ].join('\n');
  try {
    const result = await callDeepWikiGateway(
      {
        purpose: 'deepwiki',
        mode: 'summarize',
        trace_id: options.trace_id || `trace-deepwiki-query-${uuidv4().replace(/-/g, '').slice(0, 16)}`,
        research_provider: options.provider,
        research_model: options.model,
        output_format: 'markdown',
        messages: [{ role: 'user', content: prompt }],
      },
      DEEPWIKI_SUMMARY_TIMEOUT_MS
    );
    return {
      answer: normalizeText(result?.content) || buildFallbackDeepWikiAnswer(queryText, retrievalContext.citations, retrievalContext.resolved_mode),
      provider: normalizeText(result?.provider) || normalizeText(options.provider) || null,
      model: normalizeText(result?.model) || normalizeText(options.model) || null,
    };
  } catch {
    return {
      answer: buildFallbackDeepWikiAnswer(queryText, retrievalContext.citations, retrievalContext.resolved_mode),
      provider: normalizeText(options.provider) || null,
      model: normalizeText(options.model) || null,
    };
  }
}

async function runDeepWikiRetrievalEvaluation(snapshot, graph = {}, pageRows = [], communityReports = []) {
  const probes = buildDeepWikiRetrievalProbeQueries(graph, pageRows, communityReports);
  const evaluated = [];
  let hitCount = 0;
  for (const probe of probes) {
    let kbResults = [];
    let kbTrace = {};
    let usedFallback = false;
    try {
      const response = await searchDeepWikiKnowledgeBase(probe.query, {
        run_id: snapshot.run_id,
        top_k: 5,
        candidate_k: 8,
        rerank_top_k: 5,
        query_mode: probe.scope,
      });
      kbResults = response.results || [];
      kbTrace = response.trace || {};
    } catch {
      usedFallback = true;
      kbResults = fallbackDeepWikiPageSearch(probe.query, pageRows, 5);
      kbTrace = { fallback: 'page_lexical' };
    }
    const pageHits = new Set(
      kbResults
        .map((item) => normalizeText(item?.metadata?.page_slug || item?.page_slug))
        .filter(Boolean)
    );
    const objectHits = new Set();
    kbResults.forEach((item) => {
      const keys = Array.isArray(item?.metadata?.object_keys) ? item.metadata.object_keys : [];
      keys.forEach((key) => objectHits.add(String(key)));
    });
    const hit =
      (probe.expected_page_slugs || []).some((slug) => pageHits.has(String(slug))) ||
      (probe.expected_object_keys || []).some((key) => objectHits.has(String(key)));
    if (hit) hitCount += 1;
    evaluated.push({
      ...probe,
      hit,
      used_fallback: usedFallback,
      top_result_page_slugs: [...pageHits].slice(0, 5),
      kb_trace: kbTrace,
    });
  }
  const top5Recall = probes.length ? Number(((hitCount / probes.length) * 100).toFixed(2)) : 0;
  return {
    probe_count: probes.length,
    grounded_probe_count: hitCount,
    top5_recall: top5Recall,
    status: top5Recall >= 85 ? 'passed' : top5Recall >= 60 ? 'review' : 'failed',
    probes: evaluated,
  };
}

function rankDeepWikiThreadsAgainstQuery(queryText, threads = [], citations = []) {
  const citedPageSlugs = new Set((citations || []).map((item) => normalizeText(item.page_slug)).filter(Boolean));
  return (threads || [])
    .map((thread) => {
      const threadSearchText = [
        thread.title,
        thread.thread_key,
        thread.thread_level,
        thread.domain_key,
        thread.summary_markdown,
        ...(thread.object_keys_json || []),
      ].join('\n');
      const citationBoost = citedPageSlugs.size && citedPageSlugs.has(`10-domains/${normalizeDeepWikiThreadKey(thread.domain_key || 'project', 'domain')}/10-threads/${thread.thread_key}/00-summary`)
        ? 0.25
        : 0;
      const rankScore = Number((rankTextAgainstQuery(queryText, threadSearchText) + citationBoost).toFixed(4));
      return {
        thread_key: thread.thread_key,
        parent_thread_key: thread.parent_thread_key || null,
        thread_level: thread.thread_level,
        domain_key: thread.domain_key,
        title: thread.title,
        rank_score: rankScore,
        object_keys: thread.object_keys_json || [],
        repo_roles: thread.repo_roles_json || [],
        summary_markdown: truncateText(thread.summary_markdown || '', 400),
      };
    })
    .filter((item) => item.rank_score > 0)
    .sort((left, right) => right.rank_score - left.rank_score)
    .slice(0, 8);
}

async function queryDeepWikiSnapshot(snapshotId, payload = {}) {
  const startedAt = Date.now();
  const snapshot = await getDeepWikiSnapshotRecord(Number(snapshotId));
  if (!snapshot) return null;
  const [graph, pageRows, communityReports, threadRows] = await Promise.all([
    loadDeepWikiKnowledgeGraphBySnapshotId(Number(snapshotId)).catch(() => ({ objects: [], relations: [] })),
    listDeepWikiPagesBySnapshotId(Number(snapshotId)).catch(() => []),
    listDeepWikiCommunityReports(Number(snapshotId)).catch(() => []),
    listDeepWikiThreads(Number(snapshotId)).catch(() => []),
  ]);
  const queryText = normalizeText(payload.query || '');
  const queryRewrite = rewriteDeepWikiBusinessQuery(queryText);
  const retrievalQuery = normalizeText(queryRewrite.rewritten_query) || queryText;
  const domains = buildDeepWikiDomainModel(Number(snapshotId), graph, threadRows, pageRows, []);
  const linkedObjects = linkQueryToDeepWikiObjects(retrievalQuery, graph.objects || [], 5);
  const resolvedMode = decideDeepWikiQueryMode(queryText, linkedObjects, payload.mode || 'auto');
  const retrievedDomains = rankDeepWikiDomainsAgainstQuery(retrievalQuery, domains);
  const retrievedBehaviors = rankDeepWikiBehaviorsAgainstQuery(retrievalQuery, retrievedDomains.length ? retrievedDomains : domains);
  let memoryContext = null;
  try {
    const memoryStore = require('../memory/store');
    const memoryProjectCode =
      normalizeText(payload.project_code) ||
      normalizeText(snapshot.project_code) ||
      `project-${snapshot.project_id || snapshotId}`;
    const memoryScopeKey =
      normalizeText(payload.memory_scope_key) ||
      `agt:${memoryProjectCode}:deepwiki`;
    memoryContext = await memoryStore.searchMemory({
      query: retrievalQuery,
      scope_key: memoryScopeKey,
      thread_key: normalizeText(payload.thread_key) || `deepwiki:snapshot:${snapshotId}`,
      trace_id: normalizeText(payload.trace_id) || null,
      project_code: memoryProjectCode,
      source_system: 'deepwiki',
      client_app: normalizeText(payload.client_app) || 'deepwiki',
      max_recall_tokens: Number(payload.max_recall_tokens || 500),
      persist_recall: true,
    });
  } catch {
    memoryContext = null;
  }
  let kbResults = [];
  let kbTrace = {};
  let usedFallback = false;
  try {
    const response = await searchDeepWikiKnowledgeBase(retrievalQuery, {
      run_id: snapshot.run_id,
      top_k: Number(payload.top_k || 5),
      candidate_k: Number(payload.candidate_k || 12),
      rerank_top_k: Number(payload.rerank_top_k || 8),
      query_mode: resolvedMode,
    });
    kbResults = response.results || [];
    kbTrace = response.trace || {};
  } catch {
    usedFallback = true;
    kbResults = fallbackDeepWikiPageSearch(retrievalQuery, pageRows, Number(payload.top_k || 5));
    kbTrace = { fallback: 'page_lexical' };
  }

  const neighborhoodKeys = resolvedMode === 'local'
    ? expandDeepWikiNeighborhood(linkedObjects, graph.relations || [], 12)
    : [];
  const retrievedObjects = (graph.objects || [])
    .filter((item) => {
      const key = `${item.object_type}:${item.object_key}`;
      return linkedObjects.some((linked) => linked.object_key === item.object_key && linked.object_type === item.object_type) || neighborhoodKeys.includes(key);
    })
    .slice(0, 12)
    .map((item) => ({
      id: item.id || null,
      object_type: item.object_type,
      object_key: item.object_key,
      title: item.title,
      link_score: Number(linkedObjects.find((linked) => linked.object_key === item.object_key && linked.object_type === item.object_type)?.link_score || 0),
    }));
  const rankedCommunityHits = (communityReports || [])
    .map((item) => ({
      ...item,
      rank_score: rankTextAgainstQuery(retrievalQuery, `${item.title}\n${item.summary_markdown || ''}`),
    }))
    .filter((item) => item.rank_score > 0)
    .sort((left, right) => right.rank_score - left.rank_score)
    .slice(0, DEEPWIKI_QUERY_MAX_COMMUNITIES)
    .map((item) => ({
      community_key: item.community_key,
      title: item.title,
      community_score: item.community_score,
      rank_score: item.rank_score,
      page_slugs: item.page_slugs_json || [],
      summary_markdown: item.summary_markdown || '',
    }));
  const citations = buildDeepWikiQueryCitations(kbResults, pageRows);
  const retrievedThreads = rankDeepWikiThreadsAgainstQuery(retrievalQuery, threadRows, citations);
  const preferredDomainCitations = buildPreferredDomainCitations(retrievedDomains, pageRows, resolvedMode);
  const preferredThreadCitations = buildPreferredThreadCitations(retrievedThreads, pageRows, resolvedMode);
  const mergedCitations = mergeDeepWikiCitations([...preferredDomainCitations, ...preferredThreadCitations], citations, 6);
  const answerResult = await buildDeepWikiAnswerFromContext(
    queryText,
    {
      resolved_mode: resolvedMode,
      retrieved_objects: retrievedObjects,
      retrieved_domains: retrievedDomains,
      retrieved_behaviors: retrievedBehaviors,
      community_hits: rankedCommunityHits,
      retrieved_threads: retrievedThreads,
      citations: mergedCitations,
      memory_context: memoryContext
        ? {
            recall_text: memoryContext.recall_text,
            facts: memoryContext.facts || [],
            turns: memoryContext.turns || [],
          }
        : null,
    },
    {
      provider: payload.provider,
      model: payload.model,
    }
  );
  const trace = {
    requested_mode: normalizeText(payload.mode) || 'auto',
    resolved_mode: resolvedMode,
    query_rewrite: queryRewrite,
    linked_object_keys: linkedObjects.map((item) => `${item.object_type}:${item.object_key}`),
    neighborhood_keys: neighborhoodKeys,
    domain_hits: retrievedDomains.map((item) => ({ domain_key: item.domain_key, title: item.title, rank_score: item.rank_score })),
    behavior_hits: retrievedBehaviors.map((item) => ({ domain_key: item.domain_key, behavior_key: item.object_key, title: item.title, rank_score: item.rank_score })),
    thread_hits: retrievedThreads.map((item) => ({ thread_key: item.thread_key, thread_level: item.thread_level, rank_score: item.rank_score })),
    scope_resolution: {
      preferred_scope: retrievedThreads[0]?.thread_level || retrievedDomains[0]?.domain_key || (resolvedMode === 'local' ? 'thread' : 'project'),
      resolved_mode: resolvedMode,
    },
    memory_scope_key: memoryContext?.scope_key || null,
    memory_recall: memoryContext
      ? {
          fact_count: Array.isArray(memoryContext.facts) ? memoryContext.facts.length : 0,
          turn_count: Array.isArray(memoryContext.turns) ? memoryContext.turns.length : 0,
          recall_present: Boolean(memoryContext.recall_text),
        }
      : null,
    kb_trace: kbTrace,
    used_fallback: usedFallback,
    fallback_reason: usedFallback ? normalizeText(kbTrace.fallback || 'page_lexical') : null,
  };
  const response = {
    answer: answerResult.answer,
    citations: mergedCitations,
    retrieved_pages: mergedCitations.map((item) => ({
      page_slug: item.page_slug,
      title: item.title,
      source_uri: item.source_uri,
      score: item.score,
    })),
    retrieved_objects: retrievedObjects,
    retrieved_domains: retrievedDomains,
    retrieved_behaviors: retrievedBehaviors,
    retrieved_threads: retrievedThreads,
    community_hits: rankedCommunityHits,
    trace,
    memory_context: memoryContext
      ? {
          scope_key: memoryContext.scope_key,
          recall_text: memoryContext.recall_text,
          fact_count: Array.isArray(memoryContext.facts) ? memoryContext.facts.length : 0,
          turn_count: Array.isArray(memoryContext.turns) ? memoryContext.turns.length : 0,
        }
      : null,
  };
  await createDeepWikiQueryLog({
    project_id: snapshot.project_id || null,
    snapshot_id: Number(snapshotId),
    run_id: snapshot.run_id || null,
    query_text: payload.query || '',
    query_mode: payload.mode || 'auto',
    resolved_mode: resolvedMode,
    answer_text: response.answer,
    citations_json: mergedCitations,
    trace_json: trace,
    provider: answerResult.provider,
    model: answerResult.model,
    latency_ms: Date.now() - startedAt,
    metadata_json: {
      top_k: Number(payload.top_k || 5),
      candidate_k: Number(payload.candidate_k || 12),
      rerank_top_k: Number(payload.rerank_top_k || 8),
      query_rewrite: queryRewrite,
    },
  }).catch(() => null);
  return response;
}

function buildFallbackModuleDigest(moduleInfo) {
  return [
    `- 模块职责：围绕 ${moduleInfo.name} 相关文件展开，当前基于目录与文件命名推断。`,
    `- 文件规模：共 ${moduleInfo.file_count} 个文件。`,
    `- 关键文件：${moduleInfo.source_files.slice(0, 6).join('、') || '待确认'}。`,
    '- 依赖与入口：建议从关键文件继续确认真实调用链路。',
    '- 风险提示：当前为静态摘要，细粒度业务规则仍需人工核对。',
  ].join('\n');
}

async function generateModuleDigestsForInventory(traceId, inventory, options = {}, onProgress) {
  const moduleDigests = new Array(inventory.modules.length);
  let processed = 0;
  for (let index = 0; index < inventory.modules.length; index += DEEPWIKI_MODULE_DIGEST_CONCURRENCY) {
    const batch = inventory.modules.slice(index, index + DEEPWIKI_MODULE_DIGEST_CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(async (moduleInfo) => {
        const result = await callDeepWikiGateway(
          {
            purpose: 'deepwiki',
            mode: 'summarize',
            trace_id: traceId,
            research_provider: options.provider,
            research_model: options.summary_model || options.model,
            output_format: 'markdown',
            messages: [
              {
                role: 'user',
                content: buildModuleDigestPrompt(moduleInfo, inventory),
              },
            ],
          },
          DEEPWIKI_SUMMARY_TIMEOUT_MS
        );
        return {
          name: moduleInfo.name,
          content: normalizeText(result?.content) || buildFallbackModuleDigest(moduleInfo),
        };
      })
    );

    results.forEach((item, offset) => {
      const moduleInfo = batch[offset];
      moduleDigests[index + offset] =
        item.status === 'fulfilled'
          ? item.value
          : {
              name: moduleInfo.name,
              content: buildFallbackModuleDigest(moduleInfo),
            };
      processed += 1;
      if (typeof onProgress === 'function') {
        onProgress({
          processed,
          total: inventory.modules.length,
          module_name: moduleInfo.name,
        });
      }
    });
  }
  return moduleDigests.filter(Boolean);
}

async function resolveDeepWikiProjectManifest(data = {}) {
  const versionLineId = Number(data.version_line_id || 0);
  let versionLine = null;
  let project = null;
  if (Number.isFinite(versionLineId) && versionLineId > 0) {
    versionLine = await getDeepWikiVersionLineById(versionLineId);
    if (versionLine?.project_id) {
      project = await getDeepWikiProjectByIdRecord(versionLine.project_id);
    }
  }
  if (data.project_id) {
    project = await getDeepWikiProjectByIdRecord(data.project_id);
  }

  let repoBindings = project ? await getDeepWikiProjectRepoBindings(project.id) : [];

  if (!project) {
    const explicitRepos = Array.isArray(data.repos) ? data.repos : [];
    const firstRepoUrl = normalizeText(data.repo_url || explicitRepos[0]?.repo_url);
    if (!firstRepoUrl) {
      return null;
    }
    const preflight = await preflightRepository(firstRepoUrl, data.branch || explicitRepos[0]?.branch || '');
    const repoSource = await upsertRepoSource({
      repo_url: preflight.repo_url,
      repo_slug: preflight.repo_slug,
      default_branch: preflight.default_branch,
      auth_mode: preflight.auth_mode,
      status: 'active',
      metadata_json: {
        latest_preflight: preflight,
      },
    });
    project = await ensureDeepWikiProjectForRepoSource(repoSource, {
      project_code: data.project_code,
      branch: data.branch || preflight.resolved_branch,
      created_from: 'create_run_fallback',
    });
    repoBindings = await getDeepWikiProjectRepoBindings(project.id);
  }

  const branchName =
    normalizeText(data.branch) ||
    normalizeText(versionLine?.branch || versionLine?.branch_name) ||
    project.default_branch ||
    'main';
  const branch = await upsertDeepWikiBranch(project.id, branchName, {
    display_name: branchName,
    metadata_json: {
      source: versionLine ? 'version_line' : data.project_id ? 'project' : 'fallback',
    },
  });

  const explicitRepos = Array.isArray(data.repos) ? data.repos : [];
  const explicitRepoMap = new Map();
  explicitRepos.forEach((item) => {
    const repoSourceId = Number(item.repo_source_id || 0);
    if (Number.isFinite(repoSourceId) && repoSourceId > 0) {
      explicitRepoMap.set(repoSourceId, item);
    }
  });

  let mappedRepoBranchByProjectRepoId = new Map();
  if (Number.isFinite(versionLineId) && versionLineId > 0) {
    const existingMappings = await listDeepWikiBranchRepoMappings(versionLineId);
    mappedRepoBranchByProjectRepoId = new Map(
      existingMappings
        .filter((mapping) => Number.isFinite(Number(mapping?.project_repo_id)))
        .map((mapping) => [Number(mapping.project_repo_id), normalizeText(mapping.repo_branch_name)])
        .filter((entry) => Boolean(entry[1]))
    );
  }

  const branchMappings = [];
  for (const binding of repoBindings) {
    const override = explicitRepoMap.get(Number(binding.repo_source_id)) || {};
    const repoBranchName =
      normalizeText(override.branch) ||
      normalizeText(override.repo_branch_name) ||
      mappedRepoBranchByProjectRepoId.get(Number(binding.id)) ||
      normalizeText(binding.metadata_json?.default_branch) ||
      branch.branch_name;
    const mapping = await upsertDeepWikiBranchRepoMapping(branch.id, binding.id, {
      repo_branch_name: repoBranchName,
      metadata_json: {
        repo_role: binding.repo_role,
      },
    });
    branchMappings.push({
      ...mapping,
      project_repo: binding,
    });
  }

  return {
    project,
    branch,
    repo_bindings: repoBindings,
    repo_mappings: branchMappings,
  };
}

function buildProjectManifestPayload(manifest = {}) {
  return {
    project_id: manifest.project?.id || null,
    project_code: manifest.project?.project_code || null,
    project_name: manifest.project?.project_name || null,
    branch: manifest.branch?.branch_name || null,
    repos: (manifest.repo_mappings || []).map((mapping) => ({
      project_repo_id: mapping.project_repo?.id || null,
      repo_source_id: mapping.project_repo?.repo_source_id || null,
      repo_role: mapping.project_repo?.repo_role || 'service',
      repo_slug: mapping.project_repo?.repo_source?.repo_slug || null,
      repo_url: mapping.project_repo?.repo_source?.repo_url || null,
      branch: mapping.repo_branch_name,
    })),
  };
}

async function getDeepWikiSkillPackageRow(skillKey) {
  const rows = await query(
    'SELECT * FROM gateway_skill_packages WHERE skill_key = ? AND status = ? LIMIT 1',
    [skillKey, 'active']
  );
  return rows[0] || null;
}

function loadDeepWikiSkillPromptFromRef(promptRef) {
  if (!promptRef) return '';
  const rel = String(promptRef).replace(/^\//, '');
  const abs = path.join(__dirname, '../../../', rel);
  try {
    if (fs.existsSync(abs)) {
      return fs.readFileSync(abs, 'utf8');
    }
  } catch {
    /* ignore */
  }
  return '';
}

function collectDiagramEvidence(researchReport) {
  const lines = normalizeText(researchReport)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const strongSignals = lines.filter((line) =>
    /(流程|状态|规则|公式|校验|约束|接口|DDL|数据库|表|字段|订单|金额|审核|库存|结算|单据)/i.test(line)
  );
  return strongSignals.slice(0, 24);
}

const DEEPWIKI_DIAGRAM_GENERATION_SPECS = {
  code_layered_architecture: {
    title: '代码分层架构图',
    syntax: 'graph TB',
    requirements: [
      '必须体现 Controller / Application Service / Domain Service / Repository / Model / Database 分层',
      '必须体现至少 4 种调用语义，如 调用 / 事务 / 校验 / 转换 / RPC / 持久化',
      '尽量落到真实类名、包名、DTO/VO/Entity/Mapper 名称，不要只画 views/components 这类空桶',
    ],
  },
  technical_architecture: {
    title: '技术架构图',
    syntax: 'flowchart LR',
    requirements: [
      '必须区分入口、API、服务、数据、外部依赖边界',
      '不要画成纯线性调用串图',
    ],
  },
  product_architecture: {
    title: '产品架构图',
    syntax: 'flowchart TD',
    requirements: [
      '必须体现业务能力、子系统或产品域，不要画成物理部署拓扑',
      '必须出现业务域名称或代表性模块名',
    ],
  },
  business_domain: {
    title: '业务域知识图',
    syntax: 'flowchart TD',
    requirements: [
      '必须体现业务域、核心对象、关键接口或关键表之间的知识关系',
      '如果信息不足，要明确写待确认，而不是退化成技术模块清单',
    ],
  },
  business_flow: {
    title: '业务总体流程图',
    syntax: 'flowchart LR',
    requirements: [
      '必须体现主流程与关键决策点，至少串联 5 个节点',
      '要出现真实业务动作和关键对象名称',
    ],
  },
  module_flow: {
    title: '模块结构与依赖流图',
    syntax: 'flowchart LR',
    requirements: [
      '必须体现模块之间的依赖、入口、服务和数据落点',
      '不要仅罗列模块名，要有依赖方向或流向',
    ],
  },
  core_logic: {
    title: '核心逻辑时序图',
    syntax: 'sequenceDiagram',
    requirements: [
      '必须体现真实业务动作、核心对象、关键校验/状态变化、持久化动作',
      '禁止退化成 User -> Api -> Service -> Repo -> DB 空骨架',
    ],
  },
  database_er: {
    title: '数据库 ER 图',
    syntax: 'erDiagram',
    requirements: [
      '必须优先使用真实表名、字段、外键或实体映射',
      '没有真实表时要明确缺口，不能硬画假 ER',
    ],
  },
};

function getDeepWikiDiagramGenerationOrder(requestedTypes = []) {
  const explicit = Array.isArray(requestedTypes)
    ? requestedTypes.map((item) => normalizeDeepWikiDiagramType(item, '')).filter(Boolean)
    : [];
  const order = explicit.filter((item) => item !== 'overview' && DEEPWIKI_DIAGRAM_GENERATION_SPECS[item]);
  if (order.length) return Array.from(new Set(order));
  return Object.keys(DEEPWIKI_DIAGRAM_GENERATION_SPECS);
}

function buildAggregatedOverviewDiagram(diagramContext, generatedDiagrams) {
  const generatedTypes = Object.keys(generatedDiagrams || {}).filter((item) => item !== '_meta');
  const repoUnits = Array.isArray(diagramContext?.repo?.repo_units) ? diagramContext.repo.repo_units : [];
  const repoLabel = repoUnits.length
    ? repoUnits
        .slice(0, 4)
        .map((item) => `${item.repo_role || 'repo'}:${item.repo_slug || ''}`)
        .join('<br/>')
    : (diagramContext?.repo?.repo_slug || '项目代码基线');
  const lines = ['flowchart TD', `  Project["${repoLabel}"]`];
  const fallbackTypes = [];
  if (Array.isArray(diagramContext?.layer_map?.controllers) && diagramContext.layer_map.controllers.length) {
    fallbackTypes.push('code_layered_architecture', 'technical_architecture', 'core_logic');
  }
  if (Array.isArray(diagramContext?.business_domains) && diagramContext.business_domains.length) {
    fallbackTypes.push('product_architecture', 'business_domain', 'module_flow');
  }
  if (Array.isArray(diagramContext?.api_endpoints) && diagramContext.api_endpoints.length) {
    fallbackTypes.push('business_flow');
  }
  if (Array.isArray(diagramContext?.sql_tables) && diagramContext.sql_tables.length) {
    fallbackTypes.push('database_er');
  }
  const effectiveTypes = generatedTypes.length
    ? generatedTypes
    : Array.from(new Set(fallbackTypes));
  const nodes = [
    ['code_layered_architecture', 'Layered', '代码分层架构'],
    ['technical_architecture', 'Tech', '技术架构'],
    ['product_architecture', 'Product', '产品架构'],
    ['business_domain', 'Domain', '业务域'],
    ['business_flow', 'Flow', '业务流程'],
    ['module_flow', 'Module', '模块依赖'],
    ['core_logic', 'Logic', '核心时序'],
    ['database_er', 'ER', '数据库 ER'],
  ].filter(([type]) => effectiveTypes.includes(type));
  nodes.forEach(([, nodeId, label]) => {
    lines.push(`  Project --> ${nodeId}["${label}"]`);
  });
  if (effectiveTypes.includes('code_layered_architecture') && effectiveTypes.includes('technical_architecture')) {
    lines.push('  Layered --> Tech');
  }
  if (effectiveTypes.includes('product_architecture') && effectiveTypes.includes('business_domain')) {
    lines.push('  Product --> Domain');
  }
  if (effectiveTypes.includes('business_domain') && effectiveTypes.includes('business_flow')) {
    lines.push('  Domain --> Flow');
  }
  if (effectiveTypes.includes('module_flow') && effectiveTypes.includes('core_logic')) {
    lines.push('  Module --> Logic');
  }
  if (effectiveTypes.includes('technical_architecture') && effectiveTypes.includes('database_er')) {
    lines.push('  Tech --> ER');
  }
  return lines.join('\n');
}

function buildDeepWikiDiagramContext(repoSource, snapshot, inventory, moduleDigests, researchReport) {
  const repoUnits = Array.isArray(inventory?.repo_units) ? inventory.repo_units : [];
  const services = Array.isArray(inventory?.services) ? inventory.services : [];
  const applicationServices = services.filter((item) => !/QueryService$/i.test(String(item.class_name || '')));
  const queryServices = services.filter((item) => /QueryService$/i.test(String(item.class_name || '')));
  const domainServices = services.filter((item) => /(Domain|Manager|Logic|ServiceImpl)$/i.test(String(item.class_name || '')));
  const controllersPreview = (inventory.controllers || []).slice(0, 12).map((item) => ({
    class_name: item.class_name,
    path: item.path,
    endpoints: Array.isArray(item.endpoints) ? item.endpoints.slice(0, 6) : [],
  }));
  const applicationServicePreview = applicationServices.slice(0, 16).map((item) => ({
    class_name: item.class_name,
    path: item.path,
  }));
  const queryServicePreview = queryServices.slice(0, 12).map((item) => ({
    class_name: item.class_name,
    path: item.path,
  }));
  const domainServicePreview = domainServices.slice(0, 12).map((item) => ({
    class_name: item.class_name,
    path: item.path,
  }));
  const repositoryPreview = (inventory.repositories || []).slice(0, 12).map((item) => ({
    class_name: item.class_name,
    path: item.path,
  }));
  const mapperPreview = (inventory.mapper_models || []).slice(0, 12).map((item) => ({
    class_name: item.class_name,
    path: item.path,
  }));
  const requestPreview = (inventory.request_models || []).slice(0, 16).map((item) => ({
    class_name: item.class_name,
    path: item.path,
  }));
  const dtoPreview = (inventory.dto_models || []).slice(0, 16).map((item) => ({
    class_name: item.class_name,
    path: item.path,
  }));
  const voPreview = (inventory.vo_models || []).slice(0, 16).map((item) => ({
    class_name: item.class_name,
    path: item.path,
  }));
  const criteriaPreview = (inventory.criteria_models || []).slice(0, 12).map((item) => ({
    class_name: item.class_name,
    path: item.path,
  }));
  const entityPreview = (inventory.entities || []).slice(0, 20).map((item) => ({
    class_name: item.class_name,
    table_name: item.table_name,
    path: item.path,
  }));
  const feignPreview = (inventory.feign_clients || []).slice(0, 12).map((item) => ({
    class_name: item.class_name,
    path: item.path,
  }));
  const sqlTablePreview = (inventory.sql_tables || []).slice(0, 20).map((item) => ({
    table_name: item.table_name,
    columns: Array.isArray(item.columns) ? item.columns.slice(0, 12) : [],
    references: Array.isArray(item.references) ? item.references.slice(0, 8) : [],
    path: item.path,
  }));
  const tableRelations = (inventory.sql_tables || []).flatMap((tableInfo) =>
    (Array.isArray(tableInfo.references) ? tableInfo.references : []).map((target) => ({
      from_table: tableInfo.table_name,
      to_table: target,
    }))
  );
  const evidenceLines = collectDiagramEvidence(researchReport);
  return {
    repo: {
      repo_slug: repoSource.repo_slug,
      repo_url: repoSource.repo_url,
      branch: snapshot.branch,
      commit_sha: snapshot.commit_sha,
      repo_units: repoUnits.map((item) => ({
        repo_role: item.repo_role || 'repo',
        repo_slug: item.repo_slug || '',
        branch: item.branch || '',
        commit_sha: item.commit_sha || '',
      })),
    },
    business_domains: (inventory.modules || []).slice(0, 16).map((item) => item.name),
    frontend_pages: (inventory.entry_candidates || []).slice(0, 12),
    api_endpoints: (inventory.api_endpoints || []).slice(0, 20),
    controllers: controllersPreview,
    services: services.slice(0, 16).map((item) => ({
      class_name: item.class_name,
      path: item.path,
    })),
    application_services: applicationServicePreview,
    query_services: queryServicePreview,
    domain_services: domainServicePreview,
    repositories: repositoryPreview,
    mapper_models: mapperPreview,
    request_models: requestPreview,
    dto_models: dtoPreview,
    vo_models: voPreview,
    criteria_models: criteriaPreview,
    entities: entityPreview,
    feign_clients: feignPreview,
    tables: (inventory.tables || []).slice(0, 20),
    sql_tables: sqlTablePreview,
    table_relations: tableRelations.slice(0, 20),
    layer_map: {
      controllers: (inventory.controllers || []).slice(0, 12).map((item) => item.class_name),
      application_services: applicationServices.slice(0, 12).map((item) => item.class_name),
      query_services: queryServices.slice(0, 10).map((item) => item.class_name),
      domain_services: domainServices.slice(0, 10).map((item) => item.class_name),
      repositories: (inventory.repositories || []).slice(0, 12).map((item) => item.class_name),
      models: [
        ...(inventory.request_models || []).map((item) => item.class_name),
        ...(inventory.dto_models || []).map((item) => item.class_name),
        ...(inventory.vo_models || []).map((item) => item.class_name),
        ...(inventory.entities || []).map((item) => item.class_name || item.table_name),
      ].slice(0, 24),
    },
    service_map: {
      application_services: applicationServicePreview,
      query_services: queryServicePreview,
      domain_services: domainServicePreview,
      repositories: repositoryPreview,
      rpc_clients: feignPreview,
    },
    api_map: {
      controllers: controllersPreview,
      endpoints: (inventory.api_endpoints || []).slice(0, 20).map((item) => ({
        endpoint: String(item || ''),
      })),
    },
    table_entity_map: {
      sql_tables: sqlTablePreview,
      entities: entityPreview,
      mapper_models: mapperPreview,
      request_models: requestPreview,
      dto_models: dtoPreview,
      vo_models: voPreview,
      criteria_models: criteriaPreview,
      table_relations: tableRelations.slice(0, 20),
    },
    module_digests: (moduleDigests || []).slice(0, 10).map((item) => ({
      name: item.name,
      digest: truncateText(item.content, 1000),
    })),
    evidence_lines: evidenceLines,
    rule_hints: evidenceLines.filter((line) => /(规则|校验|约束|审批|审核|驳回|作废|状态)/i.test(line)).slice(0, 12),
    state_hints: evidenceLines.filter((line) => /(状态|流转|提交|确认|审核|作废|关闭)/i.test(line)).slice(0, 12),
    formula_hints: evidenceLines.filter((line) => /(公式|金额|数量|折扣|合计|税|库存)/i.test(line)).slice(0, 12),
    research_excerpt: truncateText(researchReport, 6000),
  };
}

function buildDiagramSynthesisUserContent(
  skillBody,
  repoSource,
  snapshot,
  inventory,
  moduleDigests,
  researchReport,
  diagramContext,
  diagramType
) {
  const spec = DEEPWIKI_DIAGRAM_GENERATION_SPECS[diagramType];
  const digests = (moduleDigests || [])
    .slice(0, 10)
    .map((d) => `### ${d.name}\n${String(d.content || '').slice(0, 1400)}`)
    .join('\n\n');
  const research = truncateText(researchReport, 8000);
  return [
    skillBody.trim(),
    '',
    '## 仓库',
    `${repoSource.repo_url} @ ${snapshot.branch} ${snapshot.commit_sha}`,
    '',
    '## 盘点摘要',
    buildRepositoryContext(inventory),
    '',
    '## 模块摘要（节选）',
    digests || '无',
    '',
    '## 结构化制图上下文（JSON）',
    JSON.stringify(diagramContext || {}, null, 2),
    '',
    '## Deep Research 节选（用于构图，请结合而非照抄）',
    research || '无',
    '',
    `## 当前目标图`,
    `- 图类型：${diagramType}`,
    `- 图名称：${spec?.title || diagramType}`,
    `- 语法：${spec?.syntax || 'mermaid'}`,
    ...((spec?.requirements || []).map((item) => `- ${item}`)),
    '',
    '输出要求：仅输出一个 JSON 对象，不要再包裹额外键名。',
    'JSON 对象至少包含：',
    '- mermaid_source',
    '- diagram_summary',
    '- covered_evidence (string[])',
    '- missing_evidence (string[])',
    '- quality_notes (string[])',
    '- render_source',
    'render_source 固定写 llm_structured。',
  ].join('\n');
}

function parseDiagramSynthesisJson(content, diagramType) {
  const extractFirstJsonObject = (input) => {
    const text = normalizeText(input);
    if (!text) return null;
    const start = text.indexOf('{');
    if (start < 0) return null;
    let depth = 0;
    let inString = false;
    let escaping = false;
    for (let index = start; index < text.length; index += 1) {
      const char = text[index];
      if (inString) {
        if (escaping) {
          escaping = false;
          continue;
        }
        if (char === '\\') {
          escaping = true;
          continue;
        }
        if (char === '"') {
          inString = false;
        }
        continue;
      }
      if (char === '"') {
        inString = true;
        continue;
      }
      if (char === '{') {
        depth += 1;
        continue;
      }
      if (char === '}') {
        depth -= 1;
        if (depth === 0) {
          return text.slice(start, index + 1);
        }
      }
    }
    return null;
  };
  let text = normalizeText(content);
  if (!text) return null;
  if (text.startsWith('```')) {
    text = text.replace(/^```json?\s*/i, '').replace(/```\s*$/i, '').trim();
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    const extracted = extractFirstJsonObject(text);
    if (!extracted) return null;
    try {
      parsed = JSON.parse(extracted);
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const payload = parsed[diagramType] && typeof parsed[diagramType] === 'object' ? parsed[diagramType] : parsed;
  const mermaidSource = payload.mermaid_source || payload.content || payload.body || '';
  if (String(mermaidSource).trim().length <= 20) return null;
  return {
    mermaid_source: mermaidSource,
    diagram_summary: normalizeText(payload.diagram_summary || payload.summary),
    covered_evidence: Array.isArray(payload.covered_evidence) ? payload.covered_evidence.map((item) => String(item || '')).filter(Boolean) : [],
    missing_evidence: Array.isArray(payload.missing_evidence) ? payload.missing_evidence.map((item) => String(item || '')).filter(Boolean) : [],
    quality_notes: Array.isArray(payload.quality_notes) ? payload.quality_notes.map((item) => String(item || '')).filter(Boolean) : [],
    render_source: normalizeText(payload.render_source) || 'llm_structured',
  };
}

async function synthesizeDeepWikiDiagrams(traceId, repoSource, snapshot, inventory, moduleDigests, researchReport, options = {}) {
  const diagramContext = buildDeepWikiDiagramContext(
    repoSource,
    snapshot,
    inventory,
    moduleDigests,
    researchReport
  );
  const providerStrategy = normalizeText(options.provider_strategy) || 'default';
  if (process.env.DEEPWIKI_DIAGRAM_SYNTHESIS === '0' || process.env.DEEPWIKI_DIAGRAM_SYNTHESIS === 'false') {
    return { _meta: { ok: false, keys: [], diagram_context: diagramContext } };
  }
  let skillBody = '';
  try {
    const row = await getDeepWikiSkillPackageRow('deepwiki_diagram_synthesis');
    skillBody = loadDeepWikiSkillPromptFromRef(row?.prompt_ref);
  } catch {
    skillBody = '';
  }
  if (!skillBody.trim()) {
    skillBody = loadDeepWikiSkillPromptFromRef('ai-rules/skills/deepwiki-diagram-synthesis.md');
  }
  if (!skillBody.trim()) {
    return { _meta: { ok: false, keys: [], diagram_context: diagramContext } };
  }
  const generated = {};
  const llmGeneratedKeys = [];
  const contextGeneratedKeys = [];
  const attempts = [];
  const targetTypes = getDeepWikiDiagramGenerationOrder(options.diagram_types);
  if (providerStrategy !== 'context_only') {
    for (const diagramType of targetTypes) {
      const userContent = buildDiagramSynthesisUserContent(
        skillBody,
        repoSource,
        snapshot,
        inventory,
        moduleDigests,
        researchReport,
        diagramContext,
        diagramType
      );
      const payload = buildDiagramSynthesisGatewayPayload(traceId, userContent, {
        ...options,
        diagram_type: diagramType,
      });
      try {
        const result = await callDeepWikiGateway(payload, DEEPWIKI_DIAGRAM_SYNTHESIS_TIMEOUT_MS);
        const parsed = parseDiagramSynthesisJson(result?.content, diagramType);
        attempts.push({
          diagram_type: diagramType,
          ok: Boolean(parsed),
          provider: normalizeText(result?.provider || payload.research_provider),
          model: normalizeText(result?.model || payload.research_model),
          wire_mode: normalizeText(result?.wire_mode),
          content_preview: truncateText(result?.content, 3000),
          raw_preview: truncateText(
            (() => {
              try {
                return JSON.stringify(result?.raw || null, null, 2);
              } catch {
                return String(result?.raw || '');
              }
            })(),
            6000
          ),
        });
        if (parsed) {
          generated[diagramType] = parsed;
          llmGeneratedKeys.push(diagramType);
        }
      } catch (error) {
        attempts.push({
          diagram_type: diagramType,
          ok: false,
          provider: normalizeText(payload?.research_provider || options.provider),
          model: normalizeText(payload?.research_model || options.model),
          wire_mode: null,
          error_message: normalizeText(error?.message || error?.response?.data?.error || 'diagram_synthesis_failed'),
          error_status: Number(error?.status || error?.response?.status || 0) || null,
          error_response_preview: truncateText(
            (() => {
              try {
                return JSON.stringify(error?.response?.data || null, null, 2);
              } catch {
                return String(error?.response?.data || '');
              }
            })(),
            3000
          ),
        });
        /* ignore single diagram failure and continue */
      }
    }
  } else {
    targetTypes.forEach((diagramType) => {
      attempts.push({
        diagram_type: diagramType,
        ok: true,
        provider: 'context_only',
        model: 'context_structured',
        wire_mode: null,
        content_preview: '',
        raw_preview: 'diagram generation skipped gateway and used context_structured directly',
      });
    });
  }
  targetTypes.forEach((diagramType) => {
    if (generated[diagramType]) return;
    const contextStructured = buildContextStructuredDiagram(diagramType, inventory);
    if (!contextStructured) return;
    generated[diagramType] = contextStructured;
    contextGeneratedKeys.push(diagramType);
  });
  const fallbackOverviewTypes = [
    Array.isArray(diagramContext?.layer_map?.controllers) && diagramContext.layer_map.controllers.length ? 'code_layered_architecture' : null,
    Array.isArray(diagramContext?.layer_map?.controllers) && diagramContext.layer_map.controllers.length ? 'technical_architecture' : null,
    Array.isArray(diagramContext?.business_domains) && diagramContext.business_domains.length ? 'product_architecture' : null,
    Array.isArray(diagramContext?.business_domains) && diagramContext.business_domains.length ? 'business_domain' : null,
    Array.isArray(diagramContext?.api_endpoints) && diagramContext.api_endpoints.length ? 'business_flow' : null,
    Array.isArray(diagramContext?.business_domains) && diagramContext.business_domains.length ? 'module_flow' : null,
    Array.isArray(diagramContext?.layer_map?.controllers) && diagramContext.layer_map.controllers.length ? 'core_logic' : null,
    Array.isArray(diagramContext?.sql_tables) && diagramContext.sql_tables.length ? 'database_er' : null,
  ].filter(Boolean);
  const allGeneratedKeys = [...llmGeneratedKeys, ...contextGeneratedKeys];
  const overviewSourceTypes = allGeneratedKeys.length ? allGeneratedKeys : Array.from(new Set(fallbackOverviewTypes));
  generated.overview = {
    mermaid_source: buildAggregatedOverviewDiagram(diagramContext, generated),
    diagram_summary: `本总图聚合 ${overviewSourceTypes.length} 类架构信号，用于从项目级视角串联代码分层、技术架构、业务域、流程与数据库。`,
    covered_evidence: overviewSourceTypes.map((item) =>
      `${item}:${llmGeneratedKeys.includes(item) ? 'generated' : contextGeneratedKeys.includes(item) ? 'context_structured' : 'diagram_context'}`
    ),
    missing_evidence: overviewSourceTypes.length ? [] : ['当前尚未生成任何可用的图谱线索'],
    quality_notes: llmGeneratedKeys.length
      ? ['overview 由正式子图资产聚合生成']
      : contextGeneratedKeys.length
        ? ['overview 由 context_structured 子图资产聚合生成']
      : ['overview 基于 diagram_context 聚合生成，关键图仍建议继续补跑结构化版本'],
    render_source: 'aggregated_overview',
  };
  return {
    ...generated,
    _meta: {
      ok: allGeneratedKeys.length > 0,
      keys: [...allGeneratedKeys, 'overview'],
      llm_keys: llmGeneratedKeys,
      context_keys: contextGeneratedKeys,
      diagram_context: diagramContext,
      attempts,
    },
  };
}

function buildRepoUnitsResearchPayload(inventory, repoSource, snapshot) {
  const units = Array.isArray(inventory?.repo_units) ? inventory.repo_units : [];
  if (units.length > 1) {
    return units.map((u) => ({
      repo_role: u.repo_role || 'service',
      repo_slug: u.repo_slug || '',
      repo_url: u.repo_url || null,
      branch: u.branch || '',
      commit_sha: u.commit_sha || '',
    }));
  }
  if (units.length === 1) {
    const u = units[0];
    return [
      {
        repo_role: u.repo_role || 'primary',
        repo_slug: u.repo_slug || repoSource.repo_slug,
        repo_url: u.repo_url || repoSource.repo_url,
        branch: u.branch || snapshot.branch,
        commit_sha: u.commit_sha || snapshot.commit_sha,
      },
    ];
  }
  return [
    {
      repo_role: 'primary',
      repo_slug: repoSource.repo_slug,
      repo_url: repoSource.repo_url,
      branch: snapshot.branch,
      commit_sha: snapshot.commit_sha,
    },
  ];
}

function buildFallbackResearchReport(repoSource, snapshot, inventory, moduleDigests, focusPrompt) {
  const units = buildRepoUnitsResearchPayload(inventory, repoSource, snapshot);
  const multi = units.length > 1;
  const head = multi
    ? [
        '# Deep Research 综合分析（兜底版 · 多仓）',
        '',
        '## 仓库清单',
        ...units.map(
          (u) =>
            `- **${u.repo_role}** ${u.repo_slug} · ${u.branch}@${String(u.commit_sha).slice(0, 12)} · ${u.repo_url || ''}`,
        ),
        '',
      ]
    : [
        '# Deep Research 综合分析（兜底版）',
        '',
        `- 仓库：${repoSource.repo_url}`,
        `- 分支：${snapshot.branch}`,
        `- 提交：${snapshot.commit_sha}`,
      ];
  return [
    ...head,
    focusPrompt ? `- 关注点：${focusPrompt}` : '- 关注点：全仓库通览',
    '',
    '## 仓库上下文',
    buildRepositoryContext(inventory),
    '',
    '## 模块摘要',
    ...moduleDigests.map((item) => `### ${item.name}\n${item.content}`),
  ].join('\n');
}

async function generateDeepResearchReport(traceId, repoSource, snapshot, inventory, moduleDigests, focusPrompt, options = {}) {
  const repoUnits = buildRepoUnitsResearchPayload(inventory, repoSource, snapshot);
  const multiRepo = repoUnits.length > 1;
  try {
    const result = await callDeepWikiGateway({
      purpose: 'deepwiki',
      mode: 'deep_research',
      trace_id: traceId,
      research_provider: options.provider,
      research_model: options.model,
      output_format: 'markdown',
      output_profile: options.output_profile || 'engineering_architecture_pack',
      diagram_profile: options.diagram_profile || 'full',
      focus_prompt: focusPrompt || '',
      repo_context: {
        repo_url: repoSource.repo_url,
        repo_slug: repoSource.repo_slug,
        branch: snapshot.branch,
        commit_sha: snapshot.commit_sha,
        multi_repo: multiRepo,
        repo_units: repoUnits,
        inventory_summary: buildRepositoryContext(inventory),
        modules: moduleDigests,
      },
    }, DEEPWIKI_DEEP_RESEARCH_TIMEOUT_MS);
    return normalizeText(result?.content) || buildFallbackResearchReport(repoSource, snapshot, inventory, moduleDigests, focusPrompt);
  } catch {
    return buildFallbackResearchReport(repoSource, snapshot, inventory, moduleDigests, focusPrompt);
  }
}

function writeDeepWikiArtifacts(outputRoot, pages, manifest, extras = {}) {
  ensureDir(outputRoot);
  for (const page of pages) {
    const targetPath = buildDeepWikiPageFilePath(outputRoot, page);
    ensureDir(path.dirname(targetPath));
    fs.writeFileSync(targetPath, page.content, 'utf8');
  }
  fs.writeFileSync(path.join(outputRoot, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  for (const [name, value] of Object.entries(extras)) {
    fs.writeFileSync(path.join(outputRoot, name), typeof value === 'string' ? value : JSON.stringify(value, null, 2), 'utf8');
  }
}

async function createDeepWikiRunRequest(data = {}, options = {}) {
  const manifest = options.project_manifest || (await resolveDeepWikiProjectManifest(data));
  if (!manifest?.project || !manifest?.repo_bindings?.length) {
    throw new Error('project manifest is required');
  }
  const primaryBinding =
    manifest.repo_bindings.find((item) => Boolean(item.is_primary)) ||
    manifest.repo_bindings[0];
  const primaryRepoSource = primaryBinding.repo_source;
  const primaryMapping =
    manifest.repo_mappings.find((item) => Number(item.project_repo?.id) === Number(primaryBinding.id)) ||
    manifest.repo_mappings[0];
  const repoUrl = normalizeText(primaryRepoSource?.repo_url);
  const preflight =
    options.preflight ||
    (await preflightRepository(repoUrl, primaryMapping?.repo_branch_name || data.branch || ''));
  const repoSource = await upsertRepoSource({
    repo_url: preflight.repo_url,
    repo_slug: preflight.repo_slug,
    default_branch: preflight.default_branch,
    auth_mode: preflight.auth_mode,
    status: 'active',
    metadata_json: {
      ...parseJson(primaryRepoSource?.metadata_json, {}),
      latest_preflight: preflight,
    },
  });
  const repoSyncDefaults = normalizeDeepWikiSyncMetadata(repoSource?.metadata_json?.sync, {});
  const providerCatalog = await getDeepWikiProviders().catch(() => ({}));
  const researchProvider = resolveResearchProvider({
    requestedProvider: data.research_provider,
    repoSyncProvider: repoSyncDefaults.research_provider,
    defaultProvider: providerCatalog?.default_provider,
    fallbackProvider: 'qwen_dashscope_native',
  });
  const researchModel = normalizeText(data.research_model) || repoSyncDefaults.research_model || '';
  const providerStrategy = normalizeText(data.provider_strategy) || 'default';
  const outputProfile = normalizeText(data.output_profile) || repoSyncDefaults.output_profile || 'engineering_architecture_pack';
  const diagramProfile = normalizeText(data.diagram_profile) || repoSyncDefaults.diagram_profile || 'full';

  const pipeline = await ensureDeepWikiPipeline();
  const traceId = `trace-deepwiki-${uuidv4().replace(/-/g, '').slice(0, 16)}`;
  // DeepWiki runs always belong to a DeepWiki project (manifest.project).
  // Earlier only data.project_code (request body) was threaded through, so
  // runs created from workbench/regenerate buttons — which do not include
  // project_code in the body — landed in gateway_pipeline_runs with a NULL
  // project_code and showed blank in the ThinCore orchestration table.
  const resolvedProjectCode =
    normalizeText(data.project_code)
    || normalizeText(manifest.project?.project_code)
    || null;
  const pipelineRun = await startPipelineRun(pipeline.id, {
    trace_id: traceId,
    project_code: resolvedProjectCode,
    source_type: 'manual',
    entry_event: 'deepwiki-pipeline-v1',
    status: 'queued',
    approval_status: 'approved',
  });

  const result = await query(
    `INSERT INTO gateway_deepwiki_runs
     (trace_id, repo_source_id, pipeline_run_id, status, current_stage, summary_json)
     VALUES (?, ?, ?, ?, ?, CAST(? AS JSON))`,
    [
      traceId,
      repoSource.id,
      pipelineRun?.id || null,
      'queued',
      'preflight',
      stringifyJson(deepWikiSummaryDefaults({
        preflight,
        project_manifest: buildProjectManifestPayload(manifest),
        focus_prompt: data.focus_prompt || '',
        research_provider: researchProvider,
        research_model: researchModel,
        provider_strategy: providerStrategy,
        output_profile: outputProfile,
        diagram_profile: diagramProfile,
        runtime_result: 'queued',
        queue_position: null,
        run_started_at: null,
      })),
    ]
  );

  const run = await getDeepWikiRunById(result.insertId);
  return {
    run_id: run.id,
    trace_id: run.trace_id,
    status: run.status,
    preflight,
    run,
  };
}

async function requestDeepWikiSync(data = {}) {
  const manifest = await resolveDeepWikiProjectManifest(data);
  if (!manifest?.project || !manifest?.repo_bindings?.length) {
    throw new Error('project manifest is required');
  }
  const primaryBinding =
    manifest.repo_bindings.find((item) => Boolean(item.is_primary)) ||
    manifest.repo_bindings[0];
  const primaryMapping =
    manifest.repo_mappings.find((item) => Number(item.project_repo?.id) === Number(primaryBinding.id)) ||
    manifest.repo_mappings[0];
  const repoSource = primaryBinding.repo_source;
  const preflight = await preflightRepository(repoSource.repo_url, primaryMapping?.repo_branch_name || data.branch || '');
  await upsertRepoSource({
    repo_url: preflight.repo_url,
    repo_slug: preflight.repo_slug,
    default_branch: preflight.default_branch,
    auth_mode: preflight.auth_mode,
    status: 'active',
    metadata_json: {
      ...parseJson(repoSource.metadata_json, {}),
      latest_preflight: preflight,
    },
  });

  const latestRun = await getLatestDeepWikiRunForRepo(repoSource.id, preflight.resolved_branch);
  const latestCommit =
    latestRun?.commit_sha ||
    deepWikiSummaryDefaults(latestRun?.summary_json || {}).preflight?.commit_sha ||
    null;
  const sameCommit = latestCommit && latestCommit === preflight.commit_sha;

  if (sameCommit && !data.force) {
    const existing = await getDeepWikiRunById(latestRun.id);
    return {
      noop: true,
      reason: 'up_to_date',
      run_id: existing?.id || latestRun.id,
      trace_id: existing?.trace_id || latestRun.trace_id,
      status: existing?.status || latestRun.status,
      preflight,
      run: existing || latestRun,
    };
  }

  return createDeepWikiRunRequest(
    {
      ...data,
      repo_url: preflight.repo_url,
      branch: preflight.resolved_branch,
    },
    { preflight, project_manifest: manifest }
  );
}

async function resetDeepWikiRunForRetry(id) {
  const run = await getDeepWikiRunRecord(id);
  if (!run) return null;
  await patchDeepWikiRun(id, {
    status: 'queued',
    current_stage: 'preflight',
    summary_json: {
      runtime_result: 'queued',
      stalled: false,
      progress_percent: 0,
      estimated_remaining_seconds: null,
      current_stage_started_at: null,
      heartbeat_at: new Date().toISOString(),
      last_error: null,
      stage_progress: buildDefaultDeepWikiStageProgress({}),
    },
  });
  if (run.pipeline_run_id) {
    await query(
      `UPDATE gateway_pipeline_runs
       SET status = ?, approval_status = ?, ended_at = NULL, updated_at = NOW()
       WHERE id = ?`,
      ['queued', 'approved', run.pipeline_run_id]
    );
    await query(
      `UPDATE gateway_run_nodes
       SET status = 'pending', output_summary = NULL, error_message = NULL, gate_execution_id = NULL, ended_at = NULL, updated_at = NOW()
       WHERE pipeline_run_id = ?`,
      [run.pipeline_run_id]
    );
  }
  return getDeepWikiRunById(id);
}

async function reingestDeepWikiRun(id) {
  const run = await getDeepWikiRunById(id);
  if (!run) return null;
  let readyCount = 0;
  for (const page of run.pages) {
    if (!page.knowledge_asset_id) continue;
    try {
      await ingestKnowledgeAsset(page.knowledge_asset_id, { collection: DEFAULT_DEEPWIKI_COLLECTION });
      readyCount += 1;
      await query(
        `UPDATE gateway_deepwiki_pages
         SET ingest_status = ?, updated_at = NOW()
         WHERE id = ?`,
        ['ready', page.id]
      );
    } catch (error) {
      await query(
        `UPDATE gateway_deepwiki_pages
         SET ingest_status = ?, updated_at = NOW()
         WHERE id = ?`,
        ['failed', page.id]
      );
      await appendDeepWikiRunLog(id, `重新入库失败：${page.page_slug} - ${error.message}`, 'rag_ingest', 'error');
    }
  }
  await patchDeepWikiRun(id, {
    summary_json: {
      last_reingest_at: new Date().toISOString(),
      reingest_ready_count: readyCount,
    },
  });
  return getDeepWikiRunById(id);
}

async function listRunningDeepWikiRuns() {
  const rows = await query(
    `SELECT *
     FROM gateway_deepwiki_runs
     WHERE status = 'running'
     ORDER BY updated_at ASC, id ASC`
  );
  return rows.map(mapDeepWikiRunRow);
}

function shouldMarkDeepWikiRunStalled(run) {
  const summary = deepWikiSummaryDefaults(run.summary_json || {});
  const currentStage = normalizeText(run.current_stage);
  if (!currentStage || !DEEPWIKI_STAGE_ORDER.includes(currentStage)) return false;
  const heartbeat = parseIsoTime(summary.heartbeat_at) || parseIsoTime(run.updated_at);
  const stageStartedAt =
    parseIsoTime(summary.current_stage_started_at) ||
    parseIsoTime(summary.stage_progress?.[currentStage]?.started_at) ||
    parseIsoTime(run.updated_at);
  const now = Date.now();
  const timeoutMs = getDeepWikiStageTimeoutMs(currentStage, summary);
  return Boolean(stageStartedAt) && now - Math.max(stageStartedAt, heartbeat || stageStartedAt) >= timeoutMs;
}

async function markDeepWikiRunStalled(run, reason = 'stage_timeout') {
  const summary = deepWikiSummaryDefaults(run.summary_json || {});
  const stage = normalizeText(run.current_stage) || 'unknown';
  const timeoutMs = getDeepWikiStageTimeoutMs(stage, summary);
  const nowIso = new Date().toISOString();
  const stageProgress = buildDeepWikiStageProgress(summary, stage, {
    status: 'stalled',
    completed_at: nowIso,
    duration_ms:
      (parseIsoTime(nowIso) - parseIsoTime(summary.current_stage_started_at || summary.stage_progress?.[stage]?.started_at || nowIso)),
    last_message: `阶段超时：${stage}`,
  });
  await patchDeepWikiRun(run.id, {
    status: 'failed',
    current_stage: stage,
    summary_json: {
      ...summary,
      stalled: true,
      runtime_result: 'stalled',
      heartbeat_at: nowIso,
      stage_progress: stageProgress,
      last_error: {
        stage,
        reason,
        timeout_ms: timeoutMs,
        message: `Deep Wiki 阶段超时：${stage}`,
        at: nowIso,
      },
    },
  });
  if (run.pipeline_run_id) {
    await updateRunNodeStatus(run.pipeline_run_id, stage, {
      status: 'failed',
      error_message: `Deep Wiki 阶段超时：${stage}`,
      output_summary: `stalled after ${timeoutMs}ms`,
    });
    await query(
      `UPDATE gateway_pipeline_runs
       SET status = ?, approval_status = ?, ended_at = NOW(), updated_at = NOW()
       WHERE id = ?`,
      ['failed', 'pending', run.pipeline_run_id]
    );
  }
  await appendDeepWikiRunLog(run.id, `阶段超时，任务已标记失败：${stage}`, stage, 'error');
  return getDeepWikiRunById(run.id);
}

async function sweepStalledDeepWikiRuns() {
  const runningRuns = await listRunningDeepWikiRuns();
  const results = [];
  for (const run of runningRuns) {
    if (!shouldMarkDeepWikiRunStalled(run)) continue;
    const updated = await markDeepWikiRunStalled(run);
    results.push({
      id: updated?.id || run.id,
      trace_id: updated?.trace_id || run.trace_id,
      current_stage: run.current_stage,
      status: updated?.status || 'failed',
    });
  }
  return results;
}

async function executeDeepWikiRun(runId) {
  let run = await getDeepWikiRunById(runId);
  if (!run) return null;
  if (run.status === 'running') return run;

  const repoSource = run.repo_source;
  const summary = deepWikiSummaryDefaults(run.summary_json || {});
  const projectManifest = getRecordLike(summary.project_manifest, {});
  const preflight = summary.preflight || (await preflightRepository(repoSource.repo_url, ''));
  const focusPrompt = summary.focus_prompt || '';
  const researchProvider = summary.research_provider || 'qwen_dashscope_native';
  const researchModel = summary.research_model || '';
  const providerStrategy = normalizeText(summary.provider_strategy) || 'default';
  const outputProfile = summary.output_profile || 'engineering_architecture_pack';
  const diagramProfile = summary.diagram_profile || 'full';
  let snapshot = run.snapshot;
  let projectSnapshot = null;
  let project = null;
  let inventory = null;
  let moduleDigests = [];
  let researchReport = null;
  let synthesizedDiagrams = null;
  let pages = [];
  let knowledgeGraph = null;
  let threadRecords = [];
  let preparedRepoUnits = [];
  let executableKnowledge = { flows: [], assertions: [], scenarios: [] };
  let qualityReport = null;
  let communityReports = [];
  let retrievalEval = null;
  let outputRoot = run.output_root || null;
  let knowledgeOsBundle = null;
  let coverageReport = null;

  const refreshRun = async () => {
    run = await getDeepWikiRunById(runId);
    return run;
  };

  const failRun = async (stage, error) => {
    const currentSummary = deepWikiSummaryDefaults(run.summary_json || {});
    const nowIso = new Date().toISOString();
    await patchDeepWikiRun(runId, {
      status: 'failed',
      current_stage: stage,
      summary_json: {
        ...currentSummary,
        heartbeat_at: nowIso,
        stalled: currentSummary.stalled || false,
        runtime_result: currentSummary.stalled ? 'stalled' : 'failed',
        stage_progress: buildDeepWikiStageProgress(currentSummary, stage, {
          status: currentSummary.stalled ? 'stalled' : 'failed',
          completed_at: nowIso,
          duration_ms: parseIsoTime(nowIso) - parseIsoTime(currentSummary.current_stage_started_at || currentSummary.stage_progress?.[stage]?.started_at || nowIso),
          last_message: error.message,
        }),
        last_error: {
          stage,
          message: error.message,
          at: new Date().toISOString(),
        },
      },
    });
    if (run.pipeline_run_id) {
      await updateRunNodeStatus(run.pipeline_run_id, stage, {
        status: 'failed',
        error_message: error.message,
        output_summary: error.message,
      });
      await query(
        `UPDATE gateway_pipeline_runs
         SET status = ?, approval_status = ?, ended_at = NOW(), updated_at = NOW()
         WHERE id = ?`,
        ['failed', 'pending', run.pipeline_run_id]
      );
    }
    await appendDeepWikiRunLog(runId, error.message, stage, 'error');
    await refreshRun();
    throw error;
  };

  const runStage = async (stage, executor) => {
    try {
      const previousSummary = deepWikiSummaryDefaults(run.summary_json || {});
      const nowIso = new Date().toISOString();
      await patchDeepWikiRun(runId, {
        status: 'running',
        current_stage: stage,
        summary_json: {
          ...previousSummary,
          run_started_at: previousSummary.run_started_at || nowIso,
          current_stage_started_at: nowIso,
          heartbeat_at: nowIso,
          stalled: false,
          runtime_result: 'running',
          stage_progress: buildDeepWikiStageProgress(previousSummary, stage, {
            status: 'running',
            started_at: nowIso,
            completed_at: null,
            duration_ms: null,
            processed: previousSummary.stage_progress?.[stage]?.processed || 0,
            total: previousSummary.stage_progress?.[stage]?.total || 0,
            last_message: `开始执行阶段：${stage}`,
          }),
        },
      });
      if (run.pipeline_run_id) {
        await updateRunNodeStatus(run.pipeline_run_id, stage, {
          status: 'running',
          output_summary: `${stage} running`,
          error_message: null,
        });
      }
      await appendDeepWikiRunLog(runId, `开始执行阶段：${stage}`, stage);
      await refreshRun();
      const result = await executor();
      const completedSummary = deepWikiSummaryDefaults((await getDeepWikiRunRecord(runId))?.summary_json || run.summary_json || {});
      const completedAt = new Date().toISOString();
      await patchDeepWikiRun(runId, {
        summary_json: {
          ...completedSummary,
          heartbeat_at: completedAt,
          runtime_result: 'running',
          stage_progress: buildDeepWikiStageProgress(completedSummary, stage, {
            ...completedSummary.stage_progress?.[stage],
            status: 'completed',
            completed_at: completedAt,
            duration_ms: parseIsoTime(completedAt) - parseIsoTime(completedSummary.current_stage_started_at || completedSummary.stage_progress?.[stage]?.started_at || completedAt),
            last_message: result?.log_message || `阶段完成：${stage}`,
          }),
        },
      });
      if (run.pipeline_run_id) {
        await updateRunNodeStatus(run.pipeline_run_id, stage, {
          status: 'completed',
          output_summary: result?.output_summary || `${stage} completed`,
        });
      }
      await appendDeepWikiRunLog(runId, result?.log_message || `阶段完成：${stage}`, stage);
      await refreshRun();
      return result;
    } catch (error) {
      return failRun(stage, error);
    }
  };

  if (run.pipeline_run_id) {
    await query(
      `UPDATE gateway_pipeline_runs
       SET status = ?, approval_status = ?, updated_at = NOW()
       WHERE id = ?`,
      ['running', 'approved', run.pipeline_run_id]
    );
  }

  await runStage('repo_prepare', async () => {
    const storageRoot = getDeepWikiStorageRoot();
    const manifestRepos = Array.isArray(projectManifest.repos) ? projectManifest.repos : [];
    if (manifestRepos.length) {
      preparedRepoUnits = [];
      for (const manifestRepo of manifestRepos) {
        const manifestRepoSource =
          (manifestRepo.repo_source_id ? await getRepoSourceById(manifestRepo.repo_source_id) : null) ||
          (manifestRepo.repo_url ? await getRepoSourceByUrl(manifestRepo.repo_url) : null);
        if (!manifestRepoSource) {
          throw new Error(`Project manifest repo not found: ${manifestRepo.repo_source_id || manifestRepo.repo_url || 'unknown'}`);
        }
        const prepared = await prepareRepositorySnapshot({
          repoUrl: manifestRepoSource.repo_url,
          branch: manifestRepo.branch || manifestRepoSource.default_branch || 'main',
          storageRoot,
          repoSlug: manifestRepoSource.repo_slug || deriveRepoSlug(manifestRepoSource.repo_url),
        });
        const repoSnapshot = await createRepoSnapshot({
          repo_source_id: manifestRepoSource.id,
          branch: prepared.branch,
          commit_sha: prepared.commit_sha,
          local_path: prepared.local_path,
          manifest_json: {
            cache_path: prepared.cache_path,
            repo_role: manifestRepo.repo_role || 'service',
          },
        });
        preparedRepoUnits.push({
          project_repo_id: manifestRepo.project_repo_id || null,
          repo_source_id: manifestRepoSource.id,
          repo_role: manifestRepo.repo_role || 'service',
          repo_slug: manifestRepoSource.repo_slug,
          repo_url: manifestRepoSource.repo_url,
          branch: prepared.branch,
          commit_sha: prepared.commit_sha,
          cache_path: prepared.cache_path,
          local_path: prepared.local_path,
          repo_snapshot_id: repoSnapshot.id,
        });
      }
      const primaryPrepared = preparedRepoUnits[0];
      outputRoot = buildDeepWikiOutputRoot(projectManifest.project_code || repoSource.repo_slug, primaryPrepared.branch, primaryPrepared.commit_sha);
      ensureDir(outputRoot);
      snapshot = await getRepoSnapshotById(primaryPrepared.repo_snapshot_id);
    } else {
      const prepared = await prepareRepositorySnapshot({
        repoUrl: repoSource.repo_url,
        branch: preflight.resolved_branch || repoSource.default_branch || 'main',
        storageRoot,
        repoSlug: repoSource.repo_slug || deriveRepoSlug(repoSource.repo_url),
      });
      outputRoot = buildDeepWikiOutputRoot(repoSource.repo_slug, prepared.branch, prepared.commit_sha);
      ensureDir(outputRoot);
      snapshot = await createRepoSnapshot({
        repo_source_id: repoSource.id,
        branch: prepared.branch,
        commit_sha: prepared.commit_sha,
        local_path: prepared.local_path,
        manifest_json: {
          cache_path: prepared.cache_path,
        },
      });
      preparedRepoUnits = [{
        project_repo_id: null,
        repo_source_id: repoSource.id,
        repo_role: 'backend',
        repo_slug: repoSource.repo_slug,
        repo_url: repoSource.repo_url,
        branch: prepared.branch,
        commit_sha: prepared.commit_sha,
        cache_path: prepared.cache_path,
        local_path: prepared.local_path,
        repo_snapshot_id: snapshot.id,
      }];
    }
    await patchDeepWikiRun(runId, {
      snapshot_id: snapshot.id,
      output_root: outputRoot,
      summary_json: {
        preflight: {
          ...preflight,
          resolved_branch: snapshot.branch,
          commit_sha: snapshot.commit_sha,
        },
        project_manifest: {
          ...projectManifest,
          repos: preparedRepoUnits.map((item) => ({
            project_repo_id: item.project_repo_id,
            repo_source_id: item.repo_source_id,
            repo_role: item.repo_role,
            repo_slug: item.repo_slug,
            repo_url: item.repo_url,
            branch: item.branch,
            commit_sha: item.commit_sha,
          })),
        },
        stage_progress: buildDeepWikiStageProgress(run.summary_json || {}, 'repo_prepare', {
          status: 'running',
          processed: preparedRepoUnits.length,
          total: preparedRepoUnits.length,
          last_message: `项目仓库快照已准备：${preparedRepoUnits.map((item) => `${item.repo_role}:${item.branch}@${item.commit_sha.slice(0, 12)}`).join('，')}`,
        }),
      },
    });
    return {
      output_summary: `${preparedRepoUnits.length} repos prepared`,
      log_message: `项目仓库快照已准备：${preparedRepoUnits.length} 个仓库`,
    };
  });

  await runStage('repo_inventory', async () => {
    inventory = preparedRepoUnits.length > 1
      ? collectProjectManifestInventory(preparedRepoUnits)
      : collectRepositoryInventory(snapshot.local_path);
    await patchDeepWikiRun(runId, {
      summary_json: {
        inventory: {
          total_files: inventory.total_files,
          readable_files: inventory.readable_files,
          package_manager: inventory.package_manager,
          frameworks: inventory.frameworks,
          top_languages: inventory.top_languages,
          modules: inventory.modules.map((item) => ({ name: item.name, file_count: item.file_count })),
          module_merge_policy: inventory.module_merge_policy || null,
          repo_unit_count: Array.isArray(inventory.repo_units) ? inventory.repo_units.length : 0,
        },
        stage_progress: buildDeepWikiStageProgress(run.summary_json || {}, 'repo_inventory', {
          status: 'running',
          processed: inventory.readable_files,
          total: inventory.total_files,
          last_message: `仓库盘点完成：${inventory.total_files} 个文件，识别 ${inventory.modules.length} 个模块`,
        }),
      },
    });
    fs.writeFileSync(path.join(outputRoot, 'inventory.json'), JSON.stringify(inventory, null, 2), 'utf8');
    try {
      knowledgeOsBundle = loadKnowledgeOsBundleSafe({ repo_slug: repoSource.repo_slug });
      if (knowledgeOsBundle) {
        const specSnapshot = {
          version: knowledgeOsBundle.version,
          namespace: knowledgeOsBundle.namespace,
          skill_registry: knowledgeOsBundle.skill_registry,
          quality_gates: knowledgeOsBundle.quality_gates,
          pipelines: knowledgeOsBundle.pipelines,
          doc_standards: knowledgeOsBundle.doc_standards,
          project_override: knowledgeOsBundle.project_override,
        };
        fs.writeFileSync(
          path.join(outputRoot, 'skills_spec_snapshot.yaml'),
          yaml.dump(specSnapshot, { lineWidth: 120 }),
          'utf8'
        );
      }
    } catch (error) {
      await appendDeepWikiRunLog(runId, `Knowledge OS 规范快照写入失败：${error.message}`, 'repo_inventory', 'warn');
    }
    return {
      output_summary: `${inventory.total_files} files / ${inventory.modules.length} modules`,
      log_message: `仓库盘点完成：${inventory.total_files} 个文件，识别 ${inventory.modules.length} 个模块`,
    };
  });

  await runStage('module_digest', async () => {
    const totalModules = Array.isArray(inventory?.modules) ? inventory.modules.length : 0;
    await patchDeepWikiRun(runId, {
      summary_json: {
        stage_progress: buildDeepWikiStageProgress(run.summary_json || {}, 'module_digest', {
          status: 'running',
          processed: 0,
          total: totalModules,
          last_message: '模块摘要生成中',
        }),
      },
    });
    moduleDigests = await generateModuleDigestsForInventory(run.trace_id, inventory, {
      provider: researchProvider,
      model: researchModel,
    }, async (progress) => {
      await patchDeepWikiRun(runId, {
        summary_json: {
          heartbeat_at: new Date().toISOString(),
          stage_progress: buildDeepWikiStageProgress((await getDeepWikiRunRecord(runId))?.summary_json || run.summary_json || {}, 'module_digest', {
            status: 'running',
            processed: progress.processed,
            total: progress.total,
            last_message: `模块摘要生成中：${progress.module_name}`,
          }),
        },
      });
    });
    await patchDeepWikiRun(runId, {
      summary_json: {
        module_digests: moduleDigests,
        stage_progress: buildDeepWikiStageProgress(run.summary_json || {}, 'module_digest', {
          status: 'running',
          processed: moduleDigests.length,
          total: totalModules,
          last_message: `模块摘要完成：${moduleDigests.length} 个模块`,
        }),
      },
    });
    fs.writeFileSync(path.join(outputRoot, 'module-digests.json'), JSON.stringify(moduleDigests, null, 2), 'utf8');
    return {
      output_summary: `${moduleDigests.length} module digests`,
      log_message: `模块摘要完成：${moduleDigests.length} 个模块`,
    };
  });

  await runStage('deep_research_outline', async () => {
    researchReport = await generateDeepResearchReport(
      run.trace_id,
      repoSource,
      snapshot,
      inventory,
      moduleDigests,
      focusPrompt,
      {
        provider: researchProvider,
        model: researchModel,
        output_profile: outputProfile,
        diagram_profile: diagramProfile,
      }
    );
    await patchDeepWikiRun(runId, {
      summary_json: {
        research: {
          generated_at: new Date().toISOString(),
          excerpt: truncateText(researchReport, 2000),
          provider: researchProvider,
          model: researchModel,
        },
        stage_progress: buildDeepWikiStageProgress(run.summary_json || {}, 'deep_research_outline', {
          status: 'running',
          processed: 1,
          total: 1,
          last_message: 'Deep Research 综合分析完成',
        }),
      },
    });
    fs.writeFileSync(path.join(outputRoot, 'deep-research.md'), researchReport, 'utf8');
    return {
      output_summary: 'deep research generated',
      log_message: 'Deep Research 综合分析完成',
    };
  });

  await runStage('diagram_synthesis', async () => {
    synthesizedDiagrams = await synthesizeDeepWikiDiagrams(
      run.trace_id,
      repoSource,
      snapshot,
      inventory,
      moduleDigests,
      researchReport,
      {
        provider: researchProvider,
        model: researchModel,
        diagram_model: process.env.DEEPWIKI_DIAGRAM_MODEL || '',
        provider_strategy: providerStrategy,
      }
    );
    try {
      fs.writeFileSync(
        path.join(outputRoot, 'diagram-synthesis.json'),
        JSON.stringify(synthesizedDiagrams || { _meta: { ok: false } }, null, 2),
        'utf8'
      );
      if (synthesizedDiagrams?._meta?.diagram_context) {
        fs.writeFileSync(
          path.join(outputRoot, 'diagram_context.json'),
          JSON.stringify(synthesizedDiagrams._meta.diagram_context, null, 2),
          'utf8'
        );
      }
      if (Array.isArray(synthesizedDiagrams?._meta?.attempts)) {
        fs.writeFileSync(
          path.join(outputRoot, 'diagram-synthesis-debug.json'),
          JSON.stringify(synthesizedDiagrams._meta.attempts, null, 2),
          'utf8'
        );
      }
    } catch {
      /* ignore */
    }
    await patchDeepWikiRun(runId, {
      summary_json: {
        diagram_synthesis: {
          ok: Boolean(synthesizedDiagrams?._meta?.ok),
          keys: synthesizedDiagrams?._meta?.keys || [],
          generated_at: new Date().toISOString(),
        },
        stage_progress: buildDeepWikiStageProgress(run.summary_json || {}, 'diagram_synthesis', {
          status: 'running',
          processed: synthesizedDiagrams?._meta?.ok ? 1 : 0,
          total: 1,
          last_message: synthesizedDiagrams?._meta?.ok ? '结构化 Mermaid 已生成' : '结构化 Mermaid 跳过或失败，将使用启发式图',
        }),
      },
    });
    return {
      output_summary: synthesizedDiagrams?._meta?.ok ? 'diagram synthesis ok' : 'diagram synthesis fallback',
      log_message: synthesizedDiagrams?._meta?.ok ? '结构化制图完成' : '结构化制图未产出有效 JSON，使用模板图',
    };
  });

  await runStage('wiki_render', async () => {
    pages = buildDeepWikiPages({
      repo: {
        repo_url: repoSource.repo_url,
        repo_slug: repoSource.repo_slug,
        branch: snapshot.branch,
        commit_sha: snapshot.commit_sha,
      },
      inventory,
      moduleDigests,
      researchReport,
      focusPrompt,
      researchProvider,
      researchModel,
      outputProfile,
      diagramProfile,
      synthesizedDiagrams,
    });
    const sources = {
      repo_url: repoSource.repo_url,
      repo_slug: repoSource.repo_slug,
      branch: snapshot.branch,
      commit_sha: snapshot.commit_sha,
      provider: researchProvider,
      model: researchModel,
      output_profile: outputProfile,
      diagram_profile: diagramProfile,
      api_endpoints: inventory.api_endpoints || [],
      tables: inventory.tables || [],
      controllers: inventory.controllers || [],
      services: inventory.services || [],
      repositories: inventory.repositories || [],
      entities: inventory.entities || [],
    };
    const manifest = {
      repo_url: repoSource.repo_url,
      repo_slug: repoSource.repo_slug,
      branch: snapshot.branch,
      commit_sha: snapshot.commit_sha,
      generated_at: new Date().toISOString(),
      page_count: pages.length,
      diagram_count: pages.filter((page) => page.page_type === 'diagram').length,
      provider: researchProvider,
      model: researchModel,
      output_profile: outputProfile,
      diagram_profile: diagramProfile,
      pages: pages.map((page) => ({
        page_slug: page.page_slug,
        title: page.title,
        page_type: page.page_type,
        source_files: page.source_files || [],
        format: page.format || 'md',
      })),
    };
    writeDeepWikiArtifacts(outputRoot, pages, manifest, {
      'deep-research.md': researchReport,
      'module-digests.json': moduleDigests,
      'inventory.json': inventory,
      'sources.json': sources,
    });
    await patchDeepWikiRun(runId, {
      summary_json: {
        manifest,
        sources,
        stage_progress: buildDeepWikiStageProgress(run.summary_json || {}, 'wiki_render', {
          status: 'running',
          processed: pages.length,
          total: pages.length,
          last_message: `Deep Wiki 页面已生成：${pages.length} 个`,
        }),
      },
    });
    return {
      output_summary: `${pages.length} pages`,
      log_message: `Deep Wiki 页面已生成：${pages.length} 个`,
    };
  });

  await runStage('knowledge_extract', async () => {
    knowledgeGraph = buildDeepWikiKnowledgeGraph({
      repo: {
        repo_url: repoSource.repo_url,
        repo_slug: repoSource.repo_slug,
        branch: snapshot.branch,
        commit_sha: snapshot.commit_sha,
      },
      inventory,
      pages,
      moduleDigests,
      researchProvider,
      researchModel,
      outputProfile,
      diagramProfile,
    });
    const objectCounts = {};
    (knowledgeGraph.objects || []).forEach((item) => {
      objectCounts[item.object_type] = Number(objectCounts[item.object_type] || 0) + 1;
    });
    const relationCounts = {};
    (knowledgeGraph.relations || []).forEach((item) => {
      relationCounts[item.relation_type] = Number(relationCounts[item.relation_type] || 0) + 1;
    });
    const pageObjectKeys = getRecordLike(knowledgeGraph.page_object_keys, {});
    const pagesForGraph = pages.map((page) => ({
      ...page,
      metadata_json: {
        ...(page.metadata_json || {}),
        object_keys: Array.isArray(pageObjectKeys[page.page_slug]) ? pageObjectKeys[page.page_slug] : [],
      },
    }));
    const graphPayload = buildDeepWikiGraphPayloadFromRows({
      run,
      repoSource,
      snapshot,
      pages: pagesForGraph,
      graph: knowledgeGraph,
      graphSummary: {
        object_counts: objectCounts,
        relation_counts: relationCounts,
        evidence_coverage: {
          object_count: Array.isArray(knowledgeGraph.objects) ? knowledgeGraph.objects.length : 0,
          covered_object_count: (knowledgeGraph.objects || []).filter((item) => Array.isArray(item.evidence) && item.evidence.length).length,
          percent: (knowledgeGraph.objects || []).length
            ? Number((((knowledgeGraph.objects || []).filter((item) => Array.isArray(item.evidence) && item.evidence.length).length / (knowledgeGraph.objects || []).length) * 100).toFixed(2))
            : 0,
        },
      },
    });
    const wikiGraphPage = {
      page_slug: 'diagrams/wiki-knowledge-graph',
      title: 'Wiki 知识图谱 · Mermaid',
      page_type: 'diagram',
      format: 'mmd',
      diagram_type: 'wiki_knowledge_graph',
      source_files: [],
      source_tables: (inventory.tables || []).slice(0, 12),
      source_apis: (inventory.api_endpoints || []).slice(0, 12),
      source_symbols: (inventory.modules || []).map((module) => module.name),
      content: graphPayload.mermaid,
      metadata_json: {
        repo_url: repoSource.repo_url,
        repo_slug: repoSource.repo_slug,
        branch: snapshot.branch,
        commit_sha: snapshot.commit_sha,
        section_type: 'diagram',
        page_slug: 'diagrams/wiki-knowledge-graph',
        diagram_type: 'wiki_knowledge_graph',
        source_files: [],
        source_tables: (inventory.tables || []).slice(0, 12),
        source_apis: (inventory.api_endpoints || []).slice(0, 12),
        source_symbols: (inventory.modules || []).map((module) => module.name),
        output_profile: outputProfile,
        diagram_profile: diagramProfile,
        generated_from: 'gateway_wiki_objects_relations',
      },
    };
    pages = pages.filter((page) => page.page_slug !== wikiGraphPage.page_slug);
    pages.push(wikiGraphPage);
    threadRecords = buildDeepWikiThreadsFromGraph({ inventory, graph: knowledgeGraph || {} });
    const supplementalPages = buildDeepWikiSupplementalPages({ inventory, graph: knowledgeGraph || {}, threads: threadRecords, existingPages: pages });
    const threadPages = buildDeepWikiThreadPages(threadRecords, inventory, knowledgeGraph || {});
    pages = [...pages, ...supplementalPages, ...threadPages];
    const currentRun = await getDeepWikiRunRecord(runId);
    const currentSummary = deepWikiSummaryDefaults(currentRun?.summary_json || run.summary_json || {});
    const currentManifest = getRecordLike(currentSummary.manifest, {});
    const nextManifest = {
      ...currentManifest,
      page_count: pages.length,
      diagram_count: pages.filter((page) => page.page_type === 'diagram').length,
      pages: pages.map((page) => ({
        page_slug: page.page_slug,
        title: page.title,
        page_type: page.page_type,
        source_files: page.source_files || [],
        format: page.format || 'md',
      })),
    };
    [wikiGraphPage, ...supplementalPages, ...threadPages].forEach((page) => {
      const targetPath = buildDeepWikiPageFilePath(outputRoot, page);
      ensureDir(path.dirname(targetPath));
      fs.writeFileSync(targetPath, page.content || '', 'utf8');
    });
    fs.writeFileSync(path.join(outputRoot, 'manifest.json'), JSON.stringify(nextManifest, null, 2), 'utf8');
    await patchDeepWikiRun(runId, {
      summary_json: {
        manifest: nextManifest,
        knowledge_graph: {
          object_counts: objectCounts,
          relation_counts: relationCounts,
          relation_count: Array.isArray(knowledgeGraph.relations) ? knowledgeGraph.relations.length : 0,
          wiki_graph_page_slug: wikiGraphPage.page_slug,
        },
        threads: {
          count: threadRecords.length,
          core_thread_count: threadRecords.filter((item) => item.thread_level === 'core_thread').length,
          branch_thread_count: threadRecords.filter((item) => ['branch_thread', 'exception_thread'].includes(item.thread_level)).length,
          generated_at: new Date().toISOString(),
        },
        stage_progress: buildDeepWikiStageProgress(run.summary_json || {}, 'knowledge_extract', {
          status: 'running',
          processed: Array.isArray(knowledgeGraph.objects) ? knowledgeGraph.objects.length : 0,
          total: Array.isArray(knowledgeGraph.objects) ? knowledgeGraph.objects.length : 0,
          last_message: `结构化对象抽取完成：${Array.isArray(knowledgeGraph.objects) ? knowledgeGraph.objects.length : 0} 个对象`,
        }),
      },
    });
    return {
      output_summary: `${Array.isArray(knowledgeGraph.objects) ? knowledgeGraph.objects.length : 0} objects`,
      log_message: `结构化对象抽取完成：${Array.isArray(knowledgeGraph.objects) ? knowledgeGraph.objects.length : 0} 个对象`,
    };
  });

  await runStage('coverage_check', async () => {
    knowledgeOsBundle = knowledgeOsBundle || loadKnowledgeOsBundleSafe({ repo_slug: repoSource.repo_slug });
    const gates = knowledgeOsBundle?.quality_gates || {};
    const expected = buildExpectedCoverage(inventory, preparedRepoUnits);
    const observed = buildObservedCoverage(expected, pages, knowledgeGraph);
    coverageReport = buildCoverageReport(expected, observed, gates, inventory, pages);
    ensureDir(path.join(outputRoot, 'artifacts'));
    fs.writeFileSync(path.join(outputRoot, 'artifacts', 'coverage_report.json'), JSON.stringify(coverageReport, null, 2), 'utf8');
    fs.writeFileSync(path.join(outputRoot, 'coverage_report.json'), JSON.stringify(coverageReport, null, 2), 'utf8');
    const stageAssets = {
      run_id: String(runId),
      repo: {
        slug: repoSource.repo_slug,
        branch: snapshot.branch,
        commit: snapshot.commit_sha,
      },
      skills_spec_version: `${knowledgeOsBundle?.namespace || 'knowledge-os'}@${knowledgeOsBundle?.version || '0'}`,
      assets: {
        'coverage.report': {
          type: 'coverage_report',
          uri: `file://${path.join(outputRoot, 'artifacts', 'coverage_report.json')}`,
        },
        'repo.inventory': { type: 'inventory', uri: `file://${path.join(outputRoot, 'inventory.json')}` },
        'docs.manifest': { type: 'manifest', uri: `file://${path.join(outputRoot, 'manifest.json')}` },
      },
    };
    fs.writeFileSync(path.join(outputRoot, 'artifacts', 'stage_assets.json'), JSON.stringify(stageAssets, null, 2), 'utf8');
    await patchDeepWikiRun(runId, {
      summary_json: {
        knowledge_os: {
          coverage_scores: coverageReport.scores,
          coverage_pass: coverageReport.pass,
        },
        stage_progress: buildDeepWikiStageProgress((await getDeepWikiRunRecord(runId))?.summary_json || run.summary_json || {}, 'coverage_check', {
          status: 'running',
          processed: 1,
          total: 1,
          last_message: `Coverage overall=${coverageReport.scores?.overall} pass=${coverageReport.pass}`,
        }),
      },
    });
    return {
      output_summary: `coverage overall=${coverageReport.scores?.overall}`,
      log_message: `Coverage 门禁：overall=${coverageReport.scores?.overall} pass=${coverageReport.pass}`,
    };
  });

  await runStage('coverage_repair', async () => {
    if (coverageReport?.pass) {
      return {
        output_summary: 'no repair',
        log_message: 'Coverage 已达标，跳过补页',
      };
    }
    const gapPages = buildCoverageGapPages(coverageReport?.gaps || {}, {
      repo_slug: repoSource.repo_slug,
      commit_sha: snapshot.commit_sha,
    });
    pages.push(...gapPages);
    for (const page of gapPages) {
      const targetPath = buildDeepWikiPageFilePath(outputRoot, page);
      ensureDir(path.dirname(targetPath));
      fs.writeFileSync(targetPath, page.content || '', 'utf8');
    }
    const currentRun = await getDeepWikiRunRecord(runId);
    const currentSummary = deepWikiSummaryDefaults(currentRun?.summary_json || run.summary_json || {});
    const currentManifest = getRecordLike(currentSummary.manifest, {});
    const nextManifest = {
      ...currentManifest,
      page_count: pages.length,
      diagram_count: pages.filter((page) => page.page_type === 'diagram').length,
      pages: pages.map((page) => ({
        page_slug: page.page_slug,
        title: page.title,
        page_type: page.page_type,
        source_files: page.source_files || [],
        format: page.format || 'md',
      })),
    };
    fs.writeFileSync(path.join(outputRoot, 'manifest.json'), JSON.stringify(nextManifest, null, 2), 'utf8');
    return {
      output_summary: `+${gapPages.length} gap pages`,
      log_message: `Coverage 补页：新增 ${gapPages.length} 个缺口说明页`,
    };
  });

  await runStage('doc_projection_md', async () => {
    knowledgeOsBundle = knowledgeOsBundle || loadKnowledgeOsBundleSafe({ repo_slug: repoSource.repo_slug });
    const documentBundleDir = path.join(outputRoot, 'document-bundle');
    ensureDir(documentBundleDir);
    const bundle = buildDocumentBundle({
      repo: {
        repo_slug: repoSource.repo_slug,
        branch: snapshot.branch,
        commit_sha: snapshot.commit_sha,
      },
      inventory,
      researchReport,
      coverageReport,
      docStandards: knowledgeOsBundle?.doc_standards || {},
    });
    for (const [name, content] of Object.entries(bundle)) {
      fs.writeFileSync(path.join(documentBundleDir, name), content, 'utf8');
    }
    await patchDeepWikiRun(runId, {
      summary_json: {
        knowledge_os: {
          document_bundle: 'document-bundle',
          files: Object.keys(bundle),
        },
        stage_progress: buildDeepWikiStageProgress((await getDeepWikiRunRecord(runId))?.summary_json || run.summary_json || {}, 'doc_projection_md', {
          status: 'running',
          processed: Object.keys(bundle).length,
          total: Object.keys(bundle).length,
          last_message: 'PRD/技术方案/测试方案 MD 投影完成',
        }),
      },
    });
    return {
      output_summary: `${Object.keys(bundle).length} md docs`,
      log_message: '文档族 MD 投影完成（PRD/技术方案/测试方案）',
    };
  });

  await runStage('knowledge_register', async () => {
    await query('DELETE FROM gateway_deepwiki_pages WHERE run_id = ?', [runId]);
    const pageMetadataBySlug = {};
    const graphPageObjectKeys = getRecordLike(knowledgeGraph?.page_object_keys, {});
    pages.forEach((page) => {
      const graphKeys = Array.isArray(graphPageObjectKeys[page.page_slug])
        ? graphPageObjectKeys[page.page_slug]
        : [];
      const existingKeys = Array.isArray(page.metadata_json?.object_keys)
        ? page.metadata_json.object_keys
        : [];
      pageMetadataBySlug[page.page_slug] = {
        ...(page.metadata_json || {}),
        object_keys: uniqueStrings([...existingKeys, ...graphKeys].map((item) => String(item || '')).filter(Boolean)),
      };
    });
    const threadByKey = new Map(threadRecords.map((item) => [item.thread_key, item]));
    pages.forEach((page) => {
      const meta = pageMetadataBySlug[page.page_slug] || {};
      const threadKey = normalizeText(meta.thread_key);
      if (!threadKey) return;
      const thread = threadByKey.get(threadKey);
      if (!thread) return;
      const threadKeys = Array.isArray(thread.object_keys_json) ? thread.object_keys_json : [];
      pageMetadataBySlug[page.page_slug] = {
        ...meta,
        object_keys: uniqueStrings([...(meta.object_keys || []), ...threadKeys].map((item) => String(item || '')).filter(Boolean)),
      };
    });
    const graphSummary = await persistDeepWikiKnowledgeGraph(run, knowledgeGraph || { objects: [], relations: [], page_object_keys: {} }, pageMetadataBySlug);
    let registeredCount = 0;
    for (const page of pages) {
      const sourceUri = buildDeepWikiPageFilePath(outputRoot, page);
      const storedSourceUri = toWorkspaceRelativePath(sourceUri);
      const nextMetadata = pageMetadataBySlug[page.page_slug] || page.metadata_json || {};
      const asset = await upsertKnowledgeAsset({
        asset_key: buildDeepWikiAssetKey(repoSource.repo_slug, snapshot.commit_sha, page.page_slug),
        name: `${repoSource.repo_slug} · ${page.title}`,
        asset_type: 'deep_wiki_page',
        asset_category: '代码库类',
        version: snapshot.commit_sha.slice(0, 12),
        owner: 'deepwiki-pipeline',
        source_uri: storedSourceUri,
        metadata_json: {
          ...nextMetadata,
          collection: DEFAULT_DEEPWIKI_COLLECTION,
          run_id: runId,
          trace_id: run.trace_id,
          title: page.title,
          research_provider: researchProvider,
          research_model: researchModel,
          output_profile: outputProfile,
          diagram_profile: diagramProfile,
        },
      });
      await query(
        `INSERT INTO gateway_deepwiki_pages
         (run_id, page_slug, title, page_type, source_uri, knowledge_asset_id, ingest_status, metadata_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON))`,
        [
          runId,
          page.page_slug,
          page.title,
          page.page_type,
          storedSourceUri,
          asset.id,
          'pending',
          stringifyJson(nextMetadata),
        ]
      );
      registeredCount += 1;
      await patchDeepWikiRun(runId, {
        summary_json: {
          heartbeat_at: new Date().toISOString(),
          stage_progress: buildDeepWikiStageProgress((await getDeepWikiRunRecord(runId))?.summary_json || run.summary_json || {}, 'knowledge_register', {
            status: 'running',
            processed: registeredCount,
            total: pages.length,
            last_message: `知识资产登记中：${page.page_slug}`,
          }),
        },
      });
    }
    await patchDeepWikiRun(runId, {
      summary_json: {
        knowledge_graph: {
          object_counts: graphSummary.object_counts,
          relation_counts: graphSummary.relation_counts,
          evidence_coverage: graphSummary.evidence_coverage,
        },
      },
    });
    project =
      (projectManifest.project_id ? await getDeepWikiProjectByIdRecord(projectManifest.project_id) : null) ||
      (projectManifest.project_code ? await getDeepWikiProjectByCode(projectManifest.project_code) : null) ||
      await ensureDeepWikiProjectForRepoSource(repoSource, {
        project_code: projectManifest.project_code || run.project_code || null,
        branch: snapshot.branch,
        created_from: 'knowledge_register',
      });
    projectSnapshot = await upsertDeepWikiProjectSnapshot({
      project_id: project.id,
      repo_source_id: repoSource.id,
      repo_snapshot_id: snapshot.id,
      run_id: run.id,
      branch: projectManifest.branch || snapshot.branch,
      commit_sha: snapshot.commit_sha,
      snapshot_version: buildDeepWikiSnapshotVersion(projectManifest.branch || snapshot.branch, snapshot.commit_sha),
      force_new: true,
      publish_status: 'draft',
      quality_status: 'pending',
      source_manifest_json: {
        project_manifest: projectManifest,
        repos: preparedRepoUnits.map((item) => ({
          project_repo_id: item.project_repo_id,
          repo_source_id: item.repo_source_id,
          repo_role: item.repo_role,
          repo_slug: item.repo_slug,
          branch_name: item.branch,
          commit_sha: item.commit_sha,
        })),
      },
      metadata_json: {
        output_root: outputRoot,
      },
    });
    await replaceDeepWikiThreads(projectSnapshot.id, threadRecords);
    for (const repoUnit of preparedRepoUnits) {
      if (!repoUnit.project_repo_id) continue;
      await upsertDeepWikiSnapshotRepoRevision(projectSnapshot.id, repoUnit.project_repo_id, {
        repo_role: repoUnit.repo_role,
        repo_slug: repoUnit.repo_slug,
        branch_name: repoUnit.branch,
        commit_sha: repoUnit.commit_sha,
        metadata_json: {
          repo_snapshot_id: repoUnit.repo_snapshot_id,
          repo_source_id: repoUnit.repo_source_id,
        },
      });
    }
    await syncDeepWikiProjectSourceBindings(Number(project.id)).catch(() => []);
    await syncDeepWikiSnapshotDocumentRevisions(Number(projectSnapshot.id)).catch(() => []);
    await syncDeepWikiSnapshotDiagrams(Number(projectSnapshot.id)).catch(() => []);
    const objectIdMap = graphSummary.object_id_map || {};
    knowledgeGraph = {
      ...(knowledgeGraph || {}),
      objects: (knowledgeGraph?.objects || []).map((item) => ({
        ...item,
        id: objectIdMap[`${item.object_type}:${item.object_key}`] || null,
      })),
    };
    const consistencyChecks = buildDeepWikiConsistencyChecksFromGraph(knowledgeGraph, objectIdMap);
    await replaceDeepWikiConsistencyChecks(projectSnapshot.id, consistencyChecks);
    executableKnowledge = buildDeepWikiExecutableKnowledge(knowledgeGraph, objectIdMap);
    const flowIdMap = await replaceDeepWikiFlows(projectSnapshot.id, executableKnowledge.flows);
    await replaceDeepWikiAssertions(projectSnapshot.id, executableKnowledge.assertions);
    await replaceDeepWikiScenarios(projectSnapshot.id, executableKnowledge.scenarios.map((item) => ({
      ...item,
      flow_id: flowIdMap.get(`flow-${String(item.scenario_code || '').replace(/^scenario-/, '')}`) || null,
    })));
    qualityReport = buildDeepWikiQualityReport({
      project,
      run,
      graph: knowledgeGraph,
      pages,
      inventory,
      threads: threadRecords,
      coverage_report: coverageReport || null,
    });
    await upsertDeepWikiQualityReport({
      project_id: project.id,
      snapshot_id: projectSnapshot.id,
      run_id: run.id,
      ...qualityReport,
    });
    await replaceDeepWikiSemanticScores(projectSnapshot.id, buildDeepWikiSemanticScores(qualityReport, projectSnapshot.id));
    await patchDeepWikiRun(runId, {
      summary_json: {
        project_snapshot: {
          id: projectSnapshot.id,
          project_id: project.id,
          project_code: project.project_code,
          snapshot_version: projectSnapshot.snapshot_version,
          quality_status: qualityReport.status,
        },
      },
    });
    return {
      output_summary: `${pages.length} assets registered`,
      log_message: `知识资产登记完成：${pages.length} 页`,
    };
  });

  if (projectSnapshot && project) {
    try {
      const projection = await syncDeepWikiTemplateProjectionForSnapshot({
        projectSnapshot,
        project,
        run,
        repoSource,
        snapshot,
        preparedRepoUnits,
        inventory,
        pages,
        knowledgeGraph,
        qualityReport,
        retrievalEval,
        outputRoot,
      });
      if (projection?.snapshot?.id) {
        projectSnapshot = projection.snapshot;
      }
    } catch (error) {
      await appendDeepWikiRunLog(runId, `知识登记后算法投影失败：${error.message}`, 'template_projection', 'warn');
    }
  }

  await runStage('community_index', async () => {
    const registeredPages = await listDeepWikiPages(runId);
    communityReports = buildDeepWikiCommunityReportsFromGraph(projectSnapshot.id, knowledgeGraph || {}, registeredPages);
    await replaceDeepWikiCommunityReports(projectSnapshot.id, communityReports);
    await patchDeepWikiRun(runId, {
      summary_json: {
        community_index: {
          generated_at: new Date().toISOString(),
          community_count: communityReports.length,
        },
        stage_progress: buildDeepWikiStageProgress(run.summary_json || {}, 'community_index', {
          status: 'running',
          processed: communityReports.length,
          total: communityReports.length,
          last_message: `社区摘要已生成：${communityReports.length} 个`,
        }),
      },
    });
    return {
      output_summary: `${communityReports.length} communities`,
      log_message: `社区摘要已生成：${communityReports.length} 个`,
    };
  });

  await runStage('rag_ingest', async () => {
    const registeredPages = await listDeepWikiPages(runId);
    let readyCount = 0;
    let processedCount = 0;
    for (const page of registeredPages) {
      try {
        await ingestKnowledgeAsset(page.knowledge_asset_id, {
          collection: DEFAULT_DEEPWIKI_COLLECTION,
        });
        readyCount += 1;
        await query(
          'UPDATE gateway_deepwiki_pages SET ingest_status = ?, updated_at = NOW() WHERE id = ?',
          ['ready', page.id]
        );
      } catch (error) {
        await query(
          'UPDATE gateway_deepwiki_pages SET ingest_status = ?, updated_at = NOW() WHERE id = ?',
          ['failed', page.id]
        );
        await appendDeepWikiRunLog(runId, `RAG 入库失败：${page.page_slug} - ${error.message}`, 'rag_ingest', 'error');
      }
      processedCount += 1;
      await patchDeepWikiRun(runId, {
        summary_json: {
          heartbeat_at: new Date().toISOString(),
          stage_progress: buildDeepWikiStageProgress((await getDeepWikiRunRecord(runId))?.summary_json || run.summary_json || {}, 'rag_ingest', {
            status: 'running',
            processed: processedCount,
            total: registeredPages.length,
            last_message: `RAG 入库处理中：${page.page_slug}`,
          }),
        },
      });
    }
    await patchDeepWikiRun(runId, {
      summary_json: {
        ingest_ready_count: readyCount,
        stage_progress: buildDeepWikiStageProgress(run.summary_json || {}, 'rag_ingest', {
          status: 'running',
          processed: readyCount,
          total: registeredPages.length,
          last_message: `RAG 入库完成：${readyCount}/${registeredPages.length} 页成功`,
        }),
      },
    });
    return {
      output_summary: `${readyCount}/${registeredPages.length} ingested`,
      log_message: `RAG 入库完成：${readyCount}/${registeredPages.length} 页成功`,
    };
  });

  await runStage('retrieval_eval', async () => {
    const registeredPages = await listDeepWikiPages(runId);
    retrievalEval = await runDeepWikiRetrievalEvaluation(projectSnapshot, knowledgeGraph || {}, registeredPages, communityReports);
    qualityReport = buildDeepWikiQualityReport({
      project,
      run,
      graph: knowledgeGraph,
      pages,
      inventory,
      retrieval_eval: retrievalEval,
      threads: threadRecords,
      coverage_report: coverageReport || null,
    });
    await upsertDeepWikiQualityReport({
      project_id: project.id,
      snapshot_id: projectSnapshot.id,
      run_id: run.id,
      ...qualityReport,
    });
    await replaceDeepWikiSemanticScores(projectSnapshot.id, buildDeepWikiSemanticScores(qualityReport, projectSnapshot.id));
    try {
      const projection = await syncDeepWikiTemplateProjectionForSnapshot({
        projectSnapshot,
        project,
        run,
        repoSource,
        snapshot,
        preparedRepoUnits,
        inventory,
        pages,
        knowledgeGraph,
        qualityReport,
        retrievalEval,
        outputRoot,
      });
      if (projection?.snapshot?.id) {
        projectSnapshot = projection.snapshot;
      }
    } catch (error) {
      await appendDeepWikiRunLog(runId, `检索评测后算法投影失败：${error.message}`, 'template_projection', 'warn');
    }
    await patchDeepWikiRun(runId, {
      summary_json: {
        retrieval_eval: retrievalEval,
        project_snapshot: {
          id: projectSnapshot.id,
          project_id: project.id,
          project_code: project.project_code,
          snapshot_version: projectSnapshot.snapshot_version,
          quality_status: qualityReport.status,
        },
        stage_progress: buildDeepWikiStageProgress(run.summary_json || {}, 'retrieval_eval', {
          status: 'running',
          processed: retrievalEval?.grounded_probe_count || 0,
          total: retrievalEval?.probe_count || 0,
          last_message: `检索评测完成：top5 recall ${retrievalEval?.top5_recall || 0}%`,
        }),
      },
    });
    return {
      output_summary: `${retrievalEval?.top5_recall || 0}% recall`,
      log_message: `检索评测完成：top5 recall ${retrievalEval?.top5_recall || 0}%`,
    };
  });

  await runStage('publish', async () => {
    let snapshotQualityStatus = qualityReport?.status || projectSnapshot?.quality_status || 'draft';
    if (coverageReport?.block_publish) {
      snapshotQualityStatus = 'draft';
    }
    if (projectSnapshot && project) {
      projectSnapshot =
        await reconcileDeepWikiSnapshotLifecycle(projectSnapshot.id, {
          quality_status: snapshotQualityStatus,
        }) || projectSnapshot;
    }
    const nextSnapshotStatus = normalizeSnapshotStatus(projectSnapshot?.status, 'queued');
    await patchDeepWikiRun(runId, {
      status: 'completed',
      current_stage: 'publish',
      output_root: outputRoot,
      summary_json: {
        published_at: projectSnapshot?.published_at || null,
        publish_status: deriveLegacySnapshotFields({ status: nextSnapshotStatus }).publish_status,
        stalled: false,
        runtime_result: 'completed',
        stage_progress: buildDeepWikiStageProgress(run.summary_json || {}, 'publish', {
          status: 'completed',
          processed: 1,
          total: 1,
          completed_at: new Date().toISOString(),
          last_message: 'Deep Wiki 发布完成',
        }),
        estimated_remaining_seconds: 0,
        progress_percent: 100,
      },
    });
    if (run.pipeline_run_id) {
      await query(
        `UPDATE gateway_pipeline_runs
         SET status = ?, approval_status = ?, ended_at = NOW(), updated_at = NOW()
         WHERE id = ?`,
        ['completed', 'approved', run.pipeline_run_id]
      );
    }
    await query(
      `INSERT INTO gateway_audit_events
       (event_type, trace_id, project_code, payload_json, source_system)
       VALUES (?, ?, ?, CAST(? AS JSON), ?)`,
      [
        'deepwiki_published',
        run.trace_id,
        run.pipeline_run?.project_code || null,
        stringifyJson({
          run_id: runId,
          repo_slug: repoSource.repo_slug,
          commit_sha: snapshot.commit_sha,
          output_root: outputRoot,
        }),
        'control-plane',
      ]
    );
    try {
      const dw = dualWriteDeepWikiMarkdownBundle({
        localRepoPath: snapshot.local_path,
        commitSha: snapshot.commit_sha,
        outputRoot,
      });
      if (dw.ok) {
        await appendDeepWikiRunLog(runId, `已双写到仓库：${dw.destRoot}`, 'publish', 'info');
      } else {
        await appendDeepWikiRunLog(runId, `双写仓库跳过：${dw.reason || 'unknown'}`, 'publish', 'warn');
      }
    } catch (error) {
      await appendDeepWikiRunLog(runId, `双写仓库失败：${error.message}`, 'publish', 'warn');
    }
    return {
      output_summary: 'published',
      log_message: 'Deep Wiki 发布完成',
    };
  });

  if (projectSnapshot && project) {
    try {
      await syncDeepWikiTemplateProjectionForSnapshot({
        projectSnapshot,
        project,
        run,
        repoSource,
        snapshot,
        preparedRepoUnits,
        inventory,
        pages,
        knowledgeGraph,
        qualityReport,
        retrievalEval,
        outputRoot,
      });
    } catch (error) {
      await appendDeepWikiRunLog(runId, `模板化 stage 投影失败：${error.message}`, 'template_projection', 'warn');
    }
  }

  return getDeepWikiRunById(runId);
}

async function syncDeepWikiTemplateProjectionForSnapshot({
  projectSnapshot,
  project,
  run,
  repoSource,
  snapshot,
  preparedRepoUnits,
  inventory,
  pages,
  knowledgeGraph,
  qualityReport,
  retrievalEval,
  outputRoot,
}) {
  if (!projectSnapshot?.id || !project?.id || !run?.id) return null;
  const { syncTemplateProjection } = require('../deepwiki/runtime');
  const [domains, threads, flows, diagrams, documentRevisions, diagramContext] = await Promise.all([
    listDeepWikiDomains(projectSnapshot.id).catch(() => []),
    listDeepWikiThreads(projectSnapshot.id).catch(() => []),
    listDeepWikiFlows(projectSnapshot.id).catch(() => []),
    listDeepWikiSnapshotDiagrams(projectSnapshot.id).catch(() => []),
    listDeepWikiSnapshotDocumentRevisions(projectSnapshot.id).catch(() => []),
    getDeepWikiDiagramContextBySnapshotId(projectSnapshot.id).catch(() => null),
  ]);
  const projection = syncTemplateProjection({
    project,
    snapshot: projectSnapshot,
    run,
    preparedRepoUnits,
    inventory,
    pages,
    knowledgeGraph,
    threads,
    flows,
    domains,
    diagrams,
    documentRevisions,
    diagramContext,
    qualityReport,
    retrievalEval,
  });
  if (!projection) return null;
  await persistDeepWikiTemplateProjection(projectSnapshot, run.id, projection);
  await persistDeepWikiScoreProjection(projectSnapshot, run.id, projection.scoreOutputs || {});
  const reconciledSnapshot = await reconcileDeepWikiSnapshotLifecycle(projectSnapshot.id, {
    quality_status: qualityReport?.status || projectSnapshot.quality_status,
  }).catch(() => null);
  const isAiPlanErp =
    Number(project?.id || 0) === 3 ||
    normalizeText(project?.project_code).toLowerCase() === 'ai-erp' ||
    normalizeText(project?.project_name).toLowerCase().includes('ai_plan_erp');
  if (isAiPlanErp && projection.visibleProjection) {
    await applyDeepWikiAlgorithmVisibleProjection({
      run,
      snapshot: projectSnapshot,
      repoSource,
      outputRoot,
      visibleProjection: projection.visibleProjection,
    });
  }
  projection.snapshot = reconciledSnapshot || projectSnapshot;
  return projection;
}

async function rebuildDeepWikiAlgorithmProjection(snapshotId) {
  const projectSnapshot = await getDeepWikiSnapshotRecord(Number(snapshotId));
  if (!projectSnapshot?.id || !projectSnapshot?.run_id) return null;
  const outputRoot =
    normalizeText(projectSnapshot.metadata_json?.output_root) ||
    normalizeText((await getDeepWikiRunRecord(Number(projectSnapshot.run_id)))?.output_root) ||
    null;
  const [project, run, repoSource, repoSnapshot, repoRevisions, pages, qualityReport] = await Promise.all([
    getDeepWikiProjectByIdRecord(Number(projectSnapshot.project_id)),
    getDeepWikiRunRecord(Number(projectSnapshot.run_id)),
    getRepoSourceById(Number(projectSnapshot.repo_source_id)),
    projectSnapshot.repo_snapshot_id ? getRepoSnapshotById(Number(projectSnapshot.repo_snapshot_id)).catch(() => null) : Promise.resolve(null),
    listDeepWikiSnapshotRepoRevisions(Number(projectSnapshot.id)).catch(() => []),
    listDeepWikiPagesBySnapshotId(Number(projectSnapshot.id)).catch(() => []),
    getDeepWikiQualityReportBySnapshotId(Number(projectSnapshot.id)).catch(() => null),
  ]);
  if (!project || !run || !repoSource) return null;
  const knowledgeGraph = await loadDeepWikiKnowledgeGraphBySnapshotId(Number(projectSnapshot.id)).catch(() => ({ objects: [], relations: [], object_id_map: {} }));
  const inventoryFromDisk = outputRoot
    ? parseJson(readTextIfExists(path.join(outputRoot, 'inventory.json')), null)
    : null;
  const preparedRepoUnits = (Array.isArray(repoRevisions) ? repoRevisions : []).map((item) => ({
    project_repo_id: item.project_repo_id || null,
    repo_role: item.repo_role || null,
    repo_slug: item.repo_slug || null,
    branch: item.branch_name || null,
    commit_sha: item.commit_sha || null,
    repo_snapshot_id: item.metadata_json?.repo_snapshot_id || null,
    repo_source_id: item.metadata_json?.repo_source_id || null,
  }));
  return syncDeepWikiTemplateProjectionForSnapshot({
    projectSnapshot,
    project,
    run,
    repoSource,
    snapshot: repoSnapshot || {
      id: projectSnapshot.repo_snapshot_id || null,
      branch: projectSnapshot.branch,
      commit_sha: projectSnapshot.commit_sha,
    },
    preparedRepoUnits,
    inventory: inventoryFromDisk || parseJson(run.summary_json?.inventory, {}) || run.summary_json?.inventory || {},
    pages,
    knowledgeGraph,
    qualityReport,
    retrievalEval: run.summary_json?.retrieval_eval || null,
    outputRoot,
  });
}

async function createKnowledgeSpotCheck(id, data = {}) {
  const asset = await getKnowledgeAssetById(id);
  if (!asset) return null;
  const payload = {
    knowledge_asset_id: asset.id,
    asset_key: asset.asset_key,
    asset_name: asset.name,
    conclusion: data.conclusion || '引用正确',
    inspector: data.inspector || 'system',
    node_key: data.node_key || null,
    note: data.note || null,
    checked_at: new Date().toISOString(),
  };
  const result = await query(
    `INSERT INTO gateway_audit_events
     (event_type, trace_id, project_code, payload_json, source_system)
     VALUES (?, ?, ?, CAST(? AS JSON), ?)`,
    ['knowledge_asset_spot_check', data.trace_id || null, data.project_code || null, stringifyJson(payload), 'control-plane']
  );
  const [row] = await query('SELECT * FROM gateway_audit_events WHERE id = ? LIMIT 1', [result.insertId]);
  return {
    ...row,
    payload_json: parseJson(row.payload_json, {}),
  };
}

async function listAuditEvents() {
  const rows = await query(
    'SELECT * FROM gateway_audit_events ORDER BY created_at DESC, id DESC LIMIT 100'
  );
  return rows.map((row) => ({
    ...row,
    payload_json: parseJson(row.payload_json, {}),
  }));
}

module.exports = {
  getPool,
  closePool,
  listCodeRepositories,
  createCodeRepository,
  getCodeRepositoryByRepoKey,
  createDocBundle,
  createDocBundleFromDeepWikiRun,
  upsertDocBundleContext,
  listDocBundles,
  getDocBundleById,
  createDocArtifact,
  createDocArtifactLink,
  listDocArtifacts,
  getDocArtifactById,
  listDocGateExecutions,
  evaluateInputContract,
  evaluatePrdGate,
  evaluateTechSpecGate,
  buildCoverageGraph,
  getLatestCoverageGraph,
  buildRepoContextRun,
  getLatestRepoContextRun,
  generateTechSpec,
  getLatestTechSpecRun,
  generateTestPlan,
  getLatestTestPlanRun,
  evaluateTestPlanGate,
  publishTestPlan,
  listWaves,
  listProjects,
  getProjectByCode,
  createWeeklyUpdate,
  listEvidencePacks,
  createEvidencePack,
  listPipelines,
  getPipelineDefinitionByRef,
  createPipeline,
  publishPipeline,
  listAgents,
  listSchemas,
  listSkills,
  listIntegrationConnections,
  createIntegrationConnection,
  listValueAssessments,
  createValueAssessment,
  listCertificationRecords,
  createCertificationRecord,
  createRuntimeEvent,
  startPipelineRun,
  listPipelineRuns,
  getTraceById,
  decideApproval,
  syncGateExecution,
  getDashboardMetrics,
  getEfficiencyReport,
  getGovernanceAcceptanceOverview,
  listKnowledgeAssets,
  ingestKnowledgeAsset,
  buildKnowledgeAssetIngestMetadata,
  KNOWLEDGE_ASSET_INGEST_PASSTHROUGH_KEYS,
  getGatewaySettings,
  createDeepWikiRunRequest,
  requestDeepWikiSync,
  getDeepWikiProviders,
  getDeepWikiModels,
  listDeepWikiProjects,
  bootstrapDeepWikiProjects,
  createDeepWikiProject,
  getDeepWikiProjectById,
  addRepoToDeepWikiProject,
  listDeepWikiProjectBranches,
  listDeepWikiVersionLines,
  createDeepWikiVersionLine,
  getDeepWikiVersionLineById,
  updateDeepWikiBranchRepoMapping,
  listDeepWikiProjectSnapshots,
  listDeepWikiSnapshotsByVersionLine,
  getDeepWikiSnapshotByRunId,
  getDeepWikiProjectDefaultPublishedSnapshot,
  listDeepWikiProjectSourceBindings,
  getDeepWikiTemplateProjectionBySnapshotId,
  listDeepWikiSnapshotRepoRevisions,
  listDeepWikiSnapshotDocumentRevisions,
  listDeepWikiSnapshotDiagrams,
  listDeepWikiDomains,
  listDeepWikiThreads,
  getDeepWikiDomainByKey,
  getDeepWikiThreadByKey,
  syncDeepWikiSnapshotDiagrams,
  regenerateDeepWikiSnapshotDiagrams,
  getDeepWikiDiagramContextBySnapshotId,
  downloadDeepWikiDiagramAssetBySnapshotId,
  listDeepWikiSnapshotObjects,
  listDeepWikiFlows,
  listDeepWikiAssertions,
  listDeepWikiScenarios,
  listDeepWikiSemanticScores,
  listDeepWikiConsistencyChecks,
  listDeepWikiCommunityReports,
  getDeepWikiSnapshotOverview,
  getDeepWikiSnapshotQuality,
  getDeepWikiGenerationJobById,
  listDeepWikiGenerationJobs,
  upsertDeepWikiGenerationJob,
  publishDeepWikiSnapshot,
  reconcileDeepWikiSnapshotLifecycle,
  updateDeepWikiSnapshotApprovalStatus,
  getDeepWikiQualityReportBySnapshotId,
  queryDeepWikiSnapshot,
  createDeepWikiFeedbackEvent,
  listDeepWikiFeedbackEvents,
  listDeepWikiRepos,
  listDeepWikiRuns,
  getDeepWikiRunById,
  getDeepWikiGraphByRunId,
  getDeepWikiGraphBySnapshotId,
  listDeepWikiPages,
  listDeepWikiPagesBySnapshotId,
  getDeepWikiPageContent,
  getDeepWikiPageContentBySnapshotId,
  createDocBundleFromDeepWikiSnapshot,
  rebuildDeepWikiKnowledgeGraphForRun,
  findRepoSourceForWebhook,
  getDeepWikiRepoBranches,
  listDeepWikiRepoSourcesForScheduling,
  updateRepoSourceSyncConfig,
  updateRepoSourceSyncState,
  resetDeepWikiRunForRetry,
  reingestDeepWikiRun,
  sweepStalledDeepWikiRuns,
  executeDeepWikiRun,
  syncDeepWikiTemplateProjectionForSnapshot,
  rebuildDeepWikiAlgorithmProjection,
  createKnowledgeSpotCheck,
  listRagQueries,
  listAuditEvents,
  listStandardNodes,
  getStandardNodeByKey,
  getDocGateOutputSchema,
  getProjectOpsSummary,
  logRagQuery,
  executeDocPipelineRun,
  runTestPlanQualityBenchmark,
  buildDeepWikiCommunityReportsFromGraph,
  buildDeepWikiDomainModel,
  buildDeepWikiThreadsFromGraph,
  buildDeepWikiThreadPages,
  buildDeepWikiRetrievalProbeQueries,
  rewriteDeepWikiBusinessQuery,
  decideDeepWikiQueryMode,
  linkQueryToDeepWikiObjects,
  runSingleLayerLouvainLikeCommunityDetection,
};
