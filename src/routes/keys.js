/**
 * API Key 管理 API
 */

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db/mysql');

/**
 * GET /api/v1/keys
 * 获取 API Key 列表
 */
router.get('/', async (req, res) => {
  try {
    const { type, status, search } = req.query;
    const filters = {};
    if (type) filters.type = type;
    if (status) filters.status = status;
    if (search) filters.search = search;
    
    const keys = await db.getApiKeys(filters);
    
    res.json({
      success: true,
      data: keys,
      total: keys.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Failed to list API keys:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to list API keys',
    });
  }
});

/**
 * GET /api/v1/keys/:key
 * 获取 API Key 详情
 */
router.get('/:key', async (req, res) => {
  try {
    const apiKey = await db.getApiKey(req.params.key);
    
    if (!apiKey) {
      return res.status(404).json({
        success: false,
        error: 'API Key not found',
      });
    }
    
    res.json({
      success: true,
      data: apiKey,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Failed to get API key:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get API key',
    });
  }
});

/**
 * POST /api/v1/keys
 * 创建 API Key
 */
router.post('/', async (req, res) => {
  try {
    const { type, name, quota_daily, quota_monthly, allowed_models, status, description } = req.body;
    
    if (!type || !['team', 'user', 'proj'].includes(type)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid type',
      });
    }
    
    if (!name) {
      return res.status(400).json({
        success: false,
        error: 'Name is required',
      });
    }
    
    const newKey = `${type}_${uuidv4().replace(/-/g, '').substring(0, 20)}`;
    
    const apiKey = await db.createApiKey({
      api_key: newKey,
      type,
      name,
      description: description || null,
      quota_daily: parseInt(quota_daily) || 100000,
      quota_monthly: parseInt(quota_monthly) || 3000000,
      allowed_models: allowed_models || ['qwen'],
      status: status || 'active',
    });
    
    res.status(201).json({
      success: true,
      data: apiKey,
      message: 'API Key created successfully',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Failed to create API key:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create API key',
    });
  }
});

/**
 * PUT /api/v1/keys/:key
 * 更新 API Key
 */
router.put('/:key', async (req, res) => {
  try {
    const existingKey = await db.getApiKey(req.params.key);
    
    if (!existingKey) {
      return res.status(404).json({
        success: false,
        error: 'API Key not found',
      });
    }
    
    const updates = req.body;
    delete updates.key;
    delete updates.created_at;
    delete updates.used_daily;
    delete updates.used_monthly;
    
    await db.updateApiKey(req.params.key, updates);
    const updatedKey = await db.getApiKey(req.params.key);
    
    res.json({
      success: true,
      data: updatedKey,
      message: 'API Key updated successfully',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Failed to update API key:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update API key',
    });
  }
});

/**
 * DELETE /api/v1/keys/:key
 * 删除 API Key
 */
router.delete('/:key', async (req, res) => {
  try {
    const existingKey = await db.getApiKey(req.params.key);
    
    if (!existingKey) {
      return res.status(404).json({
        success: false,
        error: 'API Key not found',
      });
    }
    
    await db.deleteApiKey(req.params.key);
    
    res.json({
      success: true,
      message: 'API Key deleted successfully',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Failed to delete API key:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete API key',
    });
  }
});

/**
 * GET /api/v1/keys/:key/usage
 * 获取 API Key 使用统计
 */
router.get('/:key/usage', async (req, res) => {
  try {
    const apiKey = await db.getApiKey(req.params.key);
    
    if (!apiKey) {
      return res.status(404).json({
        success: false,
        error: 'API Key not found',
      });
    }
    
    const usage = {
      key: apiKey.api_key,
      quota_daily: apiKey.quota_daily,
      used_daily: apiKey.used_daily,
      remaining_daily: apiKey.quota_daily - apiKey.used_daily,
      daily_usage_percent: ((apiKey.used_daily / apiKey.quota_daily) * 100).toFixed(1),
      quota_monthly: apiKey.quota_monthly,
      used_monthly: apiKey.used_monthly,
      remaining_monthly: apiKey.quota_monthly - apiKey.used_monthly,
      monthly_usage_percent: ((apiKey.used_monthly / apiKey.quota_monthly) * 100).toFixed(1),
    };
    
    res.json({
      success: true,
      data: usage,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Failed to get API key usage:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get API key usage',
    });
  }
});

module.exports = router;
