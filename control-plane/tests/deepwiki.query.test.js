const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildDeepWikiCommunityReportsFromGraph,
  buildDeepWikiDomainModel,
  buildDeepWikiThreadPages,
  buildDeepWikiThreadsFromGraph,
  buildDeepWikiRetrievalProbeQueries,
  decideDeepWikiQueryMode,
  linkQueryToDeepWikiObjects,
  rewriteDeepWikiBusinessQuery,
  runSingleLayerLouvainLikeCommunityDetection,
} = require('../src/db/mysql');

test('runSingleLayerLouvainLikeCommunityDetection groups connected subgraphs', () => {
  const communities = runSingleLayerLouvainLikeCommunityDetection(
    [
      { object_type: 'service', object_key: 'order-service' },
      { object_type: 'api', object_key: 'order-api' },
      { object_type: 'table', object_key: 'order-table' },
      { object_type: 'service', object_key: 'inventory-service' },
    ],
    [
      { from_object_type: 'service', from_object_key: 'order-service', to_object_type: 'api', to_object_key: 'order-api' },
      { from_object_type: 'api', from_object_key: 'order-api', to_object_type: 'table', to_object_key: 'order-table' },
    ]
  );

  assert.equal(communities.length, 2);
  assert.equal(communities[0].object_keys.length, 3);
});

test('linkQueryToDeepWikiObjects and decideDeepWikiQueryMode prefer local mode for entity-centric queries', () => {
  const objects = [
    { object_type: 'service', object_key: 'sales-order-service', title: '销售订单服务', payload_json: { detail: { service_name: '销售订单服务' } } },
    { object_type: 'table', object_key: 'sales_order', title: '销售订单表', payload_json: { detail: { table_name: 'sales_order' } } },
  ];
  const linked = linkQueryToDeepWikiObjects('销售订单服务接口依赖什么表', objects, 3);

  assert.equal(linked[0].object_key, 'sales-order-service');
  assert.equal(decideDeepWikiQueryMode('销售订单服务接口依赖什么表', linked, 'auto'), 'local');
  assert.equal(decideDeepWikiQueryMode('请从整体架构解释这个项目', linked, 'auto'), 'global');
});

test('buildDeepWikiCommunityReportsFromGraph and buildDeepWikiRetrievalProbeQueries include page evidence', () => {
  const graph = {
    objects: [
      { id: 1, object_type: 'service', object_key: 'sales-order-service', title: '销售订单服务', payload_json: {} },
      { id: 2, object_type: 'api', object_key: 'sales-order-api', title: '销售订单接口', payload_json: {} },
    ],
    relations: [
      { from_object_type: 'service', from_object_key: 'sales-order-service', to_object_type: 'api', to_object_key: 'sales-order-api' },
    ],
  };
  const pages = [
    {
      page_slug: '03-services',
      title: '服务总览',
      metadata_json: { object_keys: ['service:sales-order-service'] },
      object_keys: ['service:sales-order-service'],
    },
    {
      page_slug: '04-apis',
      title: '接口清单',
      metadata_json: { object_keys: ['api:sales-order-api'] },
      object_keys: ['api:sales-order-api'],
    },
  ];

  const reports = buildDeepWikiCommunityReportsFromGraph(9, graph, pages);
  const probes = buildDeepWikiRetrievalProbeQueries(graph, pages, reports);

  assert.equal(reports.length, 1);
  assert.deepEqual(reports[0].page_slugs_json.sort(), ['03-services', '04-apis']);
  assert.ok(probes.some((item) => item.expected_page_slugs.includes('03-services')));
  assert.ok(probes.some((item) => item.scope === 'global'));
});

test('buildDeepWikiThreadsFromGraph creates trunk/domain/core/branch layers and thread pages', () => {
  const inventory = {
    business_modules: [
      {
        name: 'lime-bill-service',
        source_files: [
          'lime-bill-service/src/main/java/com/example/controller/BillOrderController.java',
          'lime-bill-service/src/main/java/com/example/service/BillOrderService.java',
        ],
      },
    ],
    modules: [],
    repo_roles: ['service'],
    missing_repo_roles: ['frontend_view'],
    entry_candidates: ['lime-bill-service/src/main/java/com/example/LimeBillApplication.java'],
    api_endpoints: ['GET /bill/orders'],
    tables: ['bill_inventory_order'],
  };
  const graph = {
    objects: [
      { object_type: 'api', object_key: 'bill-orders-api', title: '账单订单接口', payload_json: { source_files: ['lime-bill-service/src/main/java/com/example/controller/BillOrderController.java'], source_apis: ['GET /bill/orders'] } },
      { object_type: 'service', object_key: 'bill-order-service', title: '账单订单服务', payload_json: { source_files: ['lime-bill-service/src/main/java/com/example/service/BillOrderService.java'] } },
      { object_type: 'table', object_key: 'bill_inventory_order', title: 'bill_inventory_order', payload_json: { source_files: ['db/schema.sql'], source_tables: ['bill_inventory_order'] } },
      { object_type: 'api', object_key: 'bill-orders-history-api', title: '账单历史接口', payload_json: { source_files: ['lime-bill-service/src/main/java/com/example/controller/BillOrderController.java'], source_apis: ['GET /bill/orders/history'] } },
    ],
    relations: [
      { from_object_type: 'service', from_object_key: 'bill-order-service', to_object_type: 'api', to_object_key: 'bill-orders-api' },
      { from_object_type: 'service', from_object_key: 'bill-order-service', to_object_type: 'api', to_object_key: 'bill-orders-history-api' },
      { from_object_type: 'service', from_object_key: 'bill-order-service', to_object_type: 'table', to_object_key: 'bill_inventory_order' },
    ],
  };

  const threads = buildDeepWikiThreadsFromGraph({ inventory, graph });
  const pages = buildDeepWikiThreadPages(threads, inventory, graph);

  assert.ok(threads.some((item) => item.thread_level === 'project_trunk'));
  assert.ok(threads.some((item) => item.thread_level === 'domain'));
  assert.ok(threads.some((item) => item.thread_level === 'core_thread'));
  assert.ok(threads.some((item) => item.thread_level === 'branch_thread'));
  assert.ok(threads.every((item) => String(item.thread_key || '').length <= 96));
  assert.ok(pages.some((item) => item.page_slug.includes('/10-threads/') && item.page_slug.endsWith('/01-main-flow')));
  assert.ok(pages.some((item) => item.page_slug.includes('/10-threads/') && item.page_slug.endsWith('/04-front-back-data-binding')));
  assert.ok(
    pages.some(
      (item) =>
        (item.page_slug.startsWith('10-domains/') || item.page_slug.includes('/10-domains/')) &&
        item.page_slug.endsWith('/01-context-map')
    )
  );
});

test('buildDeepWikiDomainModel and rewriteDeepWikiBusinessQuery capture ddd domain intent', () => {
  const graph = {
    objects: [
      {
        object_type: 'domain_context',
        object_key: 'inventory-bill',
        title: '库存 / 入出库 上下文',
        payload_json: {
          domain_key: 'inventory-bill',
          domain_label: '库存 / 入出库',
          domain_tier: 'core',
          ubiquitous_language: ['采购入库单', '出库单', '库存流水'],
        },
      },
      {
        object_type: 'domain_behavior',
        object_key: 'purchase-in-create',
        title: '采购入库单 / create',
        payload_json: {
          domain_key: 'inventory-bill',
          description: '创建采购入库单并落库存流水',
          source_apis: ['POST /purchase/in/create'],
          source_tables: ['purchase_in_bill'],
          aggregate_name: 'PurchaseInBill',
          command_name: '采购入库创建命令',
          event_name: '采购入库已创建',
        },
      },
      {
        object_type: 'aggregate',
        object_key: 'inventory-bill-purchaseinbill',
        title: 'PurchaseInBill',
        payload_json: {
          domain_key: 'inventory-bill',
        },
      },
    ],
    relations: [
      {
        from_object_type: 'domain_context',
        from_object_key: 'inventory-bill',
        relation_type: 'owns_behavior',
        to_object_type: 'domain_behavior',
        to_object_key: 'purchase-in-create',
      },
      {
        from_object_type: 'domain_context',
        from_object_key: 'inventory-bill',
        relation_type: 'owns_aggregate',
        to_object_type: 'aggregate',
        to_object_key: 'inventory-bill-purchaseinbill',
      },
    ],
  };
  const threads = [
    {
      thread_key: 'inventory-bill-purchase-in-create',
      thread_level: 'core_thread',
      domain_key: 'inventory-bill',
      domain_context_key: 'inventory-bill',
      behavior_key: 'purchase-in-create',
      title: '采购入库单 / create',
      repo_roles_json: ['service'],
    },
  ];
  const pages = [{ page_slug: '10-domains/inventory-bill/00-summary', metadata_json: { scope_type: 'domain', scope_key: 'inventory-bill' } }];
  const domains = buildDeepWikiDomainModel(1, graph, threads, pages, []);
  const rewritten = rewriteDeepWikiBusinessQuery('采购入库单核心逻辑和回滚分支是什么？');

  assert.equal(domains.length, 1);
  assert.equal(domains[0].domain_key, 'inventory-bill');
  assert.equal(domains[0].behaviors[0].title, '采购入库单 / create');
  assert.ok(rewritten.intents.includes('main_flow'));
  assert.ok(rewritten.intents.includes('branch_flow'));
  assert.ok(rewritten.rewritten_query.includes('核心行为'));
  assert.ok(rewritten.rewritten_query.includes('回滚路径'));
});
