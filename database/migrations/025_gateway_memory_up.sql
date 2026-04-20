CREATE TABLE IF NOT EXISTS `gateway_memory_policies` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `scope_type` VARCHAR(64) NOT NULL,
  `scope_id` VARCHAR(191) NOT NULL,
  `enabled` TINYINT(1) NOT NULL DEFAULT 0,
  `capture_mode` VARCHAR(64) NOT NULL DEFAULT 'hybrid',
  `fact_extraction` TINYINT(1) NOT NULL DEFAULT 1,
  `retention_days` INT NOT NULL DEFAULT 365,
  `redaction_mode` VARCHAR(64) NOT NULL DEFAULT 'mask',
  `max_recall_tokens` INT NOT NULL DEFAULT 800,
  `metadata_json` JSON NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_gateway_memory_policies_scope` (`scope_type`, `scope_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `gateway_memory_threads` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `scope_key` VARCHAR(191) NOT NULL,
  `thread_key` VARCHAR(191) NOT NULL,
  `source_system` VARCHAR(64) NOT NULL DEFAULT 'gateway',
  `client_app` VARCHAR(64) NULL,
  `project_code` VARCHAR(64) NULL,
  `title` VARCHAR(255) NULL,
  `summary_text` TEXT NULL,
  `last_message_at` DATETIME NULL,
  `metadata_json` JSON NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_gateway_memory_threads` (`scope_key`, `thread_key`),
  KEY `idx_gateway_memory_threads_project` (`project_code`, `updated_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `gateway_memory_turns` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `thread_id` BIGINT NULL,
  `source_system` VARCHAR(64) NOT NULL DEFAULT 'gateway',
  `client_app` VARCHAR(64) NULL,
  `scope_key` VARCHAR(191) NOT NULL,
  `thread_key` VARCHAR(191) NOT NULL,
  `trace_id` VARCHAR(128) NULL,
  `project_code` VARCHAR(64) NULL,
  `room_key` VARCHAR(64) NULL,
  `hall_key` VARCHAR(64) NULL,
  `role` VARCHAR(32) NOT NULL,
  `content_text_redacted` MEDIUMTEXT NULL,
  `content_text_raw_cipher` MEDIUMTEXT NULL,
  `summary_text` TEXT NULL,
  `importance_score` DECIMAL(6, 3) NULL,
  `embedding_collection` VARCHAR(128) NULL,
  `embedding_doc_id` VARCHAR(128) NULL,
  `metadata_json` JSON NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_gateway_memory_turns_scope_thread` (`scope_key`, `thread_key`, `created_at`),
  KEY `idx_gateway_memory_turns_trace` (`trace_id`),
  KEY `idx_gateway_memory_turns_project` (`project_code`, `created_at`),
  CONSTRAINT `fk_gateway_memory_turns_thread`
    FOREIGN KEY (`thread_id`) REFERENCES `gateway_memory_threads` (`id`)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `gateway_memory_facts` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `scope_key` VARCHAR(191) NOT NULL,
  `thread_key` VARCHAR(191) NULL,
  `source_turn_id` BIGINT NULL,
  `fact_type` VARCHAR(64) NOT NULL DEFAULT 'fact',
  `subject_text` VARCHAR(255) NOT NULL,
  `predicate_text` VARCHAR(191) NOT NULL,
  `object_text` TEXT NULL,
  `confidence` DECIMAL(6, 3) NULL,
  `valid_from` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `valid_to` DATETIME NULL,
  `supersedes_turn_id` BIGINT NULL,
  `metadata_json` JSON NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_gateway_memory_facts_scope` (`scope_key`, `subject_text`, `predicate_text`, `valid_to`),
  KEY `idx_gateway_memory_facts_thread` (`thread_key`),
  CONSTRAINT `fk_gateway_memory_facts_turn`
    FOREIGN KEY (`source_turn_id`) REFERENCES `gateway_memory_turns` (`id`)
    ON DELETE SET NULL,
  CONSTRAINT `fk_gateway_memory_facts_supersedes`
    FOREIGN KEY (`supersedes_turn_id`) REFERENCES `gateway_memory_turns` (`id`)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `gateway_memory_recalls` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `trace_id` VARCHAR(128) NULL,
  `scope_key` VARCHAR(191) NOT NULL,
  `thread_key` VARCHAR(191) NULL,
  `source_system` VARCHAR(64) NOT NULL DEFAULT 'gateway',
  `client_app` VARCHAR(64) NULL,
  `query_text` TEXT NULL,
  `recall_text` MEDIUMTEXT NULL,
  `recalled_turn_ids_json` JSON NULL,
  `recalled_fact_ids_json` JSON NULL,
  `token_count` INT NOT NULL DEFAULT 0,
  `latency_ms` INT NOT NULL DEFAULT 0,
  `status` VARCHAR(32) NOT NULL DEFAULT 'success',
  `failure_reason` VARCHAR(255) NULL,
  `metadata_json` JSON NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_gateway_memory_recalls_trace` (`trace_id`, `created_at`),
  KEY `idx_gateway_memory_recalls_scope` (`scope_key`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
