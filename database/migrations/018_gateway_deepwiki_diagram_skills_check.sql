SELECT CASE
  WHEN EXISTS (
    SELECT 1 FROM `gateway_skill_packages`
    WHERE `skill_key` = 'deepwiki_diagram_synthesis' AND `version` = '1.0.0' AND `status` = 'active'
  ) THEN 'ok_deepwiki_diagram_synthesis'
  ELSE 'missing_deepwiki_diagram_synthesis'
END AS deepwiki_diagram_skill_check;
