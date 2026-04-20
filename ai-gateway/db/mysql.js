/**
 * Mock database module for testing
 * This replaces the real MySQL connection
 */

const fs = require('fs');
const path = require('path');

// Mock data storage
const mockData = {
  gateway_api_keys: [
    { id: 1, api_key: 'sk-xxx', type: 'team', name: '测试团队', description: '用于测试', quota_daily: 100000, quota_monthly: 3000000, allowed_models: ['qwen'], status: 'active', created_at: '2026-04-10' },
    { id: 2, api_key: 'sk-yyy', type: 'personal', name: '个人密钥', description: '个人使用', quota_daily: 5000, quota_monthly: 150000, allowed_models: ['gpt-4o'], status: 'active', created_at: '2026-04-10' }
  ],
  gateway_usage_logs: [
    { id: 1, request_id: 'req-001', api_key_id: 1, model: 'qwen3.6-plus', prompt_tokens: 120, completion_tokens: 80, total_tokens: 200, cost_cny: 0.02, status: 'success', response_time_ms: 230, created_at: '2026-04-10T10:00:00Z', user_id: 'user-1', team_id: 1 },
    { id: 2, request_id: 'req-002', api_key_id: 2, model: 'gpt-4o', prompt_tokens: 150, completion_tokens: 70, total_tokens: 220, cost_cny: 0.03, status: 'failed', response_time_ms: 180, created_at: '2026-04-10T10:01:00Z', user_id: 'user-2', team_id: 2 }
  ]
};

// Simulate database connection
function getPool() {
  return {
    execute: async (sql, params) => {
      console.log('[Mock DB] Executing:', sql);
      
      // Handle different queries
      if (sql.includes('SELECT * FROM gateway_api_keys')) {
        return [mockData.gateway_api_keys];
      } else if (sql.includes('SELECT * FROM gateway_usage_logs')) {
        return [mockData.gateway_usage_logs];
      } else if (sql.includes('INSERT INTO gateway_usage_logs')) {
        const newId = Math.max(...mockData.gateway_usage_logs.map(r => r.id)) + 1;
        const row = {
          id: newId,
          request_id: params[1],
          api_key_id: params[0],
          model: params[2],
          prompt_tokens: params[3],
          completion_tokens: params[4],
          total_tokens: params[3] + params[4],
          cost_cny: (params[3] + params[4]) * 0.0001,
          status: 'success',
          response_time_ms: 200,
          created_at: new Date().toISOString(),
          user_id: 'user-1',
          team_id: 1
        };
        mockData.gateway_usage_logs.push(row);
        return [{ insertId: newId }];
      } else if (sql.includes('UPDATE gateway_usage_logs')) {
        const requestId = params[1];
        const costCny = params[0];
        const index = mockData.gateway_usage_logs.findIndex(r => r.request_id === requestId);
        if (index !== -1) {
          mockData.gateway_usage_logs[index].cost_cny = costCny;
        }
        return { affectedRows: 1 };
      }
      
      throw new Error(`Unsupported query: ${sql}`);
    }
  };
}

// Export functions
module.exports = {
  getPool,
  testConnection: () => Promise.resolve(true),
  closePool: () => {},
  
  // API Key
  getApiKey: (apiKey) => {
    return mockData.gateway_api_keys.find(k => k.api_key === apiKey) || null;
  },
  createApiKey: (data) => {
    const newId = Math.max(...mockData.gateway_api_keys.map(k => k.id)) + 1;
    const key = {
      id: newId,
      ...data,
      created_at: new Date().toISOString()
    };
    mockData.gateway_api_keys.push(key);
    return key;
  },
  
  // Usage Logs
  listUsageLogs: (options) => {
    const page = options.page || 1;
    const limit = options.limit || 20;
    const start = options.start;
    const end = options.end;
    const model = options.model;
    const apiKeyPattern = options.apiKeyPattern;
    const requestId = options.requestId;
    const httpStatus = options.httpStatus;
    
    let filtered = [...mockData.gateway_usage_logs];
    
    if (start && end) {
      filtered = filtered.filter(r => r.created_at >= start && r.created_at <= end);
    }
    
    if (model) {
      filtered = filtered.filter(r => r.model === model);
    }
    
    if (requestId) {
      filtered = filtered.filter(r => r.request_id === requestId);
    }
    
    if (apiKeyPattern) {
      filtered = filtered.filter(r => r.api_key_id.toString().includes(apiKeyPattern));
    }
    
    if (httpStatus === '200') {
      filtered = filtered.filter(r => r.status === 'success');
    } else if (httpStatus === '500') {
      filtered = filtered.filter(r => r.status === 'failed');
    }
    
    const total = filtered.length;
    const totalPages = Math.ceil(total / limit);
    const startIdx = (page - 1) * limit;
    const logs = filtered.slice(startIdx, startIdx + limit);
    
    return {
      logs,
      total,
      page,
      limit,
      totalPages
    };
  }
};
