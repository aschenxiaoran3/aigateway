#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const dotenv = require('dotenv');

const ROOT = path.join(__dirname, '..');
dotenv.config({ path: path.join(ROOT, 'control-plane/.env') });

const db = require(path.join(ROOT, 'control-plane/src/db/mysql'));

const DEFAULT_QUERIES = [
  '这个项目的主干流程是什么？',
  '这个项目有哪些失败分支或异常补偿流程？',
  '前端请求如何一路落到数据库实体和表？',
];

const NOISE_MODULE_DIRS = new Set([
  '.cursor',
  'gradle',
  'plans',
  'plan',
  'testcases',
  'fixtures',
  'examples',
  'samples',
  'archives',
]);

const REQUIRED_V2_PAGES = [
  '00-overview',
  '01-architecture-backbone',
  '02-domain-map',
  '20-api-contract-map',
  '21-database-entity-map',
  '22-runtime-boundaries',
  '90-synthesis-and-gaps',
];

function normalizeText(value) {
  return String(value || '').replace(/\r/g, '').trim();
}

function truncate(value, max = 180) {
  const text = normalizeText(value);
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function toInt(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseArgs(argv) {
  const parsed = {};
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const cleaned = arg.slice(2);
    const eqIndex = cleaned.indexOf('=');
    if (eqIndex === -1) {
      parsed[cleaned] = true;
      continue;
    }
    const key = cleaned.slice(0, eqIndex);
    const value = cleaned.slice(eqIndex + 1);
    parsed[key] = value;
  }
  return parsed;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function unique(values) {
  return Array.from(new Set((values || []).filter(Boolean)));
}

function slugDepth(slug) {
  return normalizeText(slug).split('/').filter(Boolean).length;
}

function isThreadPageSlug(slug) {
  return /(^10-threads\/|\/10-threads\/)/.test(normalizeText(slug));
}

function normalizeThreadLevelForReport(level) {
  const normalized = normalizeText(level).replace(/-/g, '_');
  if (normalized === 'core_thread') return 'core';
  if (normalized === 'branch_thread' || normalized === 'exception_thread') return 'branch';
  return normalized || 'unknown';
}

function computePageMetrics(pages = [], qualityJson = {}) {
  const slugs = pages.map((item) => normalizeText(item.page_slug)).filter(Boolean);
  const modulePages = slugs.filter((slug) => slug.startsWith('modules/'));
  const noiseModulePages = modulePages.filter((slug) => NOISE_MODULE_DIRS.has(slug.replace(/^modules\//, '')));
  const threadPages = slugs.filter((slug) => isThreadPageSlug(slug));
  const domainPages = slugs.filter((slug) => /^10-domains\/[^/]+\/00-summary$/.test(slug));
  const sourceNoiseHits = unique(
    pages.flatMap((page) =>
      (Array.isArray(page.metadata_json?.source_files) ? page.metadata_json.source_files : [])
        .map((filePath) => String(filePath || '').split('/')[0])
        .filter((topLevel) => NOISE_MODULE_DIRS.has(topLevel))
    )
  );
  const missingRequiredV2Pages = REQUIRED_V2_PAGES.filter((slug) => !slugs.includes(slug));
  return {
    total: pages.length,
    max_depth: slugs.length ? Math.max(...slugs.map(slugDepth)) : 0,
    module_page_count: modulePages.length,
    domain_page_count: domainPages.length,
    thread_page_count: threadPages.length,
    thread_summary_page_count: threadPages.filter((slug) => slug.endsWith('/00-summary')).length,
    thread_sequence_page_count: threadPages.filter((slug) => slug.endsWith('/03-sequence')).length,
    required_v2_pages_present: REQUIRED_V2_PAGES.filter((slug) => slugs.includes(slug)),
    missing_required_v2_pages: missingRequiredV2Pages,
    noise_module_pages: noiseModulePages,
    source_noise_hits: sourceNoiseHits,
    sample_thread_pages: threadPages.slice(0, 12),
  };
}

function computeDiagramMetrics(diagrams = []) {
  const byScopeType = {};
  const byDiagramType = {};
  diagrams.forEach((diagram) => {
    const scopeType = normalizeText(diagram.scope_type) || 'project';
    const diagramType = normalizeText(diagram.diagram_type) || 'unknown';
    byScopeType[scopeType] = toInt(byScopeType[scopeType]) + 1;
    byDiagramType[diagramType] = toInt(byDiagramType[diagramType]) + 1;
  });
  const fallbackCount = diagrams.filter((item) => /fallback/i.test(normalizeText(item.render_source))).length;
  return {
    total: diagrams.length,
    by_scope_type: byScopeType,
    by_diagram_type: byDiagramType,
    fallback_count: fallbackCount,
    sample_diagram_keys: diagrams.map((item) => normalizeText(item.diagram_key)).filter(Boolean).slice(0, 16),
  };
}

function computeThreadMetrics(threads = []) {
  const byLevel = {};
  threads.forEach((thread) => {
    const level = normalizeThreadLevelForReport(thread.thread_level);
    byLevel[level] = toInt(byLevel[level]) + 1;
  });
  return {
    total: threads.length,
    by_level: byLevel,
    domain_keys: unique(threads.map((item) => normalizeText(item.domain_key))).filter(Boolean),
    sample_thread_keys: threads.map((item) => normalizeText(item.thread_key)).filter(Boolean).slice(0, 16),
  };
}

function computeComparison(baseValue, nextValue) {
  const base = toInt(baseValue);
  const next = toInt(nextValue);
  const delta = next - base;
  return `${base} -> ${next} (${delta >= 0 ? '+' : ''}${delta})`;
}

async function fetchKnowledgeHealth() {
  const kbUrl = normalizeText(process.env.KNOWLEDGE_BASE_HEALTH_URL || 'http://127.0.0.1:8000/health');
  const qdrantUrl = normalizeText(process.env.QDRANT_HEALTH_URL || 'http://127.0.0.1:6333/collections');
  const result = {
    knowledge_base: null,
    qdrant: null,
    errors: [],
  };
  try {
    const { data } = await axios.get(kbUrl, { timeout: 10000 });
    result.knowledge_base = data;
  } catch (error) {
    result.errors.push(`knowledge_base:${error.message}`);
  }
  try {
    const { data } = await axios.get(qdrantUrl, { timeout: 10000 });
    result.qdrant = data;
  } catch (error) {
    result.errors.push(`qdrant:${error.message}`);
  }
  return result;
}

async function runQuerySamples(snapshotId, queries = DEFAULT_QUERIES) {
  const results = [];
  for (const queryText of queries) {
    const response = await db.queryDeepWikiSnapshot(snapshotId, {
      query: queryText,
      mode: 'auto',
      top_k: 5,
      candidate_k: 10,
      rerank_top_k: 6,
    });
    results.push({
      query: queryText,
      answer_excerpt: truncate(response?.answer, 220),
      resolved_mode: normalizeText(response?.trace?.resolved_mode) || 'auto',
      used_fallback: Boolean(response?.trace?.used_fallback),
      citation_count: Array.isArray(response?.citations) ? response.citations.length : 0,
      retrieved_thread_count: Array.isArray(response?.retrieved_threads) ? response.retrieved_threads.length : 0,
      top_threads: (response?.retrieved_threads || []).map((item) => ({
        thread_key: item.thread_key,
        thread_level: item.thread_level,
        rank_score: item.rank_score,
      })).slice(0, 3),
    });
  }
  return results;
}

function extractQualityHighlights(quality = {}) {
  const report = quality.quality_report || null;
  const qualityJson = report?.quality_json || {};
  const semanticScores = Array.isArray(quality.semantic_scores) ? quality.semantic_scores : [];
  return {
    status: normalizeText(report?.status) || null,
    score: Number(report?.score || 0),
    publish_ready: Boolean(quality.publish_ready),
    publish_blockers: quality.publish_blockers || [],
    publish_warnings: quality.publish_warnings || [],
    quality_json: qualityJson,
    semantic_scores: semanticScores.map((item) => ({
      metric_key: item.metric_key,
      final_score: item.final_score,
      detail_json: item.detail_json || {},
    })),
  };
}

async function summarizeSnapshot(snapshotId, options = {}) {
  const [overview, quality, pages, diagrams, threads, kbHealth] = await Promise.all([
    db.getDeepWikiSnapshotOverview(snapshotId),
    db.getDeepWikiSnapshotQuality(snapshotId),
    db.listDeepWikiPagesBySnapshotId(snapshotId),
    db.listDeepWikiSnapshotDiagrams(snapshotId),
    db.listDeepWikiThreads(snapshotId),
    options.includeHealth ? fetchKnowledgeHealth() : Promise.resolve(null),
  ]);
  const snapshot = overview?.snapshot || null;
  const qualityHighlights = extractQualityHighlights(quality || {});
  const qualityJson = qualityHighlights.quality_json || {};
  const pageMetrics = computePageMetrics(pages, qualityJson);
  const diagramMetrics = computeDiagramMetrics(diagrams);
  const threadMetrics = computeThreadMetrics(threads);
  const querySamples = options.includeQueries ? await runQuerySamples(snapshotId, options.queries) : [];

  return {
    snapshot_id: snapshotId,
    snapshot: snapshot
      ? {
          id: snapshot.id,
          run_id: snapshot.run_id,
          project_id: snapshot.project_id,
          branch: snapshot.branch,
          commit_sha: snapshot.commit_sha,
          snapshot_version: snapshot.snapshot_version,
          publish_status: snapshot.publish_status,
          quality_status: snapshot.quality_status,
        }
      : null,
    source_coverage: overview?.source_coverage || {},
    page_metrics: pageMetrics,
    diagram_metrics: diagramMetrics,
    thread_metrics: threadMetrics,
    quality: qualityHighlights,
    knowledge_stack: kbHealth,
    query_samples: querySamples,
  };
}

function buildIssues(summary = {}) {
  const issues = [];
  const qualityJson = summary.quality?.quality_json || {};
  if (toInt(summary.thread_metrics?.total) === 0) {
    issues.push('旧快照没有任何线程实体，查询无法优先命中主干/分支线程。');
  }
  if (toInt(summary.page_metrics?.thread_page_count) === 0) {
    issues.push('页面树里没有 10-domains/.../10-threads/... 层级，主干与分支流程没有独立页面。');
  }
  if ((summary.page_metrics?.noise_module_pages || []).length) {
    issues.push(`模块页存在噪声目录：${summary.page_metrics.noise_module_pages.join(', ')}`);
  }
  if ((summary.diagram_metrics?.by_scope_type?.thread || 0) === 0) {
    issues.push('图表中心没有线程级图资产，只剩固定项目级大图。');
  }
  if (Array.isArray(summary.quality?.publish_warnings) && summary.quality.publish_warnings.length) {
    issues.push(`当前告警：${summary.quality.publish_warnings.join(', ')}`);
  }
  if (summary.knowledge_stack?.knowledge_base) {
    const kb = summary.knowledge_stack.knowledge_base;
    if (kb.embedder_fallback) {
      issues.push('knowledge-base 仍处于 embedding fallback 状态。');
    }
    if (normalizeText(kb.vector_store) === 'not_initialized') {
      issues.push('knowledge-base 向量存储未初始化，真实检索 grounding 仍不稳定。');
    }
  }
  if (qualityJson.frontend_repo_bound === false) {
    issues.push('当前项目只绑定了后端仓，前端/BFF 链路会明确显示缺口。');
  }
  return issues;
}

function formatValue(value) {
  if (value == null || value === '') return '-';
  if (Array.isArray(value)) return value.length ? value.join(', ') : '-';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function formatQuerySection(results = []) {
  if (!results.length) return '- 未执行查询样例';
  return results
    .map((item) => [
      `- 问题：${item.query}`,
      `  模式：${item.resolved_mode}，引用 ${item.citation_count} 条，命中线程 ${item.retrieved_thread_count} 个，fallback=${item.used_fallback}`,
      `  线程：${item.top_threads.length ? item.top_threads.map((thread) => `${thread.thread_level}:${thread.thread_key}`).join(', ') : '-'}`,
      `  答案摘录：${item.answer_excerpt || '-'}`,
    ].join('\n'))
    .join('\n');
}

function buildReportMarkdown(context = {}) {
  const baseline = context.baseline || null;
  const regenerated = context.regenerated || null;
  const baselineIssues = buildIssues(baseline || {});
  const regeneratedIssues = buildIssues(regenerated || {});
  const lines = [
    '# DeepWiki Regeneration Report',
    '',
    `- 生成时间: ${new Date().toISOString()}`,
    `- 项目: ${context.projectName || '-'}`,
    `- 版本线: ${context.versionLine ? `${context.versionLine.branch} (#${context.versionLine.id})` : '-'}`,
    `- 基线 Snapshot: ${baseline?.snapshot ? `#${baseline.snapshot.id} ${baseline.snapshot.branch}@${String(baseline.snapshot.commit_sha || '').slice(0, 12)}` : '-'}`,
    `- 重生 Snapshot: ${regenerated?.snapshot ? `#${regenerated.snapshot.id} ${regenerated.snapshot.branch}@${String(regenerated.snapshot.commit_sha || '').slice(0, 12)}` : '-'}`,
    '',
  ];

  if (baseline) {
    lines.push('## Baseline');
    lines.push('');
    lines.push(`- 页面数: ${baseline.page_metrics.total}`);
    lines.push(`- 页面树最大深度: ${baseline.page_metrics.max_depth}`);
    lines.push(`- 线程页数: ${baseline.page_metrics.thread_page_count}`);
    lines.push(`- 域页数: ${baseline.page_metrics.domain_page_count}`);
    lines.push(`- 图资产数: ${baseline.diagram_metrics.total}`);
    lines.push(`- 线程图数: ${baseline.diagram_metrics.by_scope_type.thread || 0}`);
    lines.push(`- 线程实体数: ${baseline.thread_metrics.total}`);
    lines.push(`- 噪声模块页: ${formatValue(baseline.page_metrics.noise_module_pages)}`);
    lines.push(`- 缺失的 V2 主页面: ${formatValue(baseline.page_metrics.missing_required_v2_pages)}`);
    lines.push(`- 发布告警: ${formatValue(baseline.quality.publish_warnings)}`);
    if (baseline.knowledge_stack?.knowledge_base) {
      lines.push(`- knowledge-base: model=${baseline.knowledge_stack.knowledge_base.embedder_model || '-'}, fallback=${baseline.knowledge_stack.knowledge_base.embedder_fallback}, vector_store=${baseline.knowledge_stack.knowledge_base.vector_store}`);
    }
    lines.push('');
    lines.push('### Why It Was Shallow');
    lines.push('');
    lines.push(...(baselineIssues.length ? baselineIssues.map((item) => `- ${item}`) : ['- 未检测到明显浅层问题']));
    lines.push('');
    lines.push('### Query Samples');
    lines.push('');
    lines.push(formatQuerySection(baseline.query_samples));
    lines.push('');
  }

  if (regenerated) {
    lines.push('## Regenerated');
    lines.push('');
    lines.push(`- 页面数: ${regenerated.page_metrics.total}`);
    lines.push(`- 页面树最大深度: ${regenerated.page_metrics.max_depth}`);
    lines.push(`- 线程页数: ${regenerated.page_metrics.thread_page_count}`);
    lines.push(`- 域页数: ${regenerated.page_metrics.domain_page_count}`);
    lines.push(`- 图资产数: ${regenerated.diagram_metrics.total}`);
    lines.push(`- scope 分布: ${formatValue(regenerated.diagram_metrics.by_scope_type)}`);
    lines.push(`- 线程实体数: ${regenerated.thread_metrics.total}`);
    lines.push(`- 线程层级分布: ${formatValue(regenerated.thread_metrics.by_level)}`);
    lines.push(`- 缺失的 V2 主页面: ${formatValue(regenerated.page_metrics.missing_required_v2_pages)}`);
    lines.push(`- 发布告警: ${formatValue(regenerated.quality.publish_warnings)}`);
    lines.push(`- 质量分: ${regenerated.quality.score}`);
    lines.push(`- publish_ready: ${regenerated.quality.publish_ready}`);
    lines.push('');
    lines.push('### Improvement Delta');
    lines.push('');
    if (baseline) {
      lines.push(`- 页面数: ${computeComparison(baseline.page_metrics.total, regenerated.page_metrics.total)}`);
      lines.push(`- 线程页数: ${computeComparison(baseline.page_metrics.thread_page_count, regenerated.page_metrics.thread_page_count)}`);
      lines.push(`- 域页数: ${computeComparison(baseline.page_metrics.domain_page_count, regenerated.page_metrics.domain_page_count)}`);
      lines.push(`- 图资产数: ${computeComparison(baseline.diagram_metrics.total, regenerated.diagram_metrics.total)}`);
      lines.push(`- 线程实体数: ${computeComparison(baseline.thread_metrics.total, regenerated.thread_metrics.total)}`);
      lines.push(`- 线程图数: ${computeComparison(baseline.diagram_metrics.by_scope_type.thread || 0, regenerated.diagram_metrics.by_scope_type.thread || 0)}`);
    } else {
      lines.push('- 无基线可对比');
    }
    lines.push('');
    lines.push('### Remaining Gaps');
    lines.push('');
    lines.push(...(regeneratedIssues.length ? regeneratedIssues.map((item) => `- ${item}`) : ['- 未检测到明显残余浅层问题']));
    lines.push('');
    lines.push('### Query Samples');
    lines.push('');
    lines.push(formatQuerySection(regenerated.query_samples));
    lines.push('');
  }

  return `${lines.join('\n').trim()}\n`;
}

async function executeRegeneration(args) {
  const versionLineId = toInt(args['version-line-id']);
  if (!versionLineId) {
    return null;
  }
  const versionLine = await db.getDeepWikiVersionLineById(versionLineId);
  if (!versionLine) {
    throw new Error(`Version line not found: ${versionLineId}`);
  }
  const payload = {
    project_id: toInt(args['project-id']) || versionLine.project_id,
    version_line_id: versionLine.id,
    branch: normalizeText(args.branch) || versionLine.branch,
    research_provider: normalizeText(args['research-provider']) || 'qwen_dashscope_native',
    research_model: normalizeText(args['research-model']) || '',
    provider_strategy: normalizeText(args['provider-strategy']) || 'default',
    output_profile: normalizeText(args['output-profile']) || 'engineering_architecture_pack',
    diagram_profile: normalizeText(args['diagram-profile']) || 'full',
    focus_prompt: normalizeText(args['focus-prompt']) || [
      '请按 DeepWiki V3 生成真正的业务主干而不是模块平铺说明。',
      '必须抽出 project_trunk -> domain_context -> core_thread -> branch/exception 四层结构。',
      '业务域采用双层 DDD：上层主干/核心域/支撑域/通用域，下层 bounded context/aggregate/behavior/command/event/context map。',
      '模块页正文必须业务优先，首屏先写职责、所属域、主行为、规则、不变量、上下游与主入口，技术证据只做摘要和跳转。',
      '页面树要体现 10-domains/<domain>/10-threads/<thread> 层级，图资产要同时输出 project/domain/thread 分组。',
      '如果没有前端仓，请明确标注缺口，不要臆造前端流程；问答要优先围绕业务域、行为、线程与证据组织。',
    ].join(' '),
  };
  const created = await db.createDeepWikiRunRequest(payload);
  console.log(`[deepwiki-v2] created run #${created.run_id} for version line #${versionLine.id}`);
  const executed = await db.executeDeepWikiRun(created.run_id);
  const run = await db.getDeepWikiRunById(created.run_id);
  const wikiSnapshot = typeof db.getDeepWikiSnapshotByRunId === 'function'
    ? await db.getDeepWikiSnapshotByRunId(created.run_id).catch(() => null)
    : null;
  if (!run || normalizeText(run.status) !== 'completed') {
    throw new Error(`DeepWiki run did not complete successfully: run=${created.run_id} status=${run?.status || 'unknown'}`);
  }
  const snapshotId =
    toInt(wikiSnapshot?.id) ||
    toInt(run.summary_json?.project_snapshot?.id) ||
    toInt(run.project_snapshot?.id) ||
    toInt(run.snapshot?.id) ||
    toInt(run.snapshot_id);
  if (!snapshotId) {
    throw new Error(`DeepWiki run completed without snapshot id: run=${created.run_id}`);
  }
  console.log(`[deepwiki-v2] completed run #${created.run_id}, snapshot #${snapshotId}`);
  return {
    versionLine,
    created,
    executed,
    run,
    snapshot_id: snapshotId,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const baselineSnapshotId = toInt(args['baseline-snapshot-id']);
  const includeQueries = args['skip-queries'] ? false : true;
  const reportFile = normalizeText(args['report-file']);

  if (!baselineSnapshotId && !args['version-line-id']) {
    throw new Error('Usage: node scripts/verify-deepwiki-v2.cjs --baseline-snapshot-id=<id> [--version-line-id=<id>] [--report-file=<path>]');
  }

  const output = {
    projectName: normalizeText(args['project-name']) || 'DeepWiki project',
    versionLine: null,
    baseline: null,
    regenerated: null,
    regeneration: null,
  };

  if (baselineSnapshotId) {
    console.log(`[deepwiki-v2] reading baseline snapshot #${baselineSnapshotId}`);
    output.baseline = await summarizeSnapshot(baselineSnapshotId, {
      includeQueries,
      includeHealth: true,
      queries: DEFAULT_QUERIES,
    });
    output.projectName = normalizeText(args['project-name']) || output.baseline?.snapshot?.project_name || output.projectName;
  }

  if (args['version-line-id']) {
    output.regeneration = await executeRegeneration(args);
    output.versionLine = output.regeneration.versionLine;
    output.projectName =
      normalizeText(args['project-name']) ||
      output.projectName;
    output.regenerated = await summarizeSnapshot(output.regeneration.snapshot_id, {
      includeQueries,
      includeHealth: false,
      queries: DEFAULT_QUERIES,
    });
  }

  const reportMarkdown = buildReportMarkdown(output);
  const reportJson = JSON.stringify(output, null, 2);

  if (reportFile) {
    const absReport = path.isAbsolute(reportFile) ? reportFile : path.join(ROOT, reportFile);
    ensureDir(path.dirname(absReport));
    fs.writeFileSync(absReport, reportMarkdown, 'utf8');
    fs.writeFileSync(`${absReport}.json`, reportJson, 'utf8');
    console.log(`[deepwiki-v2] wrote report to ${absReport}`);
    console.log(`[deepwiki-v2] wrote json to ${absReport}.json`);
  }

  console.log(reportMarkdown);
}

(async () => {
  try {
    await main();
  } catch (error) {
    console.error('[deepwiki-v2] failed:', error && error.stack ? error.stack : error);
    process.exitCode = 1;
  } finally {
    try {
      if (typeof db.getPool === 'function') {
        await db.getPool().end();
      }
    } catch {
      /* ignore pool shutdown errors */
    }
  }
})();
