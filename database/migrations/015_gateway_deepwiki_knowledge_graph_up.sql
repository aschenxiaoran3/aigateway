CREATE TABLE IF NOT EXISTS `gateway_wiki_objects` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `run_id` BIGINT NOT NULL,
  `repo_source_id` BIGINT NOT NULL,
  `snapshot_id` BIGINT NULL,
  `object_type` VARCHAR(64) NOT NULL,
  `object_key` VARCHAR(191) NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `payload_json` JSON NULL,
  `confidence` DECIMAL(6,4) NOT NULL DEFAULT 0.6000,
  `status` VARCHAR(32) NOT NULL DEFAULT 'ready',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_gateway_wiki_objects_run_id`
    FOREIGN KEY (`run_id`) REFERENCES `gateway_deepwiki_runs`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_gateway_wiki_objects_repo_source_id`
    FOREIGN KEY (`repo_source_id`) REFERENCES `gateway_repo_sources`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_gateway_wiki_objects_snapshot_id`
    FOREIGN KEY (`snapshot_id`) REFERENCES `gateway_repo_snapshots`(`id`) ON DELETE SET NULL,
  UNIQUE KEY `uk_gateway_wiki_objects_run_type_key` (`run_id`, `object_type`, `object_key`),
  INDEX `idx_gateway_wiki_objects_repo_object_type` (`repo_source_id`, `object_type`),
  INDEX `idx_gateway_wiki_objects_snapshot` (`snapshot_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Deep Wiki 结构化对象';

CREATE TABLE IF NOT EXISTS `gateway_wiki_evidence` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `run_id` BIGINT NOT NULL,
  `object_id` BIGINT NOT NULL,
  `evidence_type` VARCHAR(64) NOT NULL,
  `source_uri` VARCHAR(1024) NULL,
  `source_ref` VARCHAR(512) NULL,
  `source_commit_sha` VARCHAR(64) NULL,
  `quote_text` TEXT NULL,
  `meta_json` JSON NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_gateway_wiki_evidence_run_id`
    FOREIGN KEY (`run_id`) REFERENCES `gateway_deepwiki_runs`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_gateway_wiki_evidence_object_id`
    FOREIGN KEY (`object_id`) REFERENCES `gateway_wiki_objects`(`id`) ON DELETE CASCADE,
  INDEX `idx_gateway_wiki_evidence_object` (`object_id`),
  INDEX `idx_gateway_wiki_evidence_run` (`run_id`),
  INDEX `idx_gateway_wiki_evidence_source` (`source_uri`(255))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Deep Wiki 证据';

CREATE TABLE IF NOT EXISTS `gateway_wiki_relations` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `run_id` BIGINT NOT NULL,
  `from_object_id` BIGINT NOT NULL,
  `relation_type` VARCHAR(64) NOT NULL,
  `to_object_id` BIGINT NOT NULL,
  `meta_json` JSON NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_gateway_wiki_relations_run_id`
    FOREIGN KEY (`run_id`) REFERENCES `gateway_deepwiki_runs`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_gateway_wiki_relations_from_object_id`
    FOREIGN KEY (`from_object_id`) REFERENCES `gateway_wiki_objects`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_gateway_wiki_relations_to_object_id`
    FOREIGN KEY (`to_object_id`) REFERENCES `gateway_wiki_objects`(`id`) ON DELETE CASCADE,
  UNIQUE KEY `uk_gateway_wiki_relations_run_from_type_to` (`run_id`, `from_object_id`, `relation_type`, `to_object_id`),
  INDEX `idx_gateway_wiki_relations_from` (`from_object_id`),
  INDEX `idx_gateway_wiki_relations_to` (`to_object_id`),
  INDEX `idx_gateway_wiki_relations_type` (`relation_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Deep Wiki 对象关系';
