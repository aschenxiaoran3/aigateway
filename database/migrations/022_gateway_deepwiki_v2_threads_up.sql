CREATE TABLE IF NOT EXISTS `gateway_wiki_threads` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `snapshot_id` BIGINT NOT NULL,
  `thread_key` VARCHAR(191) NOT NULL,
  `parent_thread_key` VARCHAR(191) NULL,
  `thread_level` VARCHAR(64) NOT NULL,
  `domain_key` VARCHAR(191) NULL,
  `title` VARCHAR(255) NOT NULL,
  `summary_markdown` MEDIUMTEXT NULL,
  `entry_points_json` JSON NULL,
  `steps_json` JSON NULL,
  `branch_points_json` JSON NULL,
  `object_keys_json` JSON NULL,
  `repo_roles_json` JSON NULL,
  `evidence_json` JSON NULL,
  `metrics_json` JSON NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_gateway_wiki_threads_snapshot_id`
    FOREIGN KEY (`snapshot_id`) REFERENCES `gateway_wiki_snapshots`(`id`) ON DELETE CASCADE,
  UNIQUE KEY `uk_gateway_wiki_threads_snapshot_key` (`snapshot_id`, `thread_key`),
  INDEX `idx_gateway_wiki_threads_scope` (`snapshot_id`, `thread_level`, `domain_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Deep Wiki 业务线程';

ALTER TABLE `gateway_wiki_snapshot_diagrams`
  ADD COLUMN `diagram_key` VARCHAR(191) NULL AFTER `diagram_type`,
  ADD COLUMN `scope_type` VARCHAR(32) NOT NULL DEFAULT 'project' AFTER `diagram_key`,
  ADD COLUMN `scope_key` VARCHAR(191) NULL AFTER `scope_type`,
  ADD COLUMN `parent_scope_key` VARCHAR(191) NULL AFTER `scope_key`,
  ADD COLUMN `sort_order` INT NOT NULL DEFAULT 0 AFTER `parent_scope_key`;

UPDATE `gateway_wiki_snapshot_diagrams`
SET `diagram_key` = COALESCE(NULLIF(`diagram_key`, ''), CONCAT('project/', REPLACE(`diagram_type`, '_', '-'))),
    `scope_type` = COALESCE(NULLIF(`scope_type`, ''), 'project'),
    `scope_key` = COALESCE(NULLIF(`scope_key`, ''), 'project'),
    `sort_order` = COALESCE(`sort_order`, 0)
WHERE `diagram_key` IS NULL OR `diagram_key` = '';

ALTER TABLE `gateway_wiki_snapshot_diagrams`
  DROP INDEX `uk_gateway_wiki_snapshot_diagrams_type`;

ALTER TABLE `gateway_wiki_snapshot_diagrams`
  MODIFY COLUMN `diagram_key` VARCHAR(191) NOT NULL,
  ADD UNIQUE KEY `uk_gateway_wiki_snapshot_diagrams_key` (`snapshot_id`, `diagram_key`),
  ADD INDEX `idx_gateway_wiki_snapshot_diagrams_scope` (`snapshot_id`, `scope_type`, `scope_key`, `sort_order`);
