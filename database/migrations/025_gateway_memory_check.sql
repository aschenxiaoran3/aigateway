SELECT CASE
  WHEN EXISTS (
    SELECT 1 FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gateway_memory_policies'
  ) THEN 'ok_gateway_memory_policies_exists'
  ELSE 'missing_gateway_memory_policies'
END AS gateway_memory_policies_status;

SELECT CASE
  WHEN EXISTS (
    SELECT 1 FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gateway_memory_threads'
  ) THEN 'ok_gateway_memory_threads_exists'
  ELSE 'missing_gateway_memory_threads'
END AS gateway_memory_threads_status;

SELECT CASE
  WHEN EXISTS (
    SELECT 1 FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gateway_memory_turns'
  ) THEN 'ok_gateway_memory_turns_exists'
  ELSE 'missing_gateway_memory_turns'
END AS gateway_memory_turns_status;

SELECT CASE
  WHEN EXISTS (
    SELECT 1 FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gateway_memory_facts'
  ) THEN 'ok_gateway_memory_facts_exists'
  ELSE 'missing_gateway_memory_facts'
END AS gateway_memory_facts_status;

SELECT CASE
  WHEN EXISTS (
    SELECT 1 FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gateway_memory_recalls'
  ) THEN 'ok_gateway_memory_recalls_exists'
  ELSE 'missing_gateway_memory_recalls'
END AS gateway_memory_recalls_status;
