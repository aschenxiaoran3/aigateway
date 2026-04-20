#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

async function main() {
  const { getPool } = require(path.join(root, 'control-plane/src/db/mysql.js'));
  const pool = getPool();
  const conn = await pool.getConnection();
  const migration = fs.readFileSync(
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
  const migration030 = fs.readFileSync(
    path.join(root, 'database/migrations/030_gateway_deepwiki_snapshot_state_machine_up.sql'),
    'utf8'
  );

  try {
    await conn.query({ sql: migration, multipleStatements: true });
    console.log('OK: 013_gateway_deepwiki_up.sql applied');
  } catch (error) {
    if (
      String(error.message).includes('Duplicate column') ||
      String(error.code) === 'ER_DUP_FIELDNAME' ||
      String(error.code) === 'ER_DUP_KEYNAME' ||
      String(error.code) === 'ER_CANT_CREATE_TABLE'
    ) {
      console.warn('Skip migration 013 (already applied or partially present):', error.message);
    } else {
      conn.release();
      throw error;
    }
  }

  try {
    await conn.query({ sql: migration015, multipleStatements: true });
    console.log('OK: 015_gateway_deepwiki_knowledge_graph_up.sql applied');
  } catch (error) {
    if (
      String(error.message).includes('Duplicate column') ||
      String(error.code) === 'ER_DUP_FIELDNAME' ||
      String(error.code) === 'ER_DUP_KEYNAME' ||
      String(error.code) === 'ER_CANT_CREATE_TABLE'
    ) {
      console.warn('Skip migration 015 (already applied or partially present):', error.message);
    } else {
      conn.release();
      throw error;
    }
  }

  try {
    await conn.query({ sql: migration016, multipleStatements: true });
    console.log('OK: 016_gateway_deepwiki_v3_projects_up.sql applied');
  } catch (error) {
    if (
      String(error.message).includes('Duplicate column') ||
      String(error.code) === 'ER_DUP_FIELDNAME' ||
      String(error.code) === 'ER_DUP_KEYNAME' ||
      String(error.code) === 'ER_CANT_CREATE_TABLE'
    ) {
      console.warn('Skip migration 016 (already applied or partially present):', error.message);
    } else {
      conn.release();
      throw error;
    }
  }

  try {
    await conn.query({ sql: migration017, multipleStatements: true });
    console.log('OK: 017_gateway_deepwiki_v4_runtime_up.sql applied');
  } catch (error) {
    if (
      String(error.message).includes('Duplicate column') ||
      String(error.code) === 'ER_DUP_FIELDNAME' ||
      String(error.code) === 'ER_DUP_KEYNAME' ||
      String(error.code) === 'ER_CANT_CREATE_TABLE'
    ) {
      console.warn('Skip migration 017 (already applied or partially present):', error.message);
    } else {
      conn.release();
      throw error;
    }
  }

  try {
    await conn.query({ sql: migration019, multipleStatements: true });
    console.log('OK: 019_gateway_deepwiki_project_cockpit_up.sql applied');
  } catch (error) {
    if (
      String(error.message).includes('Duplicate column') ||
      String(error.code) === 'ER_DUP_FIELDNAME' ||
      String(error.code) === 'ER_DUP_KEYNAME' ||
      String(error.code) === 'ER_CANT_CREATE_TABLE'
    ) {
      console.warn('Skip migration 019 (already applied or partially present):', error.message);
    } else {
      conn.release();
      throw error;
    }
  }

  try {
    await conn.query({ sql: migration021, multipleStatements: true });
    console.log('OK: 021_gateway_deepwiki_neural_query_up.sql applied');
  } catch (error) {
    if (
      String(error.message).includes('Duplicate column') ||
      String(error.code) === 'ER_DUP_FIELDNAME' ||
      String(error.code) === 'ER_DUP_KEYNAME' ||
      String(error.code) === 'ER_CANT_CREATE_TABLE'
    ) {
      console.warn('Skip migration 021 (already applied or partially present):', error.message);
    } else {
      conn.release();
      throw error;
    }
  }

  try {
    await conn.query({ sql: migration022, multipleStatements: true });
    console.log('OK: 022_gateway_deepwiki_v2_threads_up.sql applied');
  } catch (error) {
    if (
      String(error.message).includes('Duplicate column') ||
      String(error.code) === 'ER_DUP_FIELDNAME' ||
      String(error.code) === 'ER_DUP_KEYNAME' ||
      String(error.code) === 'ER_CANT_CREATE_TABLE' ||
      String(error.code) === 'ER_CANT_DROP_FIELD_OR_KEY'
    ) {
      console.warn('Skip migration 022 (already applied or partially present):', error.message);
    } else {
      conn.release();
      throw error;
    }
  }

  try {
    await conn.query({ sql: migration023, multipleStatements: true });
    console.log('OK: 023_gateway_deepwiki_source_uri_capacity_up.sql applied');
  } catch (error) {
    if (
      String(error.message).includes('Duplicate column') ||
      String(error.code) === 'ER_DUP_FIELDNAME' ||
      String(error.code) === 'ER_DUP_KEYNAME' ||
      String(error.code) === 'ER_CANT_CREATE_TABLE' ||
      String(error.code) === 'ER_CANT_DROP_FIELD_OR_KEY'
    ) {
      console.warn('Skip migration 023 (already applied or partially present):', error.message);
    } else {
      conn.release();
      throw error;
    }
  }

  try {
    await conn.query({ sql: migration024, multipleStatements: true });
    console.log('OK: 024_gateway_deepwiki_v3_domain_runtime_up.sql applied');
  } catch (error) {
    if (
      String(error.message).includes('Duplicate column') ||
      String(error.code) === 'ER_DUP_FIELDNAME' ||
      String(error.code) === 'ER_DUP_KEYNAME' ||
      String(error.code) === 'ER_CANT_CREATE_TABLE'
    ) {
      console.warn('Skip migration 024 (already applied or partially present):', error.message);
    } else {
      conn.release();
      throw error;
    }
  }

  try {
    await conn.query({ sql: migration030, multipleStatements: true });
    console.log('OK: 030_gateway_deepwiki_snapshot_state_machine_up.sql applied');
  } catch (error) {
    if (
      String(error.message).includes('Duplicate column') ||
      String(error.code) === 'ER_DUP_FIELDNAME' ||
      String(error.code) === 'ER_DUP_KEYNAME' ||
      String(error.code) === 'ER_CANT_CREATE_TABLE' ||
      String(error.code) === 'ER_DUP_INDEX'
    ) {
      console.warn('Skip migration 030 (already applied or partially present):', error.message);
    } else {
      conn.release();
      throw error;
    }
  }

  const { runBackfill } = require(path.join(root, 'scripts/backfill-deepwiki-snapshot-state.cjs'));
  await runBackfill({ quiet: false });

  const [[repoSourceTable]] = await conn.query(
    `SELECT COUNT(*) AS c FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gateway_repo_sources'`
  );
  const [[repoSnapshotTable]] = await conn.query(
    `SELECT COUNT(*) AS c FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gateway_repo_snapshots'`
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
  const [[wikiSourceBindingTable]] = await conn.query(
    `SELECT COUNT(*) AS c FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gateway_wiki_project_source_bindings'`
  );
  const [[wikiDocumentRevisionTable]] = await conn.query(
    `SELECT COUNT(*) AS c FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gateway_wiki_snapshot_document_revisions'`
  );
  const [[wikiDiagramTable]] = await conn.query(
    `SELECT COUNT(*) AS c FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gateway_wiki_snapshot_diagrams'`
  );

  console.log('--- verify ---');
  console.log('gateway_repo_sources exists:', Number(repoSourceTable.c) > 0);
  console.log('gateway_repo_snapshots exists:', Number(repoSnapshotTable.c) > 0);
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
  console.log('gateway_wiki_project_source_bindings exists:', Number(wikiSourceBindingTable.c) > 0);
  console.log('gateway_wiki_snapshot_document_revisions exists:', Number(wikiDocumentRevisionTable.c) > 0);
  console.log('gateway_wiki_snapshot_diagrams exists:', Number(wikiDiagramTable.c) > 0);

  conn.release();
  console.log('Done.');
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
