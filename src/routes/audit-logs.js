/**
 * 管理台日志查询 — GET /api/v1/audit-logs
 * 数据：MySQL gateway_usage_logs
 */

const db = require('../db/mysql');

async function handleAuditLogs(req, res) {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 20;
    const start = req.query.start || null;
    const end = req.query.end || null;
    const model = req.query.model || null;
    const api_key = req.query.api_key || null;
    const requestId = req.query.requestId || null;
    const status = req.query.status || null;
    const purpose = req.query.purpose || null;
    const client_app = req.query.client_app || req.query.client || null;

    const result = await db.listUsageLogs({
      page,
      limit,
      start,
      end,
      model,
      apiKeyPattern: api_key,
      requestId,
      httpStatus: status,
      purpose,
      client_app,
    });

    res.json({
      success: true,
      logs: result.logs,
      total: result.total,
      pagination: {
        page: result.page,
        limit: result.limit,
        total: result.total,
      },
    });
  } catch (error) {
    console.error('[audit-logs]', error.message);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to list usage logs',
    });
  }
}

module.exports = { handleAuditLogs };
