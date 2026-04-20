CREATE TABLE IF NOT EXISTS `gateway_wiki_stage_runs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `snapshot_id` BIGINT UNSIGNED NOT NULL,
  `project_id` BIGINT UNSIGNED NULL,
  `run_id` BIGINT UNSIGNED NULL,
  `stage_key` VARCHAR(128) NOT NULL,
  `sort_order` INT NOT NULL DEFAULT 0,
  `status` VARCHAR(64) NOT NULL DEFAULT 'queued',
  `stage_contract_json` JSON NULL,
  `metadata_json` JSON NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_gateway_wiki_stage_runs_snapshot_stage` (`snapshot_id`, `stage_key`),
  KEY `idx_gateway_wiki_stage_runs_project` (`project_id`, `stage_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `gateway_wiki_skill_executions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `snapshot_id` BIGINT UNSIGNED NOT NULL,
  `project_id` BIGINT UNSIGNED NULL,
  `run_id` BIGINT UNSIGNED NULL,
  `stage_key` VARCHAR(128) NOT NULL,
  `skill_key` VARCHAR(128) NOT NULL,
  `status` VARCHAR(64) NOT NULL DEFAULT 'queued',
  `skill_contract_json` JSON NULL,
  `metadata_json` JSON NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_gateway_wiki_skill_exec_snapshot_skill` (`snapshot_id`, `stage_key`, `skill_key`),
  KEY `idx_gateway_wiki_skill_exec_project` (`project_id`, `stage_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `gateway_wiki_stage_assets` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `snapshot_id` BIGINT UNSIGNED NOT NULL,
  `project_id` BIGINT UNSIGNED NULL,
  `run_id` BIGINT UNSIGNED NULL,
  `stage_key` VARCHAR(128) NOT NULL,
  `asset_key` VARCHAR(191) NOT NULL,
  `schema_version` VARCHAR(32) NULL,
  `payload_json` JSON NOT NULL,
  `metadata_json` JSON NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_gateway_wiki_stage_assets_snapshot_asset` (`snapshot_id`, `stage_key`, `asset_key`),
  KEY `idx_gateway_wiki_stage_assets_project` (`project_id`, `stage_key`, `asset_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `gateway_wiki_gate_decisions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `snapshot_id` BIGINT UNSIGNED NOT NULL,
  `project_id` BIGINT UNSIGNED NULL,
  `run_id` BIGINT UNSIGNED NULL,
  `gate_key` VARCHAR(191) NOT NULL,
  `source_stage_key` VARCHAR(128) NULL,
  `decision_status` VARCHAR(64) NOT NULL DEFAULT 'review',
  `is_blocking` TINYINT(1) NOT NULL DEFAULT 0,
  `decision_json` JSON NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_gateway_wiki_gate_decisions_snapshot_gate` (`snapshot_id`, `gate_key`),
  KEY `idx_gateway_wiki_gate_decisions_project` (`project_id`, `source_stage_key`, `decision_status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `gateway_wiki_autofill_approvals` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `snapshot_id` BIGINT UNSIGNED NOT NULL,
  `project_id` BIGINT UNSIGNED NULL,
  `source_binding_id` BIGINT UNSIGNED NULL,
  `document_type` VARCHAR(64) NULL,
  `approval_status` VARCHAR(64) NOT NULL DEFAULT 'pending',
  `approval_source` VARCHAR(64) NULL,
  `decision_json` JSON NULL,
  `approved_by` VARCHAR(191) NULL,
  `approved_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_gateway_wiki_autofill_approvals_snapshot` (`snapshot_id`, `approval_status`),
  KEY `idx_gateway_wiki_autofill_approvals_project` (`project_id`, `document_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
