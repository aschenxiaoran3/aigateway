# AI 工程化管理系统演进说明（复用现有 `gateway_*` 数据资产）

> 版本：V1.0  
> 日期：2026-04-13  
> 适用范围：`admin-ui`、`ai-gateway`、`gate-engine`、后续控制平面与运行编排服务

---

## 1. 目标

本说明用于明确：AI 工程化管理系统建设时，**必须复用现有 `gateway_*` 表**，而不是重新设计一套平行数据库体系。

系统演进原则：

1. **保留现有事实表与规则表**
2. **只新增现有系统没有的治理、控制和编排表**
3. **所有新增主表统一使用 `gateway_` 前缀**
4. **前端继续沿用 `admin-ui`，不另起第二管理台**

---

## 2. 已存在表及建议角色

| 表名 | 当前用途 | 演进后用途 | 动作 |
| --- | --- | --- | --- |
| `gateway_api_keys` | Key、模型白名单、配额 | 模型调用主体与权限入口 | 保留 |
| `gateway_teams` | 团队配额与归属 | 团队维度治理和统计归属 | 保留 |
| `gateway_users` | 平台用户和角色 | 平台角色基础表 | 保留，后续可扩角色 |
| `gateway_usage_logs` | 模型调用日志 | 模型调用事实表 / 运行链路事实来源 | 增强 |
| `gateway_cost_records` | 成本聚合 | 成本中心和成本报表来源 | 保留 |
| `gateway_gate_rules` | 门禁规则定义 | 门禁规则库 | 增强 |
| `gateway_gate_executions` | 门禁执行结果 | 门禁执行事实表 / 验收证据来源之一 | 增强 |

---

## 3. 需要增强的现有表

### 3.1 `gateway_usage_logs`

建议新增字段：

- `trace_id`
- `pipeline_run_id`
- `run_node_id`
- `agent_spec_id`
- `skill_package_id`
- `project_code`
- `request_summary`
- `response_summary`
- `fallback_mode`
- `human_intervention`

目的：

1. 支撑运行链路追踪
2. 支撑项目/管道/节点维度统计
3. 支撑验收与审计回溯

### 3.2 `gateway_gate_rules`

建议新增字段：

- `scope`
- `severity`
- `mode`
- `repo_scope`
- `pipeline_scope`

目的：

1. 将门禁规则从“规则 JSON”升级为“可治理规则资产”
2. 支撑差异化绑定和分级执行

### 3.3 `gateway_gate_executions`

建议标准化 `execution_meta`，统一写入：

- `trace_id`
- `pipeline_id`
- `pipeline_run_id`
- `node_id`
- `artifact_fingerprint`
- `duration_ms`
- `source`

目的：

1. 将门禁执行结果挂到运行链路
2. 直接支撑阶段验收证据包

---

## 4. 建议新增表

### 4.1 项目治理

- `gateway_waves`
- `gateway_program_projects`
- `gateway_project_milestones`
- `gateway_project_risk_issues`
- `gateway_project_weekly_updates`
- `gateway_evidence_packs`
- `gateway_evidence_pack_items`

### 4.2 Harness 控制平面

- `gateway_pipeline_definitions`
- `gateway_pipeline_versions`
- `gateway_pipeline_nodes`
- `gateway_agent_specs`
- `gateway_contract_schemas`
- `gateway_skill_packages`
- `gateway_gate_rule_bindings`

### 4.3 运行编排

- `gateway_runtime_events`
- `gateway_pipeline_runs`
- `gateway_run_nodes`
- `gateway_approval_tasks`
- `gateway_run_callbacks`

### 4.4 指标与审计

- `gateway_metric_samples`
- `gateway_efficiency_baselines`
- `gateway_efficiency_reports`
- `gateway_quality_analysis_reports`
- `gateway_knowledge_assets`
- `gateway_knowledge_indexes`
- `gateway_rag_query_logs`
- `gateway_audit_events`

---

## 5. 服务与表的映射关系

### `ai-gateway`

继续负责写入：

- `gateway_usage_logs`
- `gateway_cost_records`

未来还应承担：

- 模型调用统一拦截
- 上下文字段透传
- trace 级别运行留痕

### `gate-engine`

继续负责写入：

- `gateway_gate_rules`
- `gateway_gate_executions`

未来还应承担：

- 门禁规则绑定
- notify / warn / block 三段式执行
- 与运行链路挂接

### 新增控制平面服务

负责写入：

- `gateway_pipeline_definitions`
- `gateway_pipeline_versions`
- `gateway_pipeline_nodes`
- `gateway_agent_specs`
- `gateway_contract_schemas`
- `gateway_skill_packages`

### 新增治理服务

负责写入：

- `gateway_waves`
- `gateway_program_projects`
- `gateway_project_milestones`
- `gateway_project_risk_issues`
- `gateway_evidence_packs`

### 新增运行编排服务

负责写入：

- `gateway_runtime_events`
- `gateway_pipeline_runs`
- `gateway_run_nodes`
- `gateway_approval_tasks`

---

## 6. 前端演进建议

现有 `admin-ui` 继续作为正式前端载体。

### 保留并并入

- `Dashboard` -> 度量与可观测
- `GateConfig` -> 门禁治理
- `Logs` -> 审计与运行日志
- `CostReport` -> 成本分析
- `ApiKeys` / `Teams` -> 基础权限治理

### 新增模块

1. 项目治理中心
2. Harness 控制平面
3. 运行编排中心
4. 阶段验收与证据中心

---

## 7. 实施顺序

### Step 1：盘点现有 API 与表的真实使用情况

先确认：

- 现有页面读写哪些表
- 现有接口是否已支持分页、筛选、详情
- 现有表中哪些字段已足够复用

### Step 2：增强事实表

优先增强：

- `gateway_usage_logs`
- `gateway_gate_executions`

因为这两张表是后续 trace、审计、验收、提效分析的基础。

### Step 3：补治理层和控制层

新增：

- 项目治理表
- 控制平面表
- 运行状态表

### Step 4：扩展 `admin-ui`

先做：

1. 项目治理中心
2. 控制平面基础页
3. 阶段验收页

再做运行编排与审批页面。

---

## 8. 禁止事项

1. 不要新造一套非 `gateway_` 前缀的平行主表体系。
2. 不要绕开 `gateway_usage_logs` 另写模型调用主事实表。
3. 不要绕开 `gateway_gate_executions` 另写门禁执行主事实表。
4. 不要另起一个第二前端管理台。

---

## 9. 结论

AI 工程化管理系统不是一个“全新平台”，而是现有 AI 网关平台的 **治理层、控制层、编排层和验收层扩展**。

后续研发实施应遵守以下总原则：

1. **事实层复用现有 `gateway_*` 表**
2. **控制层与治理层新增缺失表**
3. **前端复用 `admin-ui`**
4. **所有新增主表统一保持 `gateway_` 前缀**
