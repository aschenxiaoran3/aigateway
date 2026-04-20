/**
 * 预测和智能建议API路由
 * 
 * 功能:
 * - 提供使用预测
 * - 异常使用检测
 * - 智能配额建议
 * - 使用模式分析
 */

const express = require('express');
const router = express.Router();
const costPredictor = require('../prediction/cost-predictor');
const db = require('../db/mysql');
const authMiddleware = require('../middleware/auth');

/**
 * 获取24小时使用预测
 */
router.get('/v1/predict/24h', authMiddleware, async (req, res) => {
  try {
    const prediction = await costPredictor.predict24HourUsage(req.apiKey);
    
    res.json({
      success: true,
      prediction,
      api_key: req.apiKey.substring(0, 12) + '...',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('获取预测失败:', error.message);
    res.status(500).json({
      success: false,
      error: '获取预测失败',
      message: error.message
    });
  }
});

/**
 * 检测异常使用
 */
router.get('/v1/predict/anomalies', authMiddleware, async (req, res) => {
  try {
    const anomalies = await costPredictor.detectAnomalies(req.apiKey);
    
    res.json({
      success: true,
      anomalies,
      api_key: req.apiKey.substring(0, 12) + '...',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('检测异常失败:', error.message);
    res.status(500).json({
      success: false,
      error: '检测异常失败',
      message: error.message
    });
  }
});

/**
 * 获取智能配额建议
 */
router.get('/v1/predict/quota-recommendation', authMiddleware, async (req, res) => {
  try {
    // 获取当前配额
    const keyInfo = await db.getApiKey(req.apiKey);
    if (!keyInfo) {
      return res.status(404).json({
        success: false,
        error: 'API密钥不存在'
      });
    }
    
    const currentQuota = {
      daily: keyInfo.quota_daily,
      monthly: keyInfo.quota_monthly
    };
    
    const recommendation = await costPredictor.getQuotaRecommendation(req.apiKey, currentQuota);
    
    res.json({
      success: true,
      current_quota: currentQuota,
      recommendation,
      api_key: req.apiKey.substring(0, 12) + '...',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('获取配额建议失败:', error.message);
    res.status(500).json({
      success: false,
      error: '获取配额建议失败',
      message: error.message
    });
  }
});

/**
 * 获取使用模式分析
 */
router.get('/v1/predict/usage-patterns', authMiddleware, async (req, res) => {
  try {
    // 获取最近30天的使用数据
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    
    const [rows] = await db.getPool().execute(
      `SELECT 
        DATE(created_at) as date,
        HOUR(created_at) as hour,
        SUM(total_tokens) as total_tokens,
        COUNT(*) as request_count,
        AVG(total_tokens) as avg_tokens_per_request,
        SUM(cost_cny) as total_cost
       FROM gateway_usage_logs 
       WHERE api_key_id = (SELECT id FROM gateway_api_keys WHERE api_key = ?)
       AND created_at >= ?
       GROUP BY DATE(created_at), HOUR(created_at)
       ORDER BY date, hour`,
      [req.apiKey, thirtyDaysAgo]
    );
    
    // 分析模式
    const patterns = {
      dailyTrend: {},
      hourlyDistribution: Array(24).fill(0),
      weeklyPattern: Array(7).fill(0),
      total: {
        tokens: 0,
        requests: 0,
        cost: 0
      }
    };
    
    rows.forEach(row => {
      const date = row.date;
      const hour = row.hour;
      const dayOfWeek = new Date(date).getDay(); // 0=周日
      const tokens = parseInt(row.total_tokens) || 0;
      const requests = parseInt(row.request_count) || 0;
      const cost = parseFloat(row.total_cost) || 0;
      
      // 每日趋势
      if (!patterns.dailyTrend[date]) {
        patterns.dailyTrend[date] = {
          tokens: 0,
          requests: 0,
          cost: 0
        };
      }
      patterns.dailyTrend[date].tokens += tokens;
      patterns.dailyTrend[date].requests += requests;
      patterns.dailyTrend[date].cost += cost;
      
      // 小时分布
      patterns.hourlyDistribution[hour] += tokens;
      
      // 周模式
      patterns.weeklyPattern[dayOfWeek] += tokens;
      
      // 总计
      patterns.total.tokens += tokens;
      patterns.total.requests += requests;
      patterns.total.cost += cost;
    });
    
    // 计算统计数据
    const stats = {
      avgDailyTokens: patterns.total.tokens / Math.max(Object.keys(patterns.dailyTrend).length, 1),
      avgDailyRequests: patterns.total.requests / Math.max(Object.keys(patterns.dailyTrend).length, 1),
      avgRequestSize: patterns.total.requests > 0 ? patterns.total.tokens / patterns.total.requests : 0,
      avgCostPerToken: patterns.total.tokens > 0 ? patterns.total.cost / patterns.total.tokens : 0,
      peakHour: patterns.hourlyDistribution.indexOf(Math.max(...patterns.hourlyDistribution)),
      peakDay: patterns.weeklyPattern.indexOf(Math.max(...patterns.weeklyPattern))
    };
    
    res.json({
      success: true,
      patterns: {
        dailyTrend: patterns.dailyTrend,
        hourlyDistribution: patterns.hourlyDistribution,
        weeklyPattern: patterns.weeklyPattern
      },
      statistics: stats,
      totals: patterns.total,
      api_key: req.apiKey.substring(0, 12) + '...',
      period: '30天',
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('获取使用模式失败:', error.message);
    res.status(500).json({
      success: false,
      error: '获取使用模式失败',
      message: error.message
    });
  }
});

/**
 * 清除预测缓存（管理员功能）
 */
router.post('/v1/predict/clear-cache', authMiddleware, async (req, res) => {
  try {
    // 检查权限（简单实现，实际应该检查管理员权限）
    const keyInfo = await db.getApiKey(req.apiKey);
    if (!keyInfo || keyInfo.type !== 'admin') {
      return res.status(403).json({
        success: false,
        error: '需要管理员权限'
      });
    }
    
    costPredictor.clearCache();
    
    res.json({
      success: true,
      message: '预测缓存已清除',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('清除缓存失败:', error.message);
    res.status(500).json({
      success: false,
      error: '清除缓存失败',
      message: error.message
    });
  }
});

module.exports = router;