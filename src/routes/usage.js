/**
 * 用量统计 API
 * 
 * 提供:
 * - 总体用量统计
 * - Token 趋势数据
 * - 模型用量排行
 * - 团队用量排行
 * - 成本报表
 */

const express = require('express');
const router = express.Router();
const db = require('../db/mysql');

/** @param {import('express').Request} req */
function readUsageFilters(req) {
  const model = req.query.model;
  const rawKey = req.query.api_key_id;
  const filters = {};
  if (typeof model === 'string' && model.trim()) {
    filters.model = model.trim();
  }
  if (rawKey !== undefined && rawKey !== null && String(rawKey).trim() !== '') {
    const id = Number(rawKey);
    if (Number.isFinite(id)) {
      filters.api_key_id = id;
    }
  }
  return filters;
}

function readDistinctModelsScope(req) {
  const rawKey = req.query.api_key_id;
  const scope = {};
  if (rawKey !== undefined && rawKey !== null && String(rawKey).trim() !== '') {
    const id = Number(rawKey);
    if (Number.isFinite(id)) {
      scope.api_key_id = id;
    }
  }
  return scope;
}

/** 将用量行转为可 JSON 序列化的纯类型（避免 DECIMAL 字符串 / BigInt / 异常对象导致 res.json 抛错） */
function normalizeModelUsageRow(row) {
  if (!row || typeof row !== 'object') return row;
  return {
    model: row.model == null ? '' : String(row.model),
    tokens: Number(row.tokens) || 0,
    cost: Number(row.cost) || 0,
    requests: Number(row.requests) || 0,
  };
}

function normalizeTeamUsageRow(row) {
  if (!row || typeof row !== 'object') return row;
  const rawTeam = row.team;
  const teamLabel =
    rawTeam == null || rawTeam === ''
      ? '未关联团队'
      : typeof rawTeam === 'string'
        ? maybeFixMojibake(rawTeam)
        : maybeFixMojibake(String(rawTeam));
  return {
    team: teamLabel,
    tokens: Number(row.tokens) || 0,
    cost: Number(row.cost) || 0,
    quota: row.quota != null && row.quota !== '' ? Number(row.quota) : null,
  };
}

function normalizeTrendRow(row) {
  if (!row || typeof row !== 'object') return row;
  const d = row.date;
  return {
    date: d instanceof Date ? d.toISOString().slice(0, 10) : String(d),
    tokens: Number(row.tokens) || 0,
    cost: Number(row.cost) || 0,
  };
}

function maybeFixMojibake(text) {
  if (typeof text !== 'string' || !text) return text;
  const hasCjk = /[\u3400-\u9fff]/.test(text);
  if (hasCjk) return text;
  const looksGarbled = /[\u00C0-\u024F]/.test(text);
  if (!looksGarbled) return text;
  try {
    const cp1252Map = new Map([
      [0x20AC, 0x80], [0x201A, 0x82], [0x0192, 0x83], [0x201E, 0x84],
      [0x2026, 0x85], [0x2020, 0x86], [0x2021, 0x87], [0x02C6, 0x88],
      [0x2030, 0x89], [0x0160, 0x8A], [0x2039, 0x8B], [0x0152, 0x8C],
      [0x017D, 0x8E], [0x2018, 0x91], [0x2019, 0x92], [0x201C, 0x93],
      [0x201D, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97],
      [0x02DC, 0x98], [0x2122, 0x99], [0x0161, 0x9A], [0x203A, 0x9B],
      [0x0153, 0x9C], [0x017E, 0x9E], [0x0178, 0x9F]
    ]);
    const bytes = [];
    for (const ch of text) {
      const code = ch.charCodeAt(0);
      if (code <= 0xFF) {
        bytes.push(code);
        continue;
      }
      const mapped = cp1252Map.get(code);
      if (mapped === undefined) return text;
      bytes.push(mapped);
    }
    const fixed = Buffer.from(bytes).toString('utf8');
    if (!fixed || fixed.includes('�')) return text;
    const fixedHasCjk = /[\u3400-\u9fff]/.test(fixed);
    if (!fixedHasCjk) return text;
    return fixed;
  } catch {
    return text;
  }
}

/**
 * GET /api/v1/usage/distinct-models
 * 当前时间范围内出现过的模型名（可选按 api_key_id 缩小，用于筛选下拉）
 */
router.get('/distinct-models', async (req, res) => {
  try {
    const startDate =
      req.query.start_date || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const endDate = req.query.end_date || new Date().toISOString();
    const scope = readDistinctModelsScope(req);
    const models = await db.getDistinctUsageModels(startDate, endDate, scope);
    res.json({
      success: true,
      data: models || [],
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Failed to get distinct models:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get distinct models',
    });
  }
});

/**
 * GET /api/v1/usage/stats
 * 获取用量统计
 */
router.get('/stats', async (req, res) => {
  try {
    const startDate = req.query.start_date || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const endDate = req.query.end_date || new Date().toISOString();
    const filters = readUsageFilters(req);

    const statsRaw = await db.getUsageStats(startDate, endDate, filters);
    const trend = await db.getUsageTrend(startDate, endDate, filters);
    const totalTokens = Number(statsRaw?.total_tokens || 0);
    const totalRequests = Number(statsRaw?.total_requests || 0);
    const totalCost = Number(statsRaw?.total_cost || 0);
    const endMs = new Date(endDate).getTime();
    const startMs = new Date(startDate).getTime();
    const diffMin = Math.round((endMs - startMs) / 60000);
    const minutes = Number.isFinite(diffMin) && diffMin > 0 ? diffMin : 1;
    const stats = {
      total_tokens: totalTokens,
      total_cost: totalCost,
      total_requests: totalRequests,
      active_users: Number(statsRaw?.active_users || 0),
      tokens_per_min: Math.round(totalTokens / minutes),
      avg_cost_per_msg: totalRequests > 0 ? totalCost / totalRequests : 0,
      trend_days: trend.length
    };
    
    res.json({
      success: true,
      data: stats,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Failed to get usage stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get usage statistics',
    });
  }
});

/**
 * GET /api/v1/usage/trend
 * 获取 Token 趋势数据
 */
router.get('/trend', async (req, res) => {
  try {
    const startDate = req.query.start_date || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const endDate = req.query.end_date || new Date().toISOString();
    const filters = readUsageFilters(req);

    const trend = await db.getUsageTrend(startDate, endDate, filters);
    const trendSafe = (trend || []).map(normalizeTrendRow);

    res.json({
      success: true,
      data: trendSafe,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Failed to get token trend:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get token trend',
    });
  }
});

/**
 * GET /api/v1/usage/models
 * 获取模型用量排行
 */
router.get('/models', async (req, res) => {
  try {
    const startDate =
      req.query.start_date || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const endDate = req.query.end_date || new Date().toISOString();
    const filters = readUsageFilters(req);

    const modelsRaw = await db.getModelUsage(startDate, endDate, filters);
    const models = (modelsRaw || []).map(normalizeModelUsageRow);

    res.json({
      success: true,
      data: models,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Failed to get model usage:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get model usage',
      message: process.env.NODE_ENV !== 'production' ? error.message : undefined,
    });
  }
});

/**
 * GET /api/v1/usage/teams
 * 获取团队用量排行
 */
router.get('/teams', async (req, res) => {
  try {
    const startDate =
      req.query.start_date || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const endDate = req.query.end_date || new Date().toISOString();
    const filters = readUsageFilters(req);

    const teamsRaw = await db.getTeamUsage(startDate, endDate, filters);
    const teams = (teamsRaw || []).map(normalizeTeamUsageRow);

    res.json({
      success: true,
      data: teams,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Failed to get team usage:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get team usage',
      message: process.env.NODE_ENV !== 'production' ? error.message : undefined,
    });
  }
});

/**
 * GET /api/v1/usage/cost/report
 * 获取成本报表
 */
router.get('/cost/report', async (req, res) => {
  try {
    const startDate =
      req.query.start_date || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const endDate = req.query.end_date || new Date().toISOString();
    const report = await db.getCostReport(startDate, endDate);
    const byTeam = (report.byTeam || []).map((item) => ({
      ...item,
      team: maybeFixMojibake(item.team)
    }));

    res.json({
      success: true,
      data: {
        summary: report.summary,
        trend: report.trend,
        by_team: byTeam,
        by_model: report.byModel,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Failed to get cost report:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get cost report',
    });
  }
});

module.exports = router;
