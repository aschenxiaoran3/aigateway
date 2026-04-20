ALTER TABLE `gateway_standard_nodes`
  ADD COLUMN `input_contract_json` JSON NULL AFTER `description`,
  ADD COLUMN `output_contract_json` JSON NULL AFTER `input_contract_json`,
  ADD COLUMN `rule_set_json` JSON NULL AFTER `output_contract_json`,
  ADD COLUMN `prompt_spec_json` JSON NULL AFTER `rule_set_json`,
  ADD COLUMN `trace_contract_json` JSON NULL AFTER `prompt_spec_json`,
  ADD COLUMN `human_checkpoint_json` JSON NULL AFTER `trace_contract_json`,
  ADD COLUMN `acceptance_rule_json` JSON NULL AFTER `human_checkpoint_json`,
  ADD COLUMN `input_schema_id` BIGINT NULL AFTER `acceptance_rule_json`,
  ADD COLUMN `output_schema_id` BIGINT NULL AFTER `input_schema_id`,
  ADD COLUMN `skill_package_id` BIGINT NULL AFTER `output_schema_id`,
  ADD COLUMN `status` VARCHAR(16) NOT NULL DEFAULT 'active' AFTER `skill_package_id`,
  ADD INDEX `idx_gateway_standard_nodes_status` (`status`);

INSERT INTO `gateway_contract_schemas`
  (`schema_key`, `domain`, `schema_name`, `version`, `json_schema`, `sample_payload`, `validation_mode`, `status`)
VALUES
  ('prd_input', 'product', 'PRD 输入契约', '1.0.0',
    JSON_OBJECT('type', 'object', 'required', JSON_ARRAY('bundle_id', 'artifact_type', 'content_text')),
    JSON_OBJECT('bundle_id', 1, 'artifact_type', 'prd', 'content_text', 'PRD markdown'),
    'strict', 'active'),
  ('prd_output', 'product', 'PRD 输出契约', '1.0.0',
    JSON_OBJECT('type', 'object', 'required', JSON_ARRAY('artifact_type', 'title', 'content_text')),
    JSON_OBJECT('artifact_type', 'prd', 'title', '销售订单 PRD', 'content_text', '# PRD'),
    'strict', 'active'),
  ('tech_spec_input', 'design', '技术方案输入契约', '1.0.0',
    JSON_OBJECT('type', 'object', 'required', JSON_ARRAY('bundle_id', 'artifact_type', 'content_text')),
    JSON_OBJECT('bundle_id', 1, 'artifact_type', 'tech_spec', 'content_text', '技术方案 markdown'),
    'strict', 'active'),
  ('tech_spec_output', 'design', '技术方案输出契约', '1.0.0',
    JSON_OBJECT('type', 'object', 'required', JSON_ARRAY('artifact_type', 'title', 'content_text')),
    JSON_OBJECT('artifact_type', 'tech_spec', 'title', '销售订单技术方案', 'content_text', '# 技术方案'),
    'strict', 'active'),
  ('test_plan_input', 'test', '测试方案输入契约', '1.0.0',
    JSON_OBJECT('type', 'object', 'required', JSON_ARRAY('bundle_id', 'coverage_graph_run_id')),
    JSON_OBJECT('bundle_id', 1, 'coverage_graph_run_id', 2),
    'strict', 'active'),
  ('doc_gate_output', 'gate', '文档门禁统一输出契约', '1.0.0',
    JSON_OBJECT('type', 'object', 'required', JSON_ARRAY('status', 'summary', 'checks', 'citations', 'evaluator_meta')),
    JSON_OBJECT('status', 'warn', 'summary', '缺字段级 DB 断言', 'checks', JSON_ARRAY(), 'citations', JSON_ARRAY(), 'evaluator_meta', JSON_OBJECT()),
    'strict', 'active')
ON DUPLICATE KEY UPDATE
  `schema_name` = VALUES(`schema_name`),
  `json_schema` = VALUES(`json_schema`),
  `sample_payload` = VALUES(`sample_payload`),
  `validation_mode` = VALUES(`validation_mode`),
  `status` = VALUES(`status`);

INSERT INTO `gateway_skill_packages`
  (`skill_key`, `name`, `version`, `env_tags`, `input_decl`, `output_decl`, `prompt_ref`, `tool_refs`, `status`)
VALUES
  ('prd_gate_review', 'PRD 门禁评审技能包', '1.0.0',
    JSON_ARRAY('phase1', 'prd'),
    JSON_OBJECT('artifact_type', 'prd', 'required_docs', JSON_ARRAY('prd')),
    JSON_OBJECT('status', 'pass|warn|block', 'checks', 'array', 'citations', 'array'),
    'skills/prd-gate-review.md',
    JSON_ARRAY('control-plane', 'knowledge-base'),
    'active'),
  ('tech_spec_gate_review', '技术方案门禁评审技能包', '1.0.0',
    JSON_ARRAY('phase1', 'tech_spec'),
    JSON_OBJECT('artifact_type', 'tech_spec', 'required_docs', JSON_ARRAY('tech_spec', 'api_contract', 'ddl')),
    JSON_OBJECT('status', 'pass|warn|block', 'checks', 'array', 'citations', 'array'),
    'skills/tech-spec-gate-review.md',
    JSON_ARRAY('control-plane', 'knowledge-base'),
    'active'),
  ('test_plan_generate', '测试方案生成技能包', '1.0.0',
    JSON_ARRAY('phase1', 'test_plan'),
    JSON_OBJECT('artifact_type', 'test_plan_draft', 'required_inputs', JSON_ARRAY('coverage_graph')),
    JSON_OBJECT('artifact_type', 'test_plan_draft', 'sections', JSON_ARRAY('输入契约检查', 'Coverage Graph', '追溯矩阵')),
    'skills/test-plan-generate.md',
    JSON_ARRAY('control-plane'),
    'active'),
  ('test_plan_gate_review', '测试方案门禁评审技能包', '1.0.0',
    JSON_ARRAY('phase1', 'test_plan_gate'),
    JSON_OBJECT('artifact_type', 'test_plan_final', 'required_docs', JSON_ARRAY('test_plan_final', 'coverage_graph')),
    JSON_OBJECT('status', 'pass|warn|block', 'checks', 'array', 'citations', 'array'),
    'skills/test-plan-gate-review.md',
    JSON_ARRAY('control-plane', 'knowledge-base'),
    'active')
ON DUPLICATE KEY UPDATE
  `name` = VALUES(`name`),
  `env_tags` = VALUES(`env_tags`),
  `input_decl` = VALUES(`input_decl`),
  `output_decl` = VALUES(`output_decl`),
  `prompt_ref` = VALUES(`prompt_ref`),
  `tool_refs` = VALUES(`tool_refs`),
  `status` = VALUES(`status`);

UPDATE `gateway_standard_nodes`
SET
  `input_contract_json` = JSON_OBJECT(
    'artifact_types', JSON_ARRAY('prd', 'tech_spec', 'api_contract', 'ddl'),
    'required_fields', JSON_ARRAY('bundle_id', 'trace_id', 'project_code'),
    'missing_policy', 'block'
  ),
  `output_contract_json` = JSON_OBJECT(
    'status_enum', JSON_ARRAY('pass', 'warn', 'block'),
    'required_fields', JSON_ARRAY('checks', 'missing_inputs', 'risk_items', 'uninferable_items', 'citations')
  ),
  `rule_set_json` = JSON_OBJECT(
    'mode', 'block',
    'required_checks', JSON_ARRAY('prd_exists', 'tech_exists', 'api_contract_support', 'ddl_support')
  ),
  `prompt_spec_json` = JSON_OBJECT(
    'template_key', 'doc_gate_input_contract',
    'allow_degrade', true
  ),
  `trace_contract_json` = JSON_OBJECT(
    'required_fields', JSON_ARRAY('trace_id', 'bundle_id', 'project_code', 'node_key', 'artifact_type')
  ),
  `human_checkpoint_json` = JSON_OBJECT(
    'required_on', JSON_ARRAY('block'),
    'roles', JSON_ARRAY('项目管理组')
  ),
  `acceptance_rule_json` = JSON_OBJECT(
    'must_have', JSON_ARRAY('四类文档齐套', '缺失项明确'),
    'pass_condition', 'status != block'
  ),
  `input_schema_id` = (SELECT id FROM gateway_contract_schemas WHERE schema_key = 'prd_input' AND version = '1.0.0' LIMIT 1),
  `output_schema_id` = (SELECT id FROM gateway_contract_schemas WHERE schema_key = 'doc_gate_output' AND version = '1.0.0' LIMIT 1),
  `status` = 'active'
WHERE `node_key` = 'std_input_contract';

UPDATE `gateway_standard_nodes`
SET
  `input_contract_json` = JSON_OBJECT(
    'artifact_types', JSON_ARRAY('prd'),
    'required_fields', JSON_ARRAY('title', 'content_text')
  ),
  `output_contract_json` = JSON_OBJECT(
    'artifact_types', JSON_ARRAY('prd'),
    'required_fields', JSON_ARRAY('title', 'content_text', 'version_label')
  ),
  `rule_set_json` = JSON_OBJECT(
    'mode', 'generate',
    'required_sections', JSON_ARRAY('需求背景', '主流程', '逆向流程', '验收标准')
  ),
  `prompt_spec_json` = JSON_OBJECT(
    'template_key', 'prd_generate',
    'forbidden_items', JSON_ARRAY('杜撰状态机', '无来源字段')
  ),
  `trace_contract_json` = JSON_OBJECT(
    'required_fields', JSON_ARRAY('trace_id', 'bundle_id', 'project_code', 'node_key', 'artifact_type')
  ),
  `human_checkpoint_json` = JSON_OBJECT(
    'required_on', JSON_ARRAY('publish'),
    'roles', JSON_ARRAY('产品组')
  ),
  `acceptance_rule_json` = JSON_OBJECT(
    'must_have', JSON_ARRAY('正向主流程', '逆向流程', '状态机', '字段规则'),
    'pass_condition', 'artifact_ready'
  ),
  `input_schema_id` = (SELECT id FROM gateway_contract_schemas WHERE schema_key = 'prd_input' AND version = '1.0.0' LIMIT 1),
  `output_schema_id` = (SELECT id FROM gateway_contract_schemas WHERE schema_key = 'prd_output' AND version = '1.0.0' LIMIT 1),
  `status` = 'active'
WHERE `node_key` = 'std_prd_generate';

UPDATE `gateway_standard_nodes`
SET
  `input_contract_json` = JSON_OBJECT(
    'artifact_types', JSON_ARRAY('prd'),
    'required_fields', JSON_ARRAY('bundle_id', 'trace_id', 'project_code')
  ),
  `output_contract_json` = JSON_OBJECT(
    'status_enum', JSON_ARRAY('pass', 'warn', 'block'),
    'required_fields', JSON_ARRAY('checks', 'missing_inputs', 'risk_items', 'uninferable_items', 'citations')
  ),
  `rule_set_json` = JSON_OBJECT(
    'mode', 'block',
    'required_checks', JSON_ARRAY('main_flow', 'reverse_flow', 'state_machine')
  ),
  `prompt_spec_json` = JSON_OBJECT(
    'template_key', 'prd_gate_review',
    'allow_degrade', true
  ),
  `trace_contract_json` = JSON_OBJECT(
    'required_fields', JSON_ARRAY('trace_id', 'bundle_id', 'project_code', 'node_key', 'artifact_type')
  ),
  `human_checkpoint_json` = JSON_OBJECT(
    'required_on', JSON_ARRAY('block'),
    'roles', JSON_ARRAY('产品组', '项目管理组')
  ),
  `acceptance_rule_json` = JSON_OBJECT(
    'must_have', JSON_ARRAY('正向主流程', '逆向流程', '状态机'),
    'pass_condition', 'status = pass'
  ),
  `input_schema_id` = (SELECT id FROM gateway_contract_schemas WHERE schema_key = 'prd_input' AND version = '1.0.0' LIMIT 1),
  `output_schema_id` = (SELECT id FROM gateway_contract_schemas WHERE schema_key = 'doc_gate_output' AND version = '1.0.0' LIMIT 1),
  `skill_package_id` = (SELECT id FROM gateway_skill_packages WHERE skill_key = 'prd_gate_review' AND version = '1.0.0' LIMIT 1),
  `status` = 'active'
WHERE `node_key` = 'std_prd_gate';

UPDATE `gateway_standard_nodes`
SET
  `input_contract_json` = JSON_OBJECT(
    'artifact_types', JSON_ARRAY('prd', 'api_contract', 'ddl'),
    'required_fields', JSON_ARRAY('title', 'content_text')
  ),
  `output_contract_json` = JSON_OBJECT(
    'artifact_types', JSON_ARRAY('tech_spec'),
    'required_fields', JSON_ARRAY('title', 'content_text', 'version_label')
  ),
  `rule_set_json` = JSON_OBJECT(
    'mode', 'generate',
    'required_sections', JSON_ARRAY('接口设计', '数据库设计', '异常处理', '边界说明')
  ),
  `prompt_spec_json` = JSON_OBJECT(
    'template_key', 'tech_spec_generate',
    'forbidden_items', JSON_ARRAY('杜撰接口', '未给出 DDL 却写字段断言')
  ),
  `trace_contract_json` = JSON_OBJECT(
    'required_fields', JSON_ARRAY('trace_id', 'bundle_id', 'project_code', 'node_key', 'artifact_type')
  ),
  `human_checkpoint_json` = JSON_OBJECT(
    'required_on', JSON_ARRAY('publish'),
    'roles', JSON_ARRAY('后端组')
  ),
  `acceptance_rule_json` = JSON_OBJECT(
    'must_have', JSON_ARRAY('API 入口', '字段职责', '子流程边界'),
    'pass_condition', 'artifact_ready'
  ),
  `input_schema_id` = (SELECT id FROM gateway_contract_schemas WHERE schema_key = 'tech_spec_input' AND version = '1.0.0' LIMIT 1),
  `output_schema_id` = (SELECT id FROM gateway_contract_schemas WHERE schema_key = 'tech_spec_output' AND version = '1.0.0' LIMIT 1),
  `status` = 'active'
WHERE `node_key` = 'std_tech_spec_generate';

UPDATE `gateway_standard_nodes`
SET
  `input_contract_json` = JSON_OBJECT(
    'artifact_types', JSON_ARRAY('tech_spec', 'api_contract', 'ddl'),
    'required_fields', JSON_ARRAY('bundle_id', 'trace_id', 'project_code')
  ),
  `output_contract_json` = JSON_OBJECT(
    'status_enum', JSON_ARRAY('pass', 'warn', 'block'),
    'required_fields', JSON_ARRAY('checks', 'missing_inputs', 'risk_items', 'uninferable_items', 'citations')
  ),
  `rule_set_json` = JSON_OBJECT(
    'mode', 'block',
    'required_checks', JSON_ARRAY('api_entry', 'data_model', 'subprocess', 'idempotency')
  ),
  `prompt_spec_json` = JSON_OBJECT(
    'template_key', 'tech_spec_gate_review',
    'allow_degrade', true
  ),
  `trace_contract_json` = JSON_OBJECT(
    'required_fields', JSON_ARRAY('trace_id', 'bundle_id', 'project_code', 'node_key', 'artifact_type')
  ),
  `human_checkpoint_json` = JSON_OBJECT(
    'required_on', JSON_ARRAY('block'),
    'roles', JSON_ARRAY('后端组', '项目管理组')
  ),
  `acceptance_rule_json` = JSON_OBJECT(
    'must_have', JSON_ARRAY('Controller/API 入口', '表字段职责', '子流程边界'),
    'pass_condition', 'status = pass'
  ),
  `input_schema_id` = (SELECT id FROM gateway_contract_schemas WHERE schema_key = 'tech_spec_input' AND version = '1.0.0' LIMIT 1),
  `output_schema_id` = (SELECT id FROM gateway_contract_schemas WHERE schema_key = 'doc_gate_output' AND version = '1.0.0' LIMIT 1),
  `skill_package_id` = (SELECT id FROM gateway_skill_packages WHERE skill_key = 'tech_spec_gate_review' AND version = '1.0.0' LIMIT 1),
  `status` = 'active'
WHERE `node_key` = 'std_tech_spec_gate';

UPDATE `gateway_standard_nodes`
SET
  `input_contract_json` = JSON_OBJECT(
    'artifact_types', JSON_ARRAY('prd', 'tech_spec', 'api_contract', 'ddl', 'coverage_graph'),
    'required_fields', JSON_ARRAY('bundle_id', 'coverage_graph_run_id')
  ),
  `output_contract_json` = JSON_OBJECT(
    'artifact_types', JSON_ARRAY('test_plan_draft', 'test_plan_final'),
    'required_fields', JSON_ARRAY('title', 'content_text')
  ),
  `rule_set_json` = JSON_OBJECT(
    'mode', 'generate',
    'required_sections', JSON_ARRAY('输入契约检查', 'Coverage Graph', '追溯矩阵', '测试步骤')
  ),
  `prompt_spec_json` = JSON_OBJECT(
    'template_key', 'test_plan_generate',
    'forbidden_items', JSON_ARRAY('未绑定 Coverage obligation 的用例')
  ),
  `trace_contract_json` = JSON_OBJECT(
    'required_fields', JSON_ARRAY('trace_id', 'bundle_id', 'project_code', 'node_key', 'artifact_type')
  ),
  `human_checkpoint_json` = JSON_OBJECT(
    'required_on', JSON_ARRAY('publish'),
    'roles', JSON_ARRAY('测试组')
  ),
  `acceptance_rule_json` = JSON_OBJECT(
    'must_have', JSON_ARRAY('Coverage obligation', 'DB 断言', '逆向流程'),
    'pass_condition', 'artifact_ready'
  ),
  `input_schema_id` = (SELECT id FROM gateway_contract_schemas WHERE schema_key = 'test_plan_input' AND version = '1.0.0' LIMIT 1),
  `output_schema_id` = (SELECT id FROM gateway_contract_schemas WHERE schema_key = 'doc_gate_output' AND version = '1.0.0' LIMIT 1),
  `skill_package_id` = (SELECT id FROM gateway_skill_packages WHERE skill_key = 'test_plan_generate' AND version = '1.0.0' LIMIT 1),
  `status` = 'active'
WHERE `node_key` = 'std_test_plan_generate';

UPDATE `gateway_standard_nodes`
SET
  `input_contract_json` = JSON_OBJECT(
    'artifact_types', JSON_ARRAY('test_plan_draft', 'coverage_graph'),
    'required_fields', JSON_ARRAY('bundle_id', 'trace_id', 'project_code')
  ),
  `output_contract_json` = JSON_OBJECT(
    'status_enum', JSON_ARRAY('pass', 'warn', 'block'),
    'required_fields', JSON_ARRAY('checks', 'missing_inputs', 'risk_items', 'uninferable_items', 'citations')
  ),
  `rule_set_json` = JSON_OBJECT(
    'mode', 'block',
    'required_checks', JSON_ARRAY('coverage_graph_section', 'traceability_section', 'db_assertions')
  ),
  `prompt_spec_json` = JSON_OBJECT(
    'template_key', 'test_plan_gate_review',
    'allow_degrade', true
  ),
  `trace_contract_json` = JSON_OBJECT(
    'required_fields', JSON_ARRAY('trace_id', 'bundle_id', 'project_code', 'node_key', 'artifact_type')
  ),
  `human_checkpoint_json` = JSON_OBJECT(
    'required_on', JSON_ARRAY('block', 'warn'),
    'roles', JSON_ARRAY('测试组', '项目管理组')
  ),
  `acceptance_rule_json` = JSON_OBJECT(
    'must_have', JSON_ARRAY('Coverage Graph 绑定', '步骤可执行', '字段级 DB 断言'),
    'pass_condition', 'status = pass'
  ),
  `input_schema_id` = (SELECT id FROM gateway_contract_schemas WHERE schema_key = 'test_plan_input' AND version = '1.0.0' LIMIT 1),
  `output_schema_id` = (SELECT id FROM gateway_contract_schemas WHERE schema_key = 'doc_gate_output' AND version = '1.0.0' LIMIT 1),
  `skill_package_id` = (SELECT id FROM gateway_skill_packages WHERE skill_key = 'test_plan_gate_review' AND version = '1.0.0' LIMIT 1),
  `status` = 'active'
WHERE `node_key` = 'std_test_plan_gate';

ALTER TABLE `gateway_standard_nodes`
  ADD CONSTRAINT `fk_gateway_standard_nodes_input_schema_id`
    FOREIGN KEY (`input_schema_id`) REFERENCES `gateway_contract_schemas`(`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_gateway_standard_nodes_output_schema_id`
    FOREIGN KEY (`output_schema_id`) REFERENCES `gateway_contract_schemas`(`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_gateway_standard_nodes_skill_package_id`
    FOREIGN KEY (`skill_package_id`) REFERENCES `gateway_skill_packages`(`id`) ON DELETE SET NULL;
