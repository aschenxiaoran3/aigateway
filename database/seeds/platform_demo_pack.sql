-- 平台产品化演示种子
-- 目标：让项目治理、知识与审计、度量可观测、阶段验收初始化后即有平台级默认内容

INSERT INTO `gateway_program_projects`
(`code`, `name`, `layer`, `wave_id`, `okr_refs`, `owner_role`, `co_owner_roles`, `start_date`, `end_date`, `status`, `risk_level`, `summary`, `acceptance_rule`)
SELECT *
FROM (
  SELECT
    'D01' AS code,
    '平台通用演示项目' AS name,
    'foundation' AS layer,
    w.id AS wave_id,
    JSON_ARRAY('KR10.1', 'KR10.4') AS okr_refs,
    '平台组' AS owner_role,
    JSON_ARRAY('PMO', '测试组') AS co_owner_roles,
    '2026-04-14' AS start_date,
    '2026-06-30' AS end_date,
    'active' AS status,
    'low' AS risk_level,
    '用于平台总览、知识资产、运行编排和验收页的默认演示项目。' AS summary,
    '页面初始化后可直接查看平台默认数据，不出现空白。' AS acceptance_rule
  FROM gateway_waves w WHERE w.code = 'W1'
  UNION ALL
  SELECT
    'C04',
    '文档工程化演示项目',
    'control',
    w.id,
    JSON_ARRAY('KR10.2', 'KR10.3'),
    '平台组',
    JSON_ARRAY('产品组', '测试组'),
    '2026-04-14',
    '2026-06-30',
    'active',
    'medium',
    '用于演示 doc-pipeline-v1、双轨测试方案和门禁结果。',
    '文档任务、运行编排和测试方案双轨产物可完整查看。'
  FROM gateway_waves w WHERE w.code = 'W2'
  UNION ALL
  SELECT
    'D03',
    '知识治理演示项目',
    'foundation',
    w.id,
    JSON_ARRAY('KR10.1'),
    '平台组',
    JSON_ARRAY('审计组'),
    '2026-04-14',
    '2026-06-30',
    'active',
    'low',
    '用于演示平台手册、门禁说明、模板规范和抽检记录。',
    '知识与审计页可直接看到平台通用资产、RAG 日志和抽检样例。'
  FROM gateway_waves w WHERE w.code = 'W1'
  UNION ALL
  SELECT
    'G04',
    '验收度量演示项目',
    'governance',
    w.id,
    JSON_ARRAY('KR10.4'),
    'PMO',
    JSON_ARRAY('平台组'),
    '2026-04-14',
    '2026-06-30',
    'active',
    'medium',
    '用于演示阶段验收样例、提效基线和指标聚合。',
    '阶段验收页可查看默认项目、证据包和阶段结论。'
  FROM gateway_waves w WHERE w.code = 'W4'
) seeded
WHERE NOT EXISTS (
  SELECT 1 FROM gateway_program_projects existing WHERE existing.code = seeded.code
);

DELETE FROM `gateway_project_milestones`
WHERE `project_code` IN ('C04', 'G04')
  AND `milestone_type` IN ('4_30_gate', '5_31_check', '6_30_acceptance')
  AND `checkpoint_label` IS NULL;

INSERT INTO `gateway_project_milestones`
(`project_code`, `milestone_type`, `title`, `due_date`, `acceptance_rule`, `status`)
SELECT *
FROM (
  SELECT 'D03' AS project_code, '5_31_check' AS milestone_type, '5/31 知识资产与抽检就绪' AS title, '2026-05-31' AS due_date, '平台手册、门禁规则、模板规范可被检索与抽检' AS acceptance_rule, 'completed' AS status
) seeded
WHERE NOT EXISTS (
  SELECT 1
  FROM gateway_project_milestones existing
  WHERE existing.project_code = seeded.project_code
    AND existing.milestone_type = seeded.milestone_type
    AND existing.title = seeded.title
);

INSERT INTO `gateway_project_risk_issues`
(`project_code`, `issue_type`, `title`, `description`, `severity`, `owner_role`, `due_date`, `resolution_status`)
SELECT *
FROM (
  SELECT 'C04' AS project_code, 'risk' AS issue_type, 'AI 增强版质量波动' AS title, 'AI 增强版在 fallback embedding 模式下可能存在知识引用噪声，需要结合模板版门禁兜底。' AS description, 'medium' AS severity, '测试组' AS owner_role, '2026-05-10' AS due_date, 'open' AS resolution_status
  UNION ALL
  SELECT 'D03', 'issue', '知识抽检需要持续执行', '平台默认已提供抽检样例，但仍需按周复查高频引用资产。', 'low', '审计组', '2026-05-17', 'open'
) seeded
WHERE NOT EXISTS (
  SELECT 1
  FROM gateway_project_risk_issues existing
  WHERE existing.project_code = seeded.project_code
    AND existing.title = seeded.title
);

INSERT INTO `gateway_project_weekly_updates`
(`project_code`, `week_label`, `progress_summary`, `risks`, `blockers`, `status`, `created_by`)
SELECT *
FROM (
  SELECT 'C04' AS project_code, '2026-W16' AS week_label, '已完成文档工程化演示样板、双轨测试方案样板和发布路径说明。' AS progress_summary, 'AI 增强版仍需持续调优引用准确性。' AS risks, '无' AS blockers, 'green' AS status, 'platform:init' AS created_by
  UNION ALL
  SELECT 'D03', '2026-W16', '平台手册、门禁规则手册、测试方案模板规范已纳入默认知识资产。', '需持续扩充抽检样本。', '无', 'green', 'platform:init'
  UNION ALL
  SELECT 'G04', '2026-W16', '阶段验收页默认样本已准备，包括 evidence pack、基线和指标聚合。', '需与真实项目运行持续对齐。', '无', 'green', 'platform:init'
) seeded
WHERE NOT EXISTS (
  SELECT 1
  FROM gateway_project_weekly_updates existing
  WHERE existing.project_code = seeded.project_code
    AND existing.week_label = seeded.week_label
);

INSERT INTO `gateway_efficiency_baselines`
(`scope_type`, `scope_id`, `metric_name`, `baseline_value`, `metric_dimension`, `sample_date`)
SELECT *
FROM (
  SELECT 'project' AS scope_type, 'G04' AS scope_id, 'gate_pass_rate' AS metric_name, 0.820000 AS baseline_value, JSON_OBJECT('label', '门禁通过率', 'unit', 'ratio') AS metric_dimension, '2026-04-14' AS sample_date
  UNION ALL SELECT 'project', 'G04', 'rag_hit_rate', 0.760000, JSON_OBJECT('label', '知识引用命中率', 'unit', 'ratio'), '2026-04-14'
  UNION ALL SELECT 'project', 'G04', 'acceptance_coverage', 0.880000, JSON_OBJECT('label', '阶段验收覆盖率', 'unit', 'ratio'), '2026-04-14'
  UNION ALL SELECT 'project', 'G04', 'cycle_hours_saved', 18.000000, JSON_OBJECT('label', '文档工程化节省工时', 'unit', 'hour'), '2026-04-14'
) seeded
WHERE NOT EXISTS (
  SELECT 1
  FROM gateway_efficiency_baselines existing
  WHERE existing.scope_type = seeded.scope_type
    AND existing.scope_id = seeded.scope_id
    AND existing.metric_name = seeded.metric_name
    AND existing.sample_date = seeded.sample_date
);

INSERT INTO `gateway_metric_samples`
(`scope_type`, `scope_id`, `metric_name`, `metric_value`, `metric_dimension`, `sample_date`, `source_type`)
SELECT *
FROM (
  SELECT 'project' AS scope_type, 'G04' AS scope_id, 'gate_pass_rate' AS metric_name, 0.870000 AS metric_value, JSON_OBJECT('label', '门禁通过率', 'unit', 'ratio') AS metric_dimension, '2026-04-10' AS sample_date, 'seed' AS source_type
  UNION ALL SELECT 'project', 'G04', 'gate_pass_rate', 0.910000, JSON_OBJECT('label', '门禁通过率', 'unit', 'ratio'), '2026-04-12', 'seed'
  UNION ALL SELECT 'project', 'G04', 'rag_hit_rate', 0.710000, JSON_OBJECT('label', '知识引用命中率', 'unit', 'ratio'), '2026-04-10', 'seed'
  UNION ALL SELECT 'project', 'G04', 'rag_hit_rate', 0.840000, JSON_OBJECT('label', '知识引用命中率', 'unit', 'ratio'), '2026-04-12', 'seed'
  UNION ALL SELECT 'project', 'G04', 'acceptance_coverage', 0.890000, JSON_OBJECT('label', '阶段验收覆盖率', 'unit', 'ratio'), '2026-04-12', 'seed'
  UNION ALL SELECT 'project', 'G04', 'cycle_hours_saved', 16.000000, JSON_OBJECT('label', '文档工程化节省工时', 'unit', 'hour'), '2026-04-10', 'seed'
  UNION ALL SELECT 'project', 'G04', 'cycle_hours_saved', 19.500000, JSON_OBJECT('label', '文档工程化节省工时', 'unit', 'hour'), '2026-04-12', 'seed'
) seeded
WHERE NOT EXISTS (
  SELECT 1
  FROM gateway_metric_samples existing
  WHERE existing.scope_type = seeded.scope_type
    AND existing.scope_id = seeded.scope_id
    AND existing.metric_name = seeded.metric_name
    AND existing.sample_date = seeded.sample_date
);

INSERT INTO `gateway_efficiency_reports`
(`report_name`, `scope_type`, `scope_id`, `report_payload`)
SELECT
  '平台初始化演示报告',
  'project',
  'G04',
  JSON_OBJECT(
    'summary', '用于管理台默认展示的阶段验收与提效样例报告。',
    'highlights', JSON_ARRAY('门禁通过率稳定', '知识抽检留痕可见', '阶段验收样本齐备')
  )
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1
  FROM gateway_efficiency_reports existing
  WHERE existing.report_name = '平台初始化演示报告'
    AND existing.scope_type = 'project'
    AND existing.scope_id = 'G04'
);

INSERT INTO `gateway_audit_events`
(`event_type`, `trace_id`, `project_code`, `payload_json`, `source_system`)
SELECT
  'knowledge_asset_spot_check',
  'trace-seed-platform-demo-001',
  'D03',
  JSON_OBJECT(
    'knowledge_asset_id', (SELECT id FROM gateway_knowledge_assets WHERE asset_key = 'ka-platform-manual' LIMIT 1),
    'asset_key', 'ka-platform-manual',
    'asset_name', '平台使用手册',
    'conclusion', '引用正确',
    'inspector', 'platform:init',
    'node_key', 'std_test_plan_gate',
    'note', '默认手册条目可作为门禁帮助入口和知识抽检样例。',
    'checked_at', '2026-04-14T10:00:00+08:00'
  ),
  'platform-init'
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1
  FROM gateway_audit_events existing
  WHERE existing.event_type = 'knowledge_asset_spot_check'
    AND existing.trace_id = 'trace-seed-platform-demo-001'
);

INSERT INTO `gateway_rag_query_logs`
(`trace_id`, `project_code`, `knowledge_asset_id`, `query_text`, `result_count`, `latency_ms`)
SELECT
  'trace-seed-platform-demo-001',
  'D03',
  (SELECT id FROM gateway_knowledge_assets WHERE asset_key = 'ka-test-plan-template-spec' LIMIT 1),
  '测试方案模板版必须包含哪些专业章节？',
  3,
  42
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1
  FROM gateway_rag_query_logs existing
  WHERE existing.trace_id = 'trace-seed-platform-demo-001'
    AND existing.project_code = 'D03'
    AND existing.query_text = '测试方案模板版必须包含哪些专业章节？'
);

UPDATE `gateway_standard_nodes`
SET
  `description` = '根据 Coverage Graph、PRD、技术方案、接口契约与 DDL 生成专业测试方案 V2：标准模板版作为发布主口径，AI 增强版补充边界场景、异常分支、测试数据与 SQL/日志/指标断言建议。',
  `rule_set_json` = JSON_OBJECT(
    'mode', 'generate',
    'output_tracks', JSON_ARRAY('standard_template', 'ai_enhanced'),
    'required_sections', JSON_ARRAY(
      '测试目标 / 测试范围 / 不在范围',
      '测试对象 / 版本边界 / 变更范围',
      '假设 / 依赖 / 约束',
      '风险清单与优先级',
      '进入准则 / 退出准则',
      '测试环境矩阵',
      '测试数据策略',
      '前置契约检查',
      'PRD 追溯矩阵',
      '技术方案追溯矩阵',
      'Coverage Graph 义务映射',
      '接口级验证矩阵',
      '状态迁移矩阵',
      '逆向 / 非法场景矩阵',
      '字段级 DB 断言矩阵',
      '子流程 / 外部系统边界验证',
      '缺陷记录策略 / 回归策略',
      '用例详述',
      '发布建议与门禁结论',
      '发布前门禁结论'
    )
  ),
  `acceptance_rule_json` = JSON_OBJECT(
    'must_have', JSON_ARRAY('标准模板版', 'AI 增强版', 'Coverage Graph 义务绑定', 'DB 断言', '逆向场景'),
    'publish_contract', JSON_OBJECT('template_gate', 'pass', 'ai_gate', 'pass_or_warn'),
    'pass_condition', 'template_draft_and_ai_draft_ready'
  )
WHERE `node_key` = 'std_test_plan_generate';

UPDATE `gateway_standard_nodes`
SET
  `description` = '测试方案门禁 V2 以模板版为发布主口径，同时对 AI 增强版做专业度告警；模板版阻断、增强告警。',
  `rule_set_json` = JSON_OBJECT(
    'mode', 'block',
    'layers', JSON_ARRAY('structure', 'traceability', 'execution', 'quality'),
    'required_checks', JSON_ARRAY(
      'scope_section',
      'risk_section',
      'environment_matrix',
      'data_strategy',
      'entry_exit_criteria',
      'prd_traceability_section',
      'tech_traceability_section',
      'coverage_graph_section',
      'api_matrix',
      'state_transition',
      'reverse_flow',
      'db_assertions',
      'case_details',
      'publish_recommendation',
      'publish_conclusion'
    ),
    'warn_checks', JSON_ARRAY('roles', 'resource_plan', 'metrics_report', 'automation_strategy', 'historical_reuse'),
    'ai_warn_checks', JSON_ARRAY('ai_enhanced_section', 'boundary_cases', 'recovery_paths', 'recommended_test_data', 'sql_suggestions')
  ),
  `acceptance_rule_json` = JSON_OBJECT(
    'must_have', JSON_ARRAY('模板版门禁 pass', 'AI 增强版已生成或告警', '正式发布内容无待补充', '风险/环境/数据/进入退出准则已齐全'),
    'publish_contract', JSON_OBJECT('template_gate', 'pass', 'ai_gate', 'pass_or_warn'),
    'pass_condition', 'template_gate_pass'
  )
WHERE `node_key` = 'std_test_plan_gate';
