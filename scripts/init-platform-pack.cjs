#!/usr/bin/env node
/**
 * 平台初始化包：
 * - base: 控制平面与治理种子
 * - knowledge: 平台通用知识资产目录
 * - demo: 演示项目、运行样例、度量/审计/验收样例、默认文档任务
 *
 * 用法：
 *   node scripts/init-platform-pack.cjs
 *   node scripts/init-platform-pack.cjs --only=base,demo
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const fixtureDir = path.join(root, 'fixtures/sales-order-e2e');

function parseArgs(argv) {
  const onlyArg = argv.find((item) => item.startsWith('--only='));
  if (!onlyArg) {
    return ['base', 'knowledge', 'demo'];
  }
  return onlyArg
    .replace('--only=', '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function readFile(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function normalizeText(value) {
  return String(value || '').replace(/\r/g, '').trim();
}

function stringifyJson(value) {
  return JSON.stringify(value == null ? {} : value);
}

function stringifyNullableJson(value, fallback = null) {
  return JSON.stringify(value == null ? fallback : value);
}

async function runSqlFile(conn, relativePath, label) {
  const sql = readFile(relativePath);
  try {
    await conn.query({ sql, multipleStatements: true });
    console.log(`OK: ${label}`);
  } catch (error) {
    const code = String(error?.code || '');
    const message = String(error?.message || '');
    const isDuplicateShape =
      message.includes('Duplicate column') ||
      code === 'ER_DUP_FIELDNAME' ||
      code === 'ER_DUP_KEYNAME' ||
      code === 'ER_CANT_CREATE_TABLE';
    if (isDuplicateShape && relativePath.includes('/migrations/')) {
      console.warn(`Skip ${label} (already applied or partially present): ${message}`);
      return;
    }
    throw error;
  }
}

async function findKnowledgeAssets(conn, assetKeys) {
  if (!assetKeys.length) return {};
  const placeholders = assetKeys.map(() => '?').join(',');
  const [rows] = await conn.query(
    `SELECT id, asset_key, name, source_uri FROM gateway_knowledge_assets WHERE asset_key IN (${placeholders})`,
    assetKeys
  );
  return rows.reduce((acc, row) => {
    acc[row.asset_key] = row;
    return acc;
  }, {});
}

async function ensurePipeline(conn, config) {
  const [existingDefRows] = await conn.query(
    'SELECT * FROM gateway_pipeline_definitions WHERE pipeline_key = ? LIMIT 1',
    [config.pipeline_key]
  );
  let definition = existingDefRows[0];
  if (!definition) {
    const [result] = await conn.query(
      `INSERT INTO gateway_pipeline_definitions
       (pipeline_key, name, domain, description, owner_role, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        config.pipeline_key,
        config.name,
        config.domain,
        config.description,
        config.owner_role || '平台组',
        'active',
      ]
    );
    const [rows] = await conn.query('SELECT * FROM gateway_pipeline_definitions WHERE id = ? LIMIT 1', [result.insertId]);
    definition = rows[0];
  } else {
    await conn.query(
      `UPDATE gateway_pipeline_definitions
       SET name = ?, domain = ?, description = ?, owner_role = ?, status = 'active', updated_at = NOW()
       WHERE id = ?`,
      [config.name, config.domain, config.description, config.owner_role || '平台组', definition.id]
    );
  }

  const [existingVersionRows] = await conn.query(
    `SELECT * FROM gateway_pipeline_versions
     WHERE pipeline_definition_id = ? AND version = ?
     LIMIT 1`,
    [definition.id, config.version]
  );
  let version = existingVersionRows[0];
  if (!version) {
    const [result] = await conn.query(
      `INSERT INTO gateway_pipeline_versions
       (pipeline_definition_id, version, status, published_at, change_summary)
       VALUES (?, ?, 'published', NOW(), ?)`,
      [definition.id, config.version, config.change_summary || 'platform-init']
    );
    const [rows] = await conn.query('SELECT * FROM gateway_pipeline_versions WHERE id = ? LIMIT 1', [result.insertId]);
    version = rows[0];
  } else {
    await conn.query(
      `UPDATE gateway_pipeline_versions
       SET status = 'published', published_at = COALESCE(published_at, NOW()), change_summary = ?
       WHERE id = ?`,
      [config.change_summary || 'platform-init', version.id]
    );
  }

  for (const node of config.nodes) {
    await conn.query(
      `INSERT INTO gateway_pipeline_nodes
       (pipeline_version_id, node_key, node_name, node_type, retry_policy, timeout_policy, fallback_policy, sort_order, config_json)
       VALUES (?, ?, ?, ?, CAST(? AS JSON), CAST(? AS JSON), CAST(? AS JSON), ?, CAST(? AS JSON))
       ON DUPLICATE KEY UPDATE
         node_name = VALUES(node_name),
         node_type = VALUES(node_type),
         sort_order = VALUES(sort_order),
         config_json = VALUES(config_json)`,
      [
        version.id,
        node.node_key,
        node.node_name,
        node.node_type,
        stringifyJson(node.retry_policy || { maxRetries: 0 }),
        stringifyJson(node.timeout_policy || { timeoutMs: 30000 }),
        stringifyJson(node.fallback_policy || { mode: 'manual_review' }),
        node.sort_order,
        stringifyJson(node.config_json || {}),
      ]
    );
  }

  await conn.query(
    `UPDATE gateway_pipeline_definitions
     SET current_version_id = ?, status = 'active', updated_at = NOW()
     WHERE id = ?`,
    [version.id, definition.id]
  );

  return {
    definition_id: definition.id,
    version_id: version.id,
  };
}

async function ensurePipelineRun(conn, config) {
  const [existingRows] = await conn.query(
    'SELECT * FROM gateway_pipeline_runs WHERE trace_id = ? ORDER BY id DESC LIMIT 1',
    [config.trace_id]
  );
  let run = existingRows[0];
  if (!run) {
    const [result] = await conn.query(
      `INSERT INTO gateway_pipeline_runs
       (pipeline_definition_id, pipeline_version_id, trace_id, project_code, status, source_type, entry_event, request_payload, started_at, ended_at, approval_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), NOW(), NOW(), ?)`,
      [
        config.pipeline_definition_id,
        config.pipeline_version_id,
        config.trace_id,
        config.project_code,
        config.status || 'completed',
        config.source_type || 'seed',
        config.entry_event || 'platform_init',
        stringifyNullableJson(
          config.request_payload,
          {
            trace_id: config.trace_id,
            project_code: config.project_code,
            entry_event: config.entry_event || 'platform_init',
            source_type: config.source_type || 'seed',
          }
        ),
        config.approval_status || 'approved',
      ]
    );
    const [rows] = await conn.query('SELECT * FROM gateway_pipeline_runs WHERE id = ? LIMIT 1', [result.insertId]);
    run = rows[0];
  } else {
    await conn.query(
      `UPDATE gateway_pipeline_runs
       SET pipeline_definition_id = ?, pipeline_version_id = ?, project_code = ?, status = ?, source_type = ?, entry_event = ?, request_payload = CAST(? AS JSON), approval_status = ?, ended_at = COALESCE(ended_at, NOW())
       WHERE id = ?`,
      [
        config.pipeline_definition_id,
        config.pipeline_version_id,
        config.project_code,
        config.status || 'completed',
        config.source_type || 'seed',
        config.entry_event || 'platform_init',
        stringifyNullableJson(
          config.request_payload,
          {
            trace_id: config.trace_id,
            project_code: config.project_code,
            entry_event: config.entry_event || 'platform_init',
            source_type: config.source_type || 'seed',
          }
        ),
        config.approval_status || 'approved',
        run.id,
      ]
    );
  }

  const [nodeRows] = await conn.query(
    `SELECT * FROM gateway_pipeline_nodes
     WHERE pipeline_version_id = ?
     ORDER BY sort_order ASC, id ASC`,
    [config.pipeline_version_id]
  );

  for (const node of nodeRows) {
    const inputPayload =
      config.node_inputs?.[node.node_key] || {
        trace_id: config.trace_id,
        project_code: config.project_code,
        node_key: node.node_key,
        node_name: node.node_name,
      };
    const outputSummary = config.node_summaries?.[node.node_key] || `${node.node_name} 已完成`;
    const outputPayload =
      config.node_outputs?.[node.node_key] || {
        status: config.node_status || 'completed',
        summary: outputSummary,
      };
    const retrievalContext = config.node_retrieval_contexts?.[node.node_key] || [];
    const evidenceRefs = config.node_evidence_refs?.[node.node_key] || [];
    const [existingNodeRows] = await conn.query(
      `SELECT id FROM gateway_run_nodes
       WHERE pipeline_run_id = ? AND node_key = ?
       LIMIT 1`,
      [run.id, node.node_key]
    );
    if (existingNodeRows[0]?.id) {
      await conn.query(
        `UPDATE gateway_run_nodes
         SET status = ?, input_payload = CAST(? AS JSON), output_summary = ?, output_payload = CAST(? AS JSON), retrieval_context = CAST(? AS JSON), evidence_refs = CAST(? AS JSON), ended_at = COALESCE(ended_at, NOW()), updated_at = NOW()
         WHERE id = ?`,
        [
          config.node_status || 'completed',
          stringifyNullableJson(inputPayload, {}),
          outputSummary,
          stringifyNullableJson(outputPayload, {}),
          stringifyNullableJson(retrievalContext, []),
          stringifyNullableJson(evidenceRefs, []),
          existingNodeRows[0].id,
        ]
      );
      continue;
    }
    await conn.query(
      `INSERT INTO gateway_run_nodes
       (pipeline_run_id, node_key, node_name, node_type, input_payload, status, started_at, ended_at, output_summary, output_payload, retrieval_context, evidence_refs)
       VALUES (?, ?, ?, ?, CAST(? AS JSON), ?, NOW(), NOW(), ?, CAST(? AS JSON), CAST(? AS JSON), CAST(? AS JSON))`,
      [
        run.id,
        node.node_key,
        node.node_name,
        node.node_type,
        stringifyNullableJson(inputPayload, {}),
        config.node_status || 'completed',
        outputSummary,
        stringifyNullableJson(outputPayload, {}),
        stringifyNullableJson(retrievalContext, []),
        stringifyNullableJson(evidenceRefs, []),
      ]
    );
  }

  return run;
}

function buildTemplatePlanMarkdown(title = '销售订单测试方案标准模板版') {
  return [
    `# ${title}`,
    '',
    '## 测试目标 / 测试范围 / 不在范围',
    '- 测试目标：验证业务规则、接口契约、状态迁移、DB 落库、补偿链路与发布依据。',
    '- 测试范围：销售订单创建、提交、审核、驳回、销售出库确认、确认收货、作废逆向。',
    '- 不在范围：仓库盘点、财务结算、第三方物流对账。',
    '',
    '## 测试对象 / 版本边界 / 变更范围',
    '- 测试对象：销售订单链路。',
    '- 版本边界：DEMO-1.0。',
    '- 变更范围：状态机、确认出库、库存回写、补偿任务、日志与指标。',
    '',
    '## 假设 / 依赖 / 约束',
    '- 假设 PRD、技术方案、接口契约、DDL 为当前唯一主口径。',
    '- 依赖可访问业务入口、接口日志、数据库查询、补偿任务表。',
    '- 约束：若 DDL 或接口契约缺失，则不允许正式发布。',
    '',
    '## 风险清单与优先级',
    '- P0：重复 confirm 导致库存重复扣减、非法状态迁移、外部成功本地失败。',
    '- P1：边界值场景、异常提示语、日志/指标缺失。',
    '- P2：历史缺陷回归遗漏、自动化范围不足。',
    '',
    '## 进入准则 / 退出准则',
    '- 进入准则：输入契约门禁、PRD 门禁、技术方案门禁已通过；Coverage Graph 已生成。',
    '- 退出准则：P0/P1 用例完成，阻断缺陷关闭，测试方案门禁 pass，发布建议为允许发布。',
    '',
    '## 测试环境矩阵',
    '| 环境 | 用途 | 必备能力 |',
    '| --- | --- | --- |',
    '| SIT | 主流程、逆向、补偿验证 | API、日志、DB 查询、消息/任务查看 |',
    '| UAT | 发布前回归与验收 | 与 SIT 同步配置、角色权限、样例数据 |',
    '',
    '## 测试数据策略',
    '- 数据分层：标准正向、边界值、逆向/异常、补偿/重试。',
    '- 数据来源：接口契约样例、DDL 字段约束、历史缺陷样板。',
    '',
    '## 测试生成前置契约检查',
    '- PRD、技术方案、接口契约、DDL 已上传。',
    '- Coverage Graph 已生成，覆盖义务与测试场景已绑定。',
    '',
    '## PRD 追溯矩阵',
    '| PRD 义务 | 关联场景 | 用例编号 |',
    '| --- | --- | --- |',
    '| 草稿 -> 提交 -> 审核通过 | 主流程闭环 | TP-001 |',
    '| 审核驳回后可修改再提交 | 逆向流程 | TP-002 |',
    '| 作废后单据与库存回滚 | 逆向补偿 | TP-006 |',
    '',
    '## 技术方案追溯矩阵',
    '| 技术约束 | 关联验证 | 用例编号 |',
    '| --- | --- | --- |',
    '| 接口幂等控制 | 重复 confirm 不重复扣减库存 | TP-004 |',
    '| 状态机合法迁移 | 非法状态跳转阻断 | TP-003 |',
    '| DDL 字段职责 | 字段级 DB 断言 | TP-005 |',
    '',
    '## Coverage Graph / 覆盖义务清单',
    '| obligation_id | 义务 | 对应测试 |',
    '| --- | --- | --- |',
    '| cov_so_submit | 销售订单提交并进入待审核 | TP-001 |',
    '| cov_so_confirm | 销售出库 confirm 回写与库存扣减 | TP-004 |',
    '| cov_so_cancel | 作废与逆向补偿 | TP-006 |',
    '',
    '## 接口级验证矩阵',
    '| 接口 | 场景 | 预期结果 |',
    '| --- | --- | --- |',
    '| POST /sales-orders | 创建草稿 | 返回单号、初始状态 draft |',
    '| POST /sales-orders/{id}/submit | 提交审核 | 状态迁移到 submitted |',
    '| POST /sales-orders/{id}/confirm-outbound | 出库确认 | 状态迁移到 outbound_confirmed，库存表同步更新 |',
    '',
    '## 状态迁移矩阵',
    '| 当前状态 | 操作 | 目标状态 | 非法校验 |',
    '| --- | --- | --- | --- |',
    '| draft | submit | submitted | 已作废单据禁止提交 |',
    '| submitted | approve | approved | 重复审核应阻断 |',
    '| approved | confirm-outbound | outbound_confirmed | 未审核不得直接出库 |',
    '',
    '## 逆向 / 非法场景矩阵',
    '| 场景 | 关注点 | 用例编号 |',
    '| --- | --- | --- |',
    '| 驳回后修改再提交 | 保留驳回意见与版本链 | TP-002 |',
    '| 已确认收货后再次作废 | 拒绝非法迁移并提示原因 | TP-003 |',
    '| 重复 confirm-outbound | 幂等校验与库存不重复扣减 | TP-004 |',
    '',
    '## 字段级 DB 断言矩阵',
    '| 表/对象 | 字段 | 断言 |',
    '| --- | --- | --- |',
    '| sales_order | status | confirm-outbound 后应为 outbound_confirmed |',
    '| sales_order | outbound_confirmed_at | 出库确认后必须写入时间戳 |',
    '| inventory_txn | source_order_no | 与销售订单号一致，且 confirm 重试不重复新增 |',
    '',
    '## 子流程 / 外部系统边界验证',
    '- 仓储回写失败时，销售订单状态不得越过 approved。',
    '- 外部库存系统超时应记录重试任务并产生告警。',
    '',
    '## 用例汇总',
    '- TP-001 主流程提交与审核',
    '- TP-002 驳回后修改再提交',
    '- TP-003 非法状态迁移拦截',
    '- TP-004 confirm-outbound 幂等与库存断言',
    '- TP-005 字段级 DB 断言',
    '- TP-006 作废与逆向补偿',
    '',
    '## 用例详述',
    '### TP-001 主流程提交与审核',
    '1. 创建销售订单草稿并记录订单号。',
    '2. 调用提交接口，校验状态变为 submitted。',
    '3. 调用审核通过接口，校验状态变为 approved。',
    '4. 查询数据库，确认 sales_order.status=approved。',
    '',
    '### TP-004 confirm-outbound 幂等与库存断言',
    '1. 准备已审核通过订单。',
    '2. 首次调用 confirm-outbound，记录返回 trace_id。',
    '3. 重复调用 confirm-outbound，验证业务结果幂等。',
    '4. 查询 inventory_txn，确认仅写入一条扣减记录。',
    '',
    '## 缺陷记录策略 / 回归策略',
    '- 缺陷必须保留步骤、数据、接口响应、trace_id、日志和 SQL 断言结果。',
    '- 回归先覆盖 P0 阻断项，再覆盖逆向、补偿和外部边界。',
    '',
    '## 角色与职责',
    '- 产品 / 方案：确认范围、状态机、范围外说明。',
    '- 测试：准备环境、数据、执行用例、记录缺陷与发布建议。',
    '- 开发：提供接口、日志、SQL 断言点与补偿链路解释。',
    '',
    '## 资源 / 工时 / 里程碑',
    '- 资源：测试负责人 1 名、开发支持 1 名、产品确认 1 名。',
    '- 里程碑：模板版评审 -> 环境就绪 -> P0 完成 -> 发布前门禁结论。',
    '',
    '## 度量与报告口径',
    '- 度量：P0 通过率、阻断缺陷数量、环境准备完成度、DB 断言通过率。',
    '- 报告：每日同步关键风险、阻断项和发布建议。',
    '',
    '## 自动化范围与回归策略',
    '- 自动化优先覆盖主流程、关键状态迁移和重复提交幂等场景。',
    '- 人工回归补足逆向异常、外部边界与 DB 断言核对。',
    '',
    '## 历史缺陷复用建议',
    '- 优先复用重复 confirm、补偿失败、状态错乱、库存回写异常等历史缺陷样板。',
    '',
    '## 执行数据准备',
    '- 客户：演示客户 A',
    '- 仓库：WH-SH-01',
    '- 商品：SKU-SO-001，库存 100',
    '- 操作角色：销售、审核员、仓储回写服务',
    '',
    '## 发布建议与门禁结论',
    '- 标准模板版覆盖 PRD、技术方案与 Coverage Graph 义务。',
    '- 已包含风险、环境、测试数据、进入/退出准则、状态迁移与字段级 DB 断言。',
    '- 发布建议：允许进入正式发布流程。',
    '',
    '## 发布前门禁结论',
    '- 模板版 pass，AI 增强版可为 pass 或 warn。',
    '- 满足正式发布条件。',
  ].join('\n');
}

function buildAiEnhancedPlanMarkdown(title = '销售订单测试方案 AI 增强版') {
  return [
    `# ${title}`,
    '',
    '## AI 增强说明',
    '- 本文基于标准模板版扩展，补充边界场景、恢复路径、测试数据组合和 SQL / 日志 / 指标断言建议。',
    '',
    '## 边界值与组合场景',
    '- 单据金额为 0 的促销订单是否允许提交。',
    '- 明细行跨仓库分配时，confirm-outbound 是否仍保持幂等。',
    '- 审核通过后库存被其他流程占用，confirm-outbound 如何返回可复核错误。',
    '',
    '## 恢复路径 / 异常分支建议',
    '- 仓储回写超时后，检查重试任务是否产生且状态保持 approved。',
    '- 外部接口返回成功但 DB 未提交时，检查补偿任务和告警事件是否落库。',
    '',
    '## 推荐测试数据集',
    '| 数据组 | 说明 |',
    '| --- | --- |',
    '| DATA-A | 标准正向链路，库存充足 |',
    '| DATA-B | 库存边界值=1，验证 confirm 后归零 |',
    '| DATA-C | 已驳回后再提交，验证意见留痕 |',
    '| DATA-D | 重复 confirm 请求，验证幂等 |',
    '',
    '## SQL / 日志 / 指标断言建议',
    '- `SELECT status, outbound_confirmed_at FROM sales_order WHERE order_no = ?;`',
    "- `SELECT COUNT(*) FROM inventory_txn WHERE source_order_no = ? AND txn_type = 'SO_OUTBOUND';`",
    '- `SELECT retry_status FROM outbound_retry_task WHERE order_no = ? ORDER BY id DESC LIMIT 1;`',
    '- 校验日志链路中 trace_id、错误码、补偿任务标记与数据库状态一致。',
    '- 校验 confirm 成功率、补偿任务积压量等指标上报。',
    '',
    '## 高风险场景优先执行建议',
    '- 已确认收货后的作废应被阻断并保留原状态。',
    '- 取消订单后再次提交应返回明确错误码，而不仅是文案提示。',
    '',
    '## 历史知识资产缺陷复用建议',
    '- 若引入多仓调拨，需新增仓间库存一致性校验。',
    '- 若存在折扣计算公式变更，需补充 CAL 公式与订单金额字段的联合断言。',
  ].join('\n');
}

function buildPublishedPlanMarkdown() {
  return buildTemplatePlanMarkdown('销售订单测试方案正式版');
}

function buildGatewayRuleDefaults() {
  return [
    {
      gate_type: 'prd',
      gate_name: 'PRD准入',
      version: '1.1.0',
      description: '平台默认 PRD 门禁规则，检查主流程、逆向流程、状态机、字段规则和验收标准是否具备可审计内容。',
      passCriteria: { min_total_score: 70 },
      checks: [
        { name: '主流程完整', type: 'checklist', weight: 15, required: true, message: '缺少可执行的正向主流程说明' },
        { name: '逆向流程完整', type: 'checklist', weight: 15, required: true, message: '缺少驳回、作废或逆向补偿流程' },
        { name: '状态机定义', type: 'format_check', weight: 15, required: true, message: '缺少合法/非法状态迁移说明' },
        { name: '字段规则明确', type: 'required_field', weight: 10, required: true, message: '缺少关键字段与字段规则说明' },
        { name: '角色权限边界', type: 'checklist', weight: 10, required: true, message: '缺少角色权限与边界约束' },
        { name: '验收标准量化', type: 'threshold', weight: 15, required: true, message: '验收标准不可量化或不可验证' },
        { name: '范围外说明', type: 'checklist', weight: 10, required: false, message: '建议补充范围外说明' },
        { name: '知识引用', type: 'knowledge_check', weight: 10, required: false, message: '建议引用平台手册或历史 PRD 样板' },
      ],
      knowledge_assets: ['ka-platform-manual', 'ka-doc-pipeline-guide'],
      spec_markdown: [
        '# PRD 准入规则说明',
        '',
        '## 必过项',
        '- 必须说明正向主流程、逆向流程、状态机、字段规则、角色边界、验收标准。',
        '',
        '## 建议项',
        '- 建议补充范围外说明、兼容性说明、历史知识引用。',
      ].join('\n'),
    },
    {
      gate_type: 'tech',
      gate_name: '技术方案与设计规范准入',
      version: '1.1.0',
      description: '平台默认技术方案门禁规则，检查 API 入口、数据职责、子流程边界、幂等补偿与 DB/DDL 断言准备情况。',
      passCriteria: { min_total_score: 70 },
      checks: [
        { name: 'API 入口清晰', type: 'required_field', weight: 15, required: true, message: '缺少 API 入口或 Controller 描述' },
        { name: '数据职责完整', type: 'required_field', weight: 15, required: true, message: '缺少主表/明细表/关键字段职责说明' },
        { name: '子流程边界', type: 'checklist', weight: 15, required: true, message: '缺少外部/现网子流程边界说明' },
        { name: '幂等与补偿', type: 'checklist', weight: 15, required: true, message: '缺少幂等键或补偿顺序设计' },
        { name: '公式与闭单条件', type: 'checklist', weight: 10, required: true, message: '缺少公式、累计规则或闭单条件' },
        { name: 'SQL / 查库断言', type: 'pattern_check', weight: 10, required: true, message: '缺少 SQL 示例或关键查库断言' },
        { name: 'DDL / 接口契约引用', type: 'rag_reference', weight: 10, required: false, message: '建议补充 DDL/接口契约引用' },
        { name: '知识样板引用', type: 'knowledge_check', weight: 10, required: false, message: '建议引用平台技术方案规范或测试方案模板规范' },
      ],
      knowledge_assets: ['ka-platform-manual', 'ka-test-plan-template-spec'],
      spec_markdown: [
        '# 技术方案准入规则说明',
        '',
        '## 必过项',
        '- API 入口、数据职责、子流程边界、幂等与补偿、SQL 断言必须可审计。',
        '',
        '## 建议项',
        '- 建议同时绑定接口契约、DDL 和历史样板。',
      ].join('\n'),
    },
    {
      gate_type: 'test_plan',
      gate_name: '测试方案专业门禁',
      version: '2.0.0',
      description: '平台默认测试方案专业门禁 V2，模板版为发布主口径，AI 增强版只做增强告警。',
      passCriteria: { min_total_score: 80 },
      checks: [
        { name: '测试目标 / 测试范围 / 不在范围', type: 'checklist', weight: 10, required: true, message: '缺少测试目标、范围或范围外说明' },
        { name: '风险清单与优先级', type: 'checklist', weight: 10, required: true, message: '缺少风险清单与优先级' },
        { name: '进入准则 / 退出准则', type: 'checklist', weight: 8, required: true, message: '缺少进入准则或退出准则' },
        { name: '测试环境矩阵', type: 'checklist', weight: 8, required: true, message: '缺少测试环境矩阵' },
        { name: '测试数据策略', type: 'checklist', weight: 8, required: true, message: '缺少测试数据策略' },
        { name: 'PRD 追溯矩阵', type: 'checklist', weight: 10, required: true, message: '缺少 PRD 追溯矩阵' },
        { name: '技术方案追溯矩阵', type: 'checklist', weight: 10, required: true, message: '缺少技术方案追溯矩阵' },
        { name: 'Coverage Graph 义务映射', type: 'checklist', weight: 10, required: true, message: '缺少 Coverage Graph / 覆盖义务绑定' },
        { name: '接口级验证矩阵', type: 'checklist', weight: 8, required: true, message: '缺少接口级验证矩阵' },
        { name: '状态迁移矩阵', type: 'checklist', weight: 8, required: true, message: '缺少状态迁移矩阵' },
        { name: '逆向 / 非法场景矩阵', type: 'checklist', weight: 8, required: true, message: '缺少逆向或非法场景矩阵' },
        { name: '字段级 DB 断言矩阵', type: 'checklist', weight: 10, required: true, message: '缺少字段级 DB 断言矩阵' },
        { name: '关键用例详述', type: 'checklist', weight: 6, required: true, message: '缺少人工执行步骤、预期结果或关键用例详述' },
        { name: '发布建议与门禁结论', type: 'checklist', weight: 6, required: true, message: '缺少发布建议或门禁结论' },
        { name: '角色 / 工时 / 度量 / 自动化 / 历史缺陷复用', type: 'checklist', weight: 3, required: false, message: '建议补充职责、里程碑、度量、自动化回归和历史缺陷复用建议' },
        { name: 'AI 增强版章节', type: 'pattern_check', weight: 5, required: false, message: 'AI 增强版未提供边界场景、恢复路径、测试数据或 SQL 建议' },
        { name: '残留待补充', type: 'pattern_check', weight: 5, required: true, message: '正式发布内容仍存在“待补充”或空泛描述' },
      ],
      knowledge_assets: ['ka-test-plan-gate-rules', 'ka-test-plan-template-spec', 'ka-platform-manual'],
      spec_markdown: [
        '# 测试方案专业门禁说明 V2',
        '',
        '## 发布主口径',
        '- 标准模板版必须 pass 才允许发布。',
        '- AI 增强版允许 warn，但必须已生成且不得替代模板版。',
        '',
        '## 四层检查',
        '- 结构层：目标、范围、风险、环境、数据、追溯、发布建议齐全。',
        '- 追溯层：PRD / 技术方案 / Coverage Graph 义务已绑定。',
        '- 可执行层：步骤、测试数据、预期结果、接口断言、DB 断言、进入/退出准则齐全。',
        '- 质量层：禁止空泛描述、禁止“待补充”残留到正式版。',
      ].join('\n'),
    },
  ];
}

function buildCoverageGraph(sourceArtifactIds) {
  return {
    obligations: [
      {
        id: 'cov_so_submit',
        source: 'prd',
        title: '销售订单提交并进入待审核',
        test_cases: ['TP-001'],
      },
      {
        id: 'cov_so_confirm',
        source: 'tech_spec',
        title: '销售出库 confirm 回写、库存扣减与幂等',
        test_cases: ['TP-004', 'TP-005'],
      },
      {
        id: 'cov_so_cancel',
        source: 'prd',
        title: '作废与逆向补偿',
        test_cases: ['TP-006'],
      },
    ],
    source_artifact_ids: sourceArtifactIds,
  };
}

async function ensureGatewayGateRule(conn, config) {
  const [rows] = await conn.query(
    `SELECT * FROM gateway_gate_rules
     WHERE gate_type = ? AND gate_name = ?
     ORDER BY id DESC LIMIT 1`,
    [config.gate_type, config.gate_name]
  );
  const rulesConfig = {
    description: config.description,
    passCriteria: config.passCriteria,
    checks: config.checks,
    knowledge_assets: config.knowledge_assets,
    initialization_note: 'platform:init 默认专业规则包',
    spec_markdown: config.spec_markdown,
  };

  if (rows[0]?.id) {
    await conn.query(
      `UPDATE gateway_gate_rules
       SET version = ?, rules_config = CAST(? AS JSON), status = 'active', updated_at = NOW()
       WHERE id = ?`,
      [config.version, stringifyJson(rulesConfig), rows[0].id]
    );
    return rows[0].id;
  }

  const [result] = await conn.query(
    `INSERT INTO gateway_gate_rules
     (gate_type, gate_name, version, rules_config, status, created_by)
     VALUES (?, ?, ?, CAST(? AS JSON), 'active', ?)`,
    [config.gate_type, config.gate_name, config.version, stringifyJson(rulesConfig), null]
  );
  return result.insertId;
}

async function ensureGatewayGateExecution(conn, payload) {
  const [rows] = await conn.query(
    `SELECT id FROM gateway_gate_executions
     WHERE gate_type = ? AND gate_name = ? AND document_name = ?
     ORDER BY id DESC LIMIT 1`,
    [payload.gate_type, payload.gate_name, payload.document_name]
  );
  if (rows[0]?.id) {
    await conn.query(
      `UPDATE gateway_gate_executions
       SET total_score = ?, max_score = ?, passed = ?, failed_checks = CAST(? AS JSON), check_results = CAST(? AS JSON), execution_meta = CAST(? AS JSON)
       WHERE id = ?`,
      [
        payload.total_score,
        payload.max_score,
        payload.passed ? 1 : 0,
        stringifyJson(payload.failed_checks || []),
        stringifyJson(payload.check_results || []),
        stringifyJson(payload.execution_meta || {}),
        rows[0].id,
      ]
    );
    return rows[0].id;
  }

  const [result] = await conn.query(
    `INSERT INTO gateway_gate_executions
     (gate_type, gate_name, document_name, author, total_score, max_score, passed, failed_checks, check_results, client_run_id, execution_meta)
     VALUES (?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), CAST(? AS JSON), ?, CAST(? AS JSON))`,
    [
      payload.gate_type,
      payload.gate_name,
      payload.document_name,
      payload.author || 'platform:init',
      payload.total_score,
      payload.max_score,
      payload.passed ? 1 : 0,
      stringifyJson(payload.failed_checks || []),
      stringifyJson(payload.check_results || []),
      payload.client_run_id,
      stringifyJson(payload.execution_meta || {}),
    ]
  );
  return result.insertId;
}

async function ensureGatewayEngineLog(conn, payload) {
  const [rows] = await conn.query(
    `SELECT id FROM gateway_gate_engine_logs
     WHERE trace_id = ? AND gate_type = ? AND event = ?
     ORDER BY id DESC LIMIT 1`,
    [payload.trace_id, payload.gate_type, payload.event]
  );
  if (rows[0]?.id) return rows[0].id;

  const [result] = await conn.query(
    `INSERT INTO gateway_gate_engine_logs
     (created_at, event, detail, source, trace_id, gate_type, rule_id)
     VALUES (?, ?, CAST(? AS JSON), ?, ?, ?, ?)`,
    [
      payload.created_at || new Date().toISOString().slice(0, 19).replace('T', ' '),
      payload.event,
      stringifyJson(payload.detail || {}),
      payload.source || 'platform-init',
      payload.trace_id,
      payload.gate_type,
      payload.rule_id || null,
    ]
  );
  return result.insertId;
}

async function ensureGatewayGateSeeds(conn) {
  const seededRuleIds = {};
  for (const rule of buildGatewayRuleDefaults()) {
    seededRuleIds[rule.gate_type] = await ensureGatewayGateRule(conn, rule);
  }

  await ensureGatewayGateExecution(conn, {
    gate_type: 'test_plan',
    gate_name: '测试方案专业门禁',
    document_name: '销售订单测试方案正式版',
    author: 'platform:init',
    total_score: 96,
    max_score: 100,
    passed: true,
    client_run_id: 'seed-test-plan-gate-execution-v1',
    failed_checks: [],
    check_results: [
      { name: 'PRD 追溯矩阵', passed: true, message: '模板版已覆盖 PRD 义务' },
      { name: 'Coverage Graph 义务映射', passed: true, message: '覆盖义务已绑定到用例' },
      { name: '字段级 DB 断言矩阵', passed: true, message: '已包含 DB 断言矩阵与 SQL 建议' },
      { name: 'AI 增强版章节', passed: true, message: 'AI 增强版已补充边界场景和 SQL 建议' },
    ],
    execution_meta: {
      trace_id: 'trace-demo-doc-pipeline-v1',
      project_code: 'C04',
      milestone_type: '5_31_check',
      source: 'platform-init',
      rule_id: seededRuleIds.test_plan,
      rule_version: '2.0.0',
    },
  });

  await ensureGatewayEngineLog(conn, {
    trace_id: 'trace-demo-doc-pipeline-v1',
    gate_type: 'test_plan',
    event: 'fetch_rules_ok',
    rule_id: seededRuleIds.test_plan,
    detail: {
      gate_name: '测试方案专业门禁',
      check_count: 12,
      note: 'platform:init 默认样例',
    },
  });

  await ensureGatewayEngineLog(conn, {
    trace_id: 'trace-demo-doc-pipeline-v1',
    gate_type: 'test_plan',
    event: 'judge_done',
    rule_id: seededRuleIds.test_plan,
    detail: {
      status: 'pass',
      score: 96,
      document_name: '销售订单测试方案正式版',
      publish_contract: {
        template_gate: 'pass',
        ai_gate: 'pass_or_warn',
      },
    },
  });
}

function buildGateResult({ gateType, summary, citations, checks }) {
  return {
    status: 'pass',
    summary,
    score: 100,
    checks,
    missing_inputs: [],
    risk_items: [],
    uninferable_items: [],
    citations,
    evaluator_meta: {
      rule: {
        status: 'pass',
        summary,
        checks,
      },
      prompt: {
        disabled: true,
        reason: 'platform:init 演示样板，未调用在线 Prompt 评审',
      },
      coverage: gateType === 'test_plan_gate' ? { status: 'pass', missing_coverage_items: [] } : null,
      knowledge: {
        status: citations.length ? 'pass' : 'warn',
        result_count: citations.length,
        query_text: `${gateType} demo seed`,
      },
    },
  };
}

async function ensureArtifact(conn, db, bundleId, artifactType, title, storageUri, contentText, metadata = {}) {
  const [rows] = await conn.query(
    `SELECT * FROM gateway_doc_artifacts
     WHERE bundle_id = ? AND artifact_type = ?
     ORDER BY id DESC LIMIT 1`,
    [bundleId, artifactType]
  );
  if (rows[0]?.id) {
    return rows[0];
  }
  return db.createDocArtifact(bundleId, {
    artifact_type: artifactType,
    source_type: artifactType.startsWith('test_plan') ? 'system' : 'seed',
    title,
    storage_uri: storageUri,
    content_text: contentText,
    version_label: 'DEMO-1.0',
    status: artifactType === 'test_plan_final' ? 'published' : 'ready',
    metadata_json: metadata,
  });
}

async function ensureDocGateExecution(conn, payload) {
  const [rows] = await conn.query(
    `SELECT * FROM gateway_doc_gate_executions
     WHERE bundle_id = ? AND gate_type = ?
     ORDER BY id DESC LIMIT 1`,
    [payload.bundle_id, payload.gate_type]
  );
  if (rows[0]?.id) {
    return rows[0];
  }
  const [result] = await conn.query(
    `INSERT INTO gateway_doc_gate_executions
     (bundle_id, trace_id, node_key, gate_type, status, score, summary, result_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON))`,
    [
      payload.bundle_id,
      payload.trace_id,
      payload.node_key,
      payload.gate_type,
      payload.status,
      payload.score,
      payload.summary,
      stringifyJson(payload.result_json),
    ]
  );
  const [insertedRows] = await conn.query('SELECT * FROM gateway_doc_gate_executions WHERE id = ? LIMIT 1', [result.insertId]);
  return insertedRows[0];
}

async function ensureCoverageGraphRun(conn, bundleId, sourceArtifactIds) {
  const [rows] = await conn.query(
    `SELECT * FROM gateway_coverage_graph_runs
     WHERE bundle_id = ?
     ORDER BY id DESC LIMIT 1`,
    [bundleId]
  );
  if (rows[0]?.id) return rows[0];
  const graph = buildCoverageGraph(sourceArtifactIds);
  const [result] = await conn.query(
    `INSERT INTO gateway_coverage_graph_runs
     (bundle_id, status, source_artifact_ids, graph_json, missing_coverage_items, unbound_case_items, uninferable_items)
     VALUES (?, 'ready', CAST(? AS JSON), CAST(? AS JSON), CAST(? AS JSON), CAST(? AS JSON), CAST(? AS JSON))`,
    [
      bundleId,
      stringifyJson(sourceArtifactIds),
      stringifyJson(graph),
      stringifyJson([]),
      stringifyJson([]),
      stringifyJson([]),
    ]
  );
  const [insertedRows] = await conn.query('SELECT * FROM gateway_coverage_graph_runs WHERE id = ? LIMIT 1', [result.insertId]);
  return insertedRows[0];
}

async function ensureTestPlanRun(conn, bundleId, coverageRunId, draftArtifactId, aiDraftArtifactId, finalArtifactId, gateExecutionId) {
  const [rows] = await conn.query(
    `SELECT * FROM gateway_test_plan_generation_runs
     WHERE bundle_id = ?
     ORDER BY id DESC LIMIT 1`,
    [bundleId]
  );
  if (rows[0]?.id) {
    await conn.query(
      `UPDATE gateway_test_plan_generation_runs
       SET coverage_graph_run_id = ?, draft_artifact_id = ?, ai_draft_artifact_id = ?, final_artifact_id = ?, gate_execution_id = ?, status = 'published', generation_mode = 'dual_track', generation_summary_json = CAST(? AS JSON), updated_at = NOW()
       WHERE id = ?`,
      [
        coverageRunId,
        draftArtifactId,
        aiDraftArtifactId,
        finalArtifactId,
        gateExecutionId,
        stringifyJson({
          template_ready: true,
          ai_enhanced_ready: true,
          publish_ready: true,
        }),
        rows[0].id,
      ]
    );
    return rows[0];
  }
  const [result] = await conn.query(
    `INSERT INTO gateway_test_plan_generation_runs
     (bundle_id, coverage_graph_run_id, draft_artifact_id, ai_draft_artifact_id, final_artifact_id, gate_execution_id, status, generation_mode, generation_summary_json)
     VALUES (?, ?, ?, ?, ?, ?, 'published', 'dual_track', CAST(? AS JSON))`,
    [
      bundleId,
      coverageRunId,
      draftArtifactId,
      aiDraftArtifactId,
      finalArtifactId,
      gateExecutionId,
      stringifyJson({
        template_ready: true,
        ai_enhanced_ready: true,
        publish_ready: true,
      }),
    ]
  );
  const [insertedRows] = await conn.query('SELECT * FROM gateway_test_plan_generation_runs WHERE id = ? LIMIT 1', [result.insertId]);
  return insertedRows[0];
}

async function ensureApprovalTask(conn, runId, approverRole, payloadSummary) {
  const [rows] = await conn.query(
    `SELECT id FROM gateway_approval_tasks
     WHERE pipeline_run_id = ? AND approver_role = ?
     LIMIT 1`,
    [runId, approverRole]
  );
  if (rows[0]?.id) return;
  await conn.query(
    `INSERT INTO gateway_approval_tasks
     (pipeline_run_id, approver_role, payload_summary, decision, decision_at, comment, status)
     VALUES (?, ?, ?, 'approved', NOW(), '平台初始化演示样例', 'completed')`,
    [runId, approverRole, payloadSummary]
  );
}

async function ensureEvidencePack(conn, payload) {
  const [rows] = await conn.query(
    `SELECT id FROM gateway_evidence_packs
     WHERE trace_id = ? AND title = ?
     LIMIT 1`,
    [payload.trace_id, payload.title]
  );
  if (rows[0]?.id) return rows[0];
  const [result] = await conn.query(
    `INSERT INTO gateway_evidence_packs
     (project_code, milestone_type, title, review_result, reviewer, reviewed_at, trace_id, pipeline_run_id, summary)
     VALUES (?, ?, ?, ?, ?, NOW(), ?, ?, ?)`,
    [
      payload.project_code,
      payload.milestone_type,
      payload.title,
      payload.review_result,
      payload.reviewer,
      payload.trace_id,
      payload.pipeline_run_id,
      payload.summary,
    ]
  );
  for (const item of payload.items || []) {
    await conn.query(
      `INSERT INTO gateway_evidence_pack_items
       (evidence_pack_id, item_type, item_name, item_ref, payload_json)
       VALUES (?, ?, ?, ?, CAST(? AS JSON))`,
      [result.insertId, item.item_type, item.item_name, item.item_ref || null, stringifyJson(item.payload_json || {})]
    );
  }
  return { id: result.insertId };
}

async function ensureCodeRepository(conn, config) {
  const [rows] = await conn.query(
    'SELECT * FROM gateway_code_repositories WHERE repo_key = ? LIMIT 1',
    [config.repo_key]
  );
  if (rows[0]?.id) {
    await conn.query(
      `UPDATE gateway_code_repositories
       SET project_code = ?, name = ?, local_path = ?, default_branch = ?, language = ?, status = 'active', metadata_json = CAST(? AS JSON), updated_at = NOW()
       WHERE id = ?`,
      [
        config.project_code || null,
        config.name,
        config.local_path,
        config.default_branch || 'main',
        config.language || null,
        stringifyJson(config.metadata_json || {}),
        rows[0].id,
      ]
    );
    const [freshRows] = await conn.query('SELECT * FROM gateway_code_repositories WHERE id = ? LIMIT 1', [rows[0].id]);
    return freshRows[0];
  }
  const [result] = await conn.query(
    `INSERT INTO gateway_code_repositories
     (repo_key, project_code, name, local_path, default_branch, language, status, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, 'active', CAST(? AS JSON))`,
    [
      config.repo_key,
      config.project_code || null,
      config.name,
      config.local_path,
      config.default_branch || 'main',
      config.language || null,
      stringifyJson(config.metadata_json || {}),
    ]
  );
  const [insertedRows] = await conn.query('SELECT * FROM gateway_code_repositories WHERE id = ? LIMIT 1', [result.insertId]);
  return insertedRows[0];
}

async function ensureBundleContext(conn, bundleId, context) {
  const [rows] = await conn.query(
    'SELECT id FROM gateway_doc_bundle_contexts WHERE bundle_id = ? LIMIT 1',
    [bundleId]
  );
  if (rows[0]?.id) {
    await conn.query(
      `UPDATE gateway_doc_bundle_contexts
       SET workflow_mode = ?, code_repository_id = ?, knowledge_scope_json = CAST(? AS JSON), updated_at = NOW()
       WHERE id = ?`,
      [
        context.workflow_mode || 'upload_existing',
        context.code_repository_id || null,
        stringifyJson(context.knowledge_scope_json || {}),
        rows[0].id,
      ]
    );
    return;
  }
  await conn.query(
    `INSERT INTO gateway_doc_bundle_contexts
     (bundle_id, workflow_mode, code_repository_id, knowledge_scope_json)
     VALUES (?, ?, ?, CAST(? AS JSON))`,
    [
      bundleId,
      context.workflow_mode || 'upload_existing',
      context.code_repository_id || null,
      stringifyJson(context.knowledge_scope_json || {}),
    ]
  );
}

async function ensureDemoDocBundle(conn, db) {
  const bundleCode = 'DEMO-SO-DOC-001';
  const traceId = 'trace-demo-doc-pipeline-v1';
  const [existingBundleRows] = await conn.query(
    'SELECT * FROM gateway_doc_bundles WHERE bundle_code = ? LIMIT 1',
    [bundleCode]
  );
  const bundle =
    existingBundleRows[0] ||
    (await db.createDocBundle({
      bundle_code: bundleCode,
      trace_id: traceId,
      project_code: 'C04',
      title: '销售订单文档工程化样板',
      domain: 'sales',
      module_name: '销售订单',
      version_label: 'DEMO-1.0',
      source_mode: 'seed',
      status: 'published',
      created_by: 'platform:init',
    }));

  const prd = await ensureArtifact(
    conn,
    db,
    bundle.id,
    'prd',
    '销售订单 PRD',
    path.relative(root, path.join(fixtureDir, 'prd.md')),
    readFile('fixtures/sales-order-e2e/prd.md'),
    { seed_key: 'sales-order-e2e', track: 'input' }
  );
  const techSpec = await ensureArtifact(
    conn,
    db,
    bundle.id,
    'tech_spec',
    '销售订单技术方案',
    path.relative(root, path.join(fixtureDir, 'tech_spec.md')),
    readFile('fixtures/sales-order-e2e/tech_spec.md'),
    { seed_key: 'sales-order-e2e', track: 'input' }
  );
  const apiContract = await ensureArtifact(
    conn,
    db,
    bundle.id,
    'api_contract',
    '销售订单接口契约',
    path.relative(root, path.join(fixtureDir, 'api_contract.md')),
    readFile('fixtures/sales-order-e2e/api_contract.md'),
    { seed_key: 'sales-order-e2e', track: 'input' }
  );
  const ddl = await ensureArtifact(
    conn,
    db,
    bundle.id,
    'ddl',
    '销售订单 DDL',
    path.relative(root, path.join(fixtureDir, 'ddl.md')),
    readFile('fixtures/sales-order-e2e/ddl.md'),
    { seed_key: 'sales-order-e2e', track: 'input' }
  );

  const templateDraft = await ensureArtifact(
    conn,
    db,
    bundle.id,
    'test_plan_draft',
    '销售订单测试方案标准模板版草稿',
    null,
    buildTemplatePlanMarkdown(),
    { track: 'standard_template', generated_by: 'platform:init' }
  );
  const aiDraft = await ensureArtifact(
    conn,
    db,
    bundle.id,
    'test_plan_ai_draft',
    '销售订单测试方案 AI 增强版草稿',
    null,
    buildAiEnhancedPlanMarkdown(),
    { track: 'ai_enhanced', based_on: templateDraft.id }
  );
  const finalArtifact = await ensureArtifact(
    conn,
    db,
    bundle.id,
    'test_plan_final',
    '销售订单测试方案正式版',
    null,
    buildPublishedPlanMarkdown(),
    { track: 'published', based_on: templateDraft.id, based_on_ai_draft: aiDraft.id }
  );

  const assets = await findKnowledgeAssets(conn, [
    'ka-platform-manual',
    'ka-test-plan-template-spec',
    'ka-test-plan-gate-rules',
    'ka-doc-pipeline-guide',
  ]);
  const citations = Object.values(assets).map((asset) => ({
    knowledge_asset_id: asset.id,
    asset_key: asset.asset_key,
    name: asset.name,
    source_uri: asset.source_uri,
    source: 'seed',
    score: 0.99,
    reason: '平台初始化默认引用资产',
  }));

  await ensureDocGateExecution(conn, {
    bundle_id: bundle.id,
    trace_id: bundle.trace_id || traceId,
    node_key: 'std_input_contract',
    gate_type: 'input_contract',
    status: 'pass',
    score: 100,
    summary: '输入文档齐套，可进入标准文档管道。',
    result_json: buildGateResult({
      gateType: 'input_contract',
      summary: '输入文档齐套，可进入标准文档管道。',
      citations: citations.slice(0, 2),
      checks: [
        { key: 'prd_exists', label: 'PRD 已上传', status: 'pass' },
        { key: 'tech_exists', label: '技术方案已上传', status: 'pass' },
        { key: 'api_contract_support', label: '接口契约已上传', status: 'pass' },
        { key: 'ddl_support', label: 'DDL 已上传', status: 'pass' },
      ],
    }),
  });

  await ensureDocGateExecution(conn, {
    bundle_id: bundle.id,
    trace_id: bundle.trace_id || traceId,
    node_key: 'std_prd_gate',
    gate_type: 'prd_gate',
    status: 'pass',
    score: 100,
    summary: 'PRD 包含主流程、逆向流程、状态机和关键字段规则。',
    result_json: buildGateResult({
      gateType: 'prd_gate',
      summary: 'PRD 包含主流程、逆向流程、状态机和关键字段规则。',
      citations: citations.slice(0, 2),
      checks: [
        { key: 'main_flow', label: '主流程完整', status: 'pass' },
        { key: 'reverse_flow', label: '逆向流程完整', status: 'pass' },
        { key: 'state_machine', label: '状态机完整', status: 'pass' },
      ],
    }),
  });

  await ensureDocGateExecution(conn, {
    bundle_id: bundle.id,
    trace_id: bundle.trace_id || traceId,
    node_key: 'std_tech_spec_gate',
    gate_type: 'tech_spec_gate',
    status: 'pass',
    score: 100,
    summary: '技术方案已覆盖 API 入口、字段职责、子流程边界和幂等补偿。',
    result_json: buildGateResult({
      gateType: 'tech_spec_gate',
      summary: '技术方案已覆盖 API 入口、字段职责、子流程边界和幂等补偿。',
      citations: citations.slice(0, 3),
      checks: [
        { key: 'api_entry', label: 'API 入口完整', status: 'pass' },
        { key: 'data_model', label: '数据职责完整', status: 'pass' },
        { key: 'subprocess', label: '子流程边界完整', status: 'pass' },
        { key: 'idempotency', label: '幂等与补偿完整', status: 'pass' },
      ],
    }),
  });

  const coverageRun = await ensureCoverageGraphRun(conn, bundle.id, [
    prd.id,
    techSpec.id,
    apiContract.id,
    ddl.id,
  ]);

  const testPlanGate = await ensureDocGateExecution(conn, {
    bundle_id: bundle.id,
    trace_id: bundle.trace_id || traceId,
    node_key: 'std_test_plan_gate',
    gate_type: 'test_plan_gate',
    status: 'pass',
    score: 100,
    summary: '标准模板版通过发布门禁，AI 增强版已生成专业补充内容。',
    result_json: buildGateResult({
      gateType: 'test_plan_gate',
      summary: '标准模板版通过发布门禁，AI 增强版已生成专业补充内容。',
      citations,
      checks: [
        { key: 'scope_section', label: '范围章节完整', status: 'pass' },
        { key: 'prd_traceability_section', label: 'PRD 追溯矩阵完整', status: 'pass' },
        { key: 'coverage_graph_section', label: 'Coverage Graph 义务完整', status: 'pass' },
        { key: 'db_assertions', label: '字段级 DB 断言完整', status: 'pass' },
        { key: 'ai_enhanced_section', label: 'AI 增强版已生成', status: 'pass' },
      ],
    }),
  });

  await ensureTestPlanRun(
    conn,
    bundle.id,
    coverageRun.id,
    templateDraft.id,
    aiDraft.id,
    finalArtifact.id,
    testPlanGate.id
  );

  await conn.query(
    `UPDATE gateway_doc_bundles
     SET trace_id = ?, project_code = 'C04', status = 'published', updated_at = NOW()
     WHERE id = ?`,
    [bundle.trace_id || traceId, bundle.id]
  );
  await ensureBundleContext(conn, bundle.id, {
    workflow_mode: 'upload_existing',
    knowledge_scope_json: {
      knowledge_asset_ids: Object.values(assets).map((item) => item.id),
    },
  });

  return {
    id: bundle.id,
    trace_id: bundle.trace_id || traceId,
  };
}

async function ensureBenchmarkBundle(conn, db, config) {
  const [existingBundleRows] = await conn.query(
    'SELECT * FROM gateway_doc_bundles WHERE bundle_code = ? LIMIT 1',
    [config.bundle_code]
  );
  const bundle =
    existingBundleRows[0] ||
    (await db.createDocBundle({
      bundle_code: config.bundle_code,
      trace_id: config.trace_id,
      project_code: 'C04',
      title: config.title,
      domain: 'sales',
      module_name: config.module_name || '销售订单',
      version_label: 'BENCH-1.0',
      source_mode: 'seed',
      status: 'published',
      created_by: 'platform:init',
      workflow_mode: 'upload_existing',
    }));

  const prd = await ensureArtifact(conn, db, bundle.id, 'prd', `${config.title} PRD`, path.relative(root, path.join(fixtureDir, 'prd.md')), readFile('fixtures/sales-order-e2e/prd.md'), { seed_key: config.bundle_code, track: 'input' });
  const techSpec = await ensureArtifact(conn, db, bundle.id, 'tech_spec', `${config.title} 技术方案`, path.relative(root, path.join(fixtureDir, 'tech_spec.md')), readFile('fixtures/sales-order-e2e/tech_spec.md'), { seed_key: config.bundle_code, track: 'input' });
  const apiContract = await ensureArtifact(conn, db, bundle.id, 'api_contract', `${config.title} 接口契约`, path.relative(root, path.join(fixtureDir, 'api_contract.md')), readFile('fixtures/sales-order-e2e/api_contract.md'), { seed_key: config.bundle_code, track: 'input' });
  const ddl = await ensureArtifact(conn, db, bundle.id, 'ddl', `${config.title} DDL`, path.relative(root, path.join(fixtureDir, 'ddl.md')), readFile('fixtures/sales-order-e2e/ddl.md'), { seed_key: config.bundle_code, track: 'input' });
  const templateDraft = await ensureArtifact(conn, db, bundle.id, 'test_plan_draft', `${config.title} 测试方案标准模板版草稿`, null, buildTemplatePlanMarkdown(`${config.title} 测试方案标准模板版`), { track: 'standard_template', generated_by: 'platform:init' });
  const aiDraft = await ensureArtifact(conn, db, bundle.id, 'test_plan_ai_draft', `${config.title} 测试方案 AI 增强版草稿`, null, buildAiEnhancedPlanMarkdown(`${config.title} 测试方案 AI 增强版`), { track: 'ai_enhanced', based_on: templateDraft.id });
  const finalArtifact = await ensureArtifact(conn, db, bundle.id, 'test_plan_final', `${config.title} 测试方案正式版`, null, buildTemplatePlanMarkdown(`${config.title} 测试方案正式版`), { track: 'published', based_on: templateDraft.id, based_on_ai_draft: aiDraft.id });
  const assets = await findKnowledgeAssets(conn, ['ka-platform-manual', 'ka-test-plan-template-spec', 'ka-test-plan-gate-rules']);
  const citations = Object.values(assets).map((asset) => ({
    knowledge_asset_id: asset.id,
    asset_key: asset.asset_key,
    name: asset.name,
    source_uri: asset.source_uri,
    source: 'seed',
    score: 0.98,
    reason: 'benchmark 默认引用资产',
  }));
  const coverageRun = await ensureCoverageGraphRun(conn, bundle.id, [prd.id, techSpec.id, apiContract.id, ddl.id]);
  const testPlanGate = await ensureDocGateExecution(conn, {
    bundle_id: bundle.id,
    trace_id: config.trace_id,
    node_key: 'std_test_plan_gate',
    gate_type: 'test_plan_gate',
    status: 'pass',
    score: 92,
    summary: `${config.title} 测试方案模板版满足专业门禁基线。`,
    result_json: buildGateResult({
      gateType: 'test_plan_gate',
      summary: `${config.title} 测试方案模板版满足专业门禁基线。`,
      citations,
      checks: [
        { key: 'scope_section', label: '目标与范围完整', status: 'pass' },
        { key: 'risk_section', label: '风险章节完整', status: 'pass' },
        { key: 'environment_matrix', label: '环境矩阵完整', status: 'pass' },
        { key: 'data_strategy', label: '测试数据策略完整', status: 'pass' },
        { key: 'publish_recommendation', label: '发布建议完整', status: 'pass' },
      ],
    }),
  });
  await ensureTestPlanRun(conn, bundle.id, coverageRun.id, templateDraft.id, aiDraft.id, finalArtifact.id, testPlanGate.id);
  await ensureBundleContext(conn, bundle.id, {
    workflow_mode: 'upload_existing',
    knowledge_scope_json: {
      knowledge_asset_ids: Object.values(assets).map((item) => item.id),
    },
  });
}

async function main() {
  const layers = parseArgs(process.argv.slice(2));
  const db = require(path.join(root, 'control-plane/src/db/mysql.js'));
  const pool = db.getPool();
  const conn = await pool.getConnection();

  try {
    await runSqlFile(
      conn,
      'database/migrations/020_gateway_harness_q2_alignment_up.sql',
      'q2 alignment migration applied'
    );
    if (layers.includes('base')) {
      await runSqlFile(conn, 'database/init-control-plane.sql', 'base seeds applied');
    }
    if (layers.includes('knowledge')) {
      await runSqlFile(conn, 'database/seeds/phase1_knowledge_assets.sql', 'knowledge seeds applied');
    }
    if (layers.includes('demo')) {
      await runSqlFile(conn, 'database/seeds/platform_demo_pack.sql', 'platform demo seeds applied');
    }

    if (layers.includes('demo')) {
      await ensureGatewayGateSeeds(conn);
      const defaultRepository = await ensureCodeRepository(conn, {
        repo_key: 'repo-ai-platform',
        project_code: 'C04',
        name: 'ai-platform',
        local_path: 'projects/ai-platform',
        default_branch: 'main',
        language: 'typescript',
        metadata_json: {
          usage: '文档门禁技术方案生成默认仓库',
        },
      });

      const docPipeline = await ensurePipeline(conn, {
        pipeline_key: 'doc-pipeline-v1',
        name: '文档工程化标准管道',
        domain: 'engineering',
        description: '上传 PRD、技术方案、接口契约、DDL 后，按标准阶段完成文档门禁、Coverage Graph、双轨测试方案生成与发布。',
        version: '1.0.0',
        change_summary: 'platform-init 默认产品化管道',
        nodes: [
          { node_key: 'input_contract', node_name: '输入契约', node_type: 'gate', sort_order: 1 },
          { node_key: 'prd_gate', node_name: 'PRD 门禁', node_type: 'gate', sort_order: 2 },
          { node_key: 'repo_context_build', node_name: '仓库上下文构建', node_type: 'transform', sort_order: 3 },
          { node_key: 'tech_spec_generate', node_name: '生成技术方案', node_type: 'generate', sort_order: 4 },
          { node_key: 'tech_spec_gate', node_name: '技术方案门禁', node_type: 'gate', sort_order: 5 },
          { node_key: 'coverage_graph', node_name: 'Coverage Graph', node_type: 'transform', sort_order: 6 },
          { node_key: 'test_plan_generate', node_name: '生成双轨草稿', node_type: 'generate', sort_order: 7 },
          { node_key: 'test_plan_gate', node_name: '测试方案门禁', node_type: 'gate', sort_order: 8 },
          { node_key: 'publish', node_name: '发布正式版', node_type: 'approval', sort_order: 9 },
        ],
      });
      const gateReview = await ensurePipeline(conn, {
        pipeline_key: 'gate-review',
        name: '门禁评审链路',
        domain: 'pm',
        description: '平台默认门禁评审与证据归档管道。',
        version: '1.0.0',
        change_summary: 'platform-init 默认评审管道',
        nodes: [
          { node_key: 'rule_bind', node_name: '规则绑定', node_type: 'transform', sort_order: 1 },
          { node_key: 'gate_execute', node_name: '门禁执行', node_type: 'gate', sort_order: 2 },
          { node_key: 'human_review', node_name: '人工复核', node_type: 'approval', sort_order: 3 },
          { node_key: 'evidence_archive', node_name: '证据归档', node_type: 'callback', sort_order: 4 },
        ],
      });

      const demoBundle = await ensureDemoDocBundle(conn, db);
      const demoScopeAssets = await findKnowledgeAssets(conn, [
        'ka-platform-manual',
        'ka-test-plan-template-spec',
        'ka-test-plan-gate-rules',
        'ka-doc-pipeline-guide',
      ]);
      await ensureBundleContext(conn, demoBundle.id, {
        workflow_mode: 'generate_tech_spec',
        code_repository_id: defaultRepository.id,
        knowledge_scope_json: {
          knowledge_asset_ids: Object.values(demoScopeAssets).map((item) => item.id),
        },
      });
      await ensureBenchmarkBundle(conn, db, {
        bundle_code: 'BENCH-EXT-SUBFLOW-001',
        trace_id: 'trace-benchmark-ext-subflow-001',
        title: '外部子流程与回写 Benchmark',
        module_name: '销售订单外部回写',
      });
      await ensureBenchmarkBundle(conn, db, {
        bundle_code: 'BENCH-STATE-COMP-001',
        trace_id: 'trace-benchmark-state-comp-001',
        title: '复杂状态流转与逆向补偿 Benchmark',
        module_name: '销售订单状态补偿',
      });
      const docRun = await ensurePipelineRun(conn, {
        pipeline_definition_id: docPipeline.definition_id,
        pipeline_version_id: docPipeline.version_id,
        trace_id: demoBundle.trace_id,
        project_code: 'C04',
        entry_event: 'platform_demo_doc_bundle',
        request_payload: {
          bundle_id: demoBundle.id,
          workflow_mode: 'upload_existing',
          project_code: 'C04',
          repo_key: 'repo-ai-platform',
        },
        node_summaries: {
          input_contract: '输入文档齐套',
          prd_gate: 'PRD 门禁通过',
          repo_context_build: '仓库上下文已生成',
          tech_spec_generate: '技术方案草稿已生成',
          tech_spec_gate: '技术方案门禁通过',
          coverage_graph: 'Coverage Graph 已生成',
          test_plan_generate: '标准模板版与 AI 增强版草稿已生成',
          test_plan_gate: '测试方案门禁通过',
          publish: '正式版已发布',
        },
        node_outputs: {
          input_contract: { status: 'completed', summary: 'PRD、技术方案、接口契约与 DDL 已齐套' },
          prd_gate: { status: 'completed', summary: 'PRD 门禁通过', score: 91 },
          repo_context_build: { status: 'completed', summary: '仓库上下文已生成', repo_key: 'repo-ai-platform' },
          tech_spec_generate: { status: 'completed', summary: '技术方案草稿已生成', artifact_type: 'tech_spec_draft' },
          tech_spec_gate: { status: 'completed', summary: '技术方案门禁通过', score: 88 },
          coverage_graph: { status: 'completed', summary: 'Coverage Graph 已生成', obligations: 12 },
          test_plan_generate: { status: 'completed', summary: '双轨测试方案草稿已生成', artifact_types: ['template', 'ai_enhanced'] },
          test_plan_gate: { status: 'completed', summary: '测试方案门禁通过', score: 93 },
          publish: { status: 'completed', summary: '正式版已发布', artifact_type: 'test_plan_final' },
        },
        node_retrieval_contexts: {
          repo_context_build: [{ asset_key: 'ka-ai-rules-readme', title: 'ai-rules README' }],
          tech_spec_generate: [{ asset_key: 'ka-platform-manual', title: '平台总手册' }],
          test_plan_generate: [{ asset_key: 'ka-test-plan-template-spec', title: '测试方案模板规范' }],
          test_plan_gate: [{ asset_key: 'ka-test-plan-gate-rules', title: '测试方案门禁规则' }],
        },
        node_evidence_refs: {
          prd_gate: ['artifact:prd', `bundle:${demoBundle.id}`],
          tech_spec_gate: ['artifact:tech_spec_draft'],
          test_plan_gate: ['artifact:test_plan_template', 'artifact:test_plan_ai_enhanced'],
          publish: ['artifact:test_plan_final', `trace:${demoBundle.trace_id}`],
        },
      });
      await ensureApprovalTask(conn, docRun.id, '测试组', '模板版 pass，AI 增强版可作为补充视图发布');
      await ensureEvidencePack(conn, {
        project_code: 'C04',
        milestone_type: '5_31_check',
        title: '文档工程化默认验收样板',
        review_result: 'passed',
        reviewer: '平台组',
        trace_id: demoBundle.trace_id,
        pipeline_run_id: docRun.id,
        summary: '默认样板已完成文档上传、双轨测试方案生成、门禁通过和正式发布。',
        items: [
          { item_type: 'bundle', item_name: '默认文档任务', item_ref: `bundle:${demoBundle.id}` },
          { item_type: 'trace', item_name: '标准文档管道 Trace', item_ref: demoBundle.trace_id },
          { item_type: 'artifact', item_name: '测试方案正式版', item_ref: 'artifact:test_plan_final' },
        ],
      });

      const gateRun = await ensurePipelineRun(conn, {
        pipeline_definition_id: gateReview.definition_id,
        pipeline_version_id: gateReview.version_id,
        trace_id: 'trace-demo-gate-review-001',
        project_code: 'G04',
        entry_event: 'platform_demo_gate_review',
        request_payload: {
          project_code: 'G04',
          review_scope: 'acceptance',
          source_trace_id: demoBundle.trace_id,
        },
        node_summaries: {
          rule_bind: '默认门禁规则画像已绑定',
          gate_execute: '门禁执行结果已归档',
          human_review: '人工复核演示样例已完成',
          evidence_archive: '证据包已生成',
        },
        node_outputs: {
          rule_bind: { status: 'completed', summary: '规则绑定完成', gate_count: 3 },
          gate_execute: { status: 'completed', summary: '门禁执行完成', result: 'passed' },
          human_review: { status: 'completed', summary: '人工复核已签字', reviewer: '项目管理组' },
          evidence_archive: { status: 'completed', summary: '证据包已生成', review_result: 'passed' },
        },
        node_retrieval_contexts: {
          gate_execute: [{ asset_key: 'ka-ai-manual-qa-v1', title: 'QA AI 工作手册 V1' }],
          evidence_archive: [{ asset_key: 'ka-platform-manual', title: '平台总手册' }],
        },
        node_evidence_refs: {
          gate_execute: [`trace:${demoBundle.trace_id}`],
          human_review: ['approval:platform-demo'],
          evidence_archive: ['evidence:default-acceptance-pack'],
        },
      });
      await ensureApprovalTask(conn, gateRun.id, '项目管理组', '平台默认门禁样例已完成复核');
      await ensureEvidencePack(conn, {
        project_code: 'G04',
        milestone_type: '6_30_acceptance',
        title: '阶段验收默认样板',
        review_result: 'passed',
        reviewer: 'PMO',
        trace_id: 'trace-demo-gate-review-001',
        pipeline_run_id: gateRun.id,
        summary: '用于阶段验收页展示的默认证据包，覆盖门禁、知识、运行和验收材料。',
        items: [
          { item_type: 'trace', item_name: '门禁评审 Trace', item_ref: 'trace-demo-gate-review-001' },
          { item_type: 'metric', item_name: '提效基线', item_ref: 'project:G04' },
          { item_type: 'audit', item_name: '知识抽检记录', item_ref: 'trace-seed-platform-demo-001' },
        ],
      });
    }

    const [[{ projects }]] = await conn.query('SELECT COUNT(*) AS projects FROM gateway_program_projects');
    const [[{ assets }]] = await conn.query('SELECT COUNT(*) AS assets FROM gateway_knowledge_assets');
    const [[{ runs }]] = await conn.query('SELECT COUNT(*) AS runs FROM gateway_pipeline_runs');
    const [[{ bundles }]] = await conn.query('SELECT COUNT(*) AS bundles FROM gateway_doc_bundles');
    const [[{ evidence }]] = await conn.query('SELECT COUNT(*) AS evidence FROM gateway_evidence_packs');
    console.log('--- verify ---');
    console.log('projects:', projects);
    console.log('knowledge_assets:', assets);
    console.log('pipeline_runs:', runs);
    console.log('doc_bundles:', bundles);
    console.log('evidence_packs:', evidence);
  } finally {
    conn.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
