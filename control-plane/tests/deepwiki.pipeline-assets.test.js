const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { PipelineContext } = require('../src/deepwiki/core/context');
const { runPipeline } = require('../src/deepwiki/core/pipeline/engine');

require('../src/deepwiki/stages/repo/run');
require('../src/deepwiki/stages/structure/run');
require('../src/deepwiki/stages/data/run');
require('../src/deepwiki/stages/semantic/run');
require('../src/deepwiki/stages/ddd/run');
require('../src/deepwiki/stages/evidence/run');
require('../src/deepwiki/stages/diagram/run');
require('../src/deepwiki/stages/wiki/run');
require('../src/deepwiki/stages/quality/run');
require('../src/deepwiki/stages/derivation/run');

test('pipeline build derives non-placeholder stage assets across PR2-PR10', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'deepwiki-pipeline-assets-'));
  const ctx = new PipelineContext(tempRoot, {
    snapshotId: 108,
    status: 'queued',
    projectId: 7,
    projectCode: 'order-hub',
    projectName: 'Order Hub',
    versionLine: 'release/2026.04',
    approval_status: 'approved',
    lineage_json: {
      source_snapshot_id: 107,
      created_from: 'pipeline-assets-test',
    },
    requirements: ['支持订单提交', '支持订单取消'],
    domains: [
      {
        key: 'order',
        name: '订单域',
        capabilities: ['支持订单提交', '支持订单取消'],
      },
    ],
    repos: [
      {
        repoId: 'web-shop',
        role: 'frontend',
        root: '/tmp/web-shop',
        branch: 'main',
        commitSha: 'fe001',
        manifests: ['package.json'],
        dependencies: ['gateway-api'],
        frontendPages: [
          { pageId: 'order-submit-page', title: '订单提交页', action: '支持订单提交', source: 'src/pages/OrderSubmit.tsx' },
        ],
        handlers: [
          { symbol: 'submitOrder', path: 'src/pages/OrderSubmit.tsx', action: '支持订单提交' },
        ],
        apiCalls: [
          { pageId: 'order-submit-page', pageAction: '支持订单提交', action: '支持订单提交', method: 'POST', path: '/api/orders', targetRepoId: 'gateway-api' },
          { pageId: 'order-submit-page', pageAction: '支持订单取消', action: '支持订单取消', method: 'POST', path: '/api/orders/cancel', targetRepoId: 'gateway-api' },
        ],
      },
      {
        repoId: 'gateway-api',
        role: 'bff',
        root: '/tmp/gateway-api',
        branch: 'main',
        commitSha: 'bff001',
        manifests: ['package.json'],
        dependencies: ['order-service'],
        apis: [
          { method: 'POST', path: '/api/orders', action: '支持订单提交' },
          { method: 'POST', path: '/api/orders/cancel', action: '支持订单取消' },
        ],
        controllers: [
          { symbol: 'OrderGatewayController', path: 'src/controllers/OrderGatewayController.ts' },
        ],
        services: [
          { symbol: 'OrderGatewayService', path: 'src/services/OrderGatewayService.ts' },
        ],
        apiCalls: [
          { action: '支持订单提交', method: 'POST', path: '/internal/orders', targetRepoId: 'order-service' },
          { action: '支持订单取消', method: 'POST', path: '/internal/orders/cancel', targetRepoId: 'order-service' },
        ],
      },
      {
        repoId: 'order-service',
        role: 'backend',
        root: '/tmp/order-service',
        branch: 'main',
        commitSha: 'be001',
        manifests: ['pom.xml'],
        dependencies: ['shared-kernel'],
        apis: [
          { method: 'POST', path: '/internal/orders', action: '支持订单提交' },
          { method: 'POST', path: '/internal/orders/cancel', action: '支持订单取消' },
        ],
        controllers: [
          { symbol: 'OrderController', path: 'src/main/java/OrderController.java' },
        ],
        services: [
          { symbol: 'OrderApplicationService', path: 'src/main/java/OrderApplicationService.java' },
        ],
        repositories: [
          { symbol: 'OrderRepository', path: 'src/main/java/OrderRepository.java' },
        ],
        entities: [
          { symbol: 'OrderAggregate', path: 'src/main/java/OrderAggregate.java' },
        ],
        tables: [
          { table: 'orders', pk: 'id', states: ['NEW', 'SUBMITTED', 'CANCELLED'], path: 'db/orders.sql' },
        ],
        events: [
          { event: 'OrderCreated', topic: 'order.created', consumerRepoIds: ['analytics-pipeline'] },
          { event: 'OrderCancelled', topic: 'order.cancelled', consumerRepoIds: ['analytics-pipeline'] },
        ],
      },
      {
        repoId: 'shared-kernel',
        role: 'shared',
        root: '/tmp/shared-kernel',
        branch: 'main',
        commitSha: 'sh001',
        manifests: ['package.json'],
        utils: [
          { symbol: 'Money', path: 'src/Money.ts' },
        ],
        dtos: [
          { symbol: 'OrderDto', path: 'src/OrderDto.ts' },
        ],
      },
      {
        repoId: 'analytics-pipeline',
        role: 'infra',
        root: '/tmp/analytics-pipeline',
        branch: 'main',
        commitSha: 'ops001',
        manifests: ['Dockerfile'],
        tests: [
          { symbol: 'analyticsFlowCheck', path: 'tests/analyticsFlowCheck.ts' },
        ],
      },
    ],
  });

  await runPipeline(ctx);

  assert.equal(ctx.status, 'ready');

  const topology = ctx.asset('project_topology');
  const subsystemClusters = ctx.asset('subsystem_clusters');
  const callGraph = ctx.asset('call_graph');
  const dataAlignment = ctx.asset('contract_alignment_report');
  const domains = ctx.asset('domain_model');
  const evidence = ctx.asset('evidence_index');
  const diagrams = ctx.asset('diagram_assets');
  const pages = ctx.asset('wiki_pages');
  const quality = ctx.asset('quality_report');
  const techSpec = ctx.asset('tech_spec_bundle');
  const derivationLineage = ctx.asset('derivation_lineage');

  assert.equal(topology.repos.length, 5);
  assert.ok(subsystemClusters.some((item) => item.subsystem === 'gateway' && item.repos.includes('gateway-api')));
  assert.ok(callGraph.some((edge) => edge.fromRepo === 'web-shop' && edge.toRepo === 'gateway-api' && edge.edgeType === 'http'));
  assert.equal(dataAlignment.unmatchedRequests.length, 0);
  assert.ok(domains.domains.some((item) => item.name === '订单域' && item.participatingRepos.includes('web-shop') && item.participatingRepos.includes('order-service')));
  assert.ok(evidence.some((item) => item.type === 'api'));
  assert.ok(evidence.some((item) => item.type === 'table'));
  assert.ok(Array.isArray(diagrams) && diagrams.length >= 2);
  assert.ok(diagrams.every((item) => Array.isArray(item.covered_evidence) && item.covered_evidence.length > 0));
  assert.ok(pages.some((item) => item.pageType === 'overview'));
  assert.ok(pages.some((item) => item.pageType === 'domain' && item.title === '订单域'));
  assert.ok(quality.checks.some((item) => item.checker === 'CrossRepoFlowCompletenessChecker' && item.passed));
  assert.ok(quality.checks.some((item) => item.checker === 'DiagramBusinessActionChecker' && item.passed));
  assert.equal(techSpec.mode, 'draft');
  assert.ok(techSpec.summary.includes('Order Hub'));
  assert.equal(derivationLineage.requirementCount, 2);
  assert.ok(fs.existsSync(path.join(tempRoot, '.deepwiki', 'snapshots', '108', 'assets', 'domain_model.json')));
  assert.ok(fs.existsSync(path.join(tempRoot, '.deepwiki', 'snapshots', '108', 'assets', 'diagram_assets.json')));
  assert.ok(fs.existsSync(path.join(tempRoot, '.deepwiki', 'snapshots', '108', 'assets', 'derivation_lineage.json')));
});
