SELECT CASE
  WHEN EXISTS (
    SELECT 1
    FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'gateway_deepwiki_runs'
  ) THEN 'ok_gateway_deepwiki_runs_exists'
  ELSE 'missing_gateway_deepwiki_runs'
END AS deepwiki_run_table_check;

SELECT CASE
  WHEN EXISTS (
    SELECT 1
    FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'gateway_deepwiki_pages'
  ) THEN 'ok_gateway_deepwiki_pages_exists'
  ELSE 'missing_gateway_deepwiki_pages'
END AS deepwiki_page_table_check;
