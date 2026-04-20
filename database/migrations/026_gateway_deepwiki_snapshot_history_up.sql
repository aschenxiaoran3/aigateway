SET @db = DATABASE();

SET @drop_commit_unique = (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = @db
    AND table_name = 'gateway_wiki_snapshots'
    AND index_name = 'uk_gateway_wiki_snapshots_project_repo_branch_commit'
);
SET @sql = IF(
  @drop_commit_unique > 0,
  'ALTER TABLE `gateway_wiki_snapshots` DROP INDEX `uk_gateway_wiki_snapshots_project_repo_branch_commit`',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @drop_version_unique = (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = @db
    AND table_name = 'gateway_wiki_snapshots'
    AND index_name = 'uk_gateway_wiki_snapshots_snapshot_version'
);
SET @sql = IF(
  @drop_version_unique > 0,
  'ALTER TABLE `gateway_wiki_snapshots` DROP INDEX `uk_gateway_wiki_snapshots_snapshot_version`',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @add_commit_index = (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = @db
    AND table_name = 'gateway_wiki_snapshots'
    AND index_name = 'idx_gateway_wiki_snapshots_project_repo_branch_commit'
);
SET @sql = IF(
  @add_commit_index = 0,
  'ALTER TABLE `gateway_wiki_snapshots` ADD INDEX `idx_gateway_wiki_snapshots_project_repo_branch_commit` (`project_id`, `repo_source_id`, `branch`, `commit_sha`)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @add_version_index = (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = @db
    AND table_name = 'gateway_wiki_snapshots'
    AND index_name = 'idx_gateway_wiki_snapshots_project_snapshot_version'
);
SET @sql = IF(
  @add_version_index = 0,
  'ALTER TABLE `gateway_wiki_snapshots` ADD INDEX `idx_gateway_wiki_snapshots_project_snapshot_version` (`project_id`, `snapshot_version`)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
