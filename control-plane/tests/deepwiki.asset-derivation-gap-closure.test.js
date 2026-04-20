'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  deriveBusinessActionCandidates,
  deriveNoTableDomainCandidates,
  buildFrontendJourneySteps,
  buildApiContractIndex,
  deriveSemanticAssets,
  deriveDddAssets,
} = require('../src/deepwiki/asset-derivation');

test('E-B · deriveNoTableDomainCandidates clusters APIs by detected domain when no table backs them', () => {
  const dataContracts = {
    apiContracts: [
      { method: 'POST', path: '/api/ai/chat/stream', businessAction: '流式处理', domainKey: '' },
      { method: 'POST', path: '/api/ai/session', businessAction: '会话建立', domainKey: '' },
      { method: 'GET', path: '/api/order/list', businessAction: '订单列表', domainKey: 'order' },
    ],
    erModel: [
      { table: 't_order', domainKey: 'order' },
    ],
    eventCatalog: [],
  };
  const candidates = deriveNoTableDomainCandidates(dataContracts);
  const aiSeed = candidates.find((item) => item.domainKey === 'ai_ordering');
  assert.ok(aiSeed, 'ai_ordering should be seeded from api cluster even without table');
  assert.ok(aiSeed.reasons.includes('no_table'));
  assert.ok(aiSeed.reasons.includes('api_cluster'));
  const orderSeed = candidates.find((item) => item.domainKey === 'order');
  assert.equal(orderSeed, undefined, 'domain with backing table must be excluded from no-table seeds');
});

test('E-B · deriveDddAssets uses no-table seeds and business_logic_assets domain_hint', () => {
  const config = {};
  const topology = { repos: [{ repoId: 'r1', role: 'backend' }] };
  const structure = { symbols: [], crossRepoEdges: [] };
  const dataContracts = {
    apiContracts: [
      { method: 'POST', path: '/api/ai/chat/stream', businessAction: '流式对话' },
      { method: 'POST', path: '/api/ai/session', businessAction: '开启会话' },
    ],
    erModel: [],
    eventCatalog: [],
    frontendRequestMap: [],
  };
  const semantic = deriveSemanticAssets(config, topology, structure, dataContracts);
  const businessLogicAssets = {
    business_rules: [
      { natural_text: '计费必须按阶梯费率', domain_hint: 'finance_bill' },
    ],
    failure_modes: [
      { description: '支付超时后必须回滚订单', domain_hint: 'finance_bill' },
    ],
  };
  const ddd = deriveDddAssets(config, topology, structure, dataContracts, semantic, { businessLogicAssets });
  const domains = (ddd.domainModel && Array.isArray(ddd.domainModel.domains)) ? ddd.domainModel.domains : [];
  const domainKeys = domains.map((d) => d.key);
  assert.ok(domainKeys.includes('ai_ordering'), `domain model must contain ai_ordering seeded from API cluster, got ${domainKeys.join(',')}`);
  assert.ok(domainKeys.includes('finance_bill'), `domain model must contain finance_bill seeded from business_logic_assets.domain_hint, got ${domainKeys.join(',')}`);
});

test('E-C · buildFrontendJourneySteps emits open + request + response kinds', () => {
  const requestMap = {
    pageAction: '订单提交',
    pageId: 'page-1',
    request: 'POST /api/order/submit',
    matched: true,
  };
  const contract = { method: 'POST', path: '/api/order/submit' };
  const steps = buildFrontendJourneySteps(requestMap, contract);
  const kinds = steps.map((s) => s.kind);
  assert.ok(kinds.includes('open'));
  assert.ok(kinds.includes('request'));
  assert.ok(kinds.includes('response'));
  assert.ok(kinds.includes('side_effect'), 'POST to /submit path should produce a side_effect step');
  const sideEffect = steps.find((s) => s.kind === 'side_effect');
  assert.ok(
    Array.isArray(sideEffect.details) && sideEffect.details.some((item) => /提交/.test(item)),
    'side_effect details should describe the submit operation'
  );
});

test('E-C · buildFrontendJourneySteps attaches guard and branch when contract provides states/requiredParams', () => {
  const requestMap = {
    pageAction: '订单审核',
    pageId: 'page-2',
    request: 'POST /api/order/approve',
    matched: true,
  };
  const contract = {
    method: 'POST',
    path: '/api/order/approve',
    requiredParams: ['orderId', 'approver'],
    states: ['APPROVED', 'REJECTED'],
    responseBranches: ['权限不足 → 403'],
  };
  const steps = buildFrontendJourneySteps(requestMap, contract);
  const kinds = steps.map((s) => s.kind);
  assert.ok(kinds.includes('guard'), 'required params should produce guard step');
  assert.ok(kinds.includes('branch'), 'states/responseBranches should produce branch step');
  const guard = steps.find((s) => s.kind === 'guard');
  assert.ok(guard.details.some((item) => /orderId/i.test(item)));
  const branch = steps.find((s) => s.kind === 'branch');
  assert.ok(branch.details.some((item) => /APPROVED/.test(item)));
  assert.ok(branch.details.some((item) => /REJECTED/.test(item)));
});

test('E-C · GET request stays informational — no side_effect', () => {
  const steps = buildFrontendJourneySteps(
    { pageAction: '订单查询', pageId: 'p', request: 'GET /api/order/list', matched: true },
    { method: 'GET', path: '/api/order/list' }
  );
  const kinds = steps.map((s) => s.kind);
  assert.ok(!kinds.includes('side_effect'), 'GET request must not emit side_effect step');
  assert.ok(kinds.includes('response'));
});

test('E-C · buildApiContractIndex lookup handles method case variance', () => {
  const index = buildApiContractIndex([
    { method: 'post', path: '/api/order/submit' },
    { method: 'GET', path: '/api/order/list' },
  ]);
  assert.ok(index.lookup('POST', '/api/order/submit'));
  assert.ok(index.lookup('get', '/api/order/list'));
  // wildcard path match: unknown method falls back to any matching path
  assert.ok(index.lookup('DELETE', '/api/order/submit'));
  // unknown path stays null
  assert.equal(index.lookup('GET', '/api/does/not/exist'), null);
});

test('E-D · deriveBusinessActionCandidates removes slice(0,24) cap and pulls from test methods + rule comments', () => {
  const config = { requirements: ['R1', 'R2'] };
  const topology = {
    repos: [
      {
        repoId: 'r1',
        test_methods: Array.from({ length: 40 }, (_, i) => ({
          name: `shouldHandleCase_${i}`,
          description: `场景 ${i} 的业务校验`,
        })),
        rule_comments: [
          { text: '金额必须为正数' },
          { text: '订单取消后不得再次支付' },
        ],
      },
    ],
  };
  const structure = { symbols: [] };
  const dataContracts = {
    apiContracts: Array.from({ length: 20 }, (_, i) => ({
      method: 'GET',
      path: `/api/probe${i}`,
      businessAction: `API 动作 ${i}`,
    })),
    frontendRequestMap: [],
    eventCatalog: [],
  };
  const actions = deriveBusinessActionCandidates(config, topology, structure, dataContracts);
  assert.ok(actions.length > 24, `expected > 24 business actions after removing slice(0,24), got ${actions.length}`);
  assert.ok(actions.some((a) => /场景 0 的业务校验/.test(a)), 'should include test method descriptions');
  assert.ok(actions.some((a) => /金额必须为正数/.test(a)), 'should include rule comments');
  assert.ok(actions.some((a) => a === 'R1'), 'should retain config requirements');
  // soft-cap still enforced
  assert.ok(actions.length <= 128, `soft cap 128 must still apply, got ${actions.length}`);
});

test('E-D · deriveSemanticAssets exposes enlarged business actions', () => {
  const config = {};
  const topology = {
    repos: [
      {
        repoId: 'r1',
        test_methods: Array.from({ length: 30 }, (_, i) => ({
          name: `test_${i}`,
          description: `用例 ${i}`,
        })),
        rule_comments: [],
      },
    ],
  };
  const structure = { symbols: [], crossRepoEdges: [] };
  const dataContracts = { apiContracts: [], frontendRequestMap: [], eventCatalog: [], erModel: [] };
  const semantic = deriveSemanticAssets(config, topology, structure, dataContracts);
  assert.ok(semantic.businessActions.length >= 25, `expected business actions above legacy 24-cap, got ${semantic.businessActions.length}`);
});
