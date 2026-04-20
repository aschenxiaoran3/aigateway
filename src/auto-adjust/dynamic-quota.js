/**
 * 动态配额调整模块
 * 
 * 功能:
 * - 根据使用模式自动调整配额
 * - 学习使用习惯，优化配额分配
 * - 防止配额浪费
 * - 确保关键时段的可用性
 */

const db = require('../db/mysql');
const costPredictor = require('../prediction/cost-predictor');
const feishuNotifier = require('../notifications/feishu-notifier');

class DynamicQuotaManager {
  constructor(config = {}) {
    this.enabled = config.enabled || process.env.ENABLE_DYNAMIC_QUOTA === 'true';
    this.adjustmentInterval = config.interval || 24 * 60 * 60 * 1000; // 24小时
    this.minAdjustmentPercent = config.minAdjustment || 0.1; // 最小调整10%
    this.maxAdjustmentPercent = config.maxAdjustment || 0.5; // 最大调整50%
    
    this.adjustmentHistory = new Map();
    
    if (this.enabled) {
      console.log('✅ 动态配额调整已启用');
      this.startAutoAdjustment();
    } else {
      console.log('⚠️  动态配额调整未启用');
    }
  }
  
  /**
   * 启动自动调整
   */
  startAutoAdjustment() {
    // 每天凌晨2点执行调整
    const now = new Date();
    const targetTime = new Date(now);
    targetTime.setHours(2, 0, 0, 0);
    
    if (now > targetTime) {
      targetTime.setDate(targetTime.getDate() + 1);
    }
    
    const timeUntilTarget = targetTime.getTime() - now.getTime();
    
    setTimeout(() => {
      this.performAutoAdjustment();
      // 设置每日定时任务
      setInterval(() => this.performAutoAdjustment(), 24 * 60 * 60 * 1000);
    }, timeUntilTarget);
    
    console.log(`⏰ 动态配额调整计划在 ${targetTime.toLocaleString('zh-CN')} 执行`);
  }
  
  /**
   * 执行自动调整
   */
  async performAutoAdjustment() {
    if (!this.enabled) return;
    
    console.log('🔄 开始执行动态配额调整...');
    
    try {
      // 获取所有活跃的API密钥
      const [keys] = await db.getPool().execute(
        `SELECT api_key, quota_daily, quota_monthly, used_daily, used_monthly, type, name 
         FROM gateway_api_keys 
         WHERE status = 'active' 
         AND (quota_daily > 0 OR quota_monthly > 0)`
      );
      
      let adjustedCount = 0;
      const adjustments = [];
      
      for (const key of keys) {
        const adjustment = await this.adjustKeyQuota(key);
        if (adjustment.adjusted) {
          adjustedCount++;
          adjustments.push(adjustment);
        }
      }
      
      console.log(`✅ 动态配额调整完成: 调整了 ${adjustedCount} 个密钥`);
      
      // 发送调整报告
      if (adjustedCount > 0) {
        await this.sendAdjustmentReport(adjustments);
      }
      
    } catch (error) {
      console.error('❌ 动态配额调整失败:', error.message);
    }
  }
  
  /**
   * 调整单个密钥的配额
   */
  async adjustKeyQuota(keyInfo) {
    try {
      const { api_key, quota_daily, quota_monthly, used_daily, used_monthly, type, name } = keyInfo;
      
      // 获取使用预测
      const prediction = await costPredictor.predict24HourUsage(api_key);
      
      // 分析当前使用情况
      const analysis = this.analyzeUsage(keyInfo, prediction);
      
      // 决定是否需要调整
      const adjustment = this.decideAdjustment(analysis);
      
      if (!adjustment.shouldAdjust) {
        return {
          api_key,
          name,
          adjusted: false,
          reason: '当前配额配置合理，无需调整',
          analysis
        };
      }
      
      // 执行调整
      const newDailyQuota = Math.round(quota_daily * (1 + adjustment.dailyAdjustment));
      const newMonthlyQuota = Math.round(quota_monthly * (1 + adjustment.monthlyAdjustment));
      
      // 确保最小配额
      const finalDailyQuota = Math.max(newDailyQuota, 1000); // 至少1000 tokens
      const finalMonthlyQuota = Math.max(newMonthlyQuota, 30000); // 至少30000 tokens
      
      // 更新数据库
      await db.updateApiKey(api_key, {
        quota_daily: finalDailyQuota,
        quota_monthly: finalMonthlyQuota
      });
      
      // 记录调整历史
      this.recordAdjustment(api_key, {
        oldDaily: quota_daily,
        newDaily: finalDailyQuota,
        oldMonthly: quota_monthly,
        newMonthly: finalMonthlyQuota,
        reason: adjustment.reason,
        prediction: prediction.predictedTokens,
        confidence: prediction.confidence
      });
      
      return {
        api_key,
        name,
        adjusted: true,
        old_daily_quota: quota_daily,
        new_daily_quota: finalDailyQuota,
        old_monthly_quota: quota_monthly,
        new_monthly_quota: finalMonthlyQuota,
        daily_change_percent: ((finalDailyQuota - quota_daily) / quota_daily * 100).toFixed(1),
        monthly_change_percent: ((finalMonthlyQuota - quota_monthly) / quota_monthly * 100).toFixed(1),
        reason: adjustment.reason,
        analysis,
        timestamp: new Date().toISOString()
      };
      
    } catch (error) {
      console.error(`调整密钥 ${keyInfo.api_key} 配额失败:`, error.message);
      return {
        api_key: keyInfo.api_key,
        name: keyInfo.name,
        adjusted: false,
        error: error.message
      };
    }
  }
  
  /**
   * 分析使用情况
   */
  analyzeUsage(keyInfo, prediction) {
    const { quota_daily, quota_monthly, used_daily, used_monthly } = keyInfo;
    
    // 计算使用率
    const dailyUsageRate = used_daily / quota_daily;
    const monthlyUsageRate = used_monthly / quota_monthly;
    
    // 计算预测使用率
    const predictedDailyUsageRate = prediction.predictedTokens / quota_daily;
    
    // 分析配额充足性
    const quotaAdequacy = {
      daily: {
        currentRate: dailyUsageRate,
        predictedRate: predictedDailyUsageRate,
        isAdequate: predictedDailyUsageRate < 0.7, // 预测使用率低于70%视为充足
        isInadequate: predictedDailyUsageRate > 0.9, // 预测使用率高于90%视为不足
        isCritical: predictedDailyUsageRate > 1.1 // 预测使用率高于110%视为严重不足
      },
      monthly: {
        currentRate: monthlyUsageRate,
        isAdequate: monthlyUsageRate < 0.3, // 月使用率低于30%视为充足
        isInadequate: monthlyUsageRate > 0.7 // 月使用率高于70%视为不足
      }
    };
    
    // 分析使用模式
    const usagePattern = {
      hasPeakHours: prediction.peakHours && prediction.peakHours.length > 0,
      peakHours: prediction.peakHours,
      avgRequestSize: prediction.avgRequestSize,
      confidence: prediction.confidence
    };
    
    return {
      quotaAdequacy,
      usagePattern,
      prediction: {
        predictedTokens: prediction.predictedTokens,
        confidence: prediction.confidence
      },
      currentUsage: {
        daily: used_daily,
        monthly: used_monthly
      }
    };
  }
  
  /**
   * 决定调整策略
   */
  decideAdjustment(analysis) {
    const { quotaAdequacy, usagePattern } = analysis;
    
    let dailyAdjustment = 0;
    let monthlyAdjustment = 0;
    let reason = '';
    
    // 日配额调整逻辑
    if (quotaAdequacy.daily.isCritical) {
      // 严重不足：大幅增加
      dailyAdjustment = this.maxAdjustmentPercent;
      reason = '日配额严重不足，预测使用率超过110%';
    } else if (quotaAdequacy.daily.isInadequate) {
      // 不足：适度增加
      dailyAdjustment = this.minAdjustmentPercent * 2;
      reason = '日配额不足，预测使用率超过90%';
    } else if (quotaAdequacy.daily.isAdequate && quotaAdequacy.daily.currentRate < 0.3) {
      // 过于充足：适度减少
      dailyAdjustment = -this.minAdjustmentPercent;
      reason = '日配额使用率较低（低于30%），适度减少以避免浪费';
    } else if (usagePattern.hasPeakHours && usagePattern.confidence > 0.7) {
      // 有明确高峰时段且置信度高：微调
      dailyAdjustment = this.minAdjustmentPercent * 0.5;
      reason = '检测到明确的使用模式，微调配额以优化资源分配';
    }
    
    // 月配额调整逻辑
    if (quotaAdequacy.monthly.isInadequate) {
      monthlyAdjustment = this.minAdjustmentPercent;
      reason += '；月配额使用率较高（超过70%）';
    } else if (quotaAdequacy.monthly.isAdequate && quotaAdequacy.monthly.currentRate < 0.1) {
      monthlyAdjustment = -this.minAdjustmentPercent * 0.5;
      reason += '；月配额使用率很低（低于10%）';
    }
    
    return {
      shouldAdjust: dailyAdjustment !== 0 || monthlyAdjustment !== 0,
      dailyAdjustment,
      monthlyAdjustment,
      reason: reason || '配额配置合理'
    };
  }
  
  /**
   * 记录调整历史
   */
  recordAdjustment(apiKey, adjustment) {
    const history = this.adjustmentHistory.get(apiKey) || [];
    history.push({
      ...adjustment,
      timestamp: new Date().toISOString()
    });
    
    // 只保留最近10次调整记录
    if (history.length > 10) {
      history.shift();
    }
    
    this.adjustmentHistory.set(apiKey, history);
  }
  
  /**
   * 获取调整历史
   */
  getAdjustmentHistory(apiKey) {
    return this.adjustmentHistory.get(apiKey) || [];
  }
  
  /**
   * 发送调整报告
   */
  async sendAdjustmentReport(adjustments) {
    if (!feishuNotifier.enabled) return;
    
    try {
      const title = '📈 AI网关动态配额调整报告';
      const adjustedKeys = adjustments.filter(a => a.adjusted);
      const skippedKeys = adjustments.filter(a => !a.adjusted);
      
      const markdownContent = `
### 📈 **动态配额调整完成报告**

**调整时间:** ${new Date().toLocaleString('zh-CN')}

**调整摘要:**
- 总共检查: ${adjustments.length} 个密钥
- 已调整: ${adjustedKeys.length} 个密钥
- 未调整: ${skippedKeys.length} 个密钥

**主要调整情况:**
${adjustedKeys.slice(0, 5).map((adj, index) => `
${index + 1}. **${adj.name}** (\`${adj.api_key.substring(0, 12)}...\`)
   - 日配额: ${adj.old_daily_quota.toLocaleString()} → ${adj.new_daily_quota.toLocaleString()} (${adj.daily_change_percent}%)
   - 月配额: ${adj.old_monthly_quota.toLocaleString()} → ${adj.new_monthly_quota.toLocaleString()} (${adj.monthly_change_percent}%)
   - 原因: ${adj.reason}
`).join('')}

${adjustedKeys.length > 5 ? `\n... 还有 ${adjustedKeys.length - 5} 个密钥的调整详情请查看管理后台。` : ''}

**调整原则:**
1. 预测使用率 > 90% → 增加配额
2. 当前使用率 < 30% → 减少配额（避免浪费）
3. 有明确使用模式 → 微调配额优化
4. 确保最小配额保障

**下一步建议:**
- 监控调整后的使用情况
- 根据实际需求手动微调
- 设置预算告警阈值

---
报告生成时间: ${new Date().toLocaleString('zh-CN')}`;
      
      await feishuNotifier.sendMarkdown(markdownContent, title);
      console.log('✅ 动态配额调整报告已发送');
      
    } catch (error) {
      console.error('❌ 发送调整报告失败:', error.message);
    }
  }
  
  /**
   * 手动触发调整
   */
  async manualAdjust(apiKey) {
    try {
      const keyInfo = await db.getApiKey(apiKey);
      if (!keyInfo) {
        return { success: false, error: 'API密钥不存在' };
      }
      
      const adjustment = await this.adjustKeyQuota(keyInfo);
      
      return {
        success: true,
        adjustment,
        timestamp: new Date().toISOString()
      };
      
    } catch (error) {
      console.error('手动调整失败:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  /**
   * 启用/禁用动态调整
   */
  setEnabled(enabled) {
    this.enabled = enabled;
    console.log(`动态配额调整已${enabled ? '启用' : '禁用'}`);
    
    if (enabled && !this.intervalId) {
      this.startAutoAdjustment();
    } else if (!enabled && this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    
    return { enabled: this.enabled };
  }
}

// 创建单例实例
const dynamicQuotaManager = new DynamicQuotaManager();

module.exports = dynamicQuotaManager;