#!/usr/bin/env node

const path = require('path');

const root = path.join(__dirname, '..');

const OFFICIAL_PROJECT_CODES = [
  'F01', 'F02', 'F03', 'F04', 'F05',
  'G03', 'P05',
  'C01', 'C02', 'C03', 'C04', 'C05',
  'P01', 'P02', 'P03', 'P04', 'P06', 'P07', 'P08',
  'G01', 'G02', 'G04',
];

const REQUIRED_TABLES = [
  'gateway_integration_connections',
  'gateway_value_assessments',
  'gateway_certification_records',
  'gateway_pipeline_definitions',
  'gateway_pipeline_runs',
  'gateway_run_nodes',
  'gateway_approval_tasks',
  'gateway_program_projects',
  'gateway_project_milestones',
  'gateway_evidence_packs',
  'gateway_waves',
];

const REQUIRED_COLUMNS = [
  ['gateway_program_projects', 'okr_stage'],
  ['gateway_program_projects', 'official_order'],
  ['gateway_program_projects', 'metadata_json'],
  ['gateway_project_milestones', 'checkpoint_label'],
  ['gateway_project_milestones', 'metadata_json'],
  ['gateway_evidence_packs', 'metadata_json'],
  ['gateway_pipeline_definitions', 'template_ref'],
  ['gateway_pipeline_runs', 'request_payload'],
  ['gateway_run_nodes', 'input_payload'],
  ['gateway_run_nodes', 'output_payload'],
  ['gateway_run_nodes', 'retrieval_context'],
  ['gateway_run_nodes', 'evidence_refs'],
  ['gateway_approval_tasks', 'approval_context'],
];

const REQUIRED_PIPELINES = [
  'gate-review',
  'doc-pipeline-v1',
  'p01-tech-bug-loop-v1',
  'p02-test-automation-v1',
  'p03-ops-release-closure-v1',
  'p04-pm-task-closure-v1',
  'p05-product-value-evaluation-v1',
];

function assertCondition(condition, successMessage, failureMessage) {
  if (!condition) {
    throw new Error(failureMessage || successMessage);
  }
  console.log(`OK: ${successMessage}`);
}

async function scalar(conn, sql, params = []) {
  const [rows] = await conn.query(sql, params);
  const row = rows[0] || {};
  const value = row[Object.keys(row)[0]];
  return value;
}

async function main() {
  const { getPool } = require(path.join(root, 'control-plane/src/db/mysql.js'));
  const pool = getPool();
  const conn = await pool.getConnection();

  try {
    const [dbInfoRows] = await conn.query(
      'SELECT DATABASE() AS db_name, @@hostname AS db_host, @@port AS db_port, CURRENT_USER() AS db_user'
    );
    const dbInfo = dbInfoRows[0] || {};
    console.log('--- connection ---');
    console.log(JSON.stringify(dbInfo, null, 2));

    console.log('--- structure ---');
    const tablePlaceholders = REQUIRED_TABLES.map(() => '?').join(',');
    const [tableRows] = await conn.query(
      `SELECT table_name AS table_name
       FROM information_schema.tables
       WHERE table_schema = DATABASE()
         AND table_name IN (${tablePlaceholders})`,
      REQUIRED_TABLES
    );
    const existingTables = new Set(tableRows.map((row) => row.table_name));
    for (const tableName of REQUIRED_TABLES) {
      assertCondition(existingTables.has(tableName), `${tableName} exists`, `${tableName} is missing`);
    }

    for (const [tableName, columnName] of REQUIRED_COLUMNS) {
      const exists = await scalar(
        conn,
        `SELECT COUNT(*) AS c
         FROM information_schema.columns
         WHERE table_schema = DATABASE()
           AND table_name = ?
           AND column_name = ?`,
        [tableName, columnName]
      );
      assertCondition(Number(exists) === 1, `${tableName}.${columnName} exists`, `${tableName}.${columnName} is missing`);
    }

    console.log('--- governance ---');
    const officialCount = await scalar(
      conn,
      `SELECT COUNT(*) AS c
       FROM gateway_program_projects
       WHERE official_order < 900`
    );
    assertCondition(Number(officialCount) === 22, 'official governance projects = 22', `expected 22 official projects, got ${officialCount}`);

    const [projectRows] = await conn.query(
      `SELECT code, official_order, okr_stage
       FROM gateway_program_projects
       WHERE official_order < 900
       ORDER BY official_order ASC`
    );
    const projectCodes = projectRows.map((row) => row.code);
    assertCondition(
      JSON.stringify(projectCodes) === JSON.stringify(OFFICIAL_PROJECT_CODES),
      'official project ordering matches attachment baseline',
      `official project ordering mismatch: ${projectCodes.join(',')}`
    );

    const waveCount = await scalar(conn, 'SELECT COUNT(*) AS c FROM gateway_waves');
    assertCondition(Number(waveCount) >= 4, 'wave catalog seeded', `expected at least 4 waves, got ${waveCount}`);

    const milestoneCount = await scalar(
      conn,
      `SELECT COUNT(*) AS c
       FROM gateway_project_milestones
       WHERE project_code IN (${OFFICIAL_PROJECT_CODES.map(() => '?').join(',')})
         AND checkpoint_label IS NOT NULL`,
      OFFICIAL_PROJECT_CODES
    );
    assertCondition(Number(milestoneCount) === 41, 'official milestone rows seeded', `expected 41 official milestones, got ${milestoneCount}`);

    const [checkpointRows] = await conn.query(
      `SELECT milestone_type, checkpoint_label, due_date, COUNT(*) AS c
       FROM gateway_project_milestones
       WHERE project_code IN (${OFFICIAL_PROJECT_CODES.map(() => '?').join(',')})
         AND checkpoint_label IS NOT NULL
       GROUP BY milestone_type, checkpoint_label, due_date
       ORDER BY due_date ASC, milestone_type ASC`,
      OFFICIAL_PROJECT_CODES
    );
    const checkpointMap = new Map(
      checkpointRows.map((row) => [`${row.milestone_type}|${row.checkpoint_label}`, Number(row.c)])
    );
    assertCondition(
      checkpointMap.get('4_30_gate|4/30') === 7,
      '4/30 official milestone count matches attachment',
      `expected 7 milestones at 4/30, got ${checkpointMap.get('4_30_gate|4/30') || 0}`
    );
    assertCondition(
      checkpointMap.get('5_31_check|5/31') === 12,
      '5/31 official milestone count matches attachment',
      `expected 12 milestones at 5/31, got ${checkpointMap.get('5_31_check|5/31') || 0}`
    );
    assertCondition(
      checkpointMap.get('6_30_acceptance|6/30') === 22,
      '6/30 official milestone count matches attachment',
      `expected 22 milestones at 6/30, got ${checkpointMap.get('6_30_acceptance|6/30') || 0}`
    );

    const [duplicateMilestones] = await conn.query(
      `SELECT project_code, milestone_type, COUNT(*) AS c
       FROM gateway_project_milestones
       WHERE project_code IN (${OFFICIAL_PROJECT_CODES.map(() => '?').join(',')})
       GROUP BY project_code, milestone_type
       HAVING COUNT(*) > 1`,
      OFFICIAL_PROJECT_CODES
    );
    assertCondition(
      duplicateMilestones.length === 0,
      'official milestone set has no duplicate checkpoint types',
      `found duplicate milestone rows: ${JSON.stringify(duplicateMilestones)}`
    );
    console.log(JSON.stringify({ checkpoints: checkpointRows }, null, 2));

    console.log('--- thincore ---');
    const [pipelineRows] = await conn.query(
      `SELECT pipeline_key, template_ref
       FROM gateway_pipeline_definitions
       WHERE pipeline_key IN (${REQUIRED_PIPELINES.map(() => '?').join(',')})
       ORDER BY pipeline_key ASC`,
      REQUIRED_PIPELINES
    );
    assertCondition(pipelineRows.length === REQUIRED_PIPELINES.length, 'required pipeline templates seeded', 'pipeline template set is incomplete');
    for (const row of pipelineRows) {
      assertCondition(Boolean(row.template_ref), `${row.pipeline_key} has template_ref`, `${row.pipeline_key} is missing template_ref`);
    }

    const pipelineRunCount = await scalar(conn, 'SELECT COUNT(*) AS c FROM gateway_pipeline_runs');
    assertCondition(Number(pipelineRunCount) >= 1, 'pipeline run samples exist', 'no pipeline run samples found');

    const runNodeCount = await scalar(conn, 'SELECT COUNT(*) AS c FROM gateway_run_nodes');
    assertCondition(Number(runNodeCount) >= 1, 'pipeline node samples exist', 'no pipeline node samples found');

    const [runNodePayloadRows] = await conn.query(
      `SELECT COUNT(*) AS with_input_payload,
              COUNT(CASE WHEN output_payload IS NOT NULL THEN 1 END) AS with_output_payload,
              COUNT(CASE WHEN retrieval_context IS NOT NULL THEN 1 END) AS with_retrieval_context,
              COUNT(CASE WHEN evidence_refs IS NOT NULL THEN 1 END) AS with_evidence_refs
       FROM gateway_run_nodes`
    );
    const payloadStats = runNodePayloadRows[0] || {};
    assertCondition(Number(payloadStats.with_input_payload || 0) >= 1, 'run node input payload samples exist', 'run node input payload samples are missing');
    assertCondition(Number(payloadStats.with_output_payload || 0) >= 1, 'run node output payload samples exist', 'run node output payload samples are missing');
    assertCondition(Number(payloadStats.with_retrieval_context || 0) >= 1, 'run node retrieval context samples exist', 'run node retrieval context samples are missing');
    assertCondition(Number(payloadStats.with_evidence_refs || 0) >= 1, 'run node evidence refs samples exist', 'run node evidence refs samples are missing');
    console.log(JSON.stringify({ run_node_payloads: runNodePayloadRows[0] || {} }, null, 2));

    console.log('--- foundation and governance assets ---');
    const integrationCount = await scalar(conn, 'SELECT COUNT(*) AS c FROM gateway_integration_connections');
    assertCondition(Number(integrationCount) >= 4, 'integration connections seeded', `expected at least 4 integration connections, got ${integrationCount}`);

    const valueAssessmentCount = await scalar(conn, 'SELECT COUNT(*) AS c FROM gateway_value_assessments');
    assertCondition(Number(valueAssessmentCount) >= 1, 'value assessment samples exist', 'no value assessment samples found');

    const certificationCount = await scalar(conn, 'SELECT COUNT(*) AS c FROM gateway_certification_records');
    assertCondition(Number(certificationCount) >= 1, 'certification samples exist', 'no certification samples found');

    const aiRulesKnowledgeCount = await scalar(
      conn,
      `SELECT COUNT(*) AS c
       FROM gateway_knowledge_assets
       WHERE asset_key IN (
         'ka-ai-rules-readme',
         'ka-ai-manual-pm-v1',
         'ka-ai-manual-rd-v1',
         'ka-ai-manual-qa-v1',
         'ka-ai-pipeline-p01',
         'ka-ai-pipeline-p02',
         'ka-ai-pipeline-p03',
         'ka-ai-pipeline-p04',
         'ka-ai-pipeline-p05'
       )`
    );
    assertCondition(Number(aiRulesKnowledgeCount) >= 9, 'ai-rules knowledge assets seeded', `expected at least 9 ai-rules assets, got ${aiRulesKnowledgeCount}`);

    const [agentPromptRows] = await conn.query(
      `SELECT agent_key, prompt_ref
       FROM gateway_agent_specs
       WHERE agent_key IN ('gate-review-agent', 'harness-node-executor', 'value-assessment-agent')
       ORDER BY agent_key ASC`
    );
    assertCondition(agentPromptRows.length === 3, 'official agent specs seeded', 'agent spec set is incomplete');

    const [skillRows] = await conn.query(
      `SELECT skill_key, prompt_ref
       FROM gateway_skill_packages
       WHERE prompt_ref LIKE 'ai-rules/%'
       ORDER BY skill_key ASC`
    );
    assertCondition(skillRows.length >= 7, 'ai-rules skill refs updated', `expected at least 7 ai-rules skill refs, got ${skillRows.length}`);

    console.log('--- samples ---');
    const [sampleProjectRows] = await conn.query(
      `SELECT code, name, okr_stage, official_order, status, risk_level
       FROM gateway_program_projects
       WHERE official_order < 900
       ORDER BY official_order ASC
       LIMIT 5`
    );
    const [sampleIntegrationRows] = await conn.query(
      `SELECT connection_key, category, status
       FROM gateway_integration_connections
       ORDER BY id ASC`
    );
    const [sampleAssessmentRows] = await conn.query(
      `SELECT project_code, assessment_key, assessment_status, assessment_score
       FROM gateway_value_assessments
       ORDER BY id ASC`
    );
    const [sampleCertificationRows] = await conn.query(
      `SELECT project_code, record_type, subject_name, assessment_result
       FROM gateway_certification_records
       ORDER BY id ASC`
    );

    console.log(JSON.stringify({
      sample_projects: sampleProjectRows,
      integrations: sampleIntegrationRows,
      value_assessments: sampleAssessmentRows,
      certification_records: sampleCertificationRows,
    }, null, 2));

    console.log('DONE: Harness Q2 database verification passed.');
  } finally {
    conn.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error('FAILED: Harness Q2 database verification failed.');
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
