SELECT COLUMN_NAME
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'gateway_usage_logs'
  AND COLUMN_NAME IN (
    'trace_id',
    'pipeline_run_id',
    'run_node_id',
    'agent_spec_id',
    'skill_package_id',
    'project_code',
    'request_summary',
    'response_summary',
    'fallback_mode',
    'human_intervention'
  );

SELECT COLUMN_NAME
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'gateway_gate_rules'
  AND COLUMN_NAME IN ('scope', 'severity', 'mode', 'repo_scope', 'pipeline_scope');

SELECT TABLE_NAME
FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN (
    'gateway_waves',
    'gateway_program_projects',
    'gateway_pipeline_definitions',
    'gateway_pipeline_runs',
    'gateway_evidence_packs',
    'gateway_audit_events'
  );
