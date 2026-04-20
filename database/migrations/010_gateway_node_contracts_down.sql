ALTER TABLE `gateway_standard_nodes`
  DROP FOREIGN KEY `fk_gateway_standard_nodes_input_schema_id`,
  DROP FOREIGN KEY `fk_gateway_standard_nodes_output_schema_id`,
  DROP FOREIGN KEY `fk_gateway_standard_nodes_skill_package_id`;

ALTER TABLE `gateway_standard_nodes`
  DROP INDEX `idx_gateway_standard_nodes_status`,
  DROP COLUMN `status`,
  DROP COLUMN `skill_package_id`,
  DROP COLUMN `output_schema_id`,
  DROP COLUMN `input_schema_id`,
  DROP COLUMN `acceptance_rule_json`,
  DROP COLUMN `human_checkpoint_json`,
  DROP COLUMN `trace_contract_json`,
  DROP COLUMN `prompt_spec_json`,
  DROP COLUMN `rule_set_json`,
  DROP COLUMN `output_contract_json`,
  DROP COLUMN `input_contract_json`;
