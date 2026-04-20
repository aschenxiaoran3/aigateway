SET @db = DATABASE();

SET @add_snapshot_status = (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = @db
    AND table_name = 'gateway_wiki_snapshots'
    AND column_name = 'status'
);
SET @sql = IF(
  @add_snapshot_status = 0,
  'ALTER TABLE `gateway_wiki_snapshots` ADD COLUMN `status` VARCHAR(32) NOT NULL DEFAULT ''queued'' AFTER `snapshot_version`',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @add_publish_ready = (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = @db
    AND table_name = 'gateway_wiki_snapshots'
    AND column_name = 'publish_ready'
);
SET @sql = IF(
  @add_publish_ready = 0,
  'ALTER TABLE `gateway_wiki_snapshots` ADD COLUMN `publish_ready` TINYINT(1) NOT NULL DEFAULT 0 AFTER `status`',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @add_quality_gate_blocked = (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = @db
    AND table_name = 'gateway_wiki_snapshots'
    AND column_name = 'quality_gate_blocked'
);
SET @sql = IF(
  @add_quality_gate_blocked = 0,
  'ALTER TABLE `gateway_wiki_snapshots` ADD COLUMN `quality_gate_blocked` TINYINT(1) NOT NULL DEFAULT 0 AFTER `publish_ready`',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @add_snapshot_approval_status = (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = @db
    AND table_name = 'gateway_wiki_snapshots'
    AND column_name = 'approval_status'
);
SET @sql = IF(
  @add_snapshot_approval_status = 0,
  'ALTER TABLE `gateway_wiki_snapshots` ADD COLUMN `approval_status` VARCHAR(32) NOT NULL DEFAULT ''pending'' AFTER `quality_gate_blocked`',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @add_source_snapshot_id = (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = @db
    AND table_name = 'gateway_wiki_snapshots'
    AND column_name = 'source_snapshot_id'
);
SET @sql = IF(
  @add_source_snapshot_id = 0,
  'ALTER TABLE `gateway_wiki_snapshots` ADD COLUMN `source_snapshot_id` BIGINT NULL AFTER `approval_status`',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @add_lineage_json = (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = @db
    AND table_name = 'gateway_wiki_snapshots'
    AND column_name = 'lineage_json'
);
SET @sql = IF(
  @add_lineage_json = 0,
  'ALTER TABLE `gateway_wiki_snapshots` ADD COLUMN `lineage_json` JSON NULL AFTER `source_snapshot_id`',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @add_fk_source_snapshot = (
  SELECT COUNT(*)
  FROM information_schema.key_column_usage
  WHERE table_schema = @db
    AND table_name = 'gateway_wiki_snapshots'
    AND constraint_name = 'fk_gateway_wiki_snapshots_source_snapshot_id'
);
SET @sql = IF(
  @add_fk_source_snapshot = 0,
  'ALTER TABLE `gateway_wiki_snapshots` ADD CONSTRAINT `fk_gateway_wiki_snapshots_source_snapshot_id`
     FOREIGN KEY (`source_snapshot_id`) REFERENCES `gateway_wiki_snapshots`(`id`) ON DELETE SET NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @add_snapshot_status_idx = (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = @db
    AND table_name = 'gateway_wiki_snapshots'
    AND index_name = 'idx_gateway_wiki_snapshots_project_status'
);
SET @sql = IF(
  @add_snapshot_status_idx = 0,
  'ALTER TABLE `gateway_wiki_snapshots` ADD INDEX `idx_gateway_wiki_snapshots_project_status` (`project_id`, `status`, `published_at`)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @add_scope_type = (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = @db
    AND table_name = 'gateway_wiki_gate_decisions'
    AND column_name = 'scope_type'
);
SET @sql = IF(
  @add_scope_type = 0,
  'ALTER TABLE `gateway_wiki_gate_decisions` ADD COLUMN `scope_type` VARCHAR(64) NOT NULL DEFAULT ''snapshot'' AFTER `gate_key`',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @add_scope_key = (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = @db
    AND table_name = 'gateway_wiki_gate_decisions'
    AND column_name = 'scope_key'
);
SET @sql = IF(
  @add_scope_key = 0,
  'ALTER TABLE `gateway_wiki_gate_decisions` ADD COLUMN `scope_key` VARCHAR(191) NOT NULL DEFAULT ''__snapshot__'' AFTER `scope_type`',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @add_source_type = (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = @db
    AND table_name = 'gateway_wiki_gate_decisions'
    AND column_name = 'source_type'
);
SET @sql = IF(
  @add_source_type = 0,
  'ALTER TABLE `gateway_wiki_gate_decisions` ADD COLUMN `source_type` VARCHAR(64) NOT NULL DEFAULT ''stage'' AFTER `scope_key`',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @add_source_ref = (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = @db
    AND table_name = 'gateway_wiki_gate_decisions'
    AND column_name = 'source_ref'
);
SET @sql = IF(
  @add_source_ref = 0,
  'ALTER TABLE `gateway_wiki_gate_decisions` ADD COLUMN `source_ref` VARCHAR(191) NOT NULL DEFAULT '''' AFTER `source_type`',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @add_reason = (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = @db
    AND table_name = 'gateway_wiki_gate_decisions'
    AND column_name = 'reason'
);
SET @sql = IF(
  @add_reason = 0,
  'ALTER TABLE `gateway_wiki_gate_decisions` ADD COLUMN `reason` VARCHAR(255) NULL AFTER `is_blocking`',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @add_detail_json = (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = @db
    AND table_name = 'gateway_wiki_gate_decisions'
    AND column_name = 'detail_json'
);
SET @sql = IF(
  @add_detail_json = 0,
  'ALTER TABLE `gateway_wiki_gate_decisions` ADD COLUMN `detail_json` JSON NULL AFTER `decision_json`',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @drop_gate_unique = (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = @db
    AND table_name = 'gateway_wiki_gate_decisions'
    AND index_name = 'uk_gateway_wiki_gate_decisions_snapshot_gate'
);
SET @sql = IF(
  @drop_gate_unique > 0,
  'ALTER TABLE `gateway_wiki_gate_decisions` DROP INDEX `uk_gateway_wiki_gate_decisions_snapshot_gate`',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @add_gate_unique = (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = @db
    AND table_name = 'gateway_wiki_gate_decisions'
    AND index_name = 'uk_gateway_wiki_gate_decisions_snapshot_scope_source'
);
SET @sql = IF(
  @add_gate_unique = 0,
  'ALTER TABLE `gateway_wiki_gate_decisions`
     ADD UNIQUE KEY `uk_gateway_wiki_gate_decisions_snapshot_scope_source`
     (`snapshot_id`, `gate_key`, `scope_type`, `scope_key`, `source_type`, `source_ref`)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @drop_gate_project_idx = (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = @db
    AND table_name = 'gateway_wiki_gate_decisions'
    AND index_name = 'idx_gateway_wiki_gate_decisions_project'
);
SET @sql = IF(
  @drop_gate_project_idx > 0,
  'ALTER TABLE `gateway_wiki_gate_decisions` DROP INDEX `idx_gateway_wiki_gate_decisions_project`',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @add_gate_project_idx = (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = @db
    AND table_name = 'gateway_wiki_gate_decisions'
    AND index_name = 'idx_gateway_wiki_gate_decisions_project_scope'
);
SET @sql = IF(
  @add_gate_project_idx = 0,
  'ALTER TABLE `gateway_wiki_gate_decisions`
     ADD KEY `idx_gateway_wiki_gate_decisions_project_scope`
     (`project_id`, `scope_type`, `scope_key`, `source_stage_key`, `decision_status`)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
