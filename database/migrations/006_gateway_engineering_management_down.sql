DROP TABLE IF EXISTS `gateway_audit_events`;
DROP TABLE IF EXISTS `gateway_rag_query_logs`;
DROP TABLE IF EXISTS `gateway_knowledge_indexes`;
DROP TABLE IF EXISTS `gateway_knowledge_assets`;
DROP TABLE IF EXISTS `gateway_quality_analysis_reports`;
DROP TABLE IF EXISTS `gateway_efficiency_reports`;
DROP TABLE IF EXISTS `gateway_efficiency_baselines`;
DROP TABLE IF EXISTS `gateway_metric_samples`;
DROP TABLE IF EXISTS `gateway_run_callbacks`;
DROP TABLE IF EXISTS `gateway_approval_tasks`;
DROP TABLE IF EXISTS `gateway_run_nodes`;
DROP TABLE IF EXISTS `gateway_pipeline_runs`;
DROP TABLE IF EXISTS `gateway_runtime_events`;
DROP TABLE IF EXISTS `gateway_gate_rule_bindings`;
DROP TABLE IF EXISTS `gateway_pipeline_nodes`;
DROP TABLE IF EXISTS `gateway_skill_packages`;
DROP TABLE IF EXISTS `gateway_contract_schemas`;
DROP TABLE IF EXISTS `gateway_agent_specs`;
DROP TABLE IF EXISTS `gateway_pipeline_versions`;
DROP TABLE IF EXISTS `gateway_pipeline_definitions`;
DROP TABLE IF EXISTS `gateway_evidence_pack_items`;
DROP TABLE IF EXISTS `gateway_evidence_packs`;
DROP TABLE IF EXISTS `gateway_project_weekly_updates`;
DROP TABLE IF EXISTS `gateway_project_risk_issues`;
DROP TABLE IF EXISTS `gateway_project_milestones`;
DROP TABLE IF EXISTS `gateway_program_projects`;
DROP TABLE IF EXISTS `gateway_waves`;

ALTER TABLE `gateway_gate_rules`
  DROP INDEX `idx_scope`,
  DROP INDEX `idx_mode`,
  DROP COLUMN `pipeline_scope`,
  DROP COLUMN `repo_scope`,
  DROP COLUMN `mode`,
  DROP COLUMN `severity`,
  DROP COLUMN `scope`;

ALTER TABLE `gateway_gate_executions`
  DROP INDEX `idx_client_run_id_created_at`;

ALTER TABLE `gateway_usage_logs`
  DROP INDEX `idx_trace_id`,
  DROP INDEX `idx_pipeline_run_id`,
  DROP INDEX `idx_project_code`,
  DROP COLUMN `human_intervention`,
  DROP COLUMN `fallback_mode`,
  DROP COLUMN `response_summary`,
  DROP COLUMN `request_summary`,
  DROP COLUMN `project_code`,
  DROP COLUMN `skill_package_id`,
  DROP COLUMN `agent_spec_id`,
  DROP COLUMN `run_node_id`,
  DROP COLUMN `pipeline_run_id`,
  DROP COLUMN `trace_id`;
