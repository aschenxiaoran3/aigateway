CREATE TABLE IF NOT EXISTS `gateway_wiki_community_reports` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `snapshot_id` BIGINT NOT NULL,
  `community_key` VARCHAR(191) NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `summary_markdown` MEDIUMTEXT NULL,
  `object_ids_json` JSON NULL,
  `page_slugs_json` JSON NULL,
  `community_score` DECIMAL(8,4) NOT NULL DEFAULT 0.0000,
  `metadata_json` JSON NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_gateway_wiki_community_reports_snapshot_id`
    FOREIGN KEY (`snapshot_id`) REFERENCES `gateway_wiki_snapshots`(`id`) ON DELETE CASCADE,
  UNIQUE KEY `uk_gateway_wiki_community_reports_snapshot_key` (`snapshot_id`, `community_key`),
  INDEX `idx_gateway_wiki_community_reports_snapshot` (`snapshot_id`, `community_score`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Deep Wiki 社区摘要报告';

CREATE TABLE IF NOT EXISTS `gateway_wiki_query_logs` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `project_id` BIGINT NULL,
  `snapshot_id` BIGINT NOT NULL,
  `run_id` BIGINT NULL,
  `query_text` TEXT NOT NULL,
  `query_mode` VARCHAR(32) NOT NULL DEFAULT 'auto',
  `resolved_mode` VARCHAR(32) NOT NULL DEFAULT 'local',
  `status` VARCHAR(32) NOT NULL DEFAULT 'completed',
  `answer_text` MEDIUMTEXT NULL,
  `citations_json` JSON NULL,
  `trace_json` JSON NULL,
  `provider` VARCHAR(64) NULL,
  `model` VARCHAR(128) NULL,
  `latency_ms` INT NULL,
  `metadata_json` JSON NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_gateway_wiki_query_logs_snapshot_id`
    FOREIGN KEY (`snapshot_id`) REFERENCES `gateway_wiki_snapshots`(`id`) ON DELETE CASCADE,
  INDEX `idx_gateway_wiki_query_logs_snapshot` (`snapshot_id`, `resolved_mode`, `created_at`),
  INDEX `idx_gateway_wiki_query_logs_project` (`project_id`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Deep Wiki 智能检索查询日志';
