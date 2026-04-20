const assert = require('node:assert/strict');
const test = require('node:test');

const {
  deriveBusinessLogicAssets,
  extractRulesFromComments,
  extractRulesFromTestNames,
  upgradeStateMachinesWithGuards,
} = require('../src/deepwiki/business-logic-mining');
const { loadBusinessLexicon } = require('../src/deepwiki/business-lexicon');
const {
  buildBusinessLogicFromInventory,
  renderBusinessLogicPage,
} = require('../src/deepwiki/page-builder');

test('extractRulesFromComments catches Chinese strong trigger comments with citations', () => {
  const lexicon = loadBusinessLexicon();
  const commentRecords = [
    {
      text: '订单金额必须大于零，否则拒绝创建',
      path: 'src/main/java/order/OrderService.java',
      line_start: 42,
      line_end: 42,
      source_type: 'code_comment',
    },
    {
      text: 'Helper utility for formatting dates',
      path: 'src/main/java/util/DateUtil.java',
      line_start: 10,
      line_end: 10,
      source_type: 'code_comment',
    },
    {
      text: '审计日志不得删除',
      path: 'src/main/java/audit/AuditService.java',
      line_start: 77,
      line_end: 77,
      source_type: 'code_comment',
    },
  ];

  const rules = extractRulesFromComments({ commentRecords, lexicon });
  assert.ok(rules.length >= 2, `expected at least 2 rules, got ${rules.length}`);

  const amountRule = rules.find((r) => /金额/.test(r.natural_text));
  assert.ok(amountRule, 'amount rule should be extracted');
  assert.equal(amountRule.source_type, 'chinese_comment');
  assert.ok(Array.isArray(amountRule.citations) && amountRule.citations.length >= 1);
  assert.equal(amountRule.citations[0].path, 'src/main/java/order/OrderService.java');
  assert.equal(amountRule.citations[0].line_start, 42);
  assert.ok(typeof amountRule.confidence === 'number' && amountRule.confidence > 0);

  const auditRule = rules.find((r) => /不得/.test(r.trigger || '') || /不得/.test(r.natural_text));
  assert.ok(auditRule, 'audit "不得" rule should be extracted');

  assert.ok(
    !rules.some((r) => /formatting dates/i.test(r.natural_text || '')),
    'non-trigger comment must not produce a rule',
  );
});

test('extractRulesFromTestNames parses JUnit method + Jest it() into Given-When-Then', () => {
  const lexicon = loadBusinessLexicon();
  const testMethods = [
    {
      name: 'shouldRejectOrderWhenAmountIsNegative',
      path: 'src/test/java/order/OrderServiceTest.java',
      line_start: 30,
      line_end: 30,
      framework: 'junit',
    },
    {
      name: 'should refuse payment when balance is insufficient',
      path: 'src/test/js/payment.test.js',
      line_start: 12,
      line_end: 12,
      framework: 'jest',
    },
    {
      name: 'testFoo',
      path: 'src/test/java/bar/FooTest.java',
      line_start: 5,
      line_end: 5,
      framework: 'junit',
    },
  ];

  const evidence = extractRulesFromTestNames({ testMethods, lexicon });
  assert.ok(evidence.length >= 2, `expected at least 2 test evidence entries, got ${evidence.length}`);

  const orderTest = evidence.find((e) => /Reject/i.test(e.description || '') || /Reject/i.test(e.test_id || ''));
  assert.ok(orderTest, 'order reject test should parse');
  assert.ok(orderTest.then, 'then clause should exist');
  assert.ok(orderTest.when, 'when clause should exist');
  assert.ok(Array.isArray(orderTest.citations) && orderTest.citations.length >= 1);
  assert.equal(orderTest.citations[0].path, 'src/test/java/order/OrderServiceTest.java');

  const paymentTest = evidence.find((e) => /payment|balance|insufficient/i.test(e.description || ''));
  assert.ok(paymentTest, 'jest payment test should parse');
  assert.ok(paymentTest.then, 'jest then clause should exist');
});

test('upgradeStateMachinesWithGuards attaches guards and side effects from comments', () => {
  const lexicon = loadBusinessLexicon();
  const stateMachines = [
    {
      entity: 'Order',
      states: ['CREATED', 'PAID', 'SHIPPED', 'COMPLETED'],
      transitions: [
        { from: 'CREATED', to: 'PAID', trigger: 'pay' },
        { from: 'PAID', to: 'SHIPPED', trigger: 'ship' },
      ],
    },
  ];
  const commentRecords = [
    {
      text: '只有当余额充足时才允许支付，支付成功后发送 OrderPaidEvent',
      path: 'src/main/java/order/PayService.java',
      line_start: 120,
      line_end: 120,
      source_type: 'code_comment',
    },
  ];
  const apiContracts = [{ name: 'payOrder', method: 'POST', path: '/api/orders/pay' }];
  const eventCatalog = [{ name: 'OrderPaidEvent', publisher: 'order-service' }];

  const machines = upgradeStateMachinesWithGuards({
    stateMachines,
    commentRecords,
    apiContracts,
    eventCatalog,
    lexicon,
  });

  assert.ok(Array.isArray(machines) && machines.length >= 1);
  const order = machines[0];
  assert.equal(order.entity, 'Order');
  assert.ok(Array.isArray(order.states) && order.states.includes('PAID'));
  assert.ok(Array.isArray(order.transitions) && order.transitions.length >= 1);

  const hasGuardOrEffect = order.transitions.some((t) => t.guard || (Array.isArray(t.side_effects) && t.side_effects.length > 0));
  assert.ok(hasGuardOrEffect, 'at least one transition should carry guard or side_effects');
});

test('deriveBusinessLogicAssets produces unified schema from topology inputs', () => {
  const lexicon = loadBusinessLexicon();
  const topology = {
    repos: [
      {
        repo_slug: 'demo',
        commentRecords: [
          {
            text: '用户必须通过 OTP 验证才能修改手机号',
            path: 'src/main/java/user/UserService.java',
            line_start: 15,
            line_end: 15,
            source_type: 'code_comment',
          },
        ],
        testMethods: [
          {
            name: 'shouldRejectWhenOtpIsInvalid',
            path: 'src/test/java/user/UserServiceTest.java',
            line_start: 22,
            line_end: 22,
            framework: 'junit',
          },
        ],
      },
    ],
  };
  const result = deriveBusinessLogicAssets({
    config: {},
    topology,
    dataContracts: { apiContracts: [], erModel: [], eventCatalog: [] },
    semantic: { businessTerms: [], businessActions: [], stateMachines: [] },
    lexicon,
  });

  assert.ok(result && typeof result === 'object');
  assert.ok(Array.isArray(result.business_rules));
  assert.ok(Array.isArray(result.test_evidence));
  assert.ok(Array.isArray(result.state_machines_with_guards));
  assert.ok(result.business_rules.length >= 1, 'should extract at least one rule');
  assert.ok(result.test_evidence.length >= 1, 'should extract at least one test evidence');
  assert.ok(typeof result.summary === 'object');
});

test('deriveBusinessLogicAssets is resilient to empty topology', () => {
  const lexicon = loadBusinessLexicon();
  const result = deriveBusinessLogicAssets({
    config: {},
    topology: { repos: [] },
    dataContracts: {},
    semantic: {},
    lexicon,
  });
  assert.deepEqual(result.business_rules, []);
  assert.deepEqual(result.test_evidence, []);
  assert.deepEqual(result.state_machines_with_guards, []);
});

test('buildBusinessLogicFromInventory + renderBusinessLogicPage produces a wiki page with citations', () => {
  const inventory = {
    repo_slug: 'demo',
    rule_comments: [
      {
        text: '订单金额必须大于零',
        path: 'src/main/java/order/OrderService.java',
        line_start: 50,
        line_end: 50,
        source_type: 'code_comment',
      },
    ],
    test_methods: [
      {
        name: 'shouldRejectOrderWhenAmountIsNegative',
        path: 'src/test/java/order/OrderServiceTest.java',
        line_start: 30,
        line_end: 30,
        framework: 'junit',
      },
    ],
  };

  const assets = buildBusinessLogicFromInventory(inventory);
  assert.ok(assets.business_rules.length >= 1);
  assert.ok(assets.test_evidence.length >= 1);

  const page = renderBusinessLogicPage(assets);
  assert.ok(page, 'page should be produced when rules/tests exist');
  assert.equal(page.page_slug, '00b-business-logic');
  assert.equal(page.page_type, 'business-logic');
  assert.ok(/业务逻辑洞察/.test(page.content));
  assert.ok(/业务规则/.test(page.content));
  assert.ok(/OrderService\.java:L50/.test(page.content), 'page should include file:line citation');
  assert.ok(/Given|When|Then/i.test(page.content) || /Reject/i.test(page.content));
  assert.ok(Array.isArray(page.source_files));
});

test('renderBusinessLogicPage returns null when no signals exist', () => {
  const empty = renderBusinessLogicPage({ business_rules: [], test_evidence: [], state_machines_with_guards: [] });
  assert.equal(empty, null);
});
