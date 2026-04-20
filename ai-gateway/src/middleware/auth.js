/**
 * 认证中间件 - API Key 验证
 * 
 * 支持的认证方式:
 * 1. Header: X-API-Key
 * 2. Header: Authorization: Bearer <token>
 * 
 * API Key 格式:
 * - 团队 Key: team_<uuid>
 * - 个人 Key: user_<uuid>
 * - 项目 Key: proj_<uuid>
 */

const db = require('../db/mysql');

// 本地缓存 (减少数据库查询)
const apiKeyCache = new Map();

/** @returns {number|null} */
function toOptionalPositiveInt(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function validateApiKey(apiKey) {
  // 检查本地缓存
  if (apiKeyCache.has(apiKey)) {
    return apiKeyCache.get(apiKey);
  }
  
  try {
    // 从数据库查询
    const keyInfo = await db.getApiKey(apiKey);
    if (keyInfo) {
      // 解析 allowed_models JSON
      if (typeof keyInfo.allowed_models === 'string') {
        keyInfo.allowed_models = JSON.parse(keyInfo.allowed_models);
      }
      apiKeyCache.set(apiKey, keyInfo);
      return keyInfo;
    }
  } catch (error) {
    console.error('Database query failed, using fallback:', error.message);
  }
  
  // 可选的开发环境 fallback，默认关闭，避免污染真实数据库统计
  const enableDevKeyFallback = process.env.ENABLE_DEV_KEY_FALLBACK === 'true';
  if (enableDevKeyFallback) {
    const testKeys = {
      'test_team_key': {
        type: 'team',
        id: 9001,
        team_id: 1,
        created_by: 100,
        name: '测试团队',
        quota: { daily: 100000, monthly: 3000000 },
        allowed_models: ['qwen', 'gpt-4'],
      },
      'test_user_key': {
        type: 'user',
        id: 9002,
        team_id: null,
        created_by: 101,
        name: '测试用户',
        quota: { daily: 10000, monthly: 300000 },
        allowed_models: ['qwen'],
      },
      // 管理页面配置的 API Key
      'proj_goushang_001': {
        type: 'proj',
        id: 9003,
        team_id: null,
        created_by: 102,
        name: '购商云汇项目',
        quota: { daily: 200000, monthly: 6000000 },
        allowed_models: ['qwen'],
      },
      'user_admin_001': {
        type: 'user',
        id: 9004,
        team_id: null,
        created_by: 103,
        name: '管理员',
        quota: { daily: 100000, monthly: 3000000 },
        allowed_models: ['qwen'],
      },
    };
    
    if (testKeys[apiKey]) {
      return testKeys[apiKey];
    }
  }
  
  return null;
}

async function authMiddleware(req, res, next) {
  const apiKey = req.headers['x-api-key'] || 
                 req.headers['authorization']?.replace('Bearer ', '');
  
  if (!apiKey) {
    return res.status(401).json({
      error: {
        message: 'API Key is required',
        type: 'AuthenticationError',
      },
    });
  }
  
  const keyInfo = await validateApiKey(apiKey);
  
  if (!keyInfo) {
    return res.status(401).json({
      error: {
        message: 'Invalid API Key',
        type: 'AuthenticationError',
      },
    });
  }

  // 附加到请求对象
  req.apiKey = apiKey;
  req.keyInfo = keyInfo;

  // gateway_api_keys.id → 与 gateway_usage_logs.api_key_id 一致
  req.apiKeyId = toOptionalPositiveInt(keyInfo.id);

  // gateway_users.id：来自发 Key 时写入的 created_by（无则 NULL）
  req.gatewayUserId = toOptionalPositiveInt(keyInfo.created_by);

  // 兼容旧路由/中间件命名：req.userId 表示平台用户，不再复用 api_keys 主键
  req.userId = req.gatewayUserId;

  // gateway_teams.id：来自 gateway_api_keys.team_id；勿再用 api_keys.id 冒充
  req.teamId = toOptionalPositiveInt(keyInfo.team_id);

  next();
}

module.exports = authMiddleware;
