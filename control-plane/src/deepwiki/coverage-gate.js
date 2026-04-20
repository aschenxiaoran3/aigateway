/**
 * Coverage expected vs observed for DeepWiki runs (Knowledge OS Phase 1).
 */

function unique(arr) {
  return [...new Set((Array.isArray(arr) ? arr : []).filter(Boolean))];
}

function normalizeModuleName(m) {
  return String(m?.name || m || '').trim();
}

function buildExpectedCoverage(inventory = {}, preparedRepoUnits = []) {
  const modules = unique((inventory.modules || []).map(normalizeModuleName).filter(Boolean));
  const apis = unique(
    (inventory.api_endpoints || []).map((a) => String(a?.path || a?.url || a?.method_path || a?.id || '').trim()).filter(Boolean)
  );
  const tables = unique(
    (inventory.tables || []).map((t) => String(t?.name || t?.table || t || '').trim()).filter(Boolean)
  );
  const roles = unique((preparedRepoUnits || []).map((u) => String(u.repo_role || '').trim()).filter(Boolean));
  return {
    modules,
    apis,
    tables,
    repo_roles: roles,
    expected_counts: {
      modules: modules.length,
      apis: apis.length,
      tables: tables.length,
    },
  };
}

function pageReferencesObject(page, key) {
  const files = page?.source_files || [];
  const apis = page?.source_apis || [];
  const tables = page?.source_tables || [];
  const syms = page?.source_symbols || [];
  const blob = `${files.join(' ')} ${apis.join(' ')} ${tables.join(' ')} ${syms.join(' ')} ${page?.content || ''}`;
  return blob.includes(key);
}

function buildObservedCoverage(expected, pages = [], knowledgeGraph = {}) {
  const objects = Array.isArray(knowledgeGraph.objects) ? knowledgeGraph.objects : [];
  const coveredModules = new Set();
  const coveredApis = new Set();
  const coveredTables = new Set();

  for (const mod of expected.modules || []) {
    const hitPage = pages.some((p) => pageReferencesObject(p, mod));
    const hitObj = objects.some(
      (o) =>
        String(o.object_key || '').includes(mod) ||
        String(o.label || '').includes(mod) ||
        (Array.isArray(o.evidence) && o.evidence.some((e) => String(e?.path || '').includes(mod)))
    );
    if (hitPage || hitObj) coveredModules.add(mod);
  }
  for (const api of expected.apis || []) {
    if (!api) continue;
    const short = api.length > 80 ? api.slice(0, 80) : api;
    const hitPage = pages.some((p) => pageReferencesObject(p, api) || pageReferencesObject(p, short));
    if (hitPage) coveredApis.add(api);
  }
  for (const table of expected.tables || []) {
    if (!table) continue;
    const hitPage = pages.some((p) => pageReferencesObject(p, table));
    const hitObj = objects.some((o) => o.object_type === 'table' && String(o.object_key || '').includes(table));
    if (hitPage || hitObj) coveredTables.add(table);
  }

  const moduleRatio = expected.modules.length ? coveredModules.size / expected.modules.length : 1;
  const apiRatio = expected.apis.length ? coveredApis.size / expected.apis.length : 1;
  const tableRatio = expected.tables.length ? coveredTables.size / expected.tables.length : 1;
  const overall = Number(((moduleRatio + apiRatio + tableRatio) / 3).toFixed(4));

  return {
    covered_modules: [...coveredModules],
    covered_apis: [...coveredApis],
    covered_tables: [...coveredTables],
    ratios: { module: moduleRatio, api: apiRatio, table: tableRatio, overall },
    gaps: {
      modules: (expected.modules || []).filter((m) => !coveredModules.has(m)),
      apis: (expected.apis || []).filter((a) => !coveredApis.has(a)).slice(0, 50),
      tables: (expected.tables || []).filter((t) => !coveredTables.has(t)),
    },
  };
}

function weakGraphHints(pages = []) {
  const diagramPages = pages.filter((p) => p.page_type === 'diagram' || String(p.format || '') === 'mmd');
  const issues = [];
  for (const p of diagramPages) {
    const c = String(p.content || '');
    const hasVerb = /(approve|submit|create|update|delete|扣减|入库|出库|审核|调用|request|response)/i.test(c);
    const hasActor = /(actor|participant|用户|系统|服务|Client|API)/i.test(c);
    if (!hasVerb) issues.push({ page_slug: p.page_slug, code: 'missing_action_verb' });
    if (!hasActor) issues.push({ page_slug: p.page_slug, code: 'missing_actor' });
  }
  return { diagram_page_count: diagramPages.length, issues };
}

function buildCoverageReport(expected, observed, qualityGates = {}, inventory = {}, pages = []) {
  const gates = qualityGates.coverage || {};
  const minOverall = Number(gates.min_overall_score ?? 0.35);
  const minMod = Number(gates.min_module_ratio ?? 0.5);
  const minApi = Number(gates.min_api_ratio ?? 0.2);
  const minTbl = Number(gates.min_table_ratio ?? 0.2);
  const r = observed.ratios || {};
  const pass =
    r.overall >= minOverall &&
    r.module >= minMod &&
    r.api >= minApi &&
    r.table >= minTbl;
  const blockPublish = Boolean(!pass && gates.block_publish_on_fail);
  const weak = weakGraphHints(pages);
  const cross = qualityGates.cross_repo || {};
  const expectRoles = Array.isArray(cross.expect_roles) ? cross.expect_roles : [];
  const missing = (inventory.missing_repo_roles || []).filter((role) => expectRoles.includes(role));
  const crossRepoScore = expectRoles.length ? 1 - missing.length / expectRoles.length : 1;

  return {
    generated_at: new Date().toISOString(),
    pass,
    block_publish: blockPublish,
    scores: {
      overall: r.overall,
      module_ratio: r.module,
      api_ratio: r.api,
      table_ratio: r.table,
      cross_repo_score: crossRepoScore,
    },
    thresholds: { min_overall: minOverall, min_module: minMod, min_api: minApi, min_table: minTbl },
    gaps: observed.gaps,
    weak_graph: weak,
    expected_counts: expected.expected_counts,
    observed_counts: {
      modules: observed.covered_modules?.length || 0,
      apis: observed.covered_apis?.length || 0,
      tables: observed.covered_tables?.length || 0,
    },
  };
}

function buildCoverageGapPages(gaps, repoMeta = {}) {
  const lines = [
    '# Coverage gaps（自动生成）',
    '',
    '> 本页由 Knowledge OS `coverage_repair` 阶段生成，列出尚未在 Wiki 页中充分引用的模块 / API / 表。',
    '',
    `**仓库**: ${repoMeta.repo_slug || '-'} @ \`${repoMeta.commit_sha || ''}\``,
    '',
    '## 未覆盖模块',
    ...(gaps.modules || []).length ? gaps.modules.map((m) => `- \`${m}\``) : ['- （无）'],
    '',
    '## 未覆盖 API（节选）',
    ...(gaps.apis || []).length ? gaps.apis.map((a) => `- \`${String(a).slice(0, 120)}\``) : ['- （无）'],
    '',
    '## 未覆盖表',
    ...(gaps.tables || []).length ? gaps.tables.map((t) => `- \`${t}\``) : ['- （无）'],
    '',
  ];
  return [
    {
      page_slug: 'meta/coverage-gaps',
      title: 'Coverage 缺口清单',
      page_type: 'reference',
      format: 'md',
      source_files: [],
      source_apis: [],
      source_tables: [],
      source_symbols: ['coverage_repair'],
      content: lines.join('\n'),
      metadata_json: {
        section_type: 'meta',
        generated_from: 'knowledge_os_coverage_repair',
      },
    },
  ];
}

module.exports = {
  buildExpectedCoverage,
  buildObservedCoverage,
  buildCoverageReport,
  buildCoverageGapPages,
  weakGraphHints,
};
