DROP TABLE IF EXISTS `gateway_standard_nodes`;

ALTER TABLE `gateway_rag_query_logs` DROP INDEX `idx_gateway_rag_query_logs_project_code`, DROP COLUMN `project_code`;

ALTER TABLE `gateway_knowledge_assets`
  DROP INDEX `idx_gateway_knowledge_assets_category`,
  DROP COLUMN `owner`,
  DROP COLUMN `version`,
  DROP COLUMN `module`,
  DROP COLUMN `domain`,
  DROP COLUMN `asset_category`;

ALTER TABLE `gateway_doc_gate_executions`
  DROP INDEX `idx_gateway_doc_gate_executions_trace_id`,
  DROP COLUMN `node_key`,
  DROP COLUMN `trace_id`;

ALTER TABLE `gateway_doc_bundles`
  DROP INDEX `idx_gateway_doc_bundles_project_code`,
  DROP INDEX `idx_gateway_doc_bundles_trace_id`,
  DROP COLUMN `project_code`,
  DROP COLUMN `trace_id`;
