SELECT CASE
  WHEN EXISTS (
    SELECT 1 FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gateway_wiki_community_reports'
  ) THEN 'ok_gateway_wiki_community_reports_exists'
  ELSE 'missing_gateway_wiki_community_reports'
END AS gateway_wiki_community_reports_status;

SELECT CASE
  WHEN EXISTS (
    SELECT 1 FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gateway_wiki_query_logs'
  ) THEN 'ok_gateway_wiki_query_logs_exists'
  ELSE 'missing_gateway_wiki_query_logs'
END AS gateway_wiki_query_logs_status;
