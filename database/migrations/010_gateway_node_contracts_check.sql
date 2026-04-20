SELECT CASE
  WHEN EXISTS (
    SELECT 1
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'gateway_standard_nodes'
      AND COLUMN_NAME = 'input_contract_json'
  ) THEN 'ok_gateway_standard_nodes_contract_columns'
  ELSE 'missing_gateway_standard_nodes_contract_columns'
END AS migration_check;

SELECT CASE
  WHEN EXISTS (
    SELECT 1
    FROM gateway_contract_schemas
    WHERE schema_key = 'doc_gate_output' AND version = '1.0.0'
  ) THEN 'ok_doc_gate_output_schema_seed'
  ELSE 'missing_doc_gate_output_schema_seed'
END AS schema_seed_check;

SELECT CASE
  WHEN EXISTS (
    SELECT 1
    FROM gateway_skill_packages
    WHERE skill_key = 'test_plan_gate_review' AND version = '1.0.0'
  ) THEN 'ok_test_plan_gate_review_skill_seed'
  ELSE 'missing_test_plan_gate_review_skill_seed'
END AS skill_seed_check;
