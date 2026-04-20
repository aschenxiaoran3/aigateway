/**
 * 执行 003 门禁执行记录迁移（可重复执行：已存在则跳过）
 * 用法：在 ai-gateway 目录下 node scripts/run-migration-003-gate-executions.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    ssl: false,
    insecureAuth: true,
  });

  const steps = [
    [
      'add client_run_id',
      `ALTER TABLE \`gateway_gate_executions\`
        ADD COLUMN \`client_run_id\` VARCHAR(64) NULL COMMENT '客户端幂等键' AFTER \`check_results\``,
    ],
    [
      'add execution_meta',
      `ALTER TABLE \`gateway_gate_executions\`
        ADD COLUMN \`execution_meta\` JSON NULL COMMENT 'rule_id/rule_version/artifact_fingerprint/source/duration_ms/trace_id' AFTER \`client_run_id\``,
    ],
    [
      'add uk_client_run_id',
      `ALTER TABLE \`gateway_gate_executions\`
        ADD UNIQUE KEY \`uk_client_run_id\` (\`client_run_id\`)`,
    ],
  ];

  for (const [label, sql] of steps) {
    try {
      await conn.query(sql);
      console.log('[ok]', label);
    } catch (e) {
      if (e.errno === 1060 || e.code === 'ER_DUP_FIELDNAME') {
        console.log('[skip]', label, '- column already exists');
      } else if (e.errno === 1061 || e.code === 'ER_DUP_KEYNAME') {
        console.log('[skip]', label, '- index already exists');
      } else {
        console.error('[fail]', label, e.message);
        throw e;
      }
    }
  }

  await conn.end();
  console.log('Migration 003 finished.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
