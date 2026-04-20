ALTER TABLE `gateway_test_plan_generation_runs`
  ADD COLUMN `ai_draft_artifact_id` BIGINT NULL AFTER `draft_artifact_id`,
  ADD COLUMN `generation_mode` VARCHAR(32) NOT NULL DEFAULT 'dual_track' AFTER `gate_execution_id`,
  ADD COLUMN `generation_summary_json` JSON NULL AFTER `generation_mode`,
  ADD CONSTRAINT `fk_gateway_test_plan_generation_runs_ai_draft_artifact_id`
    FOREIGN KEY (`ai_draft_artifact_id`) REFERENCES `gateway_doc_artifacts`(`id`) ON DELETE SET NULL;

ALTER TABLE `gateway_test_plan_generation_runs`
  ADD INDEX `idx_gateway_test_plan_generation_runs_generation_mode` (`generation_mode`);
