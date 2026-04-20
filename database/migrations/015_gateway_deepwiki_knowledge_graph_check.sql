SELECT CASE
  WHEN EXISTS (
    SELECT 1 FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gateway_wiki_objects'
  ) THEN 'ok_gateway_wiki_objects_exists'
  ELSE 'missing_gateway_wiki_objects'
END AS gateway_wiki_objects_status;

SELECT CASE
  WHEN EXISTS (
    SELECT 1 FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gateway_wiki_evidence'
  ) THEN 'ok_gateway_wiki_evidence_exists'
  ELSE 'missing_gateway_wiki_evidence'
END AS gateway_wiki_evidence_status;

SELECT CASE
  WHEN EXISTS (
    SELECT 1 FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gateway_wiki_relations'
  ) THEN 'ok_gateway_wiki_relations_exists'
  ELSE 'missing_gateway_wiki_relations'
END AS gateway_wiki_relations_status;

SELECT o.run_id, o.object_type, COUNT(*) AS object_count
FROM gateway_wiki_objects o
WHERE o.run_id = (SELECT id FROM gateway_deepwiki_runs ORDER BY id DESC LIMIT 1)
GROUP BY o.run_id, o.object_type
ORDER BY o.object_type;

SELECT o.run_id,
       COUNT(*) AS object_count,
       COUNT(DISTINCT CASE WHEN e.id IS NOT NULL THEN o.id END) AS covered_object_count,
       ROUND(
         COUNT(DISTINCT CASE WHEN e.id IS NOT NULL THEN o.id END) / NULLIF(COUNT(*), 0) * 100,
         2
       ) AS evidence_coverage_percent
FROM gateway_wiki_objects o
LEFT JOIN gateway_wiki_evidence e ON e.object_id = o.id
WHERE o.run_id = (SELECT id FROM gateway_deepwiki_runs ORDER BY id DESC LIMIT 1)
GROUP BY o.run_id;

SELECT r.run_id,
       SUM(CASE WHEN src.object_type = 'feature' AND r.relation_type = 'depends_on_service' AND dst.object_type = 'service' THEN 1 ELSE 0 END) AS feature_service_links,
       SUM(CASE WHEN src.object_type = 'service' AND r.relation_type = 'owns_api' AND dst.object_type = 'api' THEN 1 ELSE 0 END) AS service_api_links,
       SUM(CASE WHEN src.object_type = 'api' AND r.relation_type = 'covered_by_test' AND dst.object_type = 'test_asset' THEN 1 ELSE 0 END) AS api_test_links
FROM gateway_wiki_relations r
INNER JOIN gateway_wiki_objects src ON src.id = r.from_object_id
INNER JOIN gateway_wiki_objects dst ON dst.id = r.to_object_id
WHERE r.run_id = (SELECT id FROM gateway_deepwiki_runs ORDER BY id DESC LIMIT 1)
GROUP BY r.run_id;
