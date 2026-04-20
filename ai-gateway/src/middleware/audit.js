/**
 * 审计日志中间件
 * 
 * 功能:
 * - 记录所有 AI 调用请求
 * - 记录用户、团队、模型、Token 消耗等信息
 * - 支持日志持久化（文件/数据库）
 */

const winston = require('winston');
const path = require('path');
const fs = require('fs');

// 确保日志目录存在
const logDir = path.join(__dirname, '../../logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

// 创建审计日志器
const auditLogger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ 
      filename: path.join(logDir, 'audit.log'),
      maxsize: 10485760, // 10MB
      maxFiles: 5,
    }),
  ],
});

// 开发环境输出到控制台
if (process.env.NODE_ENV !== 'production') {
  auditLogger.add(new winston.transports.Console({
    format: winston.format.simple(),
  }));
}

async function auditMiddleware(req, res, next) {
  const requestId = req.requestId;
  const startTime = Date.now();
  
  // 记录请求开始
  const auditData = {
    event: 'request_start',
    request_id: requestId,
    timestamp: new Date().toISOString(),
    method: req.method,
    path: req.path,
    api_key: req.apiKey ? req.apiKey.substring(0, 12) + '...' : 'unknown',
    user_id: req.gatewayUserId != null ? req.gatewayUserId : null,
    team_id: req.teamId,
    model: req.body?.model,
    purpose: req.body?.metadata?.purpose,
  };
  
  auditLogger.info('API request', auditData);
  
  // 监听响应完成
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    
    const responseData = {
      event: 'request_end',
      request_id: requestId,
      timestamp: new Date().toISOString(),
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration_ms: duration,
      api_key: req.apiKey ? req.apiKey.substring(0, 12) + '...' : 'unknown',
      user_id: req.gatewayUserId != null ? req.gatewayUserId : null,
      team_id: req.teamId,
    };
    
    auditLogger.info('API response', responseData);
  });
  
  next();
}

// 记录 Token 使用的辅助函数
function logTokenUsage(req, usage) {
  if (!usage || !req.apiKey) return;
  
  const auditData = {
    event: 'token_usage',
    request_id: req.requestId,
    timestamp: new Date().toISOString(),
    api_key: req.apiKey,
    user_id: req.gatewayUserId != null ? req.gatewayUserId : null,
    team_id: req.teamId,
    model: req.body?.model,
    prompt_tokens: usage.prompt_tokens,
    completion_tokens: usage.completion_tokens,
    total_tokens: usage.total_tokens,
    cost_cny: usage.cost_cny,
  };
  
  auditLogger.info('Token usage', auditData);
}

module.exports = auditMiddleware;
module.exports.logTokenUsage = logTokenUsage;
module.exports.auditLogger = auditLogger;
