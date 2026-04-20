/**
 * AI Gateway - 统一 LLM 接入层
 *
 * 核心功能:
 * - 统一接入：所有 AI 调用走网关，禁止直连 LLM
 * - 路由策略：根据任务类型路由到不同模型
 * - 用量管控：团队/个人 Token 配额管理
 * - 成本审计：记录每次调用的 Token 和成本
 * - 安全审计：敏感信息过滤、合规检查
 */

const path = require('path');
const { loadProjectEnv } = require('../../scripts/lib/load-shared-env.cjs');

loadProjectEnv({
  serviceDir: path.resolve(__dirname, '..'),
  projectRoot: path.resolve(__dirname, '../..'),
});

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const winston = require('winston');
const { v4: uuidv4 } = require('uuid');

const modelRouter = require('./routes/model-router');
const usageRoutes = require('./routes/usage');
const keysRoutes = require('./routes/keys');
const teamsRoutes = require('./routes/teams');
const settingsRoutes = require('./routes/settings');
const predictionRoutes = require('./routes/prediction-routes');
const teamManagementRoutes = require('./routes/team-management');
const { handleAuditLogs } = require('./routes/audit-logs');
const gatesRoutes = require('./routes/gates');
const deepWikiResearchRoutes = require('./routes/deepwiki-research');
const internalNotificationsRoutes = require('./routes/internal-notifications');
const feishuCallbacksRoutes = require('./routes/feishu-callbacks');
const authMiddleware = require('./middleware/auth');
const rateLimitMiddleware = require('./middleware/rate-limit');
const auditMiddleware = require('./middleware/audit');
const costTracker = require('./middleware/cost-tracker');
const budgetCheck = require('./middleware/budget-check');

// 日志配置
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' }),
  ],
});

if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.simple(),
  }));
}

const app = express();
const PORT = process.env.PORT || 3001;

// 中间件
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// 默认 JSON UTF-8；OpenClaw 流式请求需由 model-router 设为 text/event-stream，此处勿抢先写死 JSON
app.use((req, res, next) => {
  const stream =
    req.path === '/v1/chat/completions' &&
    req.method === 'POST' &&
    req.body &&
    (req.body.stream === true || req.body.stream === 'true' || req.body.stream === 1);
  if (!stream) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
  }
  next();
});

// 请求日志
app.use((req, res, next) => {
  const requestId = uuidv4();
  req.requestId = requestId;
  req.startTime = Date.now();
  
  logger.info('Request received', {
    requestId,
    method: req.method,
    path: req.path,
    headers: req.headers,
  });
  
  res.on('finish', () => {
    const duration = Date.now() - req.startTime;
    logger.info('Request completed', {
      requestId,
      status: res.statusCode,
      duration_ms: duration,
    });
  });
  
  next();
});

// 健康检查
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
  });
});

// OpenAI-compatible 模型列表，供 Hermes / OpenClaw / 通用客户端探测
app.get('/v1/models', authMiddleware, (req, res) => {
  const allowedProviders = Array.isArray(req.keyInfo?.allowed_models)
    ? req.keyInfo.allowed_models
    : [];
  const baseModels = [
    {
      id: 'qwen3.6-plus',
      object: 'model',
      created: 1776000000,
      owned_by: 'ai-gateway',
      provider: 'qwen',
    },
    {
      id: 'qwen3.5-plus',
      object: 'model',
      created: 1776000000,
      owned_by: 'ai-gateway',
      provider: 'qwen',
    },
    {
      id: 'gpt-4-turbo',
      object: 'model',
      created: 1776000000,
      owned_by: 'ai-gateway',
      provider: 'openai',
    },
    {
      id: 'claude-3-sonnet',
      object: 'model',
      created: 1776000000,
      owned_by: 'ai-gateway',
      provider: 'anthropic',
    },
  ];
  const data = baseModels.filter((model) => {
    if (!allowedProviders.length) return true;
    return allowedProviders.includes(model.provider);
  });
  res.json({
    object: 'list',
    data,
  });
});

// 日志查询：显式注册，避免子路由挂载顺序/路径导致 404
app.get('/api/v1/audit-logs', handleAuditLogs);

// Deep Wiki 内部研究接口
app.use('/api/v1/research', deepWikiResearchRoutes);

// API 路由 - 用量统计
app.use('/api/v1/usage', usageRoutes);

// API 路由 - API Key 管理
app.use('/api/v1/keys', keysRoutes);

// API 路由 - 团队管理
app.use('/api/v1/teams', teamsRoutes);

// API 路由 - 系统设置
app.use('/api/v1/settings', settingsRoutes);

// API 路由 - 预测和智能建议
app.use('/api/v1', predictionRoutes);

// API 路由 - 团队管理（多租户支持）
app.use('/api/v1', teamManagementRoutes);

// API 路由 - 门禁（规则 + 执行记录）
app.use('/api/v1/gates', gatesRoutes);

// API 路由 - Harness 内部通知
app.use('/api/v1/internal/notifications', internalNotificationsRoutes);

// API 路由 - 飞书回调
app.use('/api/v1/feishu', feishuCallbacksRoutes);

// API 路由 - 统一接入点 (OpenAI 兼容)
app.post('/v1/chat/completions',
  authMiddleware,
  budgetCheck,           // 预算检查和限流
  rateLimitMiddleware,   // 配额管理（内存/Redis）
  auditMiddleware,       // 审计日志
  costTracker,
  modelRouter,
  (req, res) => {
    // 响应由 modelRouter 处理
  }
);

// 配额查询
app.get('/v1/quota', authMiddleware, (req, res) => {
  const quota = req.quotaInfo;
  res.json({
    quota,
    timestamp: new Date().toISOString(),
  });
});

// 使用统计
app.get('/v1/usage', authMiddleware, async (req, res) => {
  try {
    // TODO: 从 Redis/数据库查询使用统计
    const usage = {
      today: { tokens: 0, cost: 0 },
      this_month: { tokens: 0, cost: 0 },
    };
    res.json(usage);
  } catch (error) {
    logger.error('Usage query failed', { error: error.message });
    res.status(500).json({ error: 'Failed to query usage' });
  }
});

// 错误处理
app.use((err, req, res, next) => {
  logger.error('Unhandled error', {
    requestId: req.requestId,
    error: err.message,
    stack: err.stack,
  });
  
  res.status(err.status || 500).json({
    error: {
      message: err.message || 'Internal server error',
      type: err.type || 'ServerError',
    },
  });
});

// 启动服务
app.listen(PORT, () => {
  logger.info(`AI Gateway started on port ${PORT}`);
  console.log(`🚀 AI Gateway running on http://localhost:${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  console.log(`📝 API docs: http://localhost:${PORT}/v1/chat/completions`);
});

module.exports = app;
