CREATE TABLE IF NOT EXISTS `gateway_doc_bundles` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `bundle_code` VARCHAR(64) NOT NULL UNIQUE,
  `title` VARCHAR(255) NOT NULL,
  `domain` VARCHAR(64) NULL,
  `module_name` VARCHAR(128) NULL,
  `version_label` VARCHAR(64) NULL,
  `source_mode` VARCHAR(32) NOT NULL DEFAULT 'hybrid',
  `status` VARCHAR(32) NOT NULL DEFAULT 'draft',
  `created_by` VARCHAR(64) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_gateway_doc_bundles_status` (`status`),
  INDEX `idx_gateway_doc_bundles_domain` (`domain`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='文档上传与测试方案生成任务';

CREATE TABLE IF NOT EXISTS `gateway_doc_artifacts` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `bundle_id` BIGINT NOT NULL,
  `artifact_type` VARCHAR(32) NOT NULL,
  `source_type` VARCHAR(16) NOT NULL DEFAULT 'upload',
  `title` VARCHAR(255) NOT NULL,
  `storage_uri` VARCHAR(1024) NULL,
  `content_hash` VARCHAR(64) NULL,
  `version_label` VARCHAR(64) NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'ready',
  `content_text` LONGTEXT NULL,
  `metadata_json` JSON NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_gateway_doc_artifacts_bundle_id` FOREIGN KEY (`bundle_id`) REFERENCES `gateway_doc_bundles`(`id`) ON DELETE CASCADE,
  INDEX `idx_gateway_doc_artifacts_bundle_type` (`bundle_id`, `artifact_type`),
  INDEX `idx_gateway_doc_artifacts_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='文档输入输出工件';

CREATE TABLE IF NOT EXISTS `gateway_doc_artifact_links` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `bundle_id` BIGINT NOT NULL,
  `artifact_type` VARCHAR(32) NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `uri` VARCHAR(1024) NOT NULL,
  `version_label` VARCHAR(64) NULL,
  `metadata_json` JSON NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_gateway_doc_artifact_links_bundle_id` FOREIGN KEY (`bundle_id`) REFERENCES `gateway_doc_bundles`(`id`) ON DELETE CASCADE,
  INDEX `idx_gateway_doc_artifact_links_bundle_type` (`bundle_id`, `artifact_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='文档外部引用链接';

CREATE TABLE IF NOT EXISTS `gateway_doc_gate_executions` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `bundle_id` BIGINT NOT NULL,
  `gate_type` VARCHAR(32) NOT NULL,
  `status` VARCHAR(16) NOT NULL,
  `score` DECIMAL(5,2) NULL,
  `summary` TEXT NULL,
  `result_json` JSON NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_gateway_doc_gate_executions_bundle_id` FOREIGN KEY (`bundle_id`) REFERENCES `gateway_doc_bundles`(`id`) ON DELETE CASCADE,
  INDEX `idx_gateway_doc_gate_executions_bundle_gate` (`bundle_id`, `gate_type`),
  INDEX `idx_gateway_doc_gate_executions_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='文档门禁执行记录';

CREATE TABLE IF NOT EXISTS `gateway_coverage_graph_runs` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `bundle_id` BIGINT NOT NULL,
  `status` VARCHAR(16) NOT NULL DEFAULT 'ready',
  `source_artifact_ids` JSON NULL,
  `graph_json` JSON NULL,
  `missing_coverage_items` JSON NULL,
  `unbound_case_items` JSON NULL,
  `uninferable_items` JSON NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_gateway_coverage_graph_runs_bundle_id` FOREIGN KEY (`bundle_id`) REFERENCES `gateway_doc_bundles`(`id`) ON DELETE CASCADE,
  INDEX `idx_gateway_coverage_graph_runs_bundle_id` (`bundle_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Coverage Graph 运行结果';

CREATE TABLE IF NOT EXISTS `gateway_test_plan_generation_runs` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `bundle_id` BIGINT NOT NULL,
  `coverage_graph_run_id` BIGINT NULL,
  `draft_artifact_id` BIGINT NULL,
  `final_artifact_id` BIGINT NULL,
  `gate_execution_id` BIGINT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'draft',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_gateway_test_plan_generation_runs_bundle_id` FOREIGN KEY (`bundle_id`) REFERENCES `gateway_doc_bundles`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_gateway_test_plan_generation_runs_coverage_id` FOREIGN KEY (`coverage_graph_run_id`) REFERENCES `gateway_coverage_graph_runs`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_gateway_test_plan_generation_runs_draft_artifact_id` FOREIGN KEY (`draft_artifact_id`) REFERENCES `gateway_doc_artifacts`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_gateway_test_plan_generation_runs_final_artifact_id` FOREIGN KEY (`final_artifact_id`) REFERENCES `gateway_doc_artifacts`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_gateway_test_plan_generation_runs_gate_execution_id` FOREIGN KEY (`gate_execution_id`) REFERENCES `gateway_doc_gate_executions`(`id`) ON DELETE SET NULL,
  INDEX `idx_gateway_test_plan_generation_runs_bundle_id` (`bundle_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='测试方案生成运行记录';
