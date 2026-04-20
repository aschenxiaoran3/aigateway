/**
 * 预算检查中间件
 * 
 * 功能:
 * - 实时检查API Key预算
 * - 预估请求成本并验证预算充足
 * - 实施分级限流策略
 * - 发送预算告警
 */

const db = require('../db/mysql');
const feishuNotifier = require('../notifications/feishu-notifier');

// 预算告警级别
const BUDGET_ALERT_LEVELS = {
  WARNING: 0.8,    // 预算使用80% - 发送警告
  CRITICAL: 0.95,  // 预算使用95% - 发送紧急警告
  BLOCK: 1.0       // 预算用尽 - 阻断请求
};

// 限流阈值（Token）；飞书/OpenClaw 长会话 + 多轮工具调用易顶满，默认放宽；可用环境变量再调
const RATE_LIMIT_THRESHOLDS = {
  HOURLY_WARNING: Number(process.env.GATEWAY_HOURLY_TOKEN_WARNING) || 10_000_000,
  HOURLY_CRITICAL: Number(process.env.GATEWAY_HOURLY_TOKEN_LIMIT) || 50_000_000,
  DAILY_WARNING: Number(process.env.GATEWAY_DAILY_TOKEN_WARNING) || 50_000_000,
  DAILY_CRITICAL: Number(process.env.GATEWAY_DAILY_TOKEN_LIMIT) || 500_000_000
};

/** 设为 true 时关闭「小时 Token 汇总」硬限流（仍记账，不 429）— 适合内网飞书联调 */
const DISABLE_HOURLY_RATELIMIT =
  process.env.GATEWAY_DISABLE_HOURLY_RATELIMIT === 'true' ||
  process.env.GATEWAY_DISABLE_HOURLY_RATELIMIT === '1';

/** 设为 true 时不因「日配额」拦截请求（仍可选告警）— 避免 DB 配额过小导致飞书突然全断 */
const RELAX_DAILY_BUDGET_BLOCK =
  process.env.GATEWAY_RELAX_DAILY_BUDGET === 'true' ||
  process.env.GATEWAY_RELAX_DAILY_BUDGET === '1';

/**
 * 获取API Key的预算信息
 */
async function getBudgetInfo(apiKey) {
  try {
    const keyInfo = await db.getApiKey(apiKey);
    if (!keyInfo) {
      return null;
    }
    
    // 计算剩余预算（Token数量）
    const dailyRemaining = Math.max(0, keyInfo.quota_daily - keyInfo.used_daily);
    const monthlyRemaining = Math.max(0, keyInfo.quota_monthly - keyInfo.used_monthly);
    
    return {
      apiKey,
      dailyQuota: keyInfo.quota_daily,
      dailyUsed: keyInfo.used_daily,
      dailyRemaining,
      monthlyQuota: keyInfo.quota_monthly,
      monthlyUsed: keyInfo.used_monthly,
      monthlyRemaining,
      alertsSent: {} // 记录已发送的告警
    };
  } catch (error) {
    console.error('获取预算信息失败:', error.message);
    return null;
  }
}

/**
 * 预估请求成本
 */
function estimateCost(model, estimatedTokens) {
  const MODEL_COSTS = {
    'qwen3.6-plus': { input: 0.002, output: 0.006 },
    'qwen3.5-plus': { input: 0.002, output: 0.006 },
    'qwen-plus': { input: 0.002, output: 0.006 },
    'gpt-4-turbo': { input: 0.01, output: 0.03 },
    'claude-3-sonnet': { input: 0.003, output: 0.015 }
  };
  
  const config = MODEL_COSTS[model];
  if (!config) {
    // 默认按最贵的模型估算（安全起见）
    return (estimatedTokens / 1000) * 0.03;
  }
  
  // 假设输入输出各占一半（保守估计）
  const inputCost = (estimatedTokens * 0.5 / 1000) * config.input;
  const outputCost = (estimatedTokens * 0.5 / 1000) * config.output;
  
  return inputCost + outputCost;
}

/**
 * 检查小时使用率（Token数量）
 */
async function checkHourlyUsage(apiKey) {
  try {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const [rows] = await db.getPool().execute(
      `SELECT SUM(total_tokens) as hourly_tokens 
       FROM gateway_usage_logs 
       WHERE api_key_id = (SELECT id FROM gateway_api_keys WHERE api_key = ?)
       AND created_at >= ?`,
      [apiKey, oneHourAgo]
    );
    
    return Number(rows[0]?.hourly_tokens || 0);
  } catch (error) {
    console.error('检查小时使用率失败:', error.message);
    return 0;
  }
}

/**
 * 检查并应用限流（基于Token数量）
 */
async function applyRateLimits(apiKey, estimatedTokens) {
  if (DISABLE_HOURLY_RATELIMIT) {
    return { allowed: true };
  }

  const hourlyTokens = await checkHourlyUsage(apiKey);
  const totalHourlyTokens = hourlyTokens + estimatedTokens;
  
  // 检查小时限流
  if (totalHourlyTokens > RATE_LIMIT_THRESHOLDS.HOURLY_CRITICAL) {
    return {
      allowed: false,
      reason: `小时Token使用将超过 ${RATE_LIMIT_THRESHOLDS.HOURLY_CRITICAL.toLocaleString()}（当前: ${hourlyTokens.toLocaleString()}，预估: ${estimatedTokens.toLocaleString()}）`,
      level: 'CRITICAL'
    };
  }
  
  if (totalHourlyTokens > RATE_LIMIT_THRESHOLDS.HOURLY_WARNING) {
    const delayMs = Number(process.env.GATEWAY_RATELIMIT_WARNING_DELAY_MS);
    const delay = Number.isFinite(delayMs) && delayMs > 0 ? delayMs : 0;
    return {
      allowed: true,
      warning: `小时Token使用将超过 ${RATE_LIMIT_THRESHOLDS.HOURLY_WARNING.toLocaleString()}，建议降低调用频率`,
      ...(delay > 0 ? { delay } : {})
    };
  }
  
  return { allowed: true };
}

/**
 * 检查预算并发送告警（基于Token数量）
 */
async function checkBudgetAndAlert(apiKey, estimatedTokens) {
  const budget = await getBudgetInfo(apiKey);
  if (!budget) {
    return { allowed: true }; // 没有预算信息，允许通过
  }

  // 日配额未配置或 <=0：视为不限制，避免除零或误拦
  if (!budget.dailyQuota || budget.dailyQuota <= 0) {
    return { allowed: true };
  }

  if (RELAX_DAILY_BUDGET_BLOCK) {
    return { allowed: true };
  }
  
  // 检查日预算（Token数量）
  const dailyUsageRatio = (budget.dailyUsed + estimatedTokens) / budget.dailyQuota;
  
  if (dailyUsageRatio >= BUDGET_ALERT_LEVELS.BLOCK) {
    return {
      allowed: false,
      reason: `日Token配额已用尽（配额: ${budget.dailyQuota.toLocaleString()}，已用: ${budget.dailyUsed.toLocaleString()}）`,
      level: 'BLOCK'
    };
  }
  
  if (dailyUsageRatio >= BUDGET_ALERT_LEVELS.CRITICAL && !budget.alertsSent.CRITICAL) {
    sendAlert(apiKey, 'CRITICAL', `日Token使用超过95%（当前: ${(dailyUsageRatio * 100).toFixed(1)}%）`, {
      dailyQuota: budget.dailyQuota,
      dailyUsed: budget.dailyUsed + estimatedTokens,
      usageRatio: dailyUsageRatio
    });
    budget.alertsSent.CRITICAL = true;
  }
  
  if (dailyUsageRatio >= BUDGET_ALERT_LEVELS.WARNING && !budget.alertsSent.WARNING) {
    sendAlert(apiKey, 'WARNING', `日Token使用超过80%（当前: ${(dailyUsageRatio * 100).toFixed(1)}%）`, {
      dailyQuota: budget.dailyQuota,
      dailyUsed: budget.dailyUsed + estimatedTokens,
      usageRatio: dailyUsageRatio
    });
    budget.alertsSent.WARNING = true;
  }
  
  return { allowed: true };
}

/**
 * 发送告警
 */
async function sendAlert(apiKey, level, message, usageInfo = {}) {
  console.log(`🚨 [${level}] 预算告警 - ${apiKey}: ${message}`);
  
  // 发送飞书通知
  try {
    await feishuNotifier.sendBudgetAlert(apiKey, level, message, usageInfo);
    console.log(`✅ 飞书告警发送成功: ${level}`);
  } catch (error) {
    console.error(`❌ 飞书告警发送失败: ${error.message}`);
  }
  
  // TODO: 可以添加其他通知渠道
  // - 邮件通知
  // - 短信告警
  // - Webhook
}

/**
 * 预算检查中间件主函数
 */
async function budgetCheck(req, res, next) {
  // 跳过非API调用
  if (!req.apiKey || req.path !== '/v1/chat/completions') {
    return next();
  }
  
  try {
    const { model, messages, max_tokens } = req.body;
    
    // 估算Token数量（保守估计）
    const estimatedTokens = estimateTokenCount(messages, max_tokens || 1000);
    
    // 估算成本（用于记录）
    const estimatedCost = estimateCost(model, estimatedTokens);
    
    // 检查预算（基于Token数量）
    const budgetCheck = await checkBudgetAndAlert(req.apiKey, estimatedTokens);
    if (!budgetCheck.allowed) {
      return res.status(429).json({
        error: {
          message: `预算限制: ${budgetCheck.reason}`,
          type: 'BudgetExceeded',
          estimated_tokens: estimatedTokens,
          estimated_cost: estimatedCost
        }
      });
    }
    
    // 应用限流（基于Token数量）
    const rateLimit = await applyRateLimits(req.apiKey, estimatedTokens);
    if (!rateLimit.allowed) {
      return res.status(429).json({
        error: {
          message: `限流: ${rateLimit.reason}`,
          type: 'RateLimitExceeded',
          estimated_tokens: estimatedTokens,
          estimated_cost: estimatedCost
        }
      });
    }
    
    // 添加限流延迟
    if (rateLimit.delay) {
      await new Promise(resolve => setTimeout(resolve, rateLimit.delay));
    }
    
    // 添加预算信息到请求对象，供后续中间件使用
    req.budgetInfo = {
      estimatedTokens,
      estimatedCost,
      warnings: rateLimit.warning ? [rateLimit.warning] : []
    };
    
    next();
  } catch (error) {
    console.error('预算检查失败:', error.message);
    // 预算检查失败时，允许请求通过（安全第一）
    next();
  }
}

/**
 * 估算Token数量（简化版本）
 */
function estimateTokenCount(messages, maxTokens) {
  // 简单估算：每个中文字符≈0.6 token，每个英文字符≈0.3 token
  let totalChars = 0;
  
  if (messages && Array.isArray(messages)) {
    messages.forEach(msg => {
      if (msg.content) {
        totalChars += msg.content.length;
      }
    });
  }
  
  // 保守估计：按中文字符计算
  const estimatedTokens = Math.min(totalChars * 0.6, maxTokens);
  
  // 确保最小Token数
  return Math.max(estimatedTokens, 10);
}

module.exports = budgetCheck;