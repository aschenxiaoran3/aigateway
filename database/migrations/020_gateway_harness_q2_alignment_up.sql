ALTER TABLE `gateway_program_projects`
  ADD COLUMN `okr_stage` VARCHAR(32) NULL AFTER `layer`,
  ADD COLUMN `official_order` INT NOT NULL DEFAULT 999 AFTER `wave_id`,
  ADD COLUMN `metadata_json` JSON NULL AFTER `acceptance_rule`;

ALTER TABLE `gateway_project_milestones`
  ADD COLUMN `checkpoint_label` VARCHAR(32) NULL AFTER `milestone_type`,
  ADD COLUMN `metadata_json` JSON NULL AFTER `status`;

ALTER TABLE `gateway_evidence_packs`
  ADD COLUMN `metadata_json` JSON NULL AFTER `summary`;

ALTER TABLE `gateway_pipeline_definitions`
  ADD COLUMN `template_ref` VARCHAR(255) NULL AFTER `description`;

ALTER TABLE `gateway_pipeline_runs`
  ADD COLUMN `request_payload` JSON NULL AFTER `entry_event`;

ALTER TABLE `gateway_run_nodes`
  ADD COLUMN `input_payload` JSON NULL AFTER `node_type`,
  ADD COLUMN `output_payload` JSON NULL AFTER `output_summary`,
  ADD COLUMN `retrieval_context` JSON NULL AFTER `output_payload`,
  ADD COLUMN `evidence_refs` JSON NULL AFTER `retrieval_context`;

ALTER TABLE `gateway_approval_tasks`
  ADD COLUMN `approval_context` JSON NULL AFTER `payload_summary`;

CREATE TABLE IF NOT EXISTS `gateway_integration_connections` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `connection_key` VARCHAR(64) NOT NULL UNIQUE,
  `name` VARCHAR(128) NOT NULL,
  `category` VARCHAR(32) NOT NULL,
  `endpoint_url` VARCHAR(255) NULL,
  `auth_mode` VARCHAR(32) NULL,
  `owner_role` VARCHAR(64) NULL,
  `status` VARCHAR(16) NOT NULL DEFAULT 'planned',
  `last_sync_at` DATETIME NULL,
  `metadata_json` JSON NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='统一外部集成连接';

CREATE TABLE IF NOT EXISTS `gateway_value_assessments` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `project_code` VARCHAR(32) NOT NULL,
  `pipeline_run_id` BIGINT NULL,
  `assessment_key` VARCHAR(64) NOT NULL,
  `demand_title` VARCHAR(255) NULL,
  `value_summary` TEXT NULL,
  `assessment_status` VARCHAR(16) NOT NULL DEFAULT 'draft',
  `assessment_score` DECIMAL(8,2) NULL,
  `confirm_owner` VARCHAR(64) NULL,
  `confirm_time` DATETIME NULL,
  `metadata_json` JSON NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `uk_gateway_value_assessment_project_key` (`project_code`, `assessment_key`),
  CONSTRAINT `fk_gateway_value_assessments_pipeline_run_id`
    FOREIGN KEY (`pipeline_run_id`) REFERENCES `gateway_pipeline_runs`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='产品价值初评记录';

CREATE TABLE IF NOT EXISTS `gateway_certification_records` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `project_code` VARCHAR(32) NULL,
  `record_type` VARCHAR(32) NOT NULL,
  `subject_name` VARCHAR(128) NOT NULL,
  `owner_role` VARCHAR(64) NULL,
  `assessment_result` VARCHAR(16) NULL,
  `score` DECIMAL(8,2) NULL,
  `effective_date` DATE NULL,
  `report_uri` VARCHAR(255) NULL,
  `metadata_json` JSON NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `uk_gateway_certification_record` (`project_code`, `record_type`, `subject_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='认证与绩效记录';

UPDATE `gateway_program_projects`
SET
  `official_order` = 999,
  `okr_stage` = COALESCE(`okr_stage`, 'legacy'),
  `metadata_json` = JSON_SET(COALESCE(`metadata_json`, JSON_OBJECT()), '$.legacy_catalog', true)
WHERE `code` NOT IN (
  'F01', 'F02', 'F03', 'F04', 'F05',
  'G03', 'P05',
  'C01', 'C02', 'C03', 'C04', 'C05',
  'P01', 'P02', 'P03', 'P04', 'P06', 'P07', 'P08',
  'G01', 'G02', 'G04'
);

UPDATE `gateway_agent_specs`
SET `prompt_ref` = 'ai-rules/prompts/gate-review-agent.md'
WHERE `agent_key` = 'gate-review-agent';

UPDATE `gateway_skill_packages`
SET `prompt_ref` = CASE `skill_key`
  WHEN 'evidence-archive' THEN 'ai-rules/skills/evidence-archive.md'
  WHEN 'prd_gate_review' THEN 'ai-rules/skills/prd-gate-review.md'
  WHEN 'tech_spec_gate_review' THEN 'ai-rules/skills/tech-spec-gate-review.md'
  WHEN 'test_plan_generate' THEN 'ai-rules/skills/test-plan-generate.md'
  WHEN 'test_plan_gate_review' THEN 'ai-rules/skills/test-plan-gate-review.md'
  WHEN 'deepwiki_diagram_synthesis' THEN 'ai-rules/skills/deepwiki-diagram-synthesis.md'
  WHEN 'deepwiki_module_context' THEN 'ai-rules/skills/deepwiki-module-context.md'
  ELSE `prompt_ref`
END
WHERE `skill_key` IN (
  'evidence-archive',
  'prd_gate_review',
  'tech_spec_gate_review',
  'test_plan_generate',
  'test_plan_gate_review',
  'deepwiki_diagram_synthesis',
  'deepwiki_module_context'
);

UPDATE `gateway_pipeline_definitions`
SET `template_ref` = CASE `pipeline_key`
  WHEN 'gate-review' THEN 'ai-rules/pipelines/gate-review.json'
  WHEN 'p01-tech-bug-loop-v1' THEN 'ai-rules/pipelines/p01-tech-bug-loop-v1.json'
  WHEN 'p02-test-automation-v1' THEN 'ai-rules/pipelines/p02-test-automation-v1.json'
  WHEN 'p03-ops-release-closure-v1' THEN 'ai-rules/pipelines/p03-ops-release-closure-v1.json'
  WHEN 'p04-pm-task-closure-v1' THEN 'ai-rules/pipelines/p04-pm-task-closure-v1.json'
  WHEN 'p05-product-value-evaluation-v1' THEN 'ai-rules/pipelines/p05-product-value-evaluation-v1.json'
  WHEN 'doc-pipeline-v1' THEN 'ai-rules/pipelines/doc-pipeline-v1.json'
  ELSE `template_ref`
END
WHERE `pipeline_key` IN (
  'gate-review',
  'p01-tech-bug-loop-v1',
  'p02-test-automation-v1',
  'p03-ops-release-closure-v1',
  'p04-pm-task-closure-v1',
  'p05-product-value-evaluation-v1',
  'doc-pipeline-v1'
);
