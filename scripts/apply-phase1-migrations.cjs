#!/usr/bin/env node
/**
 * 对 RDS 执行 009/010/011/012/013/015/016/017/019/020/021/022/023/024/025/026/027/028/029/030 迁移 + 基础种子 + phase1 知识种子，并做校验。
 * 连接配置与 control-plane/src/db/mysql.js 完全一致（通过 getPool，无重复密钥）。
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

async function main() {
  const { getPool } = require(path.join(__dirname, '../control-plane/src/db/mysql.js'));
  const pool = getPool();
  const conn = await pool.getConnection();

  const migration009 = fs.readFileSync(
    path.join(root, 'database/migrations/009_gateway_phase1_contracts_up.sql'),
    'utf8'
  );
  const migration010 = fs.readFileSync(
    path.join(root, 'database/migrations/010_gateway_node_contracts_up.sql'),
    'utf8'
  );
  const migration011 = fs.readFileSync(
    path.join(root, 'database/migrations/011_gateway_productization_up.sql'),
    'utf8'
  );
  const migration012 = fs.readFileSync(
    path.join(root, 'database/migrations/012_gateway_doc_workflow_modes_up.sql'),
    'utf8'
  );
  const migration013 = fs.readFileSync(
    path.join(root, 'database/migrations/013_gateway_deepwiki_up.sql'),
    'utf8'
  );
  const migration015 = fs.readFileSync(
    path.join(root, 'database/migrations/015_gateway_deepwiki_knowledge_graph_up.sql'),
    'utf8'
  );
  const migration016 = fs.readFileSync(
    path.join(root, 'database/migrations/016_gateway_deepwiki_v3_projects_up.sql'),
    'utf8'
  );
  const migration017 = fs.readFileSync(
    path.join(root, 'database/migrations/017_gateway_deepwiki_v4_runtime_up.sql'),
    'utf8'
  );
  const migration019 = fs.readFileSync(
    path.join(root, 'database/migrations/019_gateway_deepwiki_project_cockpit_up.sql'),
    'utf8'
  );
  const migration020 = fs.readFileSync(
    path.join(root, 'database/migrations/020_gateway_harness_q2_alignment_up.sql'),
    'utf8'
  );
  const migration021 = fs.readFileSync(
    path.join(root, 'database/migrations/021_gateway_deepwiki_neural_query_up.sql'),
    'utf8'
  );
  const migration022 = fs.readFileSync(
    path.join(root, 'database/migrations/022_gateway_deepwiki_v2_threads_up.sql'),
    'utf8'
  );
  const migration023 = fs.readFileSync(
    path.join(root, 'database/migrations/023_gateway_deepwiki_source_uri_capacity_up.sql'),
    'utf8'
  );
  const migration024 = fs.readFileSync(
    path.join(root, 'database/migrations/024_gateway_deepwiki_v3_domain_runtime_up.sql'),
    'utf8'
  );
  const migration025 = fs.readFileSync(
    path.join(root, 'database/migrations/025_gateway_memory_up.sql'),
    'utf8'
  );
  const migration026 = fs.readFileSync(
    path.join(root, 'database/migrations/026_gateway_deepwiki_snapshot_history_up.sql'),
    'utf8'
  );
  const migration027 = fs.readFileSync(
    path.join(root, 'database/migrations/027_gateway_deepwiki_stage_runtime_up.sql'),
    'utf8'
  );
  const migration028 = fs.readFileSync(
    path.join(root, 'database/migrations/028_gateway_deepwiki_scoring_runtime_up.sql'),
    'utf8'
  );
  const migration029 = fs.readFileSync(
    path.join(root, 'database/migrations/029_gateway_deepwiki_publish_state_repair_up.sql'),
    'utf8'
  );
  const migration030 = fs.readFileSync(
    path.join(root, 'database/migrations/030_gateway_deepwiki_snapshot_state_machine_up.sql'),
    'utf8'
  );
  const baseSeed = fs.readFileSync(path.join(root, 'database/init-control-plane.sql'), 'utf8');
  const seed = fs.readFileSync(path.join(root, 'database/seeds/phase1_knowledge_assets.sql'), 'utf8');

  try {
    await conn.query({ sql: migration009, multipleStatements: true });
    console.log('OK: 009_gateway_phase1_contracts_up.sql applied');
  } catch (e) {
    if (String(e.message).includes('Duplicate column') || String(e.code) === 'ER_DUP_FIELDNAME') {
      console.warn('Skip migration 009 (columns already exist):', e.message);
    } else {
      conn.release();
      throw e;
    }
  }

  try {
    await conn.query({ sql: migration010, multipleStatements: true });
    console.log('OK: 010_gateway_node_contracts_up.sql applied');
  } catch (e) {
    if (
      String(e.message).includes('Duplicate column') ||
      String(e.code) === 'ER_DUP_FIELDNAME' ||
      String(e.code) === 'ER_DUP_KEYNAME' ||
      String(e.code) === 'ER_CANT_CREATE_TABLE'
    ) {
      console.warn('Skip migration 010 (already applied or partially present):', e.message);
    } else {
      conn.release();
      throw e;
    }
  }

  try {
    await conn.query({ sql: migration011, multipleStatements: true });
    console.log('OK: 011_gateway_productization_up.sql applied');
  } catch (e) {
    if (
      String(e.message).includes('Duplicate column') ||
      String(e.code) === 'ER_DUP_FIELDNAME' ||
      String(e.code) === 'ER_DUP_KEYNAME' ||
      String(e.code) === 'ER_CANT_CREATE_TABLE'
    ) {
      console.warn('Skip migration 011 (already applied or partially present):', e.message);
    } else {
      conn.release();
      throw e;
    }
  }

  try {
    await conn.query({ sql: migration012, multipleStatements: true });
    console.log('OK: 012_gateway_doc_workflow_modes_up.sql applied');
  } catch (e) {
    if (
      String(e.message).includes('Duplicate column') ||
      String(e.code) === 'ER_DUP_FIELDNAME' ||
      String(e.code) === 'ER_DUP_KEYNAME' ||
      String(e.code) === 'ER_CANT_CREATE_TABLE'
    ) {
      console.warn('Skip migration 012 (already applied or partially present):', e.message);
    } else {
      conn.release();
      throw e;
    }
  }

  try {
    await conn.query({ sql: migration013, multipleStatements: true });
    console.log('OK: 013_gateway_deepwiki_up.sql applied');
  } catch (e) {
    if (
      String(e.message).includes('Duplicate column') ||
      String(e.code) === 'ER_DUP_FIELDNAME' ||
      String(e.code) === 'ER_DUP_KEYNAME' ||
      String(e.code) === 'ER_CANT_CREATE_TABLE'
    ) {
      console.warn('Skip migration 013 (already applied or partially present):', e.message);
    } else {
      conn.release();
      throw e;
    }
  }

  try {
    await conn.query({ sql: migration015, multipleStatements: true });
    console.log('OK: 015_gateway_deepwiki_knowledge_graph_up.sql applied');
  } catch (e) {
    if (
      String(e.message).includes('Duplicate column') ||
      String(e.code) === 'ER_DUP_FIELDNAME' ||
      String(e.code) === 'ER_DUP_KEYNAME' ||
      String(e.code) === 'ER_CANT_CREATE_TABLE'
    ) {
      console.warn('Skip migration 015 (already applied or partially present):', e.message);
    } else {
      conn.release();
      throw e;
    }
  }

  try {
    await conn.query({ sql: migration016, multipleStatements: true });
    console.log('OK: 016_gateway_deepwiki_v3_projects_up.sql applied');
  } catch (e) {
    if (
      String(e.message).includes('Duplicate column') ||
      String(e.code) === 'ER_DUP_FIELDNAME' ||
      String(e.code) === 'ER_DUP_KEYNAME' ||
      String(e.code) === 'ER_CANT_CREATE_TABLE'
    ) {
      console.warn('Skip migration 016 (already applied or partially present):', e.message);
    } else {
      conn.release();
      throw e;
    }
  }

  try {
    await conn.query({ sql: migration017, multipleStatements: true });
    console.log('OK: 017_gateway_deepwiki_v4_runtime_up.sql applied');
  } catch (e) {
    if (
      String(e.message).includes('Duplicate column') ||
      String(e.code) === 'ER_DUP_FIELDNAME' ||
      String(e.code) === 'ER_DUP_KEYNAME' ||
      String(e.code) === 'ER_CANT_CREATE_TABLE'
    ) {
      console.warn('Skip migration 017 (already applied or partially present):', e.message);
    } else {
      conn.release();
      throw e;
    }
  }

  try {
    await conn.query({ sql: migration019, multipleStatements: true });
    console.log('OK: 019_gateway_deepwiki_project_cockpit_up.sql applied');
  } catch (e) {
    if (
      String(e.message).includes('Duplicate column') ||
      String(e.code) === 'ER_DUP_FIELDNAME' ||
      String(e.code) === 'ER_DUP_KEYNAME' ||
      String(e.code) === 'ER_CANT_CREATE_TABLE'
    ) {
      console.warn('Skip migration 019 (already applied or partially present):', e.message);
    } else {
      conn.release();
      throw e;
    }
  }

  try {
    await conn.query({ sql: migration020, multipleStatements: true });
    console.log('OK: 020_gateway_harness_q2_alignment_up.sql applied');
  } catch (e) {
    if (
      String(e.message).includes('Duplicate column') ||
      String(e.code) === 'ER_DUP_FIELDNAME' ||
      String(e.code) === 'ER_DUP_KEYNAME' ||
      String(e.code) === 'ER_CANT_CREATE_TABLE'
    ) {
      console.warn('Skip migration 020 (already applied or partially present):', e.message);
    } else {
      conn.release();
      throw e;
    }
  }

  try {
    await conn.query({ sql: migration021, multipleStatements: true });
    console.log('OK: 021_gateway_deepwiki_neural_query_up.sql applied');
  } catch (e) {
    if (
      String(e.message).includes('Duplicate column') ||
      String(e.code) === 'ER_DUP_FIELDNAME' ||
      String(e.code) === 'ER_DUP_KEYNAME' ||
      String(e.code) === 'ER_CANT_CREATE_TABLE'
    ) {
      console.warn('Skip migration 021 (already applied or partially present):', e.message);
    } else {
      conn.release();
      throw e;
    }
  }

  try {
    await conn.query({ sql: migration022, multipleStatements: true });
    console.log('OK: 022_gateway_deepwiki_v2_threads_up.sql applied');
  } catch (e) {
    if (
      String(e.message).includes('Duplicate column') ||
      String(e.code) === 'ER_DUP_FIELDNAME' ||
      String(e.code) === 'ER_DUP_KEYNAME' ||
      String(e.code) === 'ER_CANT_CREATE_TABLE' ||
      String(e.code) === 'ER_CANT_DROP_FIELD_OR_KEY'
    ) {
      console.warn('Skip migration 022 (already applied or partially present):', e.message);
    } else {
      conn.release();
      throw e;
    }
  }

  try {
    await conn.query({ sql: migration023, multipleStatements: true });
    console.log('OK: 023_gateway_deepwiki_source_uri_capacity_up.sql applied');
  } catch (e) {
    if (
      String(e.message).includes('Duplicate column') ||
      String(e.code) === 'ER_DUP_FIELDNAME' ||
      String(e.code) === 'ER_DUP_KEYNAME' ||
      String(e.code) === 'ER_CANT_CREATE_TABLE' ||
      String(e.code) === 'ER_CANT_DROP_FIELD_OR_KEY'
    ) {
      console.warn('Skip migration 023 (already applied or partially present):', e.message);
    } else {
      conn.release();
      throw e;
    }
  }

  try {
    await conn.query({ sql: migration024, multipleStatements: true });
    console.log('OK: 024_gateway_deepwiki_v3_domain_runtime_up.sql applied');
  } catch (e) {
    if (
      String(e.message).includes('Duplicate column') ||
      String(e.code) === 'ER_DUP_FIELDNAME' ||
      String(e.code) === 'ER_DUP_KEYNAME' ||
      String(e.code) === 'ER_CANT_CREATE_TABLE'
    ) {
      console.warn('Skip migration 024 (already applied or partially present):', e.message);
    } else {
      conn.release();
      throw e;
    }
  }

  try {
    await conn.query({ sql: migration026, multipleStatements: true });
    console.log('OK: 026_gateway_deepwiki_snapshot_history_up.sql applied');
  } catch (e) {
    if (
      String(e.message).includes('Duplicate key name') ||
      String(e.code) === 'ER_DUP_KEYNAME' ||
      String(e.code) === 'ER_CANT_DROP_FIELD_OR_KEY'
    ) {
      console.warn('Skip migration 026 (already applied or partially present):', e.message);
    } else {
      conn.release();
      throw e;
    }
  }

  try {
    await conn.query({ sql: migration027, multipleStatements: true });
    console.log('OK: 027_gateway_deepwiki_stage_runtime_up.sql applied');
  } catch (e) {
    if (
      String(e.message).includes('Duplicate column') ||
      String(e.code) === 'ER_DUP_FIELDNAME' ||
      String(e.code) === 'ER_DUP_KEYNAME' ||
      String(e.code) === 'ER_CANT_CREATE_TABLE'
    ) {
      console.warn('Skip migration 027 (already applied or partially present):', e.message);
    } else {
      conn.release();
      throw e;
    }
  }

  try {
    await conn.query({ sql: migration028, multipleStatements: true });
    console.log('OK: 028_gateway_deepwiki_scoring_runtime_up.sql applied');
  } catch (e) {
    if (
      String(e.message).includes('Duplicate column') ||
      String(e.code) === 'ER_DUP_FIELDNAME' ||
      String(e.code) === 'ER_DUP_KEYNAME' ||
      String(e.code) === 'ER_CANT_CREATE_TABLE'
    ) {
      console.warn('Skip migration 028 (already applied or partially present):', e.message);
    } else {
      conn.release();
      throw e;
    }
  }

  try {
    await conn.query({ sql: migration029, multipleStatements: true });
    console.log('OK: 029_gateway_deepwiki_publish_state_repair_up.sql applied');
  } catch (e) {
    conn.release();
    throw e;
  }

  try {
    await conn.query({ sql: migration030, multipleStatements: true });
    console.log('OK: 030_gateway_deepwiki_snapshot_state_machine_up.sql applied');
  } catch (e) {
    if (
      String(e.message).includes('Duplicate column') ||
      String(e.code) === 'ER_DUP_FIELDNAME' ||
      String(e.code) === 'ER_DUP_KEYNAME' ||
      String(e.code) === 'ER_CANT_CREATE_TABLE' ||
      String(e.code) === 'ER_DUP_INDEX'
    ) {
      console.warn('Skip migration 030 (already applied or partially present):', e.message);
    } else {
      conn.release();
      throw e;
    }
  }

  try {
    await conn.query({ sql: migration025, multipleStatements: true });
    console.log('OK: 025_gateway_memory_up.sql applied');
  } catch (e) {
    if (
      String(e.message).includes('Duplicate column') ||
      String(e.code) === 'ER_DUP_FIELDNAME' ||
      String(e.code) === 'ER_DUP_KEYNAME' ||
      String(e.code) === 'ER_CANT_CREATE_TABLE'
    ) {
      console.warn('Skip migration 025 (already applied or partially present):', e.message);
    } else {
      conn.release();
      throw e;
    }
  }

  try {
    await conn.query({ sql: baseSeed, multipleStatements: true });
    console.log('OK: init-control-plane.sql applied');
  } catch (e) {
    conn.release();
    throw e;
  }

  try {
    await conn.query({ sql: seed, multipleStatements: true });
    console.log('OK: phase1_knowledge_assets.sql applied');
  } catch (e) {
    conn.release();
    throw e;
  }

  const { runBackfill } = require(path.join(root, 'scripts/backfill-deepwiki-snapshot-state.cjs'));
  await runBackfill({ quiet: false });

  const [[{ c: nodeCount }]] = await conn.query('SELECT COUNT(*) AS c FROM gateway_standard_nodes');
  const [[{ c: assetCount }]] = await conn.query('SELECT COUNT(*) AS c FROM gateway_knowledge_assets');
  const [[{ c: schemaCount }]] = await conn.query(
    "SELECT COUNT(*) AS c FROM gateway_contract_schemas WHERE schema_key IN ('prd_input','prd_output','tech_spec_input','tech_spec_output','test_plan_input','doc_gate_output')"
  );
  const [[{ c: skillCount }]] = await conn.query(
    "SELECT COUNT(*) AS c FROM gateway_skill_packages WHERE skill_key IN ('prd_gate_review','tech_spec_gate_review','test_plan_generate','test_plan_gate_review')"
  );
  const [[bundlesCol]] = await conn.query(
    `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gateway_doc_bundles' AND COLUMN_NAME = 'trace_id'`
  );
  const [[contractsCol]] = await conn.query(
    `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gateway_standard_nodes' AND COLUMN_NAME = 'input_contract_json'`
  );
  const [[aiDraftCol]] = await conn.query(
    `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gateway_test_plan_generation_runs' AND COLUMN_NAME = 'ai_draft_artifact_id'`
  );
  const [[repoTable]] = await conn.query(
    `SELECT COUNT(*) AS c FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gateway_code_repositories'`
  );
  const [[bundleContextTable]] = await conn.query(
    `SELECT COUNT(*) AS c FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gateway_doc_bundle_contexts'`
  );
  const [[repoContextTable]] = await conn.query(
    `SELECT COUNT(*) AS c FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gateway_repo_context_runs'`
  );
  const [[techSpecRunTable]] = await conn.query(
    `SELECT COUNT(*) AS c FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gateway_tech_spec_generation_runs'`
  );
  const [[deepWikiRunTable]] = await conn.query(
    `SELECT COUNT(*) AS c FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gateway_deepwiki_runs'`
  );
  const [[deepWikiPageTable]] = await conn.query(
    `SELECT COUNT(*) AS c FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gateway_deepwiki_pages'`
  );
  const [[wikiObjectTable]] = await conn.query(
    `SELECT COUNT(*) AS c FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gateway_wiki_objects'`
  );
  const [[wikiEvidenceTable]] = await conn.query(
    `SELECT COUNT(*) AS c FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gateway_wiki_evidence'`
  );
  const [[wikiRelationTable]] = await conn.query(
    `SELECT COUNT(*) AS c FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gateway_wiki_relations'`
  );
  const [[wikiProjectTable]] = await conn.query(
    `SELECT COUNT(*) AS c FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gateway_wiki_projects'`
  );
  const [[wikiProjectRepoTable]] = await conn.query(
    `SELECT COUNT(*) AS c FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gateway_wiki_project_repos'`
  );
  const [[wikiSnapshotTable]] = await conn.query(
    `SELECT COUNT(*) AS c FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gateway_wiki_snapshots'`
  );
  const [[wikiGenerationJobTable]] = await conn.query(
    `SELECT COUNT(*) AS c FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gateway_wiki_generation_jobs'`
  );
  const [[wikiQualityReportTable]] = await conn.query(
    `SELECT COUNT(*) AS c FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gateway_wiki_quality_reports'`
  );
  const [[wikiBranchTable]] = await conn.query(
    `SELECT COUNT(*) AS c FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gateway_wiki_branches'`
  );
  const [[wikiBranchMappingTable]] = await conn.query(
    `SELECT COUNT(*) AS c FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gateway_wiki_branch_repo_mappings'`
  );
  const [[wikiSnapshotRevisionTable]] = await conn.query(
    `SELECT COUNT(*) AS c FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gateway_wiki_snapshot_repo_revisions'`
  );
  const [[wikiConsistencyTable]] = await conn.query(
    `SELECT COUNT(*) AS c FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gateway_wiki_consistency_checks'`
  );
  const [[wikiFlowTable]] = await conn.query(
    `SELECT COUNT(*) AS c FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gateway_wiki_flows'`
  );
  const [[wikiAssertionTable]] = await conn.query(
    `SELECT COUNT(*) AS c FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gateway_wiki_assertions'`
  );
  const [[wikiScenarioTable]] = await conn.query(
    `SELECT COUNT(*) AS c FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gateway_wiki_scenarios'`
  );
  const [[wikiSemanticScoreTable]] = await conn.query(
    `SELECT COUNT(*) AS c FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gateway_wiki_semantic_scores'`
  );
  const [[wikiFeedbackTable]] = await conn.query(
    `SELECT COUNT(*) AS c FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gateway_wiki_feedback_events'`
  );

  console.log('--- verify ---');
  console.log('gateway_standard_nodes rows:', nodeCount);
  console.log('gateway_knowledge_assets rows:', assetCount);
  console.log('gateway_contract_schemas seeded rows:', schemaCount);
  console.log('gateway_skill_packages seeded rows:', skillCount);
  console.log('gateway_doc_bundles.trace_id column exists:', Number(bundlesCol.c) > 0);
  console.log('gateway_standard_nodes.input_contract_json column exists:', Number(contractsCol.c) > 0);
  console.log('gateway_test_plan_generation_runs.ai_draft_artifact_id column exists:', Number(aiDraftCol.c) > 0);
  console.log('gateway_code_repositories exists:', Number(repoTable.c) > 0);
  console.log('gateway_doc_bundle_contexts exists:', Number(bundleContextTable.c) > 0);
  console.log('gateway_repo_context_runs exists:', Number(repoContextTable.c) > 0);
  console.log('gateway_tech_spec_generation_runs exists:', Number(techSpecRunTable.c) > 0);
  console.log('gateway_deepwiki_runs exists:', Number(deepWikiRunTable.c) > 0);
  console.log('gateway_deepwiki_pages exists:', Number(deepWikiPageTable.c) > 0);
  console.log('gateway_wiki_objects exists:', Number(wikiObjectTable.c) > 0);
  console.log('gateway_wiki_evidence exists:', Number(wikiEvidenceTable.c) > 0);
  console.log('gateway_wiki_relations exists:', Number(wikiRelationTable.c) > 0);
  console.log('gateway_wiki_projects exists:', Number(wikiProjectTable.c) > 0);
  console.log('gateway_wiki_project_repos exists:', Number(wikiProjectRepoTable.c) > 0);
  console.log('gateway_wiki_snapshots exists:', Number(wikiSnapshotTable.c) > 0);
  console.log('gateway_wiki_generation_jobs exists:', Number(wikiGenerationJobTable.c) > 0);
  console.log('gateway_wiki_quality_reports exists:', Number(wikiQualityReportTable.c) > 0);
  console.log('gateway_wiki_branches exists:', Number(wikiBranchTable.c) > 0);
  console.log('gateway_wiki_branch_repo_mappings exists:', Number(wikiBranchMappingTable.c) > 0);
  console.log('gateway_wiki_snapshot_repo_revisions exists:', Number(wikiSnapshotRevisionTable.c) > 0);
  console.log('gateway_wiki_consistency_checks exists:', Number(wikiConsistencyTable.c) > 0);
  console.log('gateway_wiki_flows exists:', Number(wikiFlowTable.c) > 0);
  console.log('gateway_wiki_assertions exists:', Number(wikiAssertionTable.c) > 0);
  console.log('gateway_wiki_scenarios exists:', Number(wikiScenarioTable.c) > 0);
  console.log('gateway_wiki_semantic_scores exists:', Number(wikiSemanticScoreTable.c) > 0);
  console.log('gateway_wiki_feedback_events exists:', Number(wikiFeedbackTable.c) > 0);

  conn.release();
  console.log('Done.');
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
