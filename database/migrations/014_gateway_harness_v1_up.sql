CREATE TABLE IF NOT EXISTS `gateway_harness_cards` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `card_code` VARCHAR(64) NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `card_type` VARCHAR(32) NOT NULL DEFAULT '需求',
  `priority` VARCHAR(32) NOT NULL DEFAULT '中优先',
  `stage_key` VARCHAR(64) NOT NULL DEFAULT 'demand_confirm_wait',
  `sub_status` VARCHAR(64) NULL,
  `trace_id` VARCHAR(64) NOT NULL,
  `repo_url` VARCHAR(1024) NULL,
  `repo_slug` VARCHAR(255) NULL,
  `repo_branch` VARCHAR(255) NULL,
  `deepwiki_run_id` BIGINT NULL,
  `bundle_id` BIGINT NULL,
  `summary_text` TEXT NULL,
  `latest_ai_action` VARCHAR(255) NULL,
  `latest_human_action` VARCHAR(255) NULL,
  `blocked_reason` VARCHAR(255) NULL,
  `metadata_json` JSON NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `uk_gateway_harness_cards_card_code` (`card_code`),
  UNIQUE KEY `uk_gateway_harness_cards_trace_id` (`trace_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Harness 卡片主表';

CREATE TABLE IF NOT EXISTS `gateway_harness_card_stages` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `card_id` BIGINT NOT NULL,
  `stage_key` VARCHAR(64) NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'pending',
  `metadata_json` JSON NULL,
  `started_at` DATETIME NULL,
  `ended_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_gateway_harness_card_stages_card` (`card_id`),
  INDEX `idx_gateway_harness_card_stages_stage` (`stage_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Harness 阶段历史';

CREATE TABLE IF NOT EXISTS `gateway_harness_messages` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `card_id` BIGINT NOT NULL,
  `tab_key` VARCHAR(32) NOT NULL,
  `actor` VARCHAR(32) NOT NULL,
  `content_text` TEXT NOT NULL,
  `status` VARCHAR(32) NULL,
  `stage_key` VARCHAR(64) NULL,
  `metadata_json` JSON NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_gateway_harness_messages_card` (`card_id`),
  INDEX `idx_gateway_harness_messages_tab` (`tab_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Harness 阶段对话';

CREATE TABLE IF NOT EXISTS `gateway_harness_logs` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `card_id` BIGINT NOT NULL,
  `runtime_run_id` BIGINT NULL,
  `stage_key` VARCHAR(64) NULL,
  `log_level` VARCHAR(16) NOT NULL DEFAULT 'info',
  `content_text` TEXT NOT NULL,
  `metadata_json` JSON NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_gateway_harness_logs_card` (`card_id`),
  INDEX `idx_gateway_harness_logs_runtime` (`runtime_run_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Harness 运行日志';

CREATE TABLE IF NOT EXISTS `gateway_harness_human_checkpoints` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `card_id` BIGINT NOT NULL,
  `checkpoint_type` VARCHAR(64) NOT NULL,
  `stage_key` VARCHAR(64) NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'waiting',
  `resume_token` VARCHAR(128) NOT NULL,
  `payload_json` JSON NULL,
  `expires_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_gateway_harness_checkpoints_card` (`card_id`),
  INDEX `idx_gateway_harness_checkpoints_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Harness 人工确认点';

CREATE TABLE IF NOT EXISTS `gateway_harness_summaries` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `card_id` BIGINT NOT NULL,
  `runtime_run_id` BIGINT NULL,
  `title` VARCHAR(255) NOT NULL,
  `content_text` MEDIUMTEXT NOT NULL,
  `summary_type` VARCHAR(64) NOT NULL DEFAULT 'change_summary',
  `metadata_json` JSON NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_gateway_harness_summaries_card` (`card_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Harness 阶段总结';

CREATE TABLE IF NOT EXISTS `gateway_harness_runtime_runs` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `card_id` BIGINT NOT NULL,
  `trace_id` VARCHAR(64) NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'queued',
  `repo_key` VARCHAR(255) NULL,
  `repo_url` VARCHAR(1024) NULL,
  `repo_branch` VARCHAR(255) NULL,
  `workspace_path` VARCHAR(1024) NULL,
  `commit_sha_before` VARCHAR(64) NULL,
  `commit_sha_after` VARCHAR(64) NULL,
  `test_command` VARCHAR(255) NULL,
  `test_result` VARCHAR(32) NULL,
  `retry_count` INT NOT NULL DEFAULT 0,
  `logs_json` JSON NULL,
  `summary_artifact_id` BIGINT NULL,
  `metadata_json` JSON NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `uk_gateway_harness_runtime_runs_trace_id` (`trace_id`),
  INDEX `idx_gateway_harness_runtime_runs_card` (`card_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Harness Runtime 运行记录';
