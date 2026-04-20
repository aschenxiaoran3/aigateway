CREATE TABLE IF NOT EXISTS `gateway_wiki_score_runs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `snapshot_id` BIGINT UNSIGNED NOT NULL,
  `project_id` BIGINT UNSIGNED NULL,
  `run_id` BIGINT UNSIGNED NULL,
  `scorer_key` VARCHAR(128) NOT NULL DEFAULT 'knowledge_scoring_engine',
  `status` VARCHAR(64) NOT NULL DEFAULT 'completed',
  `summary_json` JSON NULL,
  `metadata_json` JSON NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_gateway_wiki_score_runs_snapshot_scorer` (`snapshot_id`, `scorer_key`),
  KEY `idx_gateway_wiki_score_runs_project` (`project_id`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `gateway_wiki_score_records` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `score_run_id` BIGINT UNSIGNED NOT NULL,
  `snapshot_id` BIGINT UNSIGNED NOT NULL,
  `project_id` BIGINT UNSIGNED NULL,
  `score_group` VARCHAR(128) NOT NULL,
  `entity_type` VARCHAR(64) NOT NULL,
  `entity_id` VARCHAR(191) NOT NULL,
  `score_id` VARCHAR(255) NULL,
  `overall_score` DECIMAL(10,4) NOT NULL DEFAULT 0,
  `dimensions_json` JSON NULL,
  `penalties_json` JSON NULL,
  `grader_versions_json` JSON NULL,
  `explanations_json` JSON NULL,
  `metadata_json` JSON NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_gateway_wiki_score_records_run_entity` (`score_run_id`, `score_group`, `entity_type`, `entity_id`),
  KEY `idx_gateway_wiki_score_records_snapshot` (`snapshot_id`, `score_group`, `entity_type`),
  KEY `idx_gateway_wiki_score_records_project` (`project_id`, `score_group`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `gateway_wiki_score_breakdowns` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `score_run_id` BIGINT UNSIGNED NOT NULL,
  `snapshot_id` BIGINT UNSIGNED NOT NULL,
  `project_id` BIGINT UNSIGNED NULL,
  `breakdown_key` VARCHAR(191) NOT NULL,
  `payload_json` JSON NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_gateway_wiki_score_breakdowns_run_key` (`score_run_id`, `breakdown_key`),
  KEY `idx_gateway_wiki_score_breakdowns_snapshot` (`snapshot_id`, `breakdown_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `gateway_wiki_score_regressions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `score_run_id` BIGINT UNSIGNED NOT NULL,
  `snapshot_id` BIGINT UNSIGNED NOT NULL,
  `project_id` BIGINT UNSIGNED NULL,
  `regression_key` VARCHAR(191) NOT NULL,
  `payload_json` JSON NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_gateway_wiki_score_regressions_run_key` (`score_run_id`, `regression_key`),
  KEY `idx_gateway_wiki_score_regressions_snapshot` (`snapshot_id`, `regression_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `gateway_wiki_ranking_views` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `score_run_id` BIGINT UNSIGNED NOT NULL,
  `snapshot_id` BIGINT UNSIGNED NOT NULL,
  `project_id` BIGINT UNSIGNED NULL,
  `view_key` VARCHAR(191) NOT NULL,
  `payload_json` JSON NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_gateway_wiki_ranking_views_run_key` (`score_run_id`, `view_key`),
  KEY `idx_gateway_wiki_ranking_views_snapshot` (`snapshot_id`, `view_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `gateway_wiki_health_indices` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `score_run_id` BIGINT UNSIGNED NOT NULL,
  `snapshot_id` BIGINT UNSIGNED NOT NULL,
  `project_id` BIGINT UNSIGNED NULL,
  `health_key` VARCHAR(191) NOT NULL,
  `health_level` VARCHAR(32) NULL,
  `numeric_value` DECIMAL(10,4) NULL,
  `payload_json` JSON NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_gateway_wiki_health_indices_run_key` (`score_run_id`, `health_key`),
  KEY `idx_gateway_wiki_health_indices_snapshot` (`snapshot_id`, `health_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `gateway_wiki_grader_versions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `score_run_id` BIGINT UNSIGNED NOT NULL,
  `snapshot_id` BIGINT UNSIGNED NOT NULL,
  `project_id` BIGINT UNSIGNED NULL,
  `grader_key` VARCHAR(191) NOT NULL,
  `version_label` VARCHAR(64) NOT NULL,
  `metadata_json` JSON NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_gateway_wiki_grader_versions_run_key` (`score_run_id`, `grader_key`),
  KEY `idx_gateway_wiki_grader_versions_snapshot` (`snapshot_id`, `grader_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
