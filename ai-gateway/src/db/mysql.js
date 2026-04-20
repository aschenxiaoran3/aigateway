/**
 * MySQL 数据库连接模块
 */

const mysql = require('mysql2/promise');
const winston = require('winston');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.File({ filename: 'logs/db.log' }),
  ],
});

// 数据库连接池
let pool = null;

/**
 * 获取数据库连接池
 * 配置参数与 Java HikariCP 保持一致
 */
function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: process.env.DB_HOST || '127.0.0.1',
      port: Number(process.env.DB_PORT) || 3306,
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASS || '',
      database: process.env.DB_NAME || 'ai_gateway',
      
      // 连接参数（与 Java 配置一致）
      charset: 'utf8mb4',
      timezone: '+08:00',
      
      // SSL 配置（与 DBeaver/Java 一致）
      ssl: false,
      insecureAuth: true,
      
      // 字符编码（确保中文正常显示）
      dateStrings: false,
      
      // 连接池配置
      waitForConnections: true,
      connectionLimit: 32,        // maximumPoolSize
      queueLimit: 0,
      
      // 超时配置
      connectTimeout: 30000,      // 30s
      
      // KeepAlive
      enableKeepAlive: true,
      keepAliveInitialDelay: 0,
      
      // 调试
      debug: false,

      // DECIMAL 以 number 返回，避免 res.json 序列化异常；用量接口依赖数值运算
      decimalNumbers: true,
    });
    
    logger.info('Database pool created', {
      host: process.env.DB_HOST,
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
    });
  }
  
  return pool;
}

/**
 * 测试数据库连接
 */
async function testConnection() {
  try {
    const connection = await getPool().getConnection();
    await connection.ping();
    connection.release();
    logger.info('Database connection test successful');
    return true;
  } catch (error) {
    logger.error('Database connection test failed', { error: error.message });
    return false;
  }
}

/**
 * 关闭数据库连接池
 */
async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
    logger.info('Database pool closed');
  }
}

// ========== API Key 相关操作 ==========

/**
 * 获取 API Key 信息
 */
async function getApiKey(apiKey) {
  try {
    const [rows] = await getPool().execute(
      'SELECT * FROM gateway_api_keys WHERE api_key = ? AND status = "active"',
      [apiKey]
    );
    return rows[0] || null;
  } catch (error) {
    logger.error('Failed to get API key', { error: error.message });
    return null;
  }
}

/**
 * 创建 API Key
 */
async function createApiKey(data) {
  try {
    const [result] = await getPool().execute(
      `INSERT INTO gateway_api_keys 
       (api_key, type, name, description, quota_daily, quota_monthly, allowed_models, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.api_key,
        data.type,
        data.name,
        data.description || null,
        data.quota_daily,
        data.quota_monthly,
        JSON.stringify(data.allowed_models),
        data.status || 'active',
        data.created_by || null,
      ]
    );
    
    logger.info('API key created', { id: result.insertId, api_key: data.api_key });
    return { id: result.insertId, ...data };
  } catch (error) {
    logger.error('Failed to create API key', { error: error.message });
    throw error;
  }
}

/**
 * 获取 API Key 列表
 */
async function getApiKeys(filters = {}) {
  try {
    let sql = 'SELECT * FROM gateway_api_keys WHERE 1=1';
    const params = [];
    
    if (filters.type) {
      sql += ' AND type = ?';
      params.push(filters.type);
    }
    
    if (filters.status) {
      sql += ' AND status = ?';
      params.push(filters.status);
    }
    
    if (filters.search) {
      sql += ' AND name LIKE ?';
      params.push(`%${filters.search}%`);
    }
    
    sql += ' ORDER BY created_at DESC';
    
    const [rows] = await getPool().execute(sql, params);
    return rows;
  } catch (error) {
    logger.error('Failed to get API keys', { error: error.message });
    return [];
  }
}

/**
 * 更新 API Key
 */
async function updateApiKey(apiKey, data) {
  try {
    const fields = [];
    const params = [];
    
    if (data.name !== undefined) {
      fields.push('name = ?');
      params.push(data.name);
    }
    
    if (data.quota_daily !== undefined) {
      fields.push('quota_daily = ?');
      params.push(data.quota_daily);
    }
    
    if (data.quota_monthly !== undefined) {
      fields.push('quota_monthly = ?');
      params.push(data.quota_monthly);
    }
    
    if (data.allowed_models !== undefined) {
      fields.push('allowed_models = ?');
      params.push(JSON.stringify(data.allowed_models));
    }
    
    if (data.status !== undefined) {
      fields.push('status = ?');
      params.push(data.status);
    }
    
    if (fields.length === 0) {
      return null;
    }
    
    params.push(apiKey);
    
    const sql = `UPDATE gateway_api_keys SET ${fields.join(', ')} WHERE api_key = ?`;
    const [result] = await getPool().execute(sql, params);
    
    logger.info('API key updated', { api_key: apiKey });
    return { affectedRows: result.affectedRows };
  } catch (error) {
    logger.error('Failed to update API key', { error: error.message });
    throw error;
  }
}

/**
 * 删除 API Key
 */
async function deleteApiKey(apiKey) {
  try {
    const [result] = await getPool().execute(
      'DELETE FROM gateway_api_keys WHERE api_key = ?',
      [apiKey]
    );
    
    logger.info('API key deleted', { api_key: apiKey });
    return { affectedRows: result.affectedRows };
  } catch (error) {
    logger.error('Failed to delete API key', { error: error.message });
    throw error;
  }
}

/**
 * 更新 API Key 用量
 */
async function updateApiKeyUsage(apiKey, tokens) {
  try {
    const today = new Date().toISOString().split('T')[0];
    const month = today.substring(0, 7);
    
    await getPool().execute(
      `UPDATE gateway_api_keys 
       SET used_daily = used_daily + ?, 
           used_monthly = used_monthly + ?,
           last_used_at = NOW()
       WHERE api_key = ?`,
      [tokens, tokens, apiKey]
    );
    
    logger.debug('API key usage updated', { api_key: apiKey, tokens });
  } catch (error) {
    logger.error('Failed to update API key usage', { error: error.message });
  }
}

// ========== 用量日志相关操作 ==========

/**
 * 记录用量日志
 */
async function logUsage(data) {
  console.log('📝 [DB] logUsage called:', data);
  try {
    console.log('📝 [DB] Executing INSERT...');
    const [result] = await getPool().execute(
      `INSERT INTO gateway_usage_logs 
       (api_key_id, request_id, model, provider, prompt_tokens, completion_tokens, 
        total_tokens, cost_cny, purpose, pipeline, user_id, team_id, status, 
        error_message, response_time_ms, client_app, user_agent, trace_id, pipeline_run_id,
        run_node_id, agent_spec_id, skill_package_id, project_code, request_summary,
        response_summary, fallback_mode, human_intervention)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.api_key_id,
        data.request_id,
        data.model,
        data.provider,
        data.prompt_tokens,
        data.completion_tokens,
        data.total_tokens,
        data.cost_cny,
        data.purpose || null,
        data.pipeline || null,
        data.user_id || null,
        data.team_id || null,
        data.status || 'success',
        data.error_message || null,
        data.response_time_ms || null,
        data.client_app != null ? String(data.client_app).slice(0, 64) : null,
        data.user_agent != null ? String(data.user_agent).slice(0, 512) : null,
        data.trace_id || null,
        data.pipeline_run_id || null,
        data.run_node_id || null,
        data.agent_spec_id || null,
        data.skill_package_id || null,
        data.project_code || null,
        data.request_summary || null,
        data.response_summary || null,
        data.fallback_mode || null,
        data.human_intervention ? 1 : 0,
      ]
    );
    
    console.log('✅ [DB] Usage logged, ID:', result.insertId);
    return { id: result.insertId };
  } catch (error) {
    console.error('❌ [DB] Failed to log usage:', error.message);
    logger.error('Failed to log usage', { error: error.message });
    throw error;
  }
}

/**
 * 用量统计时间窗：与 trend / models / teams 共用同一谓词，避免 DATE() 与瞬时区间混用导致卡片与图表不一致。
 */
function normalizeUsageRange(startDate, endDate) {
  const defaultStart = () =>
    new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const defaultEnd = () => new Date().toISOString();

  let start = startDate != null && String(startDate).trim() !== '' ? String(startDate).trim() : defaultStart();
  let end = endDate != null && String(endDate).trim() !== '' ? String(endDate).trim() : defaultEnd();

  // 纯日期 YYYY-MM-DD：MySQL 会把 '2026-04-11' 当成 00:00:00，导致当天除零点外的请求全部落在区间外
  if (/^\d{4}-\d{2}-\d{2}$/.test(start)) {
    start = `${start} 00:00:00`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    end = `${end} 23:59:59.999`;
  }

  return [start, end];
}

/**
 * 用量聚合与 getCostReport 一致：按日历日过滤，避免 ISO 瞬时与 DATETIME/会话时区比较漏掉整日数据。
 * 若请求已传 YYYY-MM-DD（管理台 Dashboard），直接使用；否则从 normalizeUsageRange 结果取日期部分。
 */
function usageCalendarBounds(startDate, endDate) {
  const a = startDate != null && String(startDate).trim() !== '' ? String(startDate).trim() : null;
  const b = endDate != null && String(endDate).trim() !== '' ? String(endDate).trim() : null;
  if (a && b && /^\d{4}-\d{2}-\d{2}$/.test(a) && /^\d{4}-\d{2}-\d{2}$/.test(b)) {
    return [a, b];
  }
  const [s, e] = normalizeUsageRange(startDate, endDate);
  const sd = String(s).match(/^(\d{4}-\d{2}-\d{2})/)?.[1] || String(s).slice(0, 10);
  const ed = String(e).match(/^(\d{4}-\d{2}-\d{2})/)?.[1] || String(e).slice(0, 10);
  return [sd, ed];
}

/**
 * 用量筛选：按模型名、API Key 主键（与 gateway_usage_logs 列一致）
 * @param {object} filters
 * @param {string} [tableAlias] 例如日志表别名 `l`，用于 JOIN 查询
 */
function buildUsageLogFilterSql(filters = {}, tableAlias = '') {
  const a = tableAlias ? `${tableAlias}.` : '';
  const parts = [];
  const params = [];
  if (filters.model != null && String(filters.model).trim() !== '') {
    parts.push(`${a}model = ?`);
    params.push(String(filters.model).trim());
  }
  if (filters.api_key_id != null && filters.api_key_id !== '') {
    const id = Number(filters.api_key_id);
    if (Number.isFinite(id)) {
      parts.push(`${a}api_key_id = ?`);
      params.push(id);
    }
  }
  return {
    sql: parts.length ? ` AND ${parts.join(' AND ')}` : '',
    params,
  };
}

/**
 * 时间范围内出现过的模型列表（用于筛选器下拉；可只按 api_key_id 缩小范围）
 */
async function getDistinctUsageModels(startDate, endDate, scopeFilters = {}) {
  try {
    const [dStart, dEnd] = usageCalendarBounds(startDate, endDate);
    const { sql, params: fParams } = buildUsageLogFilterSql(
      { api_key_id: scopeFilters.api_key_id },
      ''
    );
    const [rows] = await getPool().execute(
      `SELECT DISTINCT model FROM gateway_usage_logs
       WHERE DATE(created_at) BETWEEN DATE(?) AND DATE(?)${sql}
       ORDER BY model`,
      [dStart, dEnd, ...fParams]
    );
    return (rows || []).map((r) => r.model).filter(Boolean);
  } catch (error) {
    logger.error('Failed to get distinct usage models', { error: error.message });
    return [];
  }
}

/**
 * 获取用量统计
 * @param {object} [filters] { model?, api_key_id? }
 */
async function getUsageStats(startDate, endDate, filters = {}) {
  try {
    const [dStart, dEnd] = usageCalendarBounds(startDate, endDate);
    const { sql, params: fParams } = buildUsageLogFilterSql(filters, '');
    const [rows] = await getPool().execute(
      `SELECT 
        COALESCE(SUM(total_tokens), 0) AS total_tokens,
        COALESCE(SUM(cost_cny), 0) AS total_cost,
        COUNT(*) AS total_requests,
        COUNT(DISTINCT user_id) AS active_users
       FROM gateway_usage_logs
       WHERE DATE(created_at) BETWEEN DATE(?) AND DATE(?)${sql}`,
      [dStart, dEnd, ...fParams]
    );

    return rows[0] || { total_tokens: 0, total_cost: 0, total_requests: 0, active_users: 0 };
  } catch (error) {
    logger.error('Failed to get usage stats', { error: error.message });
    return { total_tokens: 0, total_cost: 0, total_requests: 0, active_users: 0 };
  }
}

/**
 * 获取 Token 趋势
 * @param {object} [filters] { model?, api_key_id? }
 */
async function getUsageTrend(startDate, endDate, filters = {}) {
  try {
    const [dStart, dEnd] = usageCalendarBounds(startDate, endDate);
    const { sql, params: fParams } = buildUsageLogFilterSql(filters, '');
    const [rows] = await getPool().execute(
      `SELECT 
        DATE(created_at) AS date,
        COALESCE(SUM(total_tokens), 0) AS tokens,
        COALESCE(SUM(cost_cny), 0) AS cost
       FROM gateway_usage_logs
       WHERE DATE(created_at) BETWEEN DATE(?) AND DATE(?)${sql}
       GROUP BY DATE(created_at)
       ORDER BY date`,
      [dStart, dEnd, ...fParams]
    );

    return rows || [];
  } catch (error) {
    logger.error('Failed to get usage trend', { error: error.message });
    return [];
  }
}

/**
 * 获取模型用量排行
 * @param {object} [filters] { model?, api_key_id? } 指定 model 时结果通常为一行，便于看单模型汇总
 */
async function getModelUsage(startDate, endDate, filters = {}) {
  try {
    const [dStart, dEnd] = usageCalendarBounds(startDate, endDate);
    const { sql, params: fParams } = buildUsageLogFilterSql(filters, '');
    const [rows] = await getPool().execute(
      `SELECT 
        model,
        COALESCE(SUM(total_tokens), 0) AS tokens,
        COALESCE(SUM(cost_cny), 0) AS cost,
        COUNT(*) AS requests
       FROM gateway_usage_logs
       WHERE DATE(created_at) BETWEEN DATE(?) AND DATE(?)${sql}
       GROUP BY model
       ORDER BY tokens DESC`,
      [dStart, dEnd, ...fParams]
    );

    return rows;
  } catch (error) {
    logger.error('Failed to get model usage', { error: error.message });
    return [];
  }
}

/**
 * 获取团队用量排行
 * @param {object} [filters] { model?, api_key_id? }
 */
async function getTeamUsage(startDate, endDate, filters = {}) {
  try {
    const [dStart, dEnd] = usageCalendarBounds(startDate, endDate);
    const { sql, params: fParams } = buildUsageLogFilterSql(filters, 'l');
    const [rows] = await getPool().execute(
      `SELECT 
        COALESCE(MAX(t.name), '未关联团队') AS team,
        COALESCE(SUM(l.total_tokens), 0) AS tokens,
        COALESCE(SUM(l.cost_cny), 0) AS cost,
        MAX(t.quota_daily) AS quota
       FROM gateway_usage_logs l
       LEFT JOIN gateway_teams t ON l.team_id = t.id
       WHERE DATE(l.created_at) BETWEEN DATE(?) AND DATE(?)${sql}
       GROUP BY l.team_id
       ORDER BY tokens DESC`,
      [dStart, dEnd, ...fParams]
    );

    return rows;
  } catch (error) {
    logger.error('Failed to get team usage', { error: error.message });
    return [];
  }
}

/**
 * 获取团队列表
 */
async function getTeams(filters = {}) {
  try {
    let sql = `SELECT
      id,
      name,
      members_count AS members,
      quota_daily,
      quota_monthly,
      used_daily,
      used_monthly,
      DATE_FORMAT(created_at, '%Y-%m-%d') AS created_at,
      status
    FROM gateway_teams
    WHERE 1=1`;
    const params = [];

    if (filters.status) {
      sql += ' AND status = ?';
      params.push(filters.status);
    }
    if (filters.search) {
      sql += ' AND name LIKE ?';
      params.push(`%${filters.search}%`);
    }

    sql += ' ORDER BY id ASC';
    const [rows] = await getPool().execute(sql, params);
    return rows || [];
  } catch (error) {
    logger.error('Failed to get teams', { error: error.message });
    return [];
  }
}

/**
 * 获取单个团队
 */
async function getTeamById(id) {
  try {
    const [rows] = await getPool().execute(
      `SELECT
        id,
        name,
        members_count AS members,
        quota_daily,
        quota_monthly,
        used_daily,
        used_monthly,
        DATE_FORMAT(created_at, '%Y-%m-%d') AS created_at,
        status
      FROM gateway_teams
      WHERE id = ?`,
      [id]
    );
    return rows[0] || null;
  } catch (error) {
    logger.error('Failed to get team by id', { error: error.message });
    return null;
  }
}

/**
 * 创建团队
 */
async function createTeam(data) {
  try {
    const [result] = await getPool().execute(
      `INSERT INTO gateway_teams
       (name, description, members_count, quota_daily, quota_monthly, used_daily, used_monthly, status)
       VALUES (?, ?, ?, ?, ?, 0, 0, ?)`,
      [
        data.name,
        data.description || null,
        Number(data.members) || 1,
        Number(data.quota_daily) || 0,
        Number(data.quota_monthly) || 0,
        data.status || 'active'
      ]
    );
    return getTeamById(result.insertId);
  } catch (error) {
    logger.error('Failed to create team', { error: error.message });
    throw error;
  }
}

/**
 * 更新团队
 */
async function updateTeam(id, data) {
  try {
    const fields = [];
    const params = [];

    if (data.name !== undefined) {
      fields.push('name = ?');
      params.push(data.name);
    }
    if (data.description !== undefined) {
      fields.push('description = ?');
      params.push(data.description);
    }
    if (data.members !== undefined) {
      fields.push('members_count = ?');
      params.push(Number(data.members) || 0);
    }
    if (data.quota_daily !== undefined) {
      fields.push('quota_daily = ?');
      params.push(Number(data.quota_daily) || 0);
    }
    if (data.quota_monthly !== undefined) {
      fields.push('quota_monthly = ?');
      params.push(Number(data.quota_monthly) || 0);
    }
    if (data.status !== undefined) {
      fields.push('status = ?');
      params.push(data.status);
    }

    if (fields.length === 0) {
      return getTeamById(id);
    }

    params.push(id);
    await getPool().execute(`UPDATE gateway_teams SET ${fields.join(', ')} WHERE id = ?`, params);
    return getTeamById(id);
  } catch (error) {
    logger.error('Failed to update team', { error: error.message });
    throw error;
  }
}

/**
 * 删除团队
 */
async function deleteTeam(id) {
  try {
    const [result] = await getPool().execute('DELETE FROM gateway_teams WHERE id = ?', [id]);
    return { affectedRows: result.affectedRows };
  } catch (error) {
    logger.error('Failed to delete team', { error: error.message });
    throw error;
  }
}

/**
 * 获取团队成员
 */
async function getTeamMembers(teamId) {
  try {
    const [rows] = await getPool().execute(
      `SELECT id, username AS name, role, email
       FROM gateway_users
       WHERE team_id = ? AND status = 'active'
       ORDER BY id ASC`,
      [teamId]
    );
    return rows || [];
  } catch (error) {
    logger.error('Failed to get team members', { error: error.message });
    return [];
  }
}

/**
 * 添加团队成员
 */
async function addTeamMember(teamId, data) {
  try {
    const [result] = await getPool().execute(
      `INSERT INTO gateway_users (username, email, team_id, role, status)
       VALUES (?, ?, ?, ?, 'active')`,
      [data.name, data.email, teamId, data.role || 'member']
    );
    await getPool().execute(
      'UPDATE gateway_teams SET members_count = members_count + 1 WHERE id = ?',
      [teamId]
    );
    const [rows] = await getPool().execute(
      'SELECT id, username AS name, role, email FROM gateway_users WHERE id = ?',
      [result.insertId]
    );
    return rows[0] || null;
  } catch (error) {
    logger.error('Failed to add team member', { error: error.message });
    throw error;
  }
}

/**
 * 移除团队成员
 */
async function removeTeamMember(teamId, memberId) {
  try {
    const [result] = await getPool().execute(
      'DELETE FROM gateway_users WHERE id = ? AND team_id = ?',
      [memberId, teamId]
    );
    if (result.affectedRows > 0) {
      await getPool().execute(
        'UPDATE gateway_teams SET members_count = GREATEST(members_count - 1, 0) WHERE id = ?',
        [teamId]
      );
    }
    return { affectedRows: result.affectedRows };
  } catch (error) {
    logger.error('Failed to remove team member', { error: error.message });
    throw error;
  }
}

/**
 * 获取成本报表
 */
async function getCostReport(startDate, endDate) {
  try {
    const [trend] = await getPool().execute(
      `SELECT
        DATE(created_at) AS date,
        SUM(total_tokens) AS tokens,
        SUM(cost_cny) AS cost
       FROM gateway_usage_logs
       WHERE DATE(created_at) BETWEEN DATE(?) AND DATE(?)
       GROUP BY DATE(created_at)
       ORDER BY DATE(created_at)`,
      [startDate, endDate]
    );

    const [byTeam] = await getPool().execute(
      `SELECT
        COALESCE(t.name, '未分配团队') AS team,
        SUM(l.cost_cny) AS cost
       FROM gateway_usage_logs l
       LEFT JOIN gateway_teams t ON l.team_id = t.id
       WHERE DATE(l.created_at) BETWEEN DATE(?) AND DATE(?)
       GROUP BY COALESCE(t.name, '未分配团队')
       ORDER BY cost DESC`,
      [startDate, endDate]
    );

    const [byModel] = await getPool().execute(
      `SELECT
        model,
        SUM(cost_cny) AS cost
       FROM gateway_usage_logs
       WHERE DATE(created_at) BETWEEN DATE(?) AND DATE(?)
       GROUP BY model
       ORDER BY cost DESC`,
      [startDate, endDate]
    );

    const totalCost = Number(
      (trend || []).reduce((sum, row) => sum + Number(row.cost || 0), 0)
    );
    const withPercentage = (rows, field) =>
      (rows || []).map((row) => {
        const cost = Number(row.cost || 0);
        return {
          [field]: row[field],
          cost,
          percentage: totalCost > 0 ? Number(((cost / totalCost) * 100).toFixed(1)) : 0
        };
      });

    return {
      trend: (trend || []).map((row) => ({
        date: row.date,
        tokens: Number(row.tokens || 0),
        cost: Number(row.cost || 0)
      })),
      byTeam: withPercentage(byTeam, 'team'),
      byModel: withPercentage(byModel, 'model'),
      summary: {
        total_cost: totalCost,
        total_tokens: Number((trend || []).reduce((sum, row) => sum + Number(row.tokens || 0), 0)),
        avg_cost_per_1k: totalCost > 0
          ? Number(((totalCost / Math.max(1, Number((trend || []).reduce((sum, row) => sum + Number(row.tokens || 0), 0))) * 1000)).toFixed(6))
          : 0
      }
    };
  } catch (error) {
    logger.error('Failed to get cost report', { error: error.message });
    return {
      trend: [],
      byTeam: [],
      byModel: [],
      summary: { total_cost: 0, total_tokens: 0, avg_cost_per_1k: 0 }
    };
  }
}

/**
 * 读取系统设置
 */
async function getSettings() {
  try {
    const [rows] = await getPool().execute(
      `SELECT setting_key, setting_value
       FROM gateway_settings`
    );
    const mapped = {};
    for (const row of rows || []) {
      try {
        mapped[row.setting_key] = JSON.parse(row.setting_value);
      } catch {
        mapped[row.setting_key] = row.setting_value;
      }
    }
    return mapped;
  } catch (error) {
    if (/doesn't exist|不存在/i.test(error.message || '')) {
      return {};
    }
    logger.error('Failed to get settings', { error: error.message });
    return {};
  }
}

/**
 * 保存系统设置
 */
async function upsertSettings(settings) {
  try {
    await getPool().execute(
      `CREATE TABLE IF NOT EXISTS gateway_settings (
        id INT AUTO_INCREMENT PRIMARY KEY,
        setting_key VARCHAR(100) NOT NULL UNIQUE,
        setting_value TEXT NULL,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
    );
    const entries = Object.entries(settings || {});
    for (const [key, value] of entries) {
      await getPool().execute(
        `INSERT INTO gateway_settings (setting_key, setting_value)
         VALUES (?, ?)
         ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
        [key, JSON.stringify(value)]
      );
    }
    return true;
  } catch (error) {
    logger.error('Failed to upsert settings', { error: error.message });
    throw error;
  }
}

function _parseJsonColumn(value) {
  if (value == null) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/**
 * 门禁规则列表
 */
async function listGateRules(filters = {}) {
  let sql = 'SELECT * FROM gateway_gate_rules WHERE 1=1';
  const params = [];
  if (filters.status) {
    sql += ' AND status = ?';
    params.push(filters.status);
  }
  if (filters.gate_type) {
    sql += ' AND gate_type = ?';
    params.push(filters.gate_type);
  }
  sql += ' ORDER BY updated_at DESC';
  const [rows] = await getPool().execute(sql, params);
  return rows.map((row) => ({
    ...row,
    rules_config:
      typeof row.rules_config === 'string'
        ? _parseJsonColumn(row.rules_config)
        : row.rules_config,
  }));
}

async function getGateRuleById(id) {
  const [rows] = await getPool().execute(
    'SELECT * FROM gateway_gate_rules WHERE id = ?',
    [id]
  );
  const row = rows[0];
  if (!row) return null;
  return {
    ...row,
    rules_config:
      typeof row.rules_config === 'string'
        ? _parseJsonColumn(row.rules_config)
        : row.rules_config,
  };
}

async function createGateRule(data) {
  const cfg =
    typeof data.rules_config === 'string'
      ? data.rules_config
      : JSON.stringify(data.rules_config || {});
  const [result] = await getPool().execute(
    `INSERT INTO gateway_gate_rules (gate_type, gate_name, version, rules_config, status, created_by)
     VALUES (?, ?, ?, CAST(? AS JSON), ?, ?)`,
    [
      data.gate_type,
      data.gate_name,
      data.version || '1.0.0',
      cfg,
      data.status || 'active',
      data.created_by || null,
    ]
  );
  return { id: result.insertId };
}

async function updateGateRule(id, data) {
  const fields = [];
  const params = [];
  if (data.gate_name !== undefined) {
    fields.push('gate_name = ?');
    params.push(data.gate_name);
  }
  if (data.version !== undefined) {
    fields.push('version = ?');
    params.push(data.version);
  }
  if (data.rules_config !== undefined) {
    fields.push('rules_config = CAST(? AS JSON)');
    params.push(
      typeof data.rules_config === 'string'
        ? data.rules_config
        : JSON.stringify(data.rules_config)
    );
  }
  if (data.status !== undefined) {
    fields.push('status = ?');
    params.push(data.status);
  }
  if (fields.length === 0) return { affectedRows: 0 };
  params.push(id);
  const [result] = await getPool().execute(
    `UPDATE gateway_gate_rules SET ${fields.join(', ')} WHERE id = ?`,
    params
  );
  return { affectedRows: result.affectedRows };
}

function _normalizeGateExecutionRow(row) {
  if (!row) return null;
  const meta = row.execution_meta;
  return {
    ...row,
    failed_checks: _parseJsonColumn(row.failed_checks),
    check_results: _parseJsonColumn(row.check_results),
    execution_meta:
      typeof meta === 'string' || meta == null
        ? _parseJsonColumn(meta)
        : meta,
    passed: Boolean(row.passed),
  };
}

async function listGateExecutions({ limit = 50, offset = 0, gate_type } = {}) {
  let sql = 'SELECT * FROM gateway_gate_executions WHERE 1=1';
  const params = [];
  if (gate_type) {
    sql += ' AND gate_type = ?';
    params.push(gate_type);
  }
  const safeLimit = Number(limit) || 50;
  const safeOffset = Number(offset) || 0;
  sql += ` ORDER BY created_at DESC LIMIT ${safeLimit} OFFSET ${safeOffset}`;
  const [rows] = await getPool().execute(sql, params);
  return rows.map((row) => _normalizeGateExecutionRow(row));
}

async function getGateExecutionByClientRunId(clientRunId) {
  if (!clientRunId || typeof clientRunId !== 'string') return null;
  const [rows] = await getPool().execute(
    'SELECT * FROM gateway_gate_executions WHERE client_run_id = ? LIMIT 1',
    [clientRunId]
  );
  return _normalizeGateExecutionRow(rows[0]);
}

async function createGateExecution(data) {
  const failed =
    data.failed_checks != null ? JSON.stringify(data.failed_checks) : null;
  const results =
    data.check_results != null ? JSON.stringify(data.check_results) : null;
  const clientRunId = data.client_run_id != null ? String(data.client_run_id) : null;
  let executionMeta = null;
  if (data.execution_meta != null) {
    executionMeta =
      typeof data.execution_meta === 'string'
        ? data.execution_meta
        : JSON.stringify(data.execution_meta);
  }
  const [result] = await getPool().execute(
    `INSERT INTO gateway_gate_executions
     (gate_type, gate_name, document_name, author, total_score, max_score, passed, failed_checks, check_results, client_run_id, execution_meta)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.gate_type,
      data.gate_name,
      data.document_name || null,
      data.author || null,
      data.total_score ?? 0,
      data.max_score ?? 100,
      data.passed ? 1 : 0,
      failed,
      results,
      clientRunId,
      executionMeta,
    ]
  );
  return { id: result.insertId };
}

async function getGateExecutionById(id) {
  const [rows] = await getPool().execute(
    'SELECT * FROM gateway_gate_executions WHERE id = ?',
    [id]
  );
  return _normalizeGateExecutionRow(rows[0]);
}

const MAX_GATE_ENGINE_LOG_DETAIL_CHARS = 60000;

/**
 * 批量写入门禁引擎诊断日志（单次最多 50 条）
 */
async function createGateEngineLogsBatch(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return { inserted: 0 };
  }
  const slice = entries.slice(0, 50);
  const placeholders = [];
  const values = [];
  for (const e of slice) {
    const createdAt = e.created_at != null ? String(e.created_at).trim() : '';
    if (!createdAt) continue;
    const event = String(e.event || '').slice(0, 64);
    if (!event) continue;
    let detailStr = null;
    if (e.detail != null) {
      const raw =
        typeof e.detail === 'string'
          ? e.detail
          : JSON.stringify(e.detail);
      detailStr =
        raw.length > MAX_GATE_ENGINE_LOG_DETAIL_CHARS
          ? raw.slice(0, MAX_GATE_ENGINE_LOG_DETAIL_CHARS)
          : raw;
    }
    const source =
      e.source != null ? String(e.source).slice(0, 32) : null;
    const traceId =
      e.trace_id != null ? String(e.trace_id).slice(0, 128) : null;
    const gateType =
      e.gate_type != null ? String(e.gate_type).slice(0, 16) : null;
    let ruleId = null;
    if (e.rule_id != null && e.rule_id !== '') {
      const n = Number(e.rule_id);
      ruleId = Number.isNaN(n) ? null : n;
    }
    placeholders.push('(?, ?, ?, ?, ?, ?, ?)');
    values.push(
      createdAt,
      event,
      detailStr,
      source,
      traceId,
      gateType,
      ruleId
    );
  }
  if (!values.length) {
    return { inserted: 0 };
  }
  const sql = `INSERT INTO gateway_gate_engine_logs (created_at, \`event\`, detail, source, trace_id, gate_type, rule_id) VALUES ${placeholders.join(',')}`;
  await getPool().execute(sql, values);
  return { inserted: placeholders.length };
}

/**
 * 分页查询引擎诊断日志
 */
async function listGateEngineLogs(options = {}) {
  const page = Math.max(1, parseInt(String(options.page), 10) || 1);
  const pageSize = Math.min(
    100,
    Math.max(1, parseInt(String(options.pageSize), 10) || 20)
  );
  const offset = (page - 1) * pageSize;

  const conditions = [];
  const params = [];

  const gateType = options.gate_type;
  if (gateType != null && String(gateType).trim() !== '') {
    conditions.push('gate_type = ?');
    params.push(String(gateType).trim());
  }
  const event = options.event;
  if (event != null && String(event).trim() !== '') {
    conditions.push('`event` LIKE ?');
    params.push(`%${String(event).trim()}%`);
  }
  const traceId = options.trace_id;
  if (traceId != null && String(traceId).trim() !== '') {
    conditions.push('trace_id = ?');
    params.push(String(traceId).trim());
  }
  const since = options.since;
  if (since != null && String(since).trim() !== '') {
    conditions.push('created_at >= ?');
    params.push(String(since).trim());
  }
  const until = options.until;
  if (until != null && String(until).trim() !== '') {
    conditions.push('created_at <= ?');
    params.push(String(until).trim());
  }

  const whereSql =
    conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const countSql = `SELECT COUNT(*) AS cnt FROM gateway_gate_engine_logs ${whereSql}`;
  const dataSql = `SELECT * FROM gateway_gate_engine_logs ${whereSql} ORDER BY created_at DESC LIMIT ${pageSize} OFFSET ${offset}`;

  const pool = getPool();
  const [[countRow]] = await pool.execute(countSql, params);
  const total = Number(countRow?.cnt || 0);
  const [rows] = await pool.execute(dataSql, params);
  const normalized = (rows || []).map((r) => ({
    ...r,
    detail:
      typeof r.detail === 'string' || r.detail == null
        ? _parseJsonColumn(r.detail)
        : r.detail,
  }));
  return {
    rows: normalized,
    total,
    page,
    pageSize,
  };
}

/**
 * 更新使用记录的成本
 */
async function updateUsageCost(requestId, costCny) {
  try {
    const [result] = await getPool().execute(
      'UPDATE gateway_usage_logs SET cost_cny = ? WHERE request_id = ?',
      [costCny, requestId]
    );
    
    logger.debug('Usage cost updated', { request_id: requestId, cost_cny: costCny });
    return { affectedRows: result.affectedRows };
  } catch (error) {
    logger.error('Failed to update usage cost', { error: error.message });
    throw error;
  }
}

/**
 * 管理台「日志查询」：从 gateway_usage_logs 分页查询（支持模型 / Key / 请求 ID / 时间 / HTTP 状态筛选）
 */
async function listUsageLogs(options = {}) {
  const page = Math.max(1, parseInt(String(options.page), 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(String(options.limit), 10) || 20));
  const offset = (page - 1) * limit;

  const {
    start: startRaw,
    end: endRaw,
    model,
    apiKeyPattern,
    requestId,
    httpStatus,
  } = options;

  const conditions = [];
  const params = [];

  // 未传时间范围时：不按时间过滤（仅分页），避免「库里有历史数据但默认只查近 7 天」导致列表恒为空
  const start =
    startRaw != null && String(startRaw).trim() !== '' ? String(startRaw).trim() : null;
  const end =
    endRaw != null && String(endRaw).trim() !== '' ? String(endRaw).trim() : null;
  if (start && end) {
    conditions.push('l.created_at >= ? AND l.created_at <= ?');
    params.push(start, end);
  }

  if (model != null && String(model).trim() !== '') {
    conditions.push('l.model = ?');
    params.push(String(model).trim());
  }
  if (requestId != null && String(requestId).trim() !== '') {
    conditions.push('l.request_id = ?');
    params.push(String(requestId).trim());
  }
  if (apiKeyPattern != null && String(apiKeyPattern).trim() !== '') {
    conditions.push('k.api_key LIKE ?');
    params.push(`%${String(apiKeyPattern).trim()}%`);
  }
  const purposePat = options.purpose;
  if (purposePat != null && String(purposePat).trim() !== '') {
    conditions.push('l.purpose LIKE ?');
    params.push(`%${String(purposePat).trim()}%`);
  }
  const clientApp = options.client_app;
  if (clientApp != null && String(clientApp).trim() !== '') {
    conditions.push('l.client_app = ?');
    params.push(String(clientApp).trim().slice(0, 64));
  }
  const st = httpStatus != null ? String(httpStatus) : '';
  if (st === '200') {
    conditions.push(`l.status = 'success'`);
  } else if (st === '500') {
    conditions.push(`l.status = 'failed'`);
  }

  const whereSql =
    conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const countSql = `
    SELECT COUNT(*) AS cnt
    FROM gateway_usage_logs l
    LEFT JOIN gateway_api_keys k ON l.api_key_id = k.id
    ${whereSql}
  `;
  const dataSql = `
    SELECT
      l.request_id,
      l.created_at AS timestamp,
      k.api_key AS api_key,
      k.name AS api_key_name,
      l.model,
      l.provider,
      l.purpose,
      l.pipeline,
      l.trace_id,
      l.pipeline_run_id,
      l.project_code,
      l.client_app,
      l.user_agent,
      l.request_summary,
      l.response_summary,
      l.prompt_tokens,
      l.completion_tokens,
      l.total_tokens,
      l.cost_cny,
      l.response_time_ms AS duration_ms,
      CASE WHEN l.status = 'success' THEN 200 ELSE 500 END AS status
    FROM gateway_usage_logs l
    LEFT JOIN gateway_api_keys k ON l.api_key_id = k.id
    ${whereSql}
    ORDER BY l.created_at DESC
    LIMIT ${Number(limit) || 20} OFFSET ${Number(offset) || 0}
  `;

  try {
    const pool = getPool();
    const [[countRow]] = await pool.execute(countSql, params);
    const total = Number(countRow?.cnt || 0);
    // 注意：部分 MySQL 版本下 LIMIT/OFFSET 占位符会触发 mysqld_stmt_execute 参数错误，故用已校验的整数拼接
    const [rows] = await pool.execute(dataSql, params);
    return {
      logs: rows || [],
      total,
      page,
      limit,
    };
  } catch (error) {
    logger.error('listUsageLogs failed', { error: error.message });
    throw error;
  }
}

// 导出所有函数
module.exports = {
  getPool,
  testConnection,
  closePool,
  
  // API Key
  getApiKey,
  createApiKey,
  getApiKeys,
  updateApiKey,
  deleteApiKey,
  updateApiKeyUsage,
  
  // 用量日志
  logUsage,
  listUsageLogs,
  getUsageStats,
  getUsageTrend,
  getModelUsage,
  getTeamUsage,
  getDistinctUsageModels,
  updateUsageCost,
  getTeams,
  getTeamById,
  createTeam,
  updateTeam,
  deleteTeam,
  getTeamMembers,
  addTeamMember,
  removeTeamMember,
  getCostReport,
  getSettings,
  upsertSettings,

  // 门禁
  listGateRules,
  getGateRuleById,
  createGateRule,
  updateGateRule,
  listGateExecutions,
  createGateExecution,
  getGateExecutionById,
  getGateExecutionByClientRunId,

  createGateEngineLogsBatch,
  listGateEngineLogs,
};
