ALTER TABLE `gateway_test_plan_generation_runs`
  DROP FOREIGN KEY `fk_gateway_test_plan_generation_runs_ai_draft_artifact_id`;

ALTER TABLE `gateway_test_plan_generation_runs`
  DROP INDEX `idx_gateway_test_plan_generation_runs_generation_mode`,
  DROP COLUMN `generation_summary_json`,
  DROP COLUMN `generation_mode`,
  DROP COLUMN `ai_draft_artifact_id`;
