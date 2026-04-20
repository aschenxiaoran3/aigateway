CREATE TABLE IF NOT EXISTS `gateway_wiki_branches` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `project_id` BIGINT NOT NULL,
  `branch_name` VARCHAR(191) NOT NULL,
  `display_name` VARCHAR(255) NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `metadata_json` JSON NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_gateway_wiki_branches_project_id`
    FOREIGN KEY (`project_id`) REFERENCES `gateway_wiki_projects`(`id`) ON DELETE CASCADE,
  UNIQUE KEY `uk_gateway_wiki_branches_project_branch` (`project_id`, `branch_name`),
  INDEX `idx_gateway_wiki_branches_project` (`project_id`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Deep Wiki 项目分支';

CREATE TABLE IF NOT EXISTS `gateway_wiki_branch_repo_mappings` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `branch_id` BIGINT NOT NULL,
  `project_repo_id` BIGINT NOT NULL,
  `repo_branch_name` VARCHAR(191) NOT NULL,
  `metadata_json` JSON NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_gateway_wiki_branch_repo_mappings_branch_id`
    FOREIGN KEY (`branch_id`) REFERENCES `gateway_wiki_branches`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_gateway_wiki_branch_repo_mappings_project_repo_id`
    FOREIGN KEY (`project_repo_id`) REFERENCES `gateway_wiki_project_repos`(`id`) ON DELETE CASCADE,
  UNIQUE KEY `uk_gateway_wiki_branch_repo_mappings` (`branch_id`, `project_repo_id`),
  INDEX `idx_gateway_wiki_branch_repo_mappings_repo` (`project_repo_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Deep Wiki 分支逐仓映射';

CREATE TABLE IF NOT EXISTS `gateway_wiki_snapshot_repo_revisions` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `snapshot_id` BIGINT NOT NULL,
  `project_repo_id` BIGINT NOT NULL,
  `repo_role` VARCHAR(64) NOT NULL,
  `repo_slug` VARCHAR(255) NOT NULL,
  `branch_name` VARCHAR(191) NOT NULL,
  `commit_sha` VARCHAR(64) NOT NULL,
  `metadata_json` JSON NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_gateway_wiki_snapshot_repo_revisions_snapshot_id`
    FOREIGN KEY (`snapshot_id`) REFERENCES `gateway_wiki_snapshots`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_gateway_wiki_snapshot_repo_revisions_project_repo_id`
    FOREIGN KEY (`project_repo_id`) REFERENCES `gateway_wiki_project_repos`(`id`) ON DELETE CASCADE,
  UNIQUE KEY `uk_gateway_wiki_snapshot_repo_revisions` (`snapshot_id`, `project_repo_id`),
  INDEX `idx_gateway_wiki_snapshot_repo_revisions_role` (`repo_role`),
  INDEX `idx_gateway_wiki_snapshot_repo_revisions_repo` (`repo_slug`, `branch_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Deep Wiki snapshot 对应的多仓修订';

CREATE TABLE IF NOT EXISTS `gateway_wiki_consistency_checks` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `snapshot_id` BIGINT NOT NULL,
  `check_type` VARCHAR(64) NOT NULL,
  `source_object_type` VARCHAR(64) NULL,
  `source_object_id` BIGINT NULL,
  `target_object_type` VARCHAR(64) NULL,
  `target_object_id` BIGINT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'pending',
  `score` DECIMAL(6,2) NOT NULL DEFAULT 0.00,
  `issue_code` VARCHAR(128) NULL,
  `issue_level` VARCHAR(32) NOT NULL DEFAULT 'info',
  `detail_json` JSON NULL,
  `evidence_json` JSON NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_gateway_wiki_consistency_checks_snapshot_id`
    FOREIGN KEY (`snapshot_id`) REFERENCES `gateway_wiki_snapshots`(`id`) ON DELETE CASCADE,
  INDEX `idx_gateway_wiki_consistency_checks_snapshot` (`snapshot_id`, `check_type`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Deep Wiki 一致性检查';

CREATE TABLE IF NOT EXISTS `gateway_wiki_flows` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `snapshot_id` BIGINT NOT NULL,
  `flow_code` VARCHAR(191) NOT NULL,
  `flow_name` VARCHAR(255) NOT NULL,
  `flow_type` VARCHAR(64) NOT NULL DEFAULT 'feature_flow',
  `feature_object_id` BIGINT NULL,
  `trigger_type` VARCHAR(64) NULL,
  `preconditions_json` JSON NULL,
  `postconditions_json` JSON NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'draft',
  `evidence_json` JSON NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_gateway_wiki_flows_snapshot_id`
    FOREIGN KEY (`snapshot_id`) REFERENCES `gateway_wiki_snapshots`(`id`) ON DELETE CASCADE,
  UNIQUE KEY `uk_gateway_wiki_flows_snapshot_flow_code` (`snapshot_id`, `flow_code`),
  INDEX `idx_gateway_wiki_flows_feature` (`feature_object_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Deep Wiki 可执行流程';

CREATE TABLE IF NOT EXISTS `gateway_wiki_flow_steps` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `flow_id` BIGINT NOT NULL,
  `step_order` INT NOT NULL,
  `step_type` VARCHAR(64) NOT NULL,
  `step_name` VARCHAR(255) NOT NULL,
  `service_object_id` BIGINT NULL,
  `api_object_id` BIGINT NULL,
  `table_object_id` BIGINT NULL,
  `event_object_id` BIGINT NULL,
  `input_schema_ref` VARCHAR(255) NULL,
  `output_schema_ref` VARCHAR(255) NULL,
  `assertion_ref` VARCHAR(191) NULL,
  `on_failure` VARCHAR(255) NULL,
  `evidence_json` JSON NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_gateway_wiki_flow_steps_flow_id`
    FOREIGN KEY (`flow_id`) REFERENCES `gateway_wiki_flows`(`id`) ON DELETE CASCADE,
  UNIQUE KEY `uk_gateway_wiki_flow_steps_flow_order` (`flow_id`, `step_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Deep Wiki 流程步骤';

CREATE TABLE IF NOT EXISTS `gateway_wiki_assertions` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `snapshot_id` BIGINT NOT NULL,
  `assertion_code` VARCHAR(191) NOT NULL,
  `assertion_type` VARCHAR(64) NOT NULL DEFAULT 'expected_result',
  `expression` TEXT NULL,
  `expected_result_json` JSON NULL,
  `evidence_json` JSON NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_gateway_wiki_assertions_snapshot_id`
    FOREIGN KEY (`snapshot_id`) REFERENCES `gateway_wiki_snapshots`(`id`) ON DELETE CASCADE,
  UNIQUE KEY `uk_gateway_wiki_assertions_snapshot_code` (`snapshot_id`, `assertion_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Deep Wiki 断言';

CREATE TABLE IF NOT EXISTS `gateway_wiki_scenarios` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `snapshot_id` BIGINT NOT NULL,
  `scenario_code` VARCHAR(191) NOT NULL,
  `scenario_name` VARCHAR(255) NOT NULL,
  `feature_object_id` BIGINT NULL,
  `flow_id` BIGINT NULL,
  `input_fixture_json` JSON NULL,
  `expected_assertions_json` JSON NULL,
  `linked_test_asset_object_id` BIGINT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'draft',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_gateway_wiki_scenarios_snapshot_id`
    FOREIGN KEY (`snapshot_id`) REFERENCES `gateway_wiki_snapshots`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_gateway_wiki_scenarios_flow_id`
    FOREIGN KEY (`flow_id`) REFERENCES `gateway_wiki_flows`(`id`) ON DELETE SET NULL,
  UNIQUE KEY `uk_gateway_wiki_scenarios_snapshot_code` (`snapshot_id`, `scenario_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Deep Wiki 场景';

CREATE TABLE IF NOT EXISTS `gateway_wiki_semantic_scores` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `snapshot_id` BIGINT NOT NULL,
  `target_type` VARCHAR(64) NOT NULL,
  `target_id` BIGINT NULL,
  `business_completeness_score` DECIMAL(6,2) NOT NULL DEFAULT 0.00,
  `architecture_coherence_score` DECIMAL(6,2) NOT NULL DEFAULT 0.00,
  `data_contract_score` DECIMAL(6,2) NOT NULL DEFAULT 0.00,
  `test_alignment_score` DECIMAL(6,2) NOT NULL DEFAULT 0.00,
  `flow_executability_score` DECIMAL(6,2) NOT NULL DEFAULT 0.00,
  `evidence_trust_score` DECIMAL(6,2) NOT NULL DEFAULT 0.00,
  `final_score` DECIMAL(6,2) NOT NULL DEFAULT 0.00,
  `status` VARCHAR(32) NOT NULL DEFAULT 'draft',
  `detail_json` JSON NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_gateway_wiki_semantic_scores_snapshot_id`
    FOREIGN KEY (`snapshot_id`) REFERENCES `gateway_wiki_snapshots`(`id`) ON DELETE CASCADE,
  INDEX `idx_gateway_wiki_semantic_scores_snapshot` (`snapshot_id`, `target_type`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Deep Wiki 语义评分';

CREATE TABLE IF NOT EXISTS `gateway_wiki_feedback_events` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `project_id` BIGINT NOT NULL,
  `snapshot_id` BIGINT NULL,
  `source_pipeline` VARCHAR(64) NOT NULL,
  `feedback_type` VARCHAR(64) NOT NULL,
  `source_ref_id` VARCHAR(255) NULL,
  `payload_json` JSON NULL,
  `evidence_json` JSON NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'accepted',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_gateway_wiki_feedback_events_project_id`
    FOREIGN KEY (`project_id`) REFERENCES `gateway_wiki_projects`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_gateway_wiki_feedback_events_snapshot_id`
    FOREIGN KEY (`snapshot_id`) REFERENCES `gateway_wiki_snapshots`(`id`) ON DELETE SET NULL,
  INDEX `idx_gateway_wiki_feedback_events_project` (`project_id`, `source_pipeline`, `feedback_type`),
  INDEX `idx_gateway_wiki_feedback_events_snapshot` (`snapshot_id`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Deep Wiki 五条管道反馈事件';
