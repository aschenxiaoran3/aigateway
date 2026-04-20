ALTER TABLE `gateway_usage_logs`
  ADD COLUMN `trace_id` VARCHAR(64) NULL COMMENT '运行链路 trace_id' AFTER `request_id`,
  ADD COLUMN `pipeline_run_id` BIGINT NULL COMMENT '运行实例 ID' AFTER `trace_id`,
  ADD COLUMN `run_node_id` BIGINT NULL COMMENT '运行节点 ID' AFTER `pipeline_run_id`,
  ADD COLUMN `agent_spec_id` BIGINT NULL COMMENT 'Agent 规格 ID' AFTER `run_node_id`,
  ADD COLUMN `skill_package_id` BIGINT NULL COMMENT '技能包 ID' AFTER `agent_spec_id`,
  ADD COLUMN `project_code` VARCHAR(32) NULL COMMENT '项目编码' AFTER `skill_package_id`,
  ADD COLUMN `request_summary` TEXT NULL COMMENT '请求摘要' AFTER `project_code`,
  ADD COLUMN `response_summary` TEXT NULL COMMENT '响应摘要' AFTER `request_summary`,
  ADD COLUMN `fallback_mode` VARCHAR(32) NULL COMMENT '降级模式' AFTER `response_summary`,
  ADD COLUMN `human_intervention` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否人工介入' AFTER `fallback_mode`,
  ADD INDEX `idx_trace_id` (`trace_id`),
  ADD INDEX `idx_pipeline_run_id` (`pipeline_run_id`),
  ADD INDEX `idx_project_code` (`project_code`);

ALTER TABLE `gateway_gate_rules`
  ADD COLUMN `scope` VARCHAR(32) NULL COMMENT '治理范围 prd/design/code/test/release' AFTER `gate_type`,
  ADD COLUMN `severity` VARCHAR(16) NULL COMMENT '严重级别' AFTER `scope`,
  ADD COLUMN `mode` VARCHAR(16) NULL COMMENT '执行模式 notify/warn/block' AFTER `severity`,
  ADD COLUMN `repo_scope` VARCHAR(255) NULL COMMENT '仓库范围' AFTER `mode`,
  ADD COLUMN `pipeline_scope` VARCHAR(64) NULL COMMENT '管道范围' AFTER `repo_scope`,
  ADD INDEX `idx_scope` (`scope`),
  ADD INDEX `idx_mode` (`mode`);

ALTER TABLE `gateway_gate_executions`
  ADD INDEX `idx_client_run_id_created_at` (`client_run_id`, `created_at`);

CREATE TABLE IF NOT EXISTS `gateway_waves` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `code` VARCHAR(32) NOT NULL UNIQUE,
  `name` VARCHAR(128) NOT NULL,
  `stage` VARCHAR(32) NOT NULL,
  `goal` TEXT NULL,
  `entry_criteria` TEXT NULL,
  `exit_criteria` TEXT NULL,
  `start_date` DATE NULL,
  `end_date` DATE NULL,
  `status` VARCHAR(16) NOT NULL DEFAULT 'active',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='AI 工程化波次';

CREATE TABLE IF NOT EXISTS `gateway_program_projects` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `code` VARCHAR(32) NOT NULL UNIQUE,
  `name` VARCHAR(128) NOT NULL,
  `layer` VARCHAR(32) NOT NULL,
  `wave_id` BIGINT NULL,
  `okr_refs` JSON NULL,
  `owner_role` VARCHAR(64) NULL,
  `co_owner_roles` JSON NULL,
  `start_date` DATE NULL,
  `end_date` DATE NULL,
  `status` VARCHAR(16) NOT NULL DEFAULT 'active',
  `risk_level` VARCHAR(16) NOT NULL DEFAULT 'medium',
  `summary` TEXT NULL,
  `acceptance_rule` TEXT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_gateway_program_projects_wave_id` FOREIGN KEY (`wave_id`) REFERENCES `gateway_waves`(`id`) ON DELETE SET NULL,
  INDEX `idx_program_projects_layer` (`layer`),
  INDEX `idx_program_projects_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='AI 工程化项目台账';

CREATE TABLE IF NOT EXISTS `gateway_project_milestones` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `project_code` VARCHAR(32) NOT NULL,
  `milestone_type` VARCHAR(32) NOT NULL,
  `title` VARCHAR(128) NOT NULL,
  `due_date` DATE NULL,
  `acceptance_rule` TEXT NULL,
  `status` VARCHAR(16) NOT NULL DEFAULT 'pending',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_project_milestones_project_code` (`project_code`),
  INDEX `idx_project_milestones_type` (`milestone_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='项目里程碑';

CREATE TABLE IF NOT EXISTS `gateway_project_risk_issues` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `project_code` VARCHAR(32) NOT NULL,
  `issue_type` VARCHAR(16) NOT NULL DEFAULT 'risk',
  `title` VARCHAR(128) NOT NULL,
  `description` TEXT NULL,
  `severity` VARCHAR(16) NOT NULL DEFAULT 'medium',
  `owner_role` VARCHAR(64) NULL,
  `due_date` DATE NULL,
  `resolution_status` VARCHAR(16) NOT NULL DEFAULT 'open',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_project_risk_issues_project_code` (`project_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='项目风险与问题';

CREATE TABLE IF NOT EXISTS `gateway_project_weekly_updates` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `project_code` VARCHAR(32) NOT NULL,
  `week_label` VARCHAR(32) NOT NULL,
  `progress_summary` TEXT NULL,
  `risks` TEXT NULL,
  `blockers` TEXT NULL,
  `status` VARCHAR(16) NOT NULL DEFAULT 'green',
  `created_by` VARCHAR(64) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_project_weekly_updates_project_code` (`project_code`),
  INDEX `idx_project_weekly_updates_week_label` (`week_label`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='项目周跟进';

CREATE TABLE IF NOT EXISTS `gateway_evidence_packs` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `project_code` VARCHAR(32) NOT NULL,
  `milestone_type` VARCHAR(32) NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `review_result` VARCHAR(16) NOT NULL DEFAULT 'pending',
  `reviewer` VARCHAR(64) NULL,
  `reviewed_at` DATETIME NULL,
  `trace_id` VARCHAR(64) NULL,
  `pipeline_run_id` BIGINT NULL,
  `summary` TEXT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_evidence_packs_project_code` (`project_code`),
  INDEX `idx_evidence_packs_trace_id` (`trace_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='验收证据包';

CREATE TABLE IF NOT EXISTS `gateway_evidence_pack_items` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `evidence_pack_id` BIGINT NOT NULL,
  `item_type` VARCHAR(32) NOT NULL,
  `item_name` VARCHAR(128) NOT NULL,
  `item_ref` VARCHAR(255) NULL,
  `payload_json` JSON NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_evidence_pack_items_pack_id` FOREIGN KEY (`evidence_pack_id`) REFERENCES `gateway_evidence_packs`(`id`) ON DELETE CASCADE,
  INDEX `idx_evidence_pack_items_pack_id` (`evidence_pack_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='证据包明细';

CREATE TABLE IF NOT EXISTS `gateway_pipeline_definitions` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `pipeline_key` VARCHAR(64) NOT NULL UNIQUE,
  `name` VARCHAR(128) NOT NULL,
  `domain` VARCHAR(16) NOT NULL,
  `description` TEXT NULL,
  `owner_role` VARCHAR(64) NULL,
  `status` VARCHAR(16) NOT NULL DEFAULT 'draft',
  `current_version_id` BIGINT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_pipeline_definitions_domain` (`domain`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='管道定义';

CREATE TABLE IF NOT EXISTS `gateway_pipeline_versions` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `pipeline_definition_id` BIGINT NOT NULL,
  `version` VARCHAR(32) NOT NULL,
  `status` VARCHAR(16) NOT NULL DEFAULT 'draft',
  `published_at` DATETIME NULL,
  `change_summary` TEXT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_pipeline_versions_definition_id` FOREIGN KEY (`pipeline_definition_id`) REFERENCES `gateway_pipeline_definitions`(`id`) ON DELETE CASCADE,
  UNIQUE KEY `uk_pipeline_definition_version` (`pipeline_definition_id`, `version`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='管道版本';

CREATE TABLE IF NOT EXISTS `gateway_agent_specs` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `agent_key` VARCHAR(64) NOT NULL UNIQUE,
  `name` VARCHAR(128) NOT NULL,
  `purpose` TEXT NULL,
  `tool_bindings` JSON NULL,
  `memory_policy` JSON NULL,
  `prompt_ref` VARCHAR(255) NULL,
  `error_policy` JSON NULL,
  `runtime_env` JSON NULL,
  `status` VARCHAR(16) NOT NULL DEFAULT 'active',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Agent 规格';

CREATE TABLE IF NOT EXISTS `gateway_contract_schemas` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `schema_key` VARCHAR(64) NOT NULL,
  `domain` VARCHAR(32) NOT NULL,
  `schema_name` VARCHAR(128) NOT NULL,
  `version` VARCHAR(32) NOT NULL,
  `json_schema` JSON NULL,
  `sample_payload` JSON NULL,
  `validation_mode` VARCHAR(16) NOT NULL DEFAULT 'strict',
  `status` VARCHAR(16) NOT NULL DEFAULT 'active',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `uk_contract_schema_key_version` (`schema_key`, `version`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='契约 Schema';

CREATE TABLE IF NOT EXISTS `gateway_skill_packages` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `skill_key` VARCHAR(64) NOT NULL,
  `name` VARCHAR(128) NOT NULL,
  `version` VARCHAR(32) NOT NULL,
  `env_tags` JSON NULL,
  `input_decl` JSON NULL,
  `output_decl` JSON NULL,
  `prompt_ref` VARCHAR(255) NULL,
  `tool_refs` JSON NULL,
  `status` VARCHAR(16) NOT NULL DEFAULT 'active',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `uk_skill_key_version` (`skill_key`, `version`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='技能包';

CREATE TABLE IF NOT EXISTS `gateway_pipeline_nodes` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `pipeline_version_id` BIGINT NOT NULL,
  `node_key` VARCHAR(64) NOT NULL,
  `node_name` VARCHAR(128) NOT NULL,
  `node_type` VARCHAR(16) NOT NULL,
  `input_schema_id` BIGINT NULL,
  `output_schema_id` BIGINT NULL,
  `retry_policy` JSON NULL,
  `timeout_policy` JSON NULL,
  `fallback_policy` JSON NULL,
  `sort_order` INT NOT NULL DEFAULT 1,
  `config_json` JSON NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_pipeline_nodes_version_id` FOREIGN KEY (`pipeline_version_id`) REFERENCES `gateway_pipeline_versions`(`id`) ON DELETE CASCADE,
  UNIQUE KEY `uk_pipeline_version_node_key` (`pipeline_version_id`, `node_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='管道节点';

CREATE TABLE IF NOT EXISTS `gateway_gate_rule_bindings` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `pipeline_definition_id` BIGINT NOT NULL,
  `gate_rule_id` INT NOT NULL,
  `repo_scope` VARCHAR(255) NULL,
  `binding_scope` VARCHAR(64) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_gate_rule_bindings_pipeline_id` FOREIGN KEY (`pipeline_definition_id`) REFERENCES `gateway_pipeline_definitions`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_gate_rule_bindings_rule_id` FOREIGN KEY (`gate_rule_id`) REFERENCES `gateway_gate_rules`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='门禁规则绑定';

CREATE TABLE IF NOT EXISTS `gateway_runtime_events` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `event_key` VARCHAR(64) NOT NULL UNIQUE,
  `source_type` VARCHAR(32) NOT NULL,
  `event_type` VARCHAR(64) NOT NULL,
  `payload_json` JSON NULL,
  `trace_id` VARCHAR(64) NULL,
  `project_code` VARCHAR(32) NULL,
  `received_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_runtime_events_trace_id` (`trace_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='运行事件';

CREATE TABLE IF NOT EXISTS `gateway_pipeline_runs` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `pipeline_definition_id` BIGINT NOT NULL,
  `pipeline_version_id` BIGINT NULL,
  `trace_id` VARCHAR(64) NOT NULL,
  `project_code` VARCHAR(32) NULL,
  `status` VARCHAR(16) NOT NULL DEFAULT 'running',
  `source_type` VARCHAR(32) NOT NULL DEFAULT 'manual',
  `entry_event` VARCHAR(64) NULL,
  `started_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `ended_at` DATETIME NULL,
  `gate_execution_id` BIGINT NULL,
  `approval_status` VARCHAR(16) NOT NULL DEFAULT 'pending',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_pipeline_runs_definition_id` FOREIGN KEY (`pipeline_definition_id`) REFERENCES `gateway_pipeline_definitions`(`id`) ON DELETE CASCADE,
  INDEX `idx_pipeline_runs_trace_id` (`trace_id`),
  INDEX `idx_pipeline_runs_project_code` (`project_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='运行实例';

CREATE TABLE IF NOT EXISTS `gateway_run_nodes` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `pipeline_run_id` BIGINT NOT NULL,
  `node_key` VARCHAR(64) NOT NULL,
  `node_name` VARCHAR(128) NOT NULL,
  `node_type` VARCHAR(16) NOT NULL,
  `status` VARCHAR(16) NOT NULL DEFAULT 'pending',
  `started_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `ended_at` DATETIME NULL,
  `error_message` TEXT NULL,
  `output_summary` TEXT NULL,
  `gate_execution_id` BIGINT NULL,
  `usage_log_id` BIGINT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_run_nodes_pipeline_run_id` FOREIGN KEY (`pipeline_run_id`) REFERENCES `gateway_pipeline_runs`(`id`) ON DELETE CASCADE,
  INDEX `idx_run_nodes_pipeline_run_id` (`pipeline_run_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='运行节点';

CREATE TABLE IF NOT EXISTS `gateway_approval_tasks` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `pipeline_run_id` BIGINT NOT NULL,
  `run_node_id` BIGINT NULL,
  `approver_role` VARCHAR(64) NOT NULL,
  `payload_summary` TEXT NULL,
  `decision` VARCHAR(16) NULL,
  `decision_at` DATETIME NULL,
  `comment` TEXT NULL,
  `status` VARCHAR(16) NOT NULL DEFAULT 'pending',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_approval_tasks_pipeline_run_id` FOREIGN KEY (`pipeline_run_id`) REFERENCES `gateway_pipeline_runs`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_approval_tasks_run_node_id` FOREIGN KEY (`run_node_id`) REFERENCES `gateway_run_nodes`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='审批任务';

CREATE TABLE IF NOT EXISTS `gateway_run_callbacks` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `pipeline_run_id` BIGINT NOT NULL,
  `callback_type` VARCHAR(32) NOT NULL,
  `callback_url` VARCHAR(255) NULL,
  `callback_status` VARCHAR(16) NOT NULL DEFAULT 'pending',
  `payload_json` JSON NULL,
  `response_summary` TEXT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_run_callbacks_pipeline_run_id` FOREIGN KEY (`pipeline_run_id`) REFERENCES `gateway_pipeline_runs`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='运行回调';

CREATE TABLE IF NOT EXISTS `gateway_metric_samples` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `scope_type` VARCHAR(16) NOT NULL,
  `scope_id` VARCHAR(64) NOT NULL,
  `metric_name` VARCHAR(64) NOT NULL,
  `metric_value` DECIMAL(18,6) NOT NULL DEFAULT 0,
  `metric_dimension` JSON NULL,
  `sample_date` DATE NOT NULL,
  `source_type` VARCHAR(32) NOT NULL DEFAULT 'system',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_metric_samples_scope` (`scope_type`, `scope_id`),
  INDEX `idx_metric_samples_name_date` (`metric_name`, `sample_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='指标样本';

CREATE TABLE IF NOT EXISTS `gateway_efficiency_baselines` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `scope_type` VARCHAR(16) NOT NULL,
  `scope_id` VARCHAR(64) NOT NULL,
  `metric_name` VARCHAR(64) NOT NULL,
  `baseline_value` DECIMAL(18,6) NOT NULL DEFAULT 0,
  `metric_dimension` JSON NULL,
  `sample_date` DATE NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='提效基线';

CREATE TABLE IF NOT EXISTS `gateway_efficiency_reports` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `report_name` VARCHAR(128) NOT NULL,
  `scope_type` VARCHAR(16) NOT NULL,
  `scope_id` VARCHAR(64) NOT NULL,
  `report_payload` JSON NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='提效报告';

CREATE TABLE IF NOT EXISTS `gateway_quality_analysis_reports` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `report_name` VARCHAR(128) NOT NULL,
  `scope_type` VARCHAR(16) NOT NULL,
  `scope_id` VARCHAR(64) NOT NULL,
  `report_payload` JSON NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='质量分析报告';

CREATE TABLE IF NOT EXISTS `gateway_knowledge_assets` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `asset_key` VARCHAR(64) NOT NULL UNIQUE,
  `name` VARCHAR(128) NOT NULL,
  `asset_type` VARCHAR(32) NOT NULL,
  `status` VARCHAR(16) NOT NULL DEFAULT 'active',
  `source_uri` VARCHAR(255) NULL,
  `metadata_json` JSON NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='知识资产';

CREATE TABLE IF NOT EXISTS `gateway_knowledge_indexes` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `knowledge_asset_id` BIGINT NOT NULL,
  `index_type` VARCHAR(32) NOT NULL,
  `status` VARCHAR(16) NOT NULL DEFAULT 'ready',
  `index_meta` JSON NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_knowledge_indexes_asset_id` FOREIGN KEY (`knowledge_asset_id`) REFERENCES `gateway_knowledge_assets`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='知识索引';

CREATE TABLE IF NOT EXISTS `gateway_rag_query_logs` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `trace_id` VARCHAR(64) NULL,
  `knowledge_asset_id` BIGINT NULL,
  `query_text` TEXT NULL,
  `result_count` INT NOT NULL DEFAULT 0,
  `latency_ms` INT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_rag_query_logs_trace_id` (`trace_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='RAG 查询日志';

CREATE TABLE IF NOT EXISTS `gateway_audit_events` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `event_type` VARCHAR(64) NOT NULL,
  `trace_id` VARCHAR(64) NULL,
  `project_code` VARCHAR(32) NULL,
  `payload_json` JSON NULL,
  `source_system` VARCHAR(64) NOT NULL DEFAULT 'control-plane',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_audit_events_trace_id` (`trace_id`),
  INDEX `idx_audit_events_event_type` (`event_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='审计事件';
