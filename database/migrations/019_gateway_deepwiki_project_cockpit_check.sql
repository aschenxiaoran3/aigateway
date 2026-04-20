SELECT COUNT(*) AS has_gateway_wiki_project_source_bindings
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'gateway_wiki_project_source_bindings';

SELECT COUNT(*) AS has_gateway_wiki_snapshot_document_revisions
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'gateway_wiki_snapshot_document_revisions';

SELECT COUNT(*) AS has_gateway_wiki_snapshot_diagrams
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'gateway_wiki_snapshot_diagrams';
