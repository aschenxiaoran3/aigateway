SELECT
  COUNT(*) AS has_gateway_code_repositories
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'gateway_code_repositories';

SELECT
  COUNT(*) AS has_gateway_doc_bundle_contexts
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'gateway_doc_bundle_contexts';

SELECT
  COUNT(*) AS has_gateway_repo_context_runs
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'gateway_repo_context_runs';

SELECT
  COUNT(*) AS has_gateway_tech_spec_generation_runs
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'gateway_tech_spec_generation_runs';
