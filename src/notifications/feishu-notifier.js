/**
 * 飞书机器人通知模块
 * 
 * 功能:
 * - 发送预算告警到飞书群
 * - 发送使用统计报告
 * - 支持多种消息格式（文本、卡片、Markdown）
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');

const FEISHU_SESSION_STORE =
  process.env.FEISHU_SESSION_STORE ||
  path.join(process.cwd(), 'storage', 'feishu', 'sessions.json');

class FeishuNotifier {
  constructor(config = {}) {
    this.webhookUrl = config.webhookUrl || process.env.FEISHU_WEBHOOK_URL;
    this.appId = config.appId || process.env.FEISHU_APP_ID;
    this.appSecret = config.appSecret || process.env.FEISHU_APP_SECRET;
    this.receiveId = config.receiveId || process.env.FEISHU_ALERT_OPEN_ID;
    this.tokenCache = null;
    this.enabled = !!(this.webhookUrl || (this.appId && this.appSecret));
    
    if (this.enabled) {
      console.log(`✅ 飞书通知系统已启用 (${this.webhookUrl ? 'webhook' : 'app'})`);
    } else {
      console.log('⚠️  飞书通知系统未配置，请设置 FEISHU_WEBHOOK_URL 或 FEISHU_APP_ID/FEISHU_APP_SECRET 环境变量');
    }
  }

  async getTenantAccessToken() {
    if (this.tokenCache && this.tokenCache.expiresAt > Date.now() + 30_000) {
      return this.tokenCache.token;
    }
    if (!this.appId || !this.appSecret) {
      throw new Error('FEISHU_APP_ID or FEISHU_APP_SECRET is missing');
    }

    const response = await axios.post(
      'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
      {
        app_id: this.appId,
        app_secret: this.appSecret,
      },
      {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
        },
        timeout: 10_000,
      }
    );
    const data = response.data || {};
    if (response.status !== 200 || data.code !== 0 || !data.tenant_access_token) {
      throw new Error(`feishu token failed: code=${data.code}, msg=${data.msg || 'unknown'}`);
    }
    this.tokenCache = {
      token: data.tenant_access_token,
      expiresAt: Date.now() + Number(data.expire || 7200) * 1000,
    };
    return this.tokenCache.token;
  }

  resolveReceiveId(overrideReceiveId) {
    if (overrideReceiveId) return overrideReceiveId;
    if (this.receiveId) return this.receiveId;
    if (!fs.existsSync(FEISHU_SESSION_STORE)) {
      throw new Error(`Feishu session store missing: ${FEISHU_SESSION_STORE}`);
    }
    const raw = fs.readFileSync(FEISHU_SESSION_STORE, 'utf8');
    const sessions = JSON.parse(raw);
    const prefix = 'agent:main:feishu:direct:';
    let bestId = '';
    let bestTs = 0;
    for (const [key, value] of Object.entries(sessions || {})) {
      if (!key.startsWith(prefix)) continue;
      const id = key.slice(prefix.length).trim();
      const ts = Number(value?.updatedAt || 0);
      if (id && ts >= bestTs) {
        bestId = id;
        bestTs = ts;
      }
    }
    if (!bestId) {
      throw new Error('cannot resolve feishu receive_id; set FEISHU_ALERT_OPEN_ID');
    }
    return bestId;
  }

  async sendAppMessage(message, options = {}) {
    const token = await this.getTenantAccessToken();
    const receiveId = this.resolveReceiveId(options.receiveId);
    const response = await axios.post(
      'https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id',
      {
        receive_id: receiveId,
        msg_type: 'text',
        content: JSON.stringify({ text: message }),
      },
      {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          Authorization: `Bearer ${token}`,
        },
        timeout: 10_000,
      }
    );
    const data = response.data || {};
    if (response.status !== 200 || data.code !== 0) {
      throw new Error(`feishu send failed: code=${data.code}, msg=${data.msg || 'unknown'}`);
    }
    return true;
  }

  async sendAppInteractive(card, options = {}) {
    const token = await this.getTenantAccessToken();
    const receiveId = this.resolveReceiveId(options.receiveId);
    const response = await axios.post(
      'https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id',
      {
        receive_id: receiveId,
        msg_type: 'interactive',
        content: JSON.stringify(card),
      },
      {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          Authorization: `Bearer ${token}`,
        },
        timeout: 10_000,
      }
    );
    const data = response.data || {};
    if (response.status !== 200 || data.code !== 0) {
      throw new Error(`feishu interactive send failed: code=${data.code}, msg=${data.msg || 'unknown'}`);
    }
    return true;
  }
  
  /**
   * 发送文本消息
   */
  async sendText(content, title = 'AI网关通知', options = {}) {
    if (!this.enabled) return false;
    
    try {
      if (!this.webhookUrl) {
        return await this.sendAppMessage(`【${title}】\n${content}`, options);
      }
      const response = await axios.post(this.webhookUrl, {
        msg_type: 'text',
        content: {
          text: `【${title}】\n${content}`
        }
      });
      
      return response.data.StatusCode === 0;
    } catch (error) {
      console.error('发送飞书消息失败:', error.message);
      return false;
    }
  }
  
  /**
   * 发送Markdown消息
   */
  async sendMarkdown(content, title = 'AI网关通知', options = {}) {
    if (!this.enabled) return false;
    
    try {
      if (!this.webhookUrl) {
        const plainText = [`【${title}】`, content, `发送时间: ${new Date().toLocaleString('zh-CN')}`].join('\n\n');
        return await this.sendAppMessage(plainText, options);
      }
      const response = await axios.post(this.webhookUrl, {
        msg_type: 'interactive',
        card: {
          config: {
            wide_screen_mode: true
          },
          header: {
            title: {
              tag: 'plain_text',
              content: title
            },
            template: this.getColorTemplate('blue')
          },
          elements: [
            {
              tag: 'markdown',
              content: content
            },
            {
              tag: 'hr'
            },
            {
              tag: 'note',
              elements: [
                {
                  tag: 'plain_text',
                  content: `发送时间: ${new Date().toLocaleString('zh-CN')}`
                }
              ]
            }
          ]
        }
      });
      
      return response.data.StatusCode === 0;
    } catch (error) {
      console.error('发送飞书Markdown消息失败:', error.message);
      return false;
    }
  }

  async sendInteractiveCard(card, options = {}) {
    if (!this.enabled) return false;

    try {
      if (!this.webhookUrl) {
        return await this.sendAppInteractive(card, options);
      }
      const response = await axios.post(this.webhookUrl, {
        msg_type: 'interactive',
        card,
      });
      return response.data.StatusCode === 0;
    } catch (error) {
      console.error('发送飞书交互卡片失败:', error.message);
      return false;
    }
  }
  
  /**
   * 发送预算告警
   */
  async sendBudgetAlert(apiKey, level, message, usageInfo) {
    if (!this.enabled) return false;
    
    const levelEmoji = {
      'WARNING': '⚠️',
      'CRITICAL': '🚨',
      'BLOCK': '⛔'
    };
    
    const emoji = levelEmoji[level] || '📢';
    const title = `${emoji} AI网关预算告警 - ${level}`;
    
    const markdownContent = `
### ${emoji} **${level} 级别告警**

**API密钥:** \`${apiKey.substring(0, 12)}...\`

**告警信息:** ${message}

**使用情况:**
- 日配额: ${usageInfo.dailyQuota?.toLocaleString() || 'N/A'} tokens
- 已使用: ${usageInfo.dailyUsed?.toLocaleString() || 'N/A'} tokens
- 使用率: ${usageInfo.usageRatio ? (usageInfo.usageRatio * 100).toFixed(1) + '%' : 'N/A'}

**建议操作:**
${this.getActionSuggestions(level, usageInfo)}

---
如需调整配额或查看详情，请访问管理后台。`;
    
    return this.sendMarkdown(markdownContent, title);
  }
  
  /**
   * 发送使用统计报告
   */
  async sendUsageReport(apiKey, reportData) {
    if (!this.enabled) return false;
    
    const { period, totalTokens, totalCost, topModels, usageTrend } = reportData;
    const title = '📊 AI网关使用统计报告';
    
    const markdownContent = `
### 📊 **${period} 使用统计报告**

**API密钥:** \`${apiKey.substring(0, 12)}...\`

**汇总信息:**
- 总Token使用: **${totalTokens.toLocaleString()} tokens**
- 总费用: **¥${totalCost.toFixed(4)}**
- 平均每次调用: ${(totalTokens / Math.max(reportData.requestCount, 1)).toFixed(0)} tokens

**模型使用排行:**
${topModels.map((model, index) => 
  `${index + 1}. ${model.name}: ${model.tokens.toLocaleString()} tokens (¥${model.cost.toFixed(4)})`
).join('\\n')}

**使用趋势:**
${usageTrend ? `- 高峰时段: ${usageTrend.peakHour}:00` : ''}
${usageTrend ? `- 平均每小时: ${usageTrend.avgHourlyTokens.toLocaleString()} tokens` : ''}

---
报告生成时间: ${new Date().toLocaleString('zh-CN')}`;
    
    return this.sendMarkdown(markdownContent, title);
  }
  
  /**
   * 发送限流通知
   */
  async sendRateLimitAlert(apiKey, reason, estimatedTokens) {
    if (!this.enabled) return false;
    
    const title = '🚦 AI网关限流通知';
    const markdownContent = `
### 🚦 **API调用被限流**

**API密钥:** \`${apiKey.substring(0, 12)}...\`

**限流原因:** ${reason}

**预估Token使用:** ${estimatedTokens?.toLocaleString() || 'N/A'} tokens

**可能的原因:**
1. 小时Token使用超过阈值
2. 短时间内调用频率过高
3. 系统检测到异常使用模式

**建议操作:**
1. 检查调用频率是否合理
2. 考虑增加配额或优化使用模式
3. 联系管理员调整限流策略

---
如需调整限流策略，请访问管理后台。`;
    
    return this.sendMarkdown(markdownContent, title);
  }
  
  /**
   * 获取颜色模板
   */
  getColorTemplate(type) {
    const colors = {
      'blue': 'blue',
      'green': 'green',
      'yellow': 'yellow',
      'red': 'red',
      'orange': 'orange',
      'purple': 'purple',
      'turquoise': 'turquoise'
    };
    
    return colors[type] || 'blue';
  }
  
  /**
   * 获取操作建议
   */
  getActionSuggestions(level, usageInfo) {
    const suggestions = {
      'WARNING': [
        '1. 监控使用趋势，避免突然增长',
        '2. 考虑优化提示词减少Token使用',
        '3. 如需更多配额，请提前申请'
      ],
      'CRITICAL': [
        '1. **立即检查使用情况**',
        '2. 考虑临时增加配额',
        '3. 优化模型选择（使用成本更低的模型）',
        '4. 启用更严格的限流策略'
      ],
      'BLOCK': [
        '1. **API调用已被自动阻断**',
        '2. 必须调整配额后才能继续使用',
        '3. 联系管理员紧急处理',
        '4. 检查是否有异常使用情况'
      ]
    };
    
    return suggestions[level]?.join('\\n') || '请检查使用情况并采取适当措施。';
  }
  
  /**
   * 测试连接
   */
  async testConnection() {
    if (!this.enabled) {
      return { success: false, message: '飞书通知未启用' };
    }
    
    try {
      const success = await this.sendText('飞书通知系统测试消息', '连接测试');
      return {
        success,
        message: success ? '飞书通知连接成功' : '飞书通知发送失败'
      };
    } catch (error) {
      return {
        success: false,
        message: `飞书通知连接失败: ${error.message}`
      };
    }
  }
}

// 创建单例实例
const feishuNotifier = new FeishuNotifier();

module.exports = feishuNotifier;
