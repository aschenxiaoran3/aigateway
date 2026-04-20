UPDATE `gateway_usage_logs`
SET `trace_id` = COALESCE(`trace_id`, `request_id`),
    `request_summary` = COALESCE(`request_summary`, CONCAT('model=', `model`, '; purpose=', COALESCE(`purpose`, 'general'))),
    `response_summary` = COALESCE(`response_summary`, CONCAT('status=', `status`, '; total_tokens=', `total_tokens`)),
    `human_intervention` = COALESCE(`human_intervention`, 0)
WHERE `trace_id` IS NULL
   OR `request_summary` IS NULL
   OR `response_summary` IS NULL;

UPDATE `gateway_gate_rules`
SET `scope` = COALESCE(`scope`, `gate_type`),
    `severity` = COALESCE(`severity`, 'medium'),
    `mode` = COALESCE(`mode`, 'warn'),
    `pipeline_scope` = COALESCE(`pipeline_scope`, 'gate-review')
WHERE `scope` IS NULL
   OR `severity` IS NULL
   OR `mode` IS NULL
   OR `pipeline_scope` IS NULL;

UPDATE `gateway_gate_executions`
SET `execution_meta` = JSON_SET(
      COALESCE(`execution_meta`, JSON_OBJECT()),
      '$.trace_id',
      COALESCE(JSON_UNQUOTE(JSON_EXTRACT(`execution_meta`, '$.trace_id')), `client_run_id`, CONCAT('gate-', `id`)),
      '$.pipeline_id',
      COALESCE(JSON_UNQUOTE(JSON_EXTRACT(`execution_meta`, '$.pipeline_id')), 'gate-review'),
      '$.source',
      COALESCE(JSON_UNQUOTE(JSON_EXTRACT(`execution_meta`, '$.source')), 'legacy-backfill')
    )
WHERE `execution_meta` IS NULL
   OR JSON_EXTRACT(`execution_meta`, '$.trace_id') IS NULL
   OR JSON_EXTRACT(`execution_meta`, '$.pipeline_id') IS NULL
   OR JSON_EXTRACT(`execution_meta`, '$.source') IS NULL;
