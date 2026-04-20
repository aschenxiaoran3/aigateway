# 销售订单样板：文档门禁 E2E 清单

## 前置条件

1. MySQL 已应用 `database/migrations/009_gateway_phase1_contracts_up.sql` 与 `010_gateway_node_contracts_up.sql`。
2. 启动 **control-plane**（默认 `http://127.0.0.1:3003`）。
3. 可选：配置 `DOC_GATE_API_KEY` 等环境变量以使 Prompt 门禁返回完整 JSON；未配置时仍可能走规则合并降级路径。

## 自动化脚本

在仓库 `projects/ai-platform` 下：

```bash
CONTROL_PLANE_URL=http://127.0.0.1:3003 node scripts/e2e-sales-order-doc-gates.mjs
```

可选：校验 Deep Wiki 反馈事件列表接口（需已有 `PROJECT_ID` 对应项目）：

```bash
CONTROL_PLANE_URL=http://127.0.0.1:3003 PROJECT_ID=1 node scripts/contract-deepwiki-feedback.mjs
```

脚本会：

- 创建文档任务（自动生成 `trace_id`）；
- 从 `fixtures/sales-order-e2e/` 上传 `prd` / `tech_spec` / `api_contract` / `ddl`；
- 调用 `POST /api/v1/runtime/pipelines/doc-pipeline-v1/runs` 触发标准管道；
- 标准管道按顺序执行 `input_contract` → `prd_gate` → `tech_spec_gate` → `coverage_graph` → `test_plan_generate` → `test_plan_gate` → `publish`。

## 管理台人工验收

1. 启动 admin-ui（默认 `http://localhost:3004/`；若使用 `npm run dev -- --port 3002` 则打开对应端口）→ 侧栏 **文档门禁（任务与产物）**，选中脚本创建的任务。
2. 确认 **Trace ID**、**项目编码**（默认 `C04`）与门禁执行记录一致。
3. 打开 **运行编排**，在「手动输入 trace」中粘贴同一 `trace_id`，应能看到 **文档任务** 与 **文档门禁执行** 表。

## 知识资产抽检（一期）

完成 `database/seeds/phase1_knowledge_assets.sql` 入库后，在 **知识与审计** 页核对分类与 URI；抽检表模板见 `docs/KNOWLEDGE_ASSET_SPOT_CHECK_TEMPLATE.md`。

## 二期演示：管道运行种子

在配置好 DB 环境变量的 `control-plane` 目录执行：

```bash
node scripts/seed-phase2-demo-runs.cjs
```

将向 `gateway_pipeline_runs` 写入 `trace-seed-doc-pipeline-001` 与 `trace-seed-gate-review-001` 两条 `completed` 记录（项目 `C04`），便于「运行编排 / 项目治理」联调。
