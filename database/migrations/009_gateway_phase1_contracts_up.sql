-- Phase 1: 单节点契约 — trace、标准节点目录、知识资产分类字段、RAG 日志项目维度

ALTER TABLE `gateway_doc_bundles`
  ADD COLUMN `trace_id` VARCHAR(64) NULL COMMENT '单次文档门禁链路 trace' AFTER `bundle_code`,
  ADD COLUMN `project_code` VARCHAR(32) NULL COMMENT '关联 gateway_program_projects.code' AFTER `trace_id`,
  ADD INDEX `idx_gateway_doc_bundles_trace_id` (`trace_id`),
  ADD INDEX `idx_gateway_doc_bundles_project_code` (`project_code`);

ALTER TABLE `gateway_doc_gate_executions`
  ADD COLUMN `trace_id` VARCHAR(64) NULL AFTER `bundle_id`,
  ADD COLUMN `node_key` VARCHAR(64) NULL COMMENT '对应 gateway_standard_nodes.node_key' AFTER `trace_id`,
  ADD INDEX `idx_gateway_doc_gate_executions_trace_id` (`trace_id`);

ALTER TABLE `gateway_knowledge_assets`
  ADD COLUMN `asset_category` VARCHAR(32) NULL COMMENT '规范/模板/样板/DDL契约/提示词规则 等' AFTER `asset_type`,
  ADD COLUMN `domain` VARCHAR(64) NULL AFTER `asset_category`,
  ADD COLUMN `module` VARCHAR(128) NULL AFTER `domain`,
  ADD COLUMN `version` VARCHAR(32) NULL DEFAULT '1.0' AFTER `module`,
  ADD COLUMN `owner` VARCHAR(64) NULL AFTER `version`,
  ADD INDEX `idx_gateway_knowledge_assets_category` (`asset_category`);

ALTER TABLE `gateway_rag_query_logs`
  ADD COLUMN `project_code` VARCHAR(32) NULL AFTER `trace_id`,
  ADD INDEX `idx_gateway_rag_query_logs_project_code` (`project_code`);

CREATE TABLE IF NOT EXISTS `gateway_standard_nodes` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `node_key` VARCHAR(64) NOT NULL UNIQUE,
  `node_type` VARCHAR(16) NOT NULL COMMENT 'generate|evaluate|retrieve|transform|approval|callback',
  `phase` TINYINT NOT NULL DEFAULT 1,
  `title` VARCHAR(128) NOT NULL,
  `description` TEXT NULL,
  `artifact_types_json` JSON NULL,
  `gate_type` VARCHAR(32) NULL COMMENT '门禁类节点对应 gateway_doc_gate_executions.gate_type',
  `sort_order` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='一期标准节点目录';

INSERT INTO `gateway_standard_nodes`
  (`node_key`, `node_type`, `phase`, `title`, `description`, `artifact_types_json`, `gate_type`, `sort_order`)
VALUES
  ('std_prd_generate', 'generate', 1, 'PRD 生成节点', '输出 prd 工件', JSON_ARRAY('prd'), NULL, 10),
  ('std_prd_gate', 'evaluate', 1, 'PRD 门禁节点', 'PRD 结构/规则/Prompt 评审', JSON_ARRAY('prd'), 'prd_gate', 20),
  ('std_tech_spec_generate', 'generate', 1, '技术方案生成节点', '输出 tech_spec 工件', JSON_ARRAY('tech_spec'), NULL, 30),
  ('std_tech_spec_gate', 'evaluate', 1, '技术方案门禁节点', '架构/接口/DDL 引用一致性', JSON_ARRAY('tech_spec','api_contract','ddl'), 'tech_spec_gate', 40),
  ('std_test_plan_generate', 'generate', 1, '测试方案生成节点', '输出 test_plan_draft/final', JSON_ARRAY('test_plan_draft','test_plan_final'), NULL, 50),
  ('std_test_plan_gate', 'evaluate', 1, '测试方案门禁节点', '可执行性/Coverage 绑定', JSON_ARRAY('test_plan_final'), 'test_plan_gate', 60),
  ('std_input_contract', 'evaluate', 1, '输入契约检查', 'PRD+技术方案+契约+DDL 齐套', JSON_ARRAY('prd','tech_spec','api_contract','ddl'), 'input_contract', 5)
ON DUPLICATE KEY UPDATE
  `title` = VALUES(`title`),
  `description` = VALUES(`description`),
  `artifact_types_json` = VALUES(`artifact_types_json`),
  `gate_type` = VALUES(`gate_type`),
  `sort_order` = VALUES(`sort_order`);
