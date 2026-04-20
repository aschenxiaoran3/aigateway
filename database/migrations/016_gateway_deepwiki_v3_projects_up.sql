CREATE TABLE IF NOT EXISTS `gateway_wiki_projects` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `project_code` VARCHAR(128) NOT NULL,
  `project_name` VARCHAR(255) NOT NULL,
  `default_branch` VARCHAR(191) NOT NULL DEFAULT 'main',
  `mission` TEXT NULL,
  `lifecycle_status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `owners_json` JSON NULL,
  `metadata_json` JSON NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `uk_gateway_wiki_projects_code` (`project_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Deep Wiki 项目主数据';

CREATE TABLE IF NOT EXISTS `gateway_wiki_project_repos` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `project_id` BIGINT NOT NULL,
  `repo_source_id` BIGINT NOT NULL,
  `repo_role` VARCHAR(64) NOT NULL DEFAULT 'service',
  `is_primary` TINYINT(1) NOT NULL DEFAULT 0,
  `metadata_json` JSON NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_gateway_wiki_project_repos_project_id`
    FOREIGN KEY (`project_id`) REFERENCES `gateway_wiki_projects`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_gateway_wiki_project_repos_repo_source_id`
    FOREIGN KEY (`repo_source_id`) REFERENCES `gateway_repo_sources`(`id`) ON DELETE CASCADE,
  UNIQUE KEY `uk_gateway_wiki_project_repos` (`project_id`, `repo_source_id`),
  INDEX `idx_gateway_wiki_project_repos_repo_source` (`repo_source_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Deep Wiki 项目与仓库绑定';

CREATE TABLE IF NOT EXISTS `gateway_wiki_snapshots` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `project_id` BIGINT NOT NULL,
  `repo_source_id` BIGINT NOT NULL,
  `repo_snapshot_id` BIGINT NULL,
  `run_id` BIGINT NULL,
  `branch` VARCHAR(191) NOT NULL,
  `commit_sha` VARCHAR(64) NOT NULL,
  `snapshot_version` VARCHAR(191) NOT NULL,
  `publish_status` VARCHAR(32) NOT NULL DEFAULT 'draft',
  `quality_status` VARCHAR(32) NOT NULL DEFAULT 'pending',
  `source_manifest_json` JSON NULL,
  `metadata_json` JSON NULL,
  `published_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_gateway_wiki_snapshots_project_id`
    FOREIGN KEY (`project_id`) REFERENCES `gateway_wiki_projects`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_gateway_wiki_snapshots_repo_source_id`
    FOREIGN KEY (`repo_source_id`) REFERENCES `gateway_repo_sources`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_gateway_wiki_snapshots_repo_snapshot_id`
    FOREIGN KEY (`repo_snapshot_id`) REFERENCES `gateway_repo_snapshots`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_gateway_wiki_snapshots_run_id`
    FOREIGN KEY (`run_id`) REFERENCES `gateway_deepwiki_runs`(`id`) ON DELETE SET NULL,
  UNIQUE KEY `uk_gateway_wiki_snapshots_project_repo_branch_commit` (`project_id`, `repo_source_id`, `branch`, `commit_sha`),
  UNIQUE KEY `uk_gateway_wiki_snapshots_snapshot_version` (`project_id`, `snapshot_version`),
  INDEX `idx_gateway_wiki_snapshots_project_branch` (`project_id`, `branch`),
  INDEX `idx_gateway_wiki_snapshots_run_id` (`run_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Deep Wiki 项目级快照';

CREATE TABLE IF NOT EXISTS `gateway_wiki_generation_jobs` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `project_id` BIGINT NOT NULL,
  `snapshot_id` BIGINT NULL,
  `run_id` BIGINT NULL,
  `job_type` VARCHAR(64) NOT NULL DEFAULT 'deepwiki_generate',
  `status` VARCHAR(32) NOT NULL DEFAULT 'queued',
  `requested_by` VARCHAR(64) NOT NULL DEFAULT 'system',
  `request_json` JSON NULL,
  `result_json` JSON NULL,
  `error_json` JSON NULL,
  `started_at` DATETIME NULL,
  `ended_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_gateway_wiki_generation_jobs_project_id`
    FOREIGN KEY (`project_id`) REFERENCES `gateway_wiki_projects`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_gateway_wiki_generation_jobs_snapshot_id`
    FOREIGN KEY (`snapshot_id`) REFERENCES `gateway_wiki_snapshots`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_gateway_wiki_generation_jobs_run_id`
    FOREIGN KEY (`run_id`) REFERENCES `gateway_deepwiki_runs`(`id`) ON DELETE SET NULL,
  INDEX `idx_gateway_wiki_generation_jobs_project` (`project_id`, `created_at`),
  INDEX `idx_gateway_wiki_generation_jobs_run` (`run_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Deep Wiki 生成任务';

CREATE TABLE IF NOT EXISTS `gateway_wiki_quality_reports` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `project_id` BIGINT NOT NULL,
  `snapshot_id` BIGINT NOT NULL,
  `run_id` BIGINT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'draft',
  `schema_pass_rate` DECIMAL(6,2) NOT NULL DEFAULT 0.00,
  `evidence_coverage_rate` DECIMAL(6,2) NOT NULL DEFAULT 0.00,
  `core_service_coverage_rate` DECIMAL(6,2) NOT NULL DEFAULT 0.00,
  `core_api_contract_rate` DECIMAL(6,2) NOT NULL DEFAULT 0.00,
  `core_table_field_coverage_rate` DECIMAL(6,2) NOT NULL DEFAULT 0.00,
  `relation_connectivity_rate` DECIMAL(6,2) NOT NULL DEFAULT 0.00,
  `quality_json` JSON NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_gateway_wiki_quality_reports_project_id`
    FOREIGN KEY (`project_id`) REFERENCES `gateway_wiki_projects`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_gateway_wiki_quality_reports_snapshot_id`
    FOREIGN KEY (`snapshot_id`) REFERENCES `gateway_wiki_snapshots`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_gateway_wiki_quality_reports_run_id`
    FOREIGN KEY (`run_id`) REFERENCES `gateway_deepwiki_runs`(`id`) ON DELETE SET NULL,
  UNIQUE KEY `uk_gateway_wiki_quality_reports_snapshot_id` (`snapshot_id`),
  INDEX `idx_gateway_wiki_quality_reports_project` (`project_id`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Deep Wiki 质量报告';
