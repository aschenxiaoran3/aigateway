SELECT TABLE_NAME
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN (
    'gateway_doc_bundles',
    'gateway_doc_artifacts',
    'gateway_doc_artifact_links',
    'gateway_doc_gate_executions',
    'gateway_coverage_graph_runs',
    'gateway_test_plan_generation_runs'
  )
ORDER BY TABLE_NAME;
