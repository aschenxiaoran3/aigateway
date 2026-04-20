const assert = require('node:assert/strict');
const test = require('node:test');
const { loadKnowledgeOsBundleSafe, listKnowledgeOsEditableFiles } = require('../src/deepwiki/knowledge-os-loader');
const { buildExpectedCoverage, buildObservedCoverage, buildCoverageReport } = require('../src/deepwiki/coverage-gate');
const { buildDocumentBundle } = require('../src/deepwiki/doc-projection');

test('knowledge-os bundle loads and lists files', () => {
  const bundle = loadKnowledgeOsBundleSafe({ repo_slug: 'nonexistent-repo-xyz' });
  assert.ok(bundle);
  assert.ok(bundle.skill_registry);
  const files = listKnowledgeOsEditableFiles();
  assert.ok(files.some((f) => f.includes('skill-registry.yaml')));
});

test('coverage gate produces scores', () => {
  const inventory = {
    modules: [{ name: 'billing', file_count: 3 }, { name: 'auth', file_count: 2 }],
    api_endpoints: ['/api/v1/x', '/api/v1/y'],
    tables: ['t1', 't2'],
  };
  const expected = buildExpectedCoverage(inventory, [{ repo_role: 'service' }]);
  const pages = [
    {
      page_slug: 'p1',
      content: 'billing module /api/v1/x t1',
      source_files: [],
      source_apis: ['/api/v1/x'],
      source_tables: ['t1'],
      source_symbols: ['billing'],
    },
  ];
  const observed = buildObservedCoverage(expected, pages, { objects: [] });
  const report = buildCoverageReport(expected, observed, { coverage: { min_overall_score: 0 } }, inventory, pages);
  assert.equal(typeof report.pass, 'boolean');
  assert.ok(report.scores);
});

test('document bundle contains three markdown files', () => {
  const md = buildDocumentBundle({
    repo: { repo_slug: 'demo', branch: 'main', commit_sha: 'abc' },
    inventory: { modules: [], api_endpoints: [], tables: [] },
    researchReport: '# Research\nhello',
    coverageReport: { pass: true, scores: { overall: 1 }, gaps: { modules: [], apis: [], tables: [] } },
    docStandards: {},
  });
  assert.ok(md['PRD.generated.md'].includes('PRD'));
  assert.ok(md['技术方案.generated.md'].includes('技术方案'));
  assert.ok(md['测试方案.generated.md'].includes('测试'));
});
