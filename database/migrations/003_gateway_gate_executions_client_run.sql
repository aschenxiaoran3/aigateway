-- 门禁执行记录：幂等键与扩展元数据（与 ai-gateway POST /gates/executions 对齐）
ALTER TABLE `gateway_gate_executions`
  ADD COLUMN `client_run_id` VARCHAR(64) NULL COMMENT '客户端幂等键' AFTER `check_results`,
  ADD COLUMN `execution_meta` JSON NULL COMMENT 'rule_id/rule_version/artifact_fingerprint/source/duration_ms/trace_id' AFTER `client_run_id`;

ALTER TABLE `gateway_gate_executions`
  ADD UNIQUE KEY `uk_client_run_id` (`client_run_id`);
