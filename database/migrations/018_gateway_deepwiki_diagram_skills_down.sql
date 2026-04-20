DELETE FROM `gateway_skill_packages`
WHERE `skill_key` IN ('deepwiki_diagram_synthesis', 'deepwiki_module_context')
  AND `version` = '1.0.0';
