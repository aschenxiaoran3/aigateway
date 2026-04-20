const assert = require('node:assert/strict');
const test = require('node:test');

const {
  deriveBusinessLogicAssets,
  extractRulesFromComments,
  extractRulesFromTestNames,
  upgradeStateMachinesWithGuards,
  extractScenarios,
  extractCalculations,
  extractFailureModes,
  extractInvariants,
} = require('../src/deepwiki/business-logic-mining');
const { loadBusinessLexicon } = require('../src/deepwiki/business-lexicon');
const {
  buildBusinessLogicFromInventory,
  renderBusinessLogicPage,
  buildInventoryEnforcerContext,
} = require('../src/deepwiki/page-builder');
const { buildEnforcerContext } = require('../src/deepwiki/citation-enforcer');

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

test('renderBusinessLogicPage renders object-shaped side_effects without [object Object]', () => {
  const page = renderBusinessLogicPage({
    business_rules: [],
    test_evidence: [],
    state_machines_with_guards: [
      {
        entity: 'Order',
        states: ['CREATED', 'PAID'],
        transitions: [
          {
            from: 'CREATED',
            to: 'PAID',
            trigger: 'pay',
            guard: 'balance >= amount',
            side_effects: [
              { type: 'event_published', name: 'OrderPaidEvent', topic: 'order.paid' },
              { type: 'api_called', name: 'chargeCard' },
              'audit log written',
            ],
          },
        ],
      },
    ],
  });
  assert.ok(page, 'page should render when only state machines exist');
  assert.ok(!/\[object Object\]/.test(page.content), 'side_effects must not render as [object Object]');
  assert.ok(/OrderPaidEvent/.test(page.content), 'should include event name');
  assert.ok(/audit log written/.test(page.content), 'string side effects pass through');
});

test('renderBusinessLogicPage in strict mode drops rules whose citations are not allowlisted', () => {
  const ctx = buildEnforcerContext({
    allowedPaths: ['src/main/java/order/OrderService.java'],
    mode: 'strict',
  });
  const page = renderBusinessLogicPage(
    {
      business_rules: [
        {
          id: 'rule-1',
          natural_text: 'Known path rule',
          trigger: '必须',
          confidence: 0.9,
          citations: [
            { path: 'src/main/java/order/OrderService.java', line_start: 42, line_end: 42 },
          ],
        },
        {
          id: 'rule-2',
          natural_text: 'Unknown path rule',
          trigger: '必须',
          confidence: 0.9,
          citations: [{ path: 'src/main/java/unknown/Ghost.java', line_start: 1, line_end: 1 }],
        },
      ],
      test_evidence: [],
      state_machines_with_guards: [],
    },
    { enforcerContext: ctx },
  );
  assert.ok(page, 'strict page should still render when at least one rule survives');
  assert.equal(page.metadata_json.rule_count, 1, 'second rule should be dropped');
  assert.equal(page.metadata_json.citation_enforcement.mode, 'strict');
  assert.equal(page.metadata_json.citation_enforcement.dropped_rules, 1);
  assert.ok(/Known path rule/.test(page.content));
  assert.ok(!/Unknown path rule/.test(page.content));
});

test('buildInventoryEnforcerContext aggregates inventory paths into allowlist', () => {
  const inventory = {
    controllers: [{ path: 'src/OrderController.java', class_name: 'OrderController' }],
    services: [{ path: 'src/OrderService.java', class_name: 'OrderService' }],
    rule_comments: [{ path: 'src/OrderService.java', line_start: 42, text: 'must be positive' }],
    test_methods: [{ path: 'test/OrderServiceTest.java', name: 'should_reject_negative_amount' }],
  };
  const ctx = buildInventoryEnforcerContext(inventory);
  assert.ok(ctx, 'context should be built');
  assert.ok(ctx.allowedFiles.has('src/OrderController.java'));
  assert.ok(ctx.allowedFiles.has('src/OrderService.java'));
  assert.ok(ctx.allowedFiles.has('test/OrderServiceTest.java'));
});

test('renderBusinessLogicPage returns null when no signals exist', () => {
  const empty = renderBusinessLogicPage({ business_rules: [], test_evidence: [], state_machines_with_guards: [] });
  assert.equal(empty, null);
});

test('extractScenarios produces happy/branch/exception from tests + comments + throws', () => {
  const lexicon = loadBusinessLexicon();
  const testEvidence = [
    {
      description: 'should reject order when amount is negative',
      given: 'amount is negative',
      when: 'creating an order',
      then: 'reject is thrown',
      citations: [
        { path: 'src/test/java/order/OrderServiceTest.java', line_start: 30, line_end: 30 },
      ],
    },
  ];
  const throwStatements = [
    {
      path: 'src/main/java/order/OrderService.java',
      line_start: 55,
      line_end: 55,
      exception_type: 'IllegalArgumentException',
      message: 'amount must be > 0',
    },
  ];
  const commentRecords = [
    {
      text: '如果余额不足则拒绝支付，否则扣款',
      path: 'src/main/java/order/PayService.java',
      line_start: 80,
      line_end: 80,
      source_type: 'code_comment',
    },
  ];
  const scenarios = extractScenarios({ testEvidence, throwStatements, commentRecords, lexicon });
  assert.ok(scenarios.length >= 3, `expected 3+, got ${scenarios.length}`);
  assert.ok(scenarios.some((s) => s.type === 'happy'));
  assert.ok(scenarios.some((s) => s.type === 'branch'));
  assert.ok(scenarios.some((s) => s.type === 'exception'));
  const exc = scenarios.find((s) => s.type === 'exception');
  assert.ok(Array.isArray(exc.citations) && exc.citations.length >= 1);
  assert.equal(exc.citations[0].line_start, 55);
});

test('extractCalculations captures code + comment hints with boundaries', () => {
  const lexicon = loadBusinessLexicon();
  const calculationHints = [
    {
      path: 'src/main/java/fee/FeeCalculator.java',
      line_start: 20,
      line_end: 20,
      text: 'BigDecimal fee = amount.multiply(rate);',
      keyword: 'BigDecimal',
      source_type: 'code',
    },
    {
      path: 'src/main/java/fee/FeeCalculator.java',
      line_start: 5,
      line_end: 5,
      text: '// 费率计算：按月计息，最低 0.5% 最高 5%',
      keyword: null,
      source_type: 'comment',
    },
  ];
  const commentRecords = [
    {
      text: '订单金额不得超过 10000 元且不少于 1 元',
      path: 'src/main/java/order/OrderRule.java',
      line_start: 12,
      line_end: 12,
      source_type: 'code_comment',
    },
  ];
  const calculations = extractCalculations({ calculationHints, commentRecords, lexicon });
  assert.ok(calculations.length >= 2);
  const code = calculations.find((c) => c.source_type === 'calculation_code');
  assert.ok(code, 'code hint should be captured');
  assert.equal(code.keyword, 'BigDecimal');
  assert.equal(code.citations[0].path, 'src/main/java/fee/FeeCalculator.java');
  const ruleCalc = calculations.find((c) => c.source_type === 'calculation_rule');
  assert.ok(ruleCalc, 'rule-derived boundary should be captured');
  assert.ok(Array.isArray(ruleCalc.boundaries) && ruleCalc.boundaries.length >= 1);
});

test('extractFailureModes pairs throws with resilience handlers', () => {
  const lexicon = loadBusinessLexicon();
  const throwStatements = [
    {
      path: 'src/main/java/pay/PayService.java',
      line_start: 60,
      line_end: 60,
      exception_type: 'PaymentDeclinedException',
      message: 'card declined',
    },
  ];
  const exceptionHandlers = [
    {
      path: 'src/main/java/pay/PayService.java',
      line_start: 40,
      line_end: 40,
      annotation: 'Retryable',
      arguments: 'value=PaymentDeclinedException.class',
      kind: 'resilience',
    },
    {
      path: 'src/main/java/pay/ExceptionAdvice.java',
      line_start: 10,
      line_end: 10,
      annotation: 'ExceptionHandler',
      exception_type: 'PaymentDeclinedException',
      arguments: 'PaymentDeclinedException.class',
      kind: 'handler',
    },
  ];
  const modes = extractFailureModes({ throwStatements, exceptionHandlers, commentRecords: [], lexicon });
  assert.ok(modes.length >= 1);
  const fm = modes.find((m) => m.exception_type === 'PaymentDeclinedException');
  assert.ok(fm, 'failure mode for PaymentDeclinedException should exist');
  assert.ok(Array.isArray(fm.compensation) && fm.compensation.length >= 1);
  assert.ok(fm.citations[0].line_start === 60);
});

test('extractInvariants aggregates validation annotations + assertions + ER UNIQUE', () => {
  const lexicon = loadBusinessLexicon();
  const validationAnnotations = [
    {
      path: 'src/main/java/user/UserCreateRequest.java',
      line_start: 18,
      line_end: 18,
      annotation: 'NotBlank',
      arguments: null,
    },
    {
      path: 'src/main/java/user/UserCreateRequest.java',
      line_start: 22,
      line_end: 22,
      annotation: 'Size',
      arguments: 'min=6, max=20',
    },
  ];
  const assertionStatements = [
    {
      path: 'src/main/java/user/UserService.java',
      line_start: 45,
      line_end: 45,
      assertion: 'Objects.requireNonNull',
      arguments: 'user, "user must not be null"',
      source_type: 'guard_call',
    },
    {
      path: 'db/schema.sql',
      line_start: 8,
      line_end: 8,
      assertion: 'UNIQUE',
      arguments: 'UNIQUE KEY uk_user_email (email)',
      source_type: 'sql_unique',
    },
  ];
  const erModel = [
    {
      table: 'orders',
      path: 'db/schema.sql',
      columns: [
        { name: 'id', primary: true, notNull: true },
        { name: 'amount', notNull: true },
      ],
    },
  ];
  const invariants = extractInvariants({ validationAnnotations, assertionStatements, erModel, lexicon });
  assert.ok(invariants.length >= 4);
  assert.ok(invariants.some((i) => i.scope === 'field_validation' && /@NotBlank/.test(i.condition)));
  assert.ok(invariants.some((i) => i.scope === 'database_unique'));
  assert.ok(invariants.some((i) => i.scope === 'guard_call'));
  assert.ok(invariants.some((i) => i.scope === 'database_schema' && /orders\.id/.test(i.condition)));
});

test('renderBusinessLogicPage renders all four new sections when assets provided', () => {
  const page = renderBusinessLogicPage({
    business_rules: [],
    test_evidence: [],
    state_machines_with_guards: [],
    scenarios: [
      {
        scenario_id: 'scn-001',
        type: 'happy',
        title: 'happy path for create order',
        preconditions: ['user logged in'],
        steps: ['POST /orders'],
        expected_outcome: 'order created',
        citations: [{ path: 'src/test/OrderTest.java', line_start: 10, line_end: 10 }],
        confidence: 0.7,
      },
      {
        scenario_id: 'scn-002',
        type: 'exception',
        title: '异常路径：IllegalArgumentException — amount must be > 0',
        preconditions: [],
        steps: [],
        expected_outcome: 'IllegalArgumentException 被抛出',
        citations: [{ path: 'src/main/java/Order.java', line_start: 55, line_end: 55 }],
        confidence: 0.75,
      },
    ],
    calculations: [
      {
        calc_id: 'calc-001',
        formula_text: 'BigDecimal fee = amount.multiply(rate);',
        keyword: 'BigDecimal',
        source_type: 'calculation_code',
        boundaries: [],
        citations: [{ path: 'src/main/java/Fee.java', line_start: 20, line_end: 20 }],
        confidence: 0.7,
      },
    ],
    failure_modes: [
      {
        failure_id: 'fm-001',
        trigger_condition: 'PaymentDeclinedException: card declined',
        exception_type: 'PaymentDeclinedException',
        error_message: 'card declined',
        compensation: [
          { kind: 'resilience', text: '@Retryable', citation: { path: 'src/main/java/Pay.java', line_start: 40, line_end: 40 } },
        ],
        citations: [{ path: 'src/main/java/Pay.java', line_start: 60, line_end: 60 }],
        confidence: 0.75,
      },
    ],
    invariants: [
      {
        invariant_id: 'inv-001',
        condition: '@NotBlank',
        scope: 'field_validation',
        source_type: 'validation_annotation',
        citations: [{ path: 'src/main/java/User.java', line_start: 18, line_end: 18 }],
        confidence: 0.8,
      },
    ],
    summary: {},
  });
  assert.ok(page, 'page should render');
  assert.ok(/业务场景/.test(page.content));
  assert.ok(/关键计算与边界/.test(page.content));
  assert.ok(/失败模式与补偿/.test(page.content));
  assert.ok(/不变量与约束/.test(page.content));
  assert.ok(/BigDecimal/.test(page.content));
  assert.ok(/PaymentDeclinedException/.test(page.content));
  assert.ok(/@NotBlank/.test(page.content));
  assert.equal(page.metadata_json.scenario_count, 2);
  assert.equal(page.metadata_json.calculation_count, 1);
  assert.equal(page.metadata_json.failure_mode_count, 1);
  assert.equal(page.metadata_json.invariant_count, 1);
});

test('buildBusinessLogicFromInventory wires 5 new inventory collections through to assets', () => {
  const inventory = {
    repo_slug: 'demo',
    rule_comments: [],
    test_methods: [],
    throw_statements: [
      {
        path: 'src/main/java/order/OrderService.java',
        line_start: 55,
        line_end: 55,
        exception_type: 'IllegalArgumentException',
        message: 'amount must be > 0',
      },
    ],
    exception_handlers: [
      {
        path: 'src/main/java/order/OrderService.java',
        line_start: 10,
        line_end: 10,
        annotation: 'Retryable',
        kind: 'resilience',
        arguments: null,
      },
    ],
    validation_annotations: [
      {
        path: 'src/main/java/order/OrderRequest.java',
        line_start: 12,
        line_end: 12,
        annotation: 'NotNull',
        arguments: null,
      },
    ],
    assertion_statements: [
      {
        path: 'src/main/java/order/OrderService.java',
        line_start: 40,
        line_end: 40,
        assertion: 'Objects.requireNonNull',
        arguments: 'request',
        source_type: 'guard_call',
      },
    ],
    calculation_hints: [
      {
        path: 'src/main/java/fee/FeeCalculator.java',
        line_start: 20,
        line_end: 20,
        text: 'BigDecimal fee = amount.multiply(rate);',
        keyword: 'BigDecimal',
        source_type: 'code',
      },
    ],
  };
  const assets = buildBusinessLogicFromInventory(inventory);
  assert.ok(assets.scenarios.length >= 1, 'scenarios should be extracted from throws');
  assert.ok(assets.calculations.length >= 1);
  assert.ok(assets.failure_modes.length >= 1);
  assert.ok(assets.invariants.length >= 2);
});
