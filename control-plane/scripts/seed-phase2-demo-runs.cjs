#!/usr/bin/env node
/**
 * 写入两条演示 pipeline 运行记录。依赖 mysql2（control-plane 已安装）。
 * 在 control-plane 目录：node scripts/seed-phase2-demo-runs.cjs
 */
const mysql = require('mysql2/promise');
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const cfg = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASS || '',
  database: process.env.DB_NAME || 'aiplan_erp_test',
};

async function ensureDocPipeline(conn) {
  const [rows] = await conn.query(
    'SELECT id, current_version_id FROM gateway_pipeline_definitions WHERE pipeline_key = ? LIMIT 1',
    ['doc-pipeline-v1']
  );
  if (rows[0]?.id && rows[0].current_version_id) {
    return { defId: rows[0].id, verId: rows[0].current_version_id };
  }
  let defId = rows[0]?.id;
  if (!defId) {
    const [ins] = await conn.query(
      `INSERT INTO gateway_pipeline_definitions (pipeline_key, name, domain, description, owner_role, status)
       VALUES ('doc-pipeline-v1', '文档管道 Phase1', 'engineering', '演示：标准节点对齐', '平台组', 'active')`
    );
    defId = ins.insertId;
  }
  const [vins] = await conn.query(
    `INSERT INTO gateway_pipeline_versions (pipeline_definition_id, version, status, published_at, change_summary)
     VALUES (?, '1.0.0', 'published', NOW(), 'seed')`,
    [defId]
  );
  const verId = vins.insertId;
  await conn.query('UPDATE gateway_pipeline_definitions SET current_version_id = ? WHERE id = ?', [verId, defId]);
  const nodes = [
    ['ingest', '文档接入', 'tool', 1],
    ['prd_gate', 'PRD 门禁', 'gate', 2],
    ['tech_spec_gate', '技术方案门禁', 'gate', 3],
    ['test_plan_gen', '测试方案生成', 'transform', 4],
    ['test_plan_gate', '测试方案门禁', 'gate', 5],
  ];
  for (const [node_key, node_name, node_type, sort_order] of nodes) {
    await conn.query(
      `INSERT IGNORE INTO gateway_pipeline_nodes
       (pipeline_version_id, node_key, node_name, node_type, sort_order, config_json)
       VALUES (?, ?, ?, ?, ?, CAST(? AS JSON))`,
      [verId, node_key, node_name, node_type, sort_order, '{}']
    );
  }
  return { defId, verId };
}

async function main() {
  const conn = await mysql.createConnection(cfg);
  try {
    const doc = await ensureDocPipeline(conn);
    const [[gr]] = await conn.query(
      'SELECT id, current_version_id FROM gateway_pipeline_definitions WHERE pipeline_key = ? LIMIT 1',
      ['gate-review']
    );
    if (!gr?.id) {
      console.error('缺少 gate-review 管道，请先执行 database/init-control-plane.sql');
      process.exit(1);
    }
    if (!gr.current_version_id) {
      console.error('gate-review 无 current_version_id，请先启动过一次 control-plane 或手动发布版本');
      process.exit(1);
    }
    const seeds = [
      { pid: doc.defId, vid: doc.verId, trace: 'trace-seed-doc-pipeline-001' },
      { pid: gr.id, vid: gr.current_version_id, trace: 'trace-seed-gate-review-001' },
    ];
    for (const s of seeds) {
      const [exist] = await conn.query('SELECT id FROM gateway_pipeline_runs WHERE trace_id = ? LIMIT 1', [
        s.trace,
      ]);
      if (exist.length) {
        console.log('已存在', s.trace);
        continue;
      }
      await conn.query(
        `INSERT INTO gateway_pipeline_runs
         (pipeline_definition_id, pipeline_version_id, trace_id, project_code, status, source_type, entry_event, started_at, ended_at, approval_status)
         VALUES (?, ?, ?, 'C04', 'completed', 'seed', 'phase2_demo', NOW(), NOW(), 'approved')`,
        [s.pid, s.vid, s.trace]
      );
      console.log('插入运行', s.trace);
    }
  } finally {
    await conn.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
