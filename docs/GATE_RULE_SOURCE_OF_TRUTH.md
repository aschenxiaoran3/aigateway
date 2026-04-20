# 门禁规则：单一事实来源（SoT）说明

## 结论

| 场景 | 权威来源 | 说明 |
|------|----------|------|
| **文档门禁**（`input_contract` / `prd_gate` / `tech_spec_gate` / `test_plan_gate`） | **control-plane**（`control-plane/src/db/mysql.js` 中规则合并 + Prompt 输出契约） | 管理台「文档门禁」调用的执行与落库路径；结果写入 `gateway_doc_gate_executions`。 |
| **YAML 规则包**（`gate-engine/rules/*.yaml`） | **gate-engine / CI 侧** | 用于本地 `gate-check`、GitLab CI、或与引擎对齐的**结构/检查清单**参考；与线上文档门禁**不是同一条执行链**。 |

## 为何不能两套并行自称「线上真值」

- 文档门禁依赖 **bundle 内工件**（`gateway_doc_artifacts`）与 **Coverage Graph** 上下文，在 **Node 侧** 与 `mergeGateRules`、Prompt 评审一体化。
- `gate-engine` 的 YAML 更偏向 **通用字段/章节** 检查，适合仓库内静态文件；若不与 control-plane 同步，会出现「CI 通过但文档门禁失败」或反之。

## 推荐协作方式

1. **以 control-plane 门禁结果**作为评审与验收依据（`pass` / `warn` / `block` + `result_json`）。
2. **YAML 变更**时：同步更新 `prd-gate.yaml` / `tech-gate.yaml` 与产品/平台约定，并在 MR 说明中引用本文件。
3. 若需 **严格对齐**：将 YAML 中的检查项编号映射到 `buildPromptPayload` 中的 `rule_result` 或 `checks` 键，并在变更日志中记录。

## 输出 JSON 契约

统一输出结构见控制平面契约：`GET /api/v1/contracts/doc-gate-output-schema`（与 `control-plane/src/contracts/docGateOutputSchema.js` 一致）。
