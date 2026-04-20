CREATE TABLE IF NOT EXISTS `gateway_repo_sources` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `repo_url` VARCHAR(1024) NOT NULL,
  `repo_slug` VARCHAR(128) NOT NULL,
  `default_branch` VARCHAR(255) NULL,
  `auth_mode` VARCHAR(32) NOT NULL DEFAULT 'local_git',
  `status` VARCHAR(16) NOT NULL DEFAULT 'active',
  `metadata_json` JSON NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `uk_gateway_repo_sources_repo_url` (`repo_url`(255)),
  UNIQUE KEY `uk_gateway_repo_sources_repo_slug` (`repo_slug`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Deep Wiki 仓库源';

CREATE TABLE IF NOT EXISTS `gateway_repo_snapshots` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `repo_source_id` BIGINT NOT NULL,
  `branch` VARCHAR(255) NOT NULL,
  `commit_sha` VARCHAR(64) NOT NULL,
  `local_path` VARCHAR(1024) NOT NULL,
  `manifest_json` JSON NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_gateway_repo_snapshots_repo_source_id`
    FOREIGN KEY (`repo_source_id`) REFERENCES `gateway_repo_sources`(`id`) ON DELETE CASCADE,
  UNIQUE KEY `uk_gateway_repo_snapshots_repo_branch_commit` (`repo_source_id`, `branch`, `commit_sha`),
  INDEX `idx_gateway_repo_snapshots_commit_sha` (`commit_sha`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Deep Wiki 仓库快照';

CREATE TABLE IF NOT EXISTS `gateway_deepwiki_runs` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `trace_id` VARCHAR(64) NOT NULL,
  `repo_source_id` BIGINT NOT NULL,
  `snapshot_id` BIGINT NULL,
  `pipeline_run_id` BIGINT NULL,
  `status` VARCHAR(16) NOT NULL DEFAULT 'queued',
  `current_stage` VARCHAR(64) NOT NULL DEFAULT 'preflight',
  `output_root` VARCHAR(1024) NULL,
  `summary_json` JSON NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_gateway_deepwiki_runs_repo_source_id`
    FOREIGN KEY (`repo_source_id`) REFERENCES `gateway_repo_sources`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_gateway_deepwiki_runs_snapshot_id`
    FOREIGN KEY (`snapshot_id`) REFERENCES `gateway_repo_snapshots`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_gateway_deepwiki_runs_pipeline_run_id`
    FOREIGN KEY (`pipeline_run_id`) REFERENCES `gateway_pipeline_runs`(`id`) ON DELETE SET NULL,
  UNIQUE KEY `uk_gateway_deepwiki_runs_trace_id` (`trace_id`),
  INDEX `idx_gateway_deepwiki_runs_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Deep Wiki 生成任务';

CREATE TABLE IF NOT EXISTS `gateway_deepwiki_pages` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `run_id` BIGINT NOT NULL,
  `page_slug` VARCHAR(255) NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `page_type` VARCHAR(64) NOT NULL,
  `source_uri` VARCHAR(1024) NOT NULL,
  `knowledge_asset_id` BIGINT NULL,
  `ingest_status` VARCHAR(16) NOT NULL DEFAULT 'pending',
  `metadata_json` JSON NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_gateway_deepwiki_pages_run_id`
    FOREIGN KEY (`run_id`) REFERENCES `gateway_deepwiki_runs`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_gateway_deepwiki_pages_knowledge_asset_id`
    FOREIGN KEY (`knowledge_asset_id`) REFERENCES `gateway_knowledge_assets`(`id`) ON DELETE SET NULL,
  UNIQUE KEY `uk_gateway_deepwiki_pages_run_slug` (`run_id`, `page_slug`),
  INDEX `idx_gateway_deepwiki_pages_ingest_status` (`ingest_status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Deep Wiki 页面';
