/**
 * 成本追踪中间件
 * 
 * 功能:
 * - 计算每次 API 调用的成本
 * - 支持多种模型的计费标准
 * - 在响应中附加成本信息
 * - 持久化成本数据到 JSON 文件 + 内存跟踪
 */

const { MODEL_CONFIGS } = require('../routes/model-router');
const fs = require('fs');
const path = require('path');

// ─── 文件持久化 ───
const dataDir = path.join(__dirname, '../../data');
const costsFile = path.join(dataDir, 'costs.json');

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// 加载已有数据
let costRecords = [];
try {
  if (fs.existsSync(costsFile)) {
    costRecords = JSON.parse(fs.readFileSync(costsFile, 'utf-8'));
  }
} catch (err) {
  console.error('[cost-tracker] Failed to load existing cost data:', err.message);
  costRecords = [];
}

/**
 * 持久化成本记录到 JSON 文件
 */
function saveCostsToFile() {
  try {
    fs.writeFileSync(costsFile, JSON.stringify(costRecords, null, 2), 'utf-8');
  } catch (err) {
    console.error('[cost-tracker] Failed to save cost data:', err.message);
  }
}

/**
 * 添加一条成本记录
 */
function addCostRecord(record) {
  costRecords.push(record);
  // 只保留最近 10000 条记录在内存中
  if (costRecords.length > 10000) {
    costRecords = costRecords.slice(-10000);
  }
  saveCostsToFile();
}

/**
 * 查询成本记录（供路由使用）
 */
function getCostRecords(options = {}) {
  const { page = 1, limit = 50, apiKey, teamId, startDate, endDate } = options;
  let filtered = [...costRecords];

  if (apiKey) {
    filtered = filtered.filter(r => r.api_key === apiKey);
  }
  if (teamId) {
    filtered = filtered.filter(r => r.team_id === teamId);
  }
  if (startDate) {
    filtered = filtered.filter(r => r.timestamp >= startDate);
  }
  if (endDate) {
    filtered = filtered.filter(r => r.timestamp <= endDate);
  }

  // 按时间倒序
  filtered.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  const total = filtered.length;
  const totalPages = Math.ceil(total / limit);
  const start = (page - 1) * limit;
  const records = filtered.slice(start, start + limit);

  return {
    data: records,
    pagination: {
      page,
      limit,
      total,
      totalPages,
    },
  };
}

// ─── 成本计算 ───
function calculateCost(model, usage) {
  const config = MODEL_CONFIGS[model];

  if (!config || !usage) {
    return 0;
  }

  const inputCost = (usage.prompt_tokens / 1000) * config.cost_per_1k_tokens.input;
  const outputCost = (usage.completion_tokens / 1000) * config.cost_per_1k_tokens.output;

  return inputCost + outputCost;
}

// ─── 中间件 ───
async function costTracker(req, res, next) {
  const originalJson = res.json;

  res.json = function(data) {
    // 如果有 usage 信息，计算成本
    if (data.usage && data.gateway?.model_used) {
      const model = data.gateway.model_used;
      const cost = calculateCost(model, data.usage);

      // 附加成本信息
      data.usage.cost_cny = parseFloat(cost.toFixed(6));

      // 记录到审计日志
      const { logTokenUsage } = require('./audit');
      logTokenUsage(req, data.usage);

      // 写入 JSON 文件并更新内存
      updateCostRecord(req, data);
    }

    return originalJson.call(this, data);
  };

  next();
}

// 写入成本记录到 JSON 文件
function updateCostRecord(req, data) {
  try {
    const record = {
      request_id: req.requestId,
      timestamp: new Date().toISOString(),
      api_key: req.apiKey,
      user_id: req.gatewayUserId != null ? req.gatewayUserId : null,
      team_id: req.teamId,
      model: data.gateway?.model_used,
      prompt_tokens: data.usage?.prompt_tokens,
      completion_tokens: data.usage?.completion_tokens,
      total_tokens: data.usage?.total_tokens,
      cost_cny: data.usage?.cost_cny,
    };

    addCostRecord(record);
  } catch (error) {
    console.error('[cost-tracker] Failed to record cost:', error.message);
  }
}

// 导出
module.exports = costTracker;
module.exports.calculateCost = calculateCost;
module.exports.getCostRecords = getCostRecords;
module.exports.addCostRecord = addCostRecord;
module.exports.costRecords = costRecords;
