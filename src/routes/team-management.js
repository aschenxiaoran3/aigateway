/**
 * 团队管理API路由
 * 
 * 功能:
 * - 团队创建和管理
 * - 团队成员管理
 * - 团队预算监控
 * - 团队使用统计
 */

const express = require('express');
const router = express.Router();
const teamManager = require('../teams/team-manager');
const authMiddleware = require('../middleware/auth');

/**
 * 创建团队
 */
router.post('/v1/teams', authMiddleware, async (req, res) => {
  try {
    const { name, description, quota_daily, quota_monthly } = req.body;
    
    if (!name) {
      return res.status(400).json({
        success: false,
        error: '团队名称不能为空'
      });
    }
    
    const result = await teamManager.createTeam({
      name,
      description,
      quota_daily: quota_daily || 100000,
      quota_monthly: quota_monthly || 3000000,
      created_by: req.userId || 0
    });
    
    if (!result.success) {
      return res.status(400).json(result);
    }
    
    res.json(result);
  } catch (error) {
    console.error('创建团队失败:', error.message);
    res.status(500).json({
      success: false,
      error: '创建团队失败',
      message: error.message
    });
  }
});

/**
 * 获取团队信息
 */
router.get('/v1/teams/:teamId', authMiddleware, async (req, res) => {
  try {
    const teamId = parseInt(req.params.teamId);
    
    if (isNaN(teamId) || teamId <= 0) {
      return res.status(400).json({
        success: false,
        error: '无效的团队ID'
      });
    }
    
    const result = await teamManager.getTeam(teamId);
    
    if (!result.success) {
      return res.status(404).json(result);
    }
    
    res.json(result);
  } catch (error) {
    console.error('获取团队信息失败:', error.message);
    res.status(500).json({
      success: false,
      error: '获取团队信息失败',
      message: error.message
    });
  }
});

/**
 * 更新团队信息
 */
router.put('/v1/teams/:teamId', authMiddleware, async (req, res) => {
  try {
    const teamId = parseInt(req.params.teamId);
    
    if (isNaN(teamId) || teamId <= 0) {
      return res.status(400).json({
        success: false,
        error: '无效的团队ID'
      });
    }
    
    const result = await teamManager.updateTeam(teamId, req.body);
    
    if (!result.success) {
      return res.status(400).json(result);
    }
    
    res.json(result);
  } catch (error) {
    console.error('更新团队失败:', error.message);
    res.status(500).json({
      success: false,
      error: '更新团队失败',
      message: error.message
    });
  }
});

/**
 * 获取团队列表
 */
router.get('/v1/teams', authMiddleware, async (req, res) => {
  try {
    const filters = {};
    
    if (req.query.status) {
      filters.status = req.query.status;
    }
    
    if (req.query.created_by) {
      filters.created_by = parseInt(req.query.created_by);
    }
    
    if (req.query.limit) {
      filters.limit = parseInt(req.query.limit);
    }
    
    const result = await teamManager.listTeams(filters);
    
    res.json(result);
  } catch (error) {
    console.error('获取团队列表失败:', error.message);
    res.status(500).json({
      success: false,
      error: '获取团队列表失败',
      message: error.message
    });
  }
});

/**
 * 获取团队使用统计
 */
router.get('/v1/teams/:teamId/usage', authMiddleware, async (req, res) => {
  try {
    const teamId = parseInt(req.params.teamId);
    const period = req.query.period || 'today';
    
    if (isNaN(teamId) || teamId <= 0) {
      return res.status(400).json({
        success: false,
        error: '无效的团队ID'
      });
    }
    
    const validPeriods = ['today', 'yesterday', 'this_week', 'this_month', 'last_30_days'];
    if (!validPeriods.includes(period)) {
      return res.status(400).json({
        success: false,
        error: '无效的时间周期',
        valid_periods: validPeriods
      });
    }
    
    const stats = await teamManager.getTeamUsageStats(teamId, period);
    
    res.json({
      success: true,
      team_id: teamId,
      period,
      stats
    });
  } catch (error) {
    console.error('获取团队使用统计失败:', error.message);
    res.status(500).json({
      success: false,
      error: '获取团队使用统计失败',
      message: error.message
    });
  }
});

/**
 * 添加团队成员
 */
router.post('/v1/teams/:teamId/members', authMiddleware, async (req, res) => {
  try {
    const teamId = parseInt(req.params.teamId);
    const { user_id, role } = req.body;
    
    if (isNaN(teamId) || teamId <= 0) {
      return res.status(400).json({
        success: false,
        error: '无效的团队ID'
      });
    }
    
    if (!user_id) {
      return res.status(400).json({
        success: false,
        error: '用户ID不能为空'
      });
    }
    
    const result = await teamManager.addTeamMember(teamId, user_id, role || 'member');
    
    if (!result.success) {
      return res.status(400).json(result);
    }
    
    res.json(result);
  } catch (error) {
    console.error('添加团队成员失败:', error.message);
    res.status(500).json({
      success: false,
      error: '添加团队成员失败',
      message: error.message
    });
  }
});

/**
 * 移除团队成员
 */
router.delete('/v1/teams/:teamId/members/:userId', authMiddleware, async (req, res) => {
  try {
    const teamId = parseInt(req.params.teamId);
    const userId = parseInt(req.params.userId);
    
    if (isNaN(teamId) || teamId <= 0) {
      return res.status(400).json({
        success: false,
        error: '无效的团队ID'
      });
    }
    
    if (isNaN(userId) || userId <= 0) {
      return res.status(400).json({
        success: false,
        error: '无效的用户ID'
      });
    }
    
    const result = await teamManager.removeTeamMember(teamId, userId);
    
    if (!result.success) {
      return res.status(400).json(result);
    }
    
    res.json(result);
  } catch (error) {
    console.error('移除团队成员失败:', error.message);
    res.status(500).json({
      success: false,
      error: '移除团队成员失败',
      message: error.message
    });
  }
});

/**
 * 获取团队成员列表
 */
router.get('/v1/teams/:teamId/members', authMiddleware, async (req, res) => {
  try {
    const teamId = parseInt(req.params.teamId);
    
    if (isNaN(teamId) || teamId <= 0) {
      return res.status(400).json({
        success: false,
        error: '无效的团队ID'
      });
    }
    
    const result = await teamManager.getTeamMembers(teamId);
    
    res.json(result);
  } catch (error) {
    console.error('获取团队成员失败:', error.message);
    res.status(500).json({
      success: false,
      error: '获取团队成员失败',
      message: error.message
    });
  }
});

/**
 * 为团队创建API密钥
 */
router.post('/v1/teams/:teamId/api-keys', authMiddleware, async (req, res) => {
  try {
    const teamId = parseInt(req.params.teamId);
    const { name, description, quota_daily, quota_monthly } = req.body;
    
    if (isNaN(teamId) || teamId <= 0) {
      return res.status(400).json({
        success: false,
        error: '无效的团队ID'
      });
    }
    
    if (!name) {
      return res.status(400).json({
        success: false,
        error: 'API密钥名称不能为空'
      });
    }
    
    const result = await teamManager.createTeamApiKey(teamId, {
      name,
      description,
      quota_daily: quota_daily || 10000,
      quota_monthly: quota_monthly || 300000,
      created_by: req.userId || 0
    });
    
    if (!result.success) {
      return res.status(400).json(result);
    }
    
    res.json(result);
  } catch (error) {
    console.error('创建团队API密钥失败:', error.message);
    res.status(500).json({
      success: false,
      error: '创建团队API密钥失败',
      message: error.message
    });
  }
});

/**
 * 获取团队的API密钥列表
 */
router.get('/v1/teams/:teamId/api-keys', authMiddleware, async (req, res) => {
  try {
    const teamId = parseInt(req.params.teamId);
    
    if (isNaN(teamId) || teamId <= 0) {
      return res.status(400).json({
        success: false,
        error: '无效的团队ID'
      });
    }
    
    const result = await teamManager.getTeamApiKeys(teamId);
    
    res.json(result);
  } catch (error) {
    console.error('获取团队API密钥失败:', error.message);
    res.status(500).json({
      success: false,
      error: '获取团队API密钥失败',
      message: error.message
    });
  }
});

/**
 * 检查团队预算
 */
router.get('/v1/teams/:teamId/budget-check', authMiddleware, async (req, res) => {
  try {
    const teamId = parseInt(req.params.teamId);
    
    if (isNaN(teamId) || teamId <= 0) {
      return res.status(400).json({
        success: false,
        error: '无效的团队ID'
      });
    }
    
    const result = await teamManager.checkTeamBudget(teamId);
    
    res.json(result);
  } catch (error) {
    console.error('检查团队预算失败:', error.message);
    res.status(500).json({
      success: false,
      error: '检查团队预算失败',
      message: error.message
    });
  }
});

/**
 * 获取团队使用趋势
 */
router.get('/v1/teams/:teamId/trend', authMiddleware, async (req, res) => {
  try {
    const teamId = parseInt(req.params.teamId);
    const days = parseInt(req.query.days) || 30;
    
    if (isNaN(teamId) || teamId <= 0) {
      return res.status(400).json({
        success: false,
        error: '无效的团队ID'
      });
    }
    
    if (days < 1 || days > 365) {
      return res.status(400).json({
        success: false,
        error: '天数必须在1-365之间'
      });
    }
    
    const [rows] = await db.getPool().execute(
      `SELECT 
        DATE(l.created_at) as date,
        SUM(l.total_tokens) as daily_tokens,
        SUM(l.cost_cny) as daily_cost,
        COUNT(*) as daily_requests
       FROM gateway_usage_logs l
       INNER JOIN gateway_api_keys k ON l.api_key_id = k.id
       WHERE k.team_id = ?
       AND l.created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
       GROUP BY DATE(l.created_at)
       ORDER BY date`,
      [teamId, days]
    );
    
    // 计算统计数据
    const totalTokens = rows.reduce((sum, row) => sum + (parseInt(row.daily_tokens) || 0), 0);
    const totalCost = rows.reduce((sum, row) => sum + (parseFloat(row.daily_cost) || 0), 0);
    const totalRequests = rows.reduce((sum, row) => sum + (parseInt(row.daily_requests) || 0), 0);
    
    res.json({
      success: true,
      team_id: teamId,
      period_days: days,
      trend: rows,
      summary: {
        total_tokens: totalTokens,
        total_cost: totalCost,
        total_requests: totalRequests,
        avg_daily_tokens: totalTokens / Math.max(rows.length, 1),
        avg_daily_cost: totalCost / Math.max(rows.length, 1),
        avg_daily_requests: totalRequests / Math.max(rows.length, 1)
      }
    });
    
  } catch (error) {
    console.error('获取团队使用趋势失败:', error.message);
    res.status(500).json({
      success: false,
      error: '获取团队使用趋势失败',
      message: error.message
    });
  }
});

module.exports = router;