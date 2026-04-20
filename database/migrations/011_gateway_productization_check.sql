SELECT CASE
  WHEN EXISTS (
    SELECT 1
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'gateway_test_plan_generation_runs'
      AND COLUMN_NAME = 'ai_draft_artifact_id'
  ) THEN 'ok_gateway_test_plan_generation_runs_dual_track_columns'
  ELSE 'missing_gateway_test_plan_generation_runs_dual_track_columns'
END AS dual_track_test_plan_check;
