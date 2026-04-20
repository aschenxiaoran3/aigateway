INSERT INTO `gateway_skill_packages`
  (`skill_key`, `name`, `version`, `env_tags`, `input_decl`, `output_decl`, `prompt_ref`, `tool_refs`, `status`)
VALUES
  ('deepwiki_diagram_synthesis', 'Deep Wiki 结构化 Mermaid 制图', '1.0.0',
    JSON_ARRAY('deepwiki', 'diagram'),
    JSON_OBJECT('inventory', 'object', 'module_digests', 'array', 'research_excerpt', 'string'),
    JSON_OBJECT('system_architecture', 'string', 'product_architecture', 'string', 'core_flow', 'string', 'sequence', 'string', 'er_diagram', 'string'),
    'skills/deepwiki-diagram-synthesis.md',
    JSON_ARRAY('control-plane', 'ai-gateway'),
    'active'),
  ('deepwiki_module_context', 'Deep Wiki 模块叙事补充（可选）', '1.0.0',
    JSON_ARRAY('deepwiki', 'module'),
    JSON_OBJECT('module_name', 'string'),
    JSON_OBJECT('hints', 'string'),
    'skills/deepwiki-module-context.md',
    JSON_ARRAY('control-plane'),
    'active')
ON DUPLICATE KEY UPDATE
  `name` = VALUES(`name`),
  `env_tags` = VALUES(`env_tags`),
  `input_decl` = VALUES(`input_decl`),
  `output_decl` = VALUES(`output_decl`),
  `prompt_ref` = VALUES(`prompt_ref`),
  `tool_refs` = VALUES(`tool_refs`),
  `status` = VALUES(`status`);
