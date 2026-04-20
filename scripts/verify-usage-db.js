#!/usr/bin/env node
/**
 * 与网关使用同一套 DB_* 环境变量，打印 gateway_usage_logs 聚合，便于与管理台 Dashboard 对齐排查。
 *
 * 用法（在 ai-gateway 目录）：
 *   node scripts/verify-usage-db.js
 *   node scripts/verify-usage-db.js 2026-04-01T00:00:00.000Z 2026-04-10T23:59:59.999Z
 *
 * 或：npm run verify:usage-db
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const mysql = require('mysql2/promise');

async function main() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    charset: 'utf8mb4',
    timezone: '+08:00',
  });

  const start = process.argv[2];
  const end = process.argv[3];

  const [[all]] = await pool.execute(
    `SELECT COUNT(*) AS cnt, COALESCE(SUM(total_tokens),0) AS total_tokens, COALESCE(SUM(cost_cny),0) AS total_cost
     FROM gateway_usage_logs`
  );

  let ranged = null;
  if (start && end) {
    const [[row]] = await pool.execute(
      `SELECT COUNT(*) AS total_requests,
              COALESCE(SUM(total_tokens),0) AS total_tokens,
              COALESCE(SUM(cost_cny),0) AS total_cost,
              COUNT(DISTINCT user_id) AS active_users
       FROM gateway_usage_logs
       WHERE created_at >= ? AND created_at <= ?`,
      [start, end]
    );
    ranged = row;
  }

  const [byDay] = await pool.execute(
    `SELECT DATE(created_at) AS d, COUNT(*) AS n, COALESCE(SUM(total_tokens),0) AS tokens
     FROM gateway_usage_logs
     GROUP BY DATE(created_at)
     ORDER BY d DESC
     LIMIT 14`
  );

  console.log(
    JSON.stringify(
      {
        db: {
          host: process.env.DB_HOST,
          database: process.env.DB_NAME,
          user: process.env.DB_USER,
        },
        gateway_usage_logs_all: all,
        gateway_usage_logs_in_range: ranged,
        last14_days_by_date: byDay,
      },
      null,
      2
    )
  );

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
