/**
 * 限流中间件 - 基于滑动窗口的配额管理
 * 
 * 功能:
 * - 检查 API Key 的配额使用情况
 * - 超过配额时返回 429 错误
 * - 支持日配额和月配额
 * - 内建内存滑动窗口限流器，Redis 为可选增强
 */

// ─── 可选 Redis 支持 ───
let redisClient = null;

async function initRedis() {
  if (process.env.REDIS_URL) {
    try {
      const redis = require('redis');
      redisClient = redis.createClient({ url: process.env.REDIS_URL });
      await redisClient.connect();
      redisClient.on('error', (err) => {
        console.error('[rate-limit] Redis error:', err.message);
        redisClient = null; // fall back to in-memory on error
      });
      console.log('[rate-limit] Redis connected');
    } catch (err) {
      console.log('[rate-limit] Redis unavailable, using in-memory rate limiter:', err.message);
      redisClient = null;
    }
  }
}

initRedis(); // fire-and-forget

// ─── 内建滑动窗口限流器 ───
// Stores timestamps of requests per key
const requestLog = new Map();

// Clean up old entries older than the window (called periodically)
const CLEANUP_INTERVAL = 60_000; // every 60 seconds
const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, timestamps] of requestLog.entries()) {
    // Keep only timestamps from the last 24 hours (largest window we care about)
    const cutoff = now - 86400_000;
    const filtered = timestamps.filter(ts => ts > cutoff);
    if (filtered.length === 0) {
      requestLog.delete(key);
    } else {
      requestLog.set(key, filtered);
    }
  }
}, CLEANUP_INTERVAL);

// Prevent the timer from keeping the process alive
if (cleanupTimer.unref) cleanupTimer.unref();

/**
 * Count requests within a sliding window.
 * @param {string} key - The rate limit key (e.g. API key)
 * @param {number} windowMs - Window duration in milliseconds
 * @returns {{ count: number, timestamps: number[] }}
 */
function slidingWindowCount(key, windowMs) {
  const now = Date.now();
  const cutoff = now - windowMs;
  const timestamps = requestLog.get(key) || [];
  const withinWindow = timestamps.filter(ts => ts > cutoff);
  requestLog.set(key, withinWindow);
  return { count: withinWindow.length, timestamps: withinWindow };
}

/**
 * Record a new request timestamp.
 */
function recordRequest(key) {
  const timestamps = requestLog.get(key) || [];
  timestamps.push(Date.now());
  requestLog.set(key, timestamps);
}

// ─── 配额存储 (in-memory) ───
const quotaCache = new Map();

async function checkQuota(apiKey, keyInfo) {
  const today = new Date().toISOString().split('T')[0];
  const month = today.substring(0, 7);

  // Try Redis first
  if (redisClient) {
    try {
      const dailyKey = `quota:${apiKey}:daily:${today}`;
      const monthlyKey = `quota:${apiKey}:monthly:${month}`;
      const [dailyUsed, monthlyUsed] = await Promise.all([
        redisClient.get(dailyKey),
        redisClient.get(monthlyKey),
      ]);
      return {
        daily_used: parseInt(dailyUsed) || 0,
        monthly_used: parseInt(monthlyUsed) || 0,
      };
    } catch (error) {
      console.error('[rate-limit] Redis quota check failed, using fallback:', error.message);
      redisClient = null;
    }
  }

  // In-memory fallback
  const cached = quotaCache.get(apiKey) || { daily_used: 0, monthly_used: 0 };
  // Reset if day/month changed
  if (cached.date !== today) {
    cached.daily_used = 0;
    cached.date = today;
  }
  if (cached.month !== month) {
    cached.monthly_used = 0;
    cached.month = month;
  }
  quotaCache.set(apiKey, cached);
  return { daily_used: cached.daily_used, monthly_used: cached.monthly_used };
}

async function updateQuota(apiKey, tokens) {
  const today = new Date().toISOString().split('T')[0];
  const month = today.substring(0, 7);

  // Try Redis first
  if (redisClient) {
    try {
      const dailyKey = `quota:${apiKey}:daily:${today}`;
      const monthlyKey = `quota:${apiKey}:monthly:${month}`;
      await Promise.all([
        redisClient.incrBy(dailyKey, tokens),
        redisClient.incrBy(monthlyKey, tokens),
        redisClient.expire(dailyKey, 86400),
      ]);
      return;
    } catch (error) {
      console.error('[rate-limit] Redis quota update failed:', error.message);
      redisClient = null;
    }
  }

  // In-memory fallback
  let cached = quotaCache.get(apiKey) || { daily_used: 0, monthly_used: 0, date: today, month };
  if (cached.date !== today) {
    cached.daily_used = 0;
    cached.date = today;
  }
  if (cached.month !== month) {
    cached.monthly_used = 0;
    cached.month = month;
  }
  cached.daily_used += tokens;
  cached.monthly_used += tokens;
  quotaCache.set(apiKey, cached);
}

async function rateLimitMiddleware(req, res, next) {
  const apiKey = req.apiKey;
  const keyInfo = req.keyInfo;

  if (!apiKey || !keyInfo) {
    return res.status(500).json({
      error: {
        message: 'API Key not found',
        type: 'InternalServerError',
      },
    });
  }

  // 检查配额
  const quota = await checkQuota(apiKey, keyInfo);
  const dailyLimit = keyInfo.quota?.daily || 100000;
  const monthlyLimit = keyInfo.quota?.monthly || 3000000;

  // 附加配额信息到请求对象
  req.quotaInfo = {
    daily_limit: dailyLimit,
    daily_used: quota.daily_used,
    daily_remaining: dailyLimit - quota.daily_used,
    monthly_limit: monthlyLimit,
    monthly_used: quota.monthly_used,
    monthly_remaining: monthlyLimit - quota.monthly_used,
  };

  // 检查是否超限
  if (quota.daily_used >= dailyLimit) {
    return res.status(429).json({
      error: {
        message: 'Daily quota exceeded',
        type: 'RateLimitError',
        quota: req.quotaInfo,
      },
    });
  }

  if (quota.monthly_used >= monthlyLimit) {
    return res.status(429).json({
      error: {
        message: 'Monthly quota exceeded',
        type: 'RateLimitError',
        quota: req.quotaInfo,
      },
    });
  }

  next();
}

// 更新配额的中间件（在响应后调用）
function updateQuotaAfterResponse(req, res, next) {
  const originalJson = res.json;

  res.json = function(data) {
    if (data.usage?.total_tokens && req.apiKey) {
      updateQuota(req.apiKey, data.usage.total_tokens);
    }
    return originalJson.call(this, data);
  };

  next();
}

module.exports = rateLimitMiddleware;
module.exports.updateQuotaAfterResponse = updateQuotaAfterResponse;
module.exports.updateQuota = updateQuota;
module.exports.slidingWindowCount = slidingWindowCount;
module.exports.recordRequest = recordRequest;
