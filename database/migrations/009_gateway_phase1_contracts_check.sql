SELECT CASE
  WHEN EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'gateway_doc_bundles'
      AND COLUMN_NAME = 'trace_id'
  ) THEN 'ok_gateway_doc_bundles_trace'
  ELSE 'missing_gateway_doc_bundles_trace'
END AS check_doc_bundles;

SELECT CASE
  WHEN EXISTS (
    SELECT 1 FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gateway_standard_nodes'
  ) THEN 'ok_gateway_standard_nodes'
  ELSE 'missing_gateway_standard_nodes'
END AS check_standard_nodes;
