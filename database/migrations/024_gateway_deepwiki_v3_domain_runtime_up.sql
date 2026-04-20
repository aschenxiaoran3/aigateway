ALTER TABLE `gateway_wiki_threads`
  ADD COLUMN `domain_context_key` VARCHAR(191) NULL AFTER `domain_key`,
  ADD COLUMN `behavior_key` VARCHAR(191) NULL AFTER `domain_context_key`,
  ADD COLUMN `command_keys_json` JSON NULL AFTER `branch_points_json`,
  ADD COLUMN `event_keys_json` JSON NULL AFTER `command_keys_json`;

ALTER TABLE `gateway_wiki_threads`
  ADD INDEX `idx_gateway_wiki_threads_domain_behavior` (`snapshot_id`, `domain_context_key`, `behavior_key`);

