/**
 * Deterministic Markdown projection: PRD / Tech spec / Test plan from stage context.
 * Content is scaffold + inventory/research excerpts — not a substitute for human PRD.
 */

function esc(s) {
  return String(s || '').replace(/</g, '&lt;');
}

function inventorySummaryMd(inventory) {
  const mods = (inventory.modules || []).slice(0, 30).map((m) => `- ${m.name}（${m.file_count || 0} files）`);
  const apis = (inventory.api_endpoints || []).slice(0, 40).map((a) => `- ${esc(JSON.stringify(a).slice(0, 160))}`);
  const tbl = (inventory.tables || []).slice(0, 40).map((t) => `- ${esc(typeof t === 'string' ? t : t.name || JSON.stringify(t))}`);
  return [
    '## 仓库盘点摘要（来自 inventory）',
    '',
    '### 模块',
    mods.length ? mods.join('\n') : '- （无）',
    '',
    '### API 采样',
    apis.length ? apis.join('\n') : '- （无）',
    '',
    '### 表采样',
    tbl.length ? tbl.join('\n') : '- （无）',
    '',
  ].join('\n');
}

function buildPrdMarkdown(ctx) {
  const { repo, inventory, researchReport, docStandards } = ctx;
  const sections = docStandards?.prd?.sections || [];
  const head = [
    '# PRD（自动生成草案）',
    '',
    '| 字段 | 值 |',
    '|------|-----|',
    `| 仓库 | ${esc(repo.repo_slug)} |`,
    `| 分支 | ${esc(repo.branch)} |`,
    `| Commit | \`${esc(repo.commit_sha)}\` |`,
    '',
    '> 章节结构由 `knowledge-os/doc-standards/prd-skeleton.yaml` 约束；请人工补充业务语义与验收编号（AC）。',
    '',
  ];
  const body = sections.map((s) => `## ${s.title}\n\n_TODO: 依据 DeepWiki 与业务访谈补全（section: ${s.id}）_\n`);
  const research = researchReport
    ? ['## Deep Research 摘录', '', researchReport.slice(0, 12000), ''].join('\n')
    : '';
  return [...head, ...body, inventorySummaryMd(inventory), research].join('\n');
}

function buildTechSpecMarkdown(ctx) {
  const { repo, inventory, researchReport, docStandards } = ctx;
  const sections = docStandards?.tech_spec?.sections || [];
  const head = [
    '# 技术方案（自动生成草案）',
    '',
    '| 字段 | 值 |',
    '|------|-----|',
    `| 仓库 | ${esc(repo.repo_slug)} |`,
    `| Commit | \`${esc(repo.commit_sha)}\` |`,
    '',
    '> 章节由 `techspec-skeleton.yaml` 约束；时序/ER/并发需结合代码与 `deep-research.md` 补全。',
    '',
  ];
  const body = sections.map((s) => `## ${s.title}\n\n_TODO（${s.id}）_\n`);
  const research = researchReport
    ? ['## 参考：Deep Research', '', researchReport.slice(0, 10000), ''].join('\n')
    : '';
  return [...head, ...body, inventorySummaryMd(inventory), research].join('\n');
}

function buildTestPlanMarkdown(ctx) {
  const { repo, inventory, coverageReport, docStandards } = ctx;
  const sections = docStandards?.test_plan?.sections || [];
  const cov = coverageReport
    ? [
        '## Coverage 报告摘要',
        '',
        `- overall: **${coverageReport.scores?.overall ?? '-'}** (pass=${coverageReport.pass})`,
        `- gaps.modules: ${(coverageReport.gaps?.modules || []).length}`,
        '',
      ].join('\n')
    : '';
  const head = [
    '# 测试方案（自动生成草案）',
    '',
    '| 字段 | 值 |',
    '|------|-----|',
    `| 仓库 | ${esc(repo.repo_slug)} |`,
    `| Commit | \`${esc(repo.commit_sha)}\` |`,
    '',
  ];
  const body = sections.map((s) => `## ${s.title}\n\n_TODO（${s.id}）：结合 PRD AC 编写 GWT 用例与 RTM_\n`);
  return [...head, ...body, cov, inventorySummaryMd(inventory)].join('\n');
}

function buildDocumentBundle(ctx) {
  return {
    'PRD.generated.md': buildPrdMarkdown(ctx),
    '技术方案.generated.md': buildTechSpecMarkdown(ctx),
    '测试方案.generated.md': buildTestPlanMarkdown(ctx),
  };
}

module.exports = {
  buildDocumentBundle,
  buildPrdMarkdown,
  buildTechSpecMarkdown,
  buildTestPlanMarkdown,
};
