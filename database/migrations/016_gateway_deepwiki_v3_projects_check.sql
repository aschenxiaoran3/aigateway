SELECT
  TABLE_NAME
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN (
    'gateway_wiki_projects',
    'gateway_wiki_project_repos',
    'gateway_wiki_snapshots',
    'gateway_wiki_generation_jobs',
    'gateway_wiki_quality_reports'
  )
ORDER BY TABLE_NAME;

SELECT
  p.project_code,
  COUNT(DISTINCT pr.repo_source_id) AS repo_count,
  COUNT(DISTINCT s.id) AS snapshot_count,
  COUNT(DISTINCT qr.id) AS quality_report_count
FROM gateway_wiki_projects p
LEFT JOIN gateway_wiki_project_repos pr ON pr.project_id = p.id
LEFT JOIN gateway_wiki_snapshots s ON s.project_id = p.id
LEFT JOIN gateway_wiki_quality_reports qr ON qr.project_id = p.id
GROUP BY p.id, p.project_code
ORDER BY p.updated_at DESC, p.id DESC;
