/**
 * 费用预测算法模块
 * 
 * 功能:
 * - 基于历史使用模式预测未来费用
 * - 识别使用趋势和模式
 * - 提供智能配额建议
 * - 异常使用检测
 */

const db = require('../db/mysql');

class CostPredictor {
  constructor() {
    this.predictionCache = new Map();
    this.cacheTTL = 5 * 60 * 1000; // 5分钟缓存
  }
  
  /**
   * 预测未来24小时使用量
   */
  async predict24HourUsage(apiKey) {
    const cacheKey = `24h_${apiKey}`;
    const cached = this.getFromCache(cacheKey);
    if (cached) return cached;
    
    try {
      // 获取最近7天的使用数据
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const [rows] = await db.getPool().execute(
        `SELECT 
          HOUR(created_at) as hour,
          DAYOFWEEK(created_at) as day_of_week,
          SUM(total_tokens) as total_tokens,
          COUNT(*) as request_count,
          AVG(total_tokens) as avg_tokens_per_request
         FROM gateway_usage_logs 
         WHERE api_key_id = (SELECT id FROM gateway_api_keys WHERE api_key = ?)
         AND created_at >= ?
         GROUP BY DAYOFWEEK(created_at), HOUR(created_at)
         ORDER BY day_of_week, hour`,
        [apiKey, sevenDaysAgo]
      );
      
      if (rows.length === 0) {
        // 没有历史数据，返回默认预测
        const defaultPrediction = {
          predictedTokens: 1000,
          confidence: 0.3,
          peakHours: [10, 14, 20], // 默认高峰时段
          recommendation: '数据不足，使用默认预测'
        };
        
        this.saveToCache(cacheKey, defaultPrediction);
        return defaultPrediction;
      }
      
      // 分析使用模式
      const analysis = this.analyzeUsagePatterns(rows);
      
      // 预测未来24小时
      const prediction = this.generatePrediction(analysis);
      
      this.saveToCache(cacheKey, prediction);
      return prediction;
      
    } catch (error) {
      console.error('预测24小时使用量失败:', error.message);
      return {
        predictedTokens: 1000,
        confidence: 0.1,
        peakHours: [10, 14, 20],
        recommendation: '预测失败，使用保守估计',
        error: error.message
      };
    }
  }
  
  /**
   * 分析使用模式
   */
  analyzeUsagePatterns(usageData) {
    const patterns = {
      hourly: Array(24).fill(0),
      daily: Array(7).fill(0),
      peakHours: [],
      avgRequestSize: 0,
      totalRequests: 0,
      totalTokens: 0
    };
    
    // 处理原始数据
    usageData.forEach(row => {
      const hour = row.hour;
      const day = row.day_of_week - 1; // 转换为0-6（周日=0）
      const tokens = parseInt(row.total_tokens) || 0;
      
      patterns.hourly[hour] += tokens;
      patterns.daily[day] += tokens;
      patterns.totalTokens += tokens;
      patterns.totalRequests += parseInt(row.request_count) || 0;
    });
    
    // 计算平均请求大小
    patterns.avgRequestSize = patterns.totalRequests > 0 
      ? patterns.totalTokens / patterns.totalRequests 
      : 0;
    
    // 识别高峰时段（使用量前3的小时）
    const hourlyWithIndex = patterns.hourly.map((tokens, hour) => ({ hour, tokens }));
    hourlyWithIndex.sort((a, b) => b.tokens - a.tokens);
    patterns.peakHours = hourlyWithIndex.slice(0, 3).map(item => item.hour);
    
    // 识别活跃日（使用量前3的星期几）
    const dailyWithIndex = patterns.daily.map((tokens, day) => ({ day, tokens }));
    dailyWithIndex.sort((a, b) => b.tokens - a.tokens);
    patterns.activeDays = dailyWithIndex.slice(0, 3).map(item => item.day);
    
    return patterns;
  }
  
  /**
   * 生成预测
   */
  generatePrediction(patterns) {
    // 计算平均每日使用量
    const totalDays = Math.max(patterns.daily.filter(t => t > 0).length, 1);
    const avgDailyTokens = patterns.totalTokens / totalDays;
    
    // 根据星期几调整预测（如果是活跃日，预测更高）
    const today = new Date().getDay(); // 0=周日, 1=周一, ...
    const isActiveDay = patterns.activeDays.includes(today);
    const dayMultiplier = isActiveDay ? 1.3 : 0.8;
    
    // 根据当前时段调整预测（如果是高峰时段，预测更高）
    const currentHour = new Date().getHours();
    const isPeakHour = patterns.peakHours.includes(currentHour);
    const hourMultiplier = isPeakHour ? 1.2 : 0.9;
    
    // 基础预测
    let predictedTokens = avgDailyTokens * dayMultiplier * hourMultiplier;
    
    // 添加随机波动（±20%）
    const randomFactor = 0.8 + Math.random() * 0.4; // 0.8-1.2
    predictedTokens *= randomFactor;
    
    // 确保最小预测值
    predictedTokens = Math.max(predictedTokens, 100);
    
    // 计算置信度（基于数据量）
    const dataPoints = patterns.totalRequests;
    let confidence = 0.3; // 基础置信度
    
    if (dataPoints > 100) confidence = 0.8;
    else if (dataPoints > 50) confidence = 0.7;
    else if (dataPoints > 20) confidence = 0.6;
    else if (dataPoints > 10) confidence = 0.5;
    else if (dataPoints > 5) confidence = 0.4;
    
    // 生成建议
    const recommendations = this.generateRecommendations(patterns, predictedTokens);
    
    return {
      predictedTokens: Math.round(predictedTokens),
      confidence: Math.round(confidence * 100) / 100,
      peakHours: patterns.peakHours,
      activeDays: patterns.activeDays,
      avgRequestSize: Math.round(patterns.avgRequestSize),
      totalHistoricalRequests: patterns.totalRequests,
      totalHistoricalTokens: patterns.totalTokens,
      recommendations,
      generatedAt: new Date().toISOString()
    };
  }
  
  /**
   * 生成智能建议
   */
  generateRecommendations(patterns, predictedTokens) {
    const recommendations = [];
    
    // 基于平均请求大小的建议
    if (patterns.avgRequestSize > 1000) {
      recommendations.push({
        type: 'optimization',
        priority: 'high',
        message: '平均请求大小较大（' + Math.round(patterns.avgRequestSize) + ' tokens），考虑优化提示词减少Token使用'
      });
    }
    
    // 基于高峰时段的建议
    if (patterns.peakHours.length > 0) {
      const peakStr = patterns.peakHours.map(h => h + ':00').join(', ');
      recommendations.push({
        type: 'scheduling',
        priority: 'medium',
        message: '高峰时段: ' + peakStr + '，可考虑在非高峰时段安排批量任务'
      });
    }
    
    // 基于预测值的配额建议
    if (predictedTokens > 10000) {
      recommendations.push({
        type: 'quota',
        priority: 'medium',
        message: '预测日使用量较高（' + Math.round(predictedTokens).toLocaleString() + ' tokens），建议确保配额充足'
      });
    }
    
    // 基于使用模式的成本优化建议
    if (patterns.peakHours.includes(10) || patterns.peakHours.includes(14)) {
      recommendations.push({
        type: 'cost',
        priority: 'low',
        message: '工作日白天使用较多，可考虑使用成本更低的模型（如DeepSeek）'
      });
    }
    
    return recommendations;
  }
  
  /**
   * 检测异常使用
   */
  async detectAnomalies(apiKey, currentUsage) {
    try {
      const prediction = await this.predict24HourUsage(apiKey);
      const expectedHourly = prediction.predictedTokens / 24;
      
      // 获取最近1小时的使用量
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const [rows] = await db.getPool().execute(
        `SELECT SUM(total_tokens) as hourly_tokens
         FROM gateway_usage_logs 
         WHERE api_key_id = (SELECT id FROM gateway_api_keys WHERE api_key = ?)
         AND created_at >= ?`,
        [apiKey, oneHourAgo]
      );
      
      const hourlyTokens = rows[0]?.hourly_tokens || 0;
      
      // 检查是否异常（超过预期3倍）
      if (hourlyTokens > expectedHourly * 3) {
        return {
          isAnomaly: true,
          severity: 'high',
          currentHourly: hourlyTokens,
          expectedHourly: Math.round(expectedHourly),
          ratio: (hourlyTokens / expectedHourly).toFixed(1),
          message: `异常使用检测：最近1小时使用 ${hourlyTokens.toLocaleString()} tokens，超过预期 ${(hourlyTokens / expectedHourly).toFixed(1)} 倍`
        };
      }
      
      // 检查是否异常（超过预期2倍）
      if (hourlyTokens > expectedHourly * 2) {
        return {
          isAnomaly: true,
          severity: 'medium',
          currentHourly: hourlyTokens,
          expectedHourly: Math.round(expectedHourly),
          ratio: (hourlyTokens / expectedHourly).toFixed(1),
          message: `较高使用量：最近1小时使用 ${hourlyTokens.toLocaleString()} tokens，超过预期 ${(hourlyTokens / expectedHourly).toFixed(1)} 倍`
        };
      }
      
      return {
        isAnomaly: false,
        currentHourly: hourlyTokens,
        expectedHourly: Math.round(expectedHourly)
      };
      
    } catch (error) {
      console.error('检测异常使用失败:', error.message);
      return {
        isAnomaly: false,
        error: error.message
      };
    }
  }
  
  /**
   * 获取智能配额建议
   */
  async getQuotaRecommendation(apiKey, currentQuota) {
    try {
      const prediction = await this.predict24HourUsage(apiKey);
      
      const recommendations = [];
      
      // 检查当前配额是否充足
      if (currentQuota.daily < prediction.predictedTokens * 1.2) {
        recommendations.push({
          type: 'increase',
          priority: 'high',
          current: currentQuota.daily,
          suggested: Math.round(prediction.predictedTokens * 1.5),
          reason: `当前日配额可能不足（预测使用: ${prediction.predictedTokens.toLocaleString()} tokens）`
        });
      }
      
      // 检查是否有浪费的配额
      const usageRatio = prediction.predictedTokens / currentQuota.daily;
      if (usageRatio < 0.3 && currentQuota.daily > 1000) {
        recommendations.push({
          type: 'decrease',
          priority: 'low',
          current: currentQuota.daily,
          suggested: Math.round(prediction.predictedTokens * 1.2),
          reason: `当前配额使用率较低（预测使用率: ${(usageRatio * 100).toFixed(1)}%）`
        });
      }
      
      // 添加预测置信度说明
      if (prediction.confidence < 0.6) {
        recommendations.push({
          type: 'monitor',
          priority: 'medium',
          message: `预测置信度较低（${(prediction.confidence * 100).toFixed(0)}%），建议继续观察使用模式`
        });
      }
      
      return {
        prediction,
        recommendations,
        summary: `基于历史使用模式的智能配额建议（置信度: ${(prediction.confidence * 100).toFixed(0)}%）`
      };
      
    } catch (error) {
      console.error('获取配额建议失败:', error.message);
      return {
        error: error.message,
        recommendations: []
      };
    }
  }
  
  /**
   * 缓存管理
   */
  getFromCache(key) {
    const item = this.predictionCache.get(key);
    if (!item) return null;
    
    if (Date.now() - item.timestamp > this.cacheTTL) {
      this.predictionCache.delete(key);
      return null;
    }
    
    return item.data;
  }
  
  saveToCache(key, data) {
    this.predictionCache.set(key, {
      data,
      timestamp: Date.now()
    });
    
    // 清理过期缓存
    if (this.predictionCache.size > 100) {
      const now = Date.now();
      for (const [cacheKey, item] of this.predictionCache.entries()) {
        if (now - item.timestamp > this.cacheTTL) {
          this.predictionCache.delete(cacheKey);
        }
      }
    }
  }
  
  /**
   * 清除缓存
   */
  clearCache() {
    this.predictionCache.clear();
    console.log('✅ 预测缓存已清除');
  }
}

// 创建单例实例
const costPredictor = new CostPredictor();

module.exports = costPredictor;