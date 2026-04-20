SELECT
  TABLE_NAME
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN (
    'gateway_wiki_branches',
    'gateway_wiki_branch_repo_mappings',
    'gateway_wiki_snapshot_repo_revisions',
    'gateway_wiki_consistency_checks',
    'gateway_wiki_flows',
    'gateway_wiki_flow_steps',
    'gateway_wiki_assertions',
    'gateway_wiki_scenarios',
    'gateway_wiki_semantic_scores',
    'gateway_wiki_feedback_events'
  )
ORDER BY TABLE_NAME;
