/**
 * 团队管理模块 - 多租户支持
 * 
 * 功能:
 * - 团队级别的预算管理
 * - 团队成员管理
 * - 团队使用统计
 * - 团队配额分配
 */

const db = require('../db/mysql');

class TeamManager {
  constructor() {
    this.teamsCache = new Map();
    this.cacheTTL = 10 * 60 * 1000; // 10分钟缓存
  }
  
  /**
   * 创建团队
   */
  async createTeam(teamData) {
    try {
      const { name, description, quota_daily, quota_monthly, created_by } = teamData;
      
      const [result] = await db.getPool().execute(
        `INSERT INTO gateway_teams 
         (name, description, quota_daily, quota_monthly, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, NOW())`,
        [name, description, quota_daily || 100000, quota_monthly || 3000000, created_by]
      );
      
      const teamId = result.insertId;
      
      console.log(`✅ 团队创建成功: ${name} (ID: ${teamId})`);
      
      // 清除缓存
      this.clearCache();
      
      return {
        success: true,
        team_id: teamId,
        message: '团队创建成功'
      };
      
    } catch (error) {
      console.error('创建团队失败:', error.message);
      return {
        success: false,
        error: '创建团队失败',
        message: error.message
      };
    }
  }
  
  /**
   * 更新团队信息
   */
  async updateTeam(teamId, updateData) {
    try {
      const fields = [];
      const values = [];
      
      if (updateData.name !== undefined) {
        fields.push('name = ?');
        values.push(updateData.name);
      }
      
      if (updateData.description !== undefined) {
        fields.push('description = ?');
        values.push(updateData.description);
      }
      
      if (updateData.quota_daily !== undefined) {
        fields.push('quota_daily = ?');
        values.push(updateData.quota_daily);
      }
      
      if (updateData.quota_monthly !== undefined) {
        fields.push('quota_monthly = ?');
        values.push(updateData.quota_monthly);
      }
      
      if (updateData.status !== undefined) {
        fields.push('status = ?');
        values.push(updateData.status);
      }
      
      if (fields.length === 0) {
        return { success: false, error: '没有提供更新字段' };
      }
      
      values.push(teamId);
      
      const [result] = await db.getPool().execute(
        `UPDATE gateway_teams SET ${fields.join(', ')}, updated_at = NOW() WHERE id = ?`,
        values
      );
      
      if (result.affectedRows === 0) {
        return { success: false, error: '团队不存在' };
      }
      
      console.log(`✅ 团队更新成功: ID ${teamId}`);
      
      // 清除缓存
      this.clearCache();
      
      return {
        success: true,
        affected_rows: result.affectedRows,
        message: '团队更新成功'
      };
      
    } catch (error) {
      console.error('更新团队失败:', error.message);
      return {
        success: false,
        error: '更新团队失败',
        message: error.message
      };
    }
  }
  
  /**
   * 获取团队信息
   */
  async getTeam(teamId) {
    const cacheKey = `team_${teamId}`;
    const cached = this.getFromCache(cacheKey);
    if (cached) return cached;
    
    try {
      const [rows] = await db.getPool().execute(
        `SELECT t.*, 
         (SELECT COUNT(*) FROM gateway_api_keys WHERE team_id = t.id AND status = 'active') as active_keys,
         (SELECT COUNT(*) FROM gateway_users WHERE team_id = t.id) as member_count
         FROM gateway_teams t
         WHERE t.id = ?`,
        [teamId]
      );
      
      if (rows.length === 0) {
        return { success: false, error: '团队不存在' };
      }
      
      const team = rows[0];
      
      // 获取团队使用统计
      const usageStats = await this.getTeamUsageStats(teamId);
      
      const result = {
        success: true,
        team: {
          ...team,
          usage: usageStats
        }
      };
      
      this.saveToCache(cacheKey, result);
      return result;
      
    } catch (error) {
      console.error('获取团队信息失败:', error.message);
      return {
        success: false,
        error: '获取团队信息失败',
        message: error.message
      };
    }
  }
  
  /**
   * 获取团队列表
   */
  async listTeams(filters = {}) {
    const cacheKey = `teams_list_${JSON.stringify(filters)}`;
    const cached = this.getFromCache(cacheKey);
    if (cached) return cached;
    
    try {
      let query = `SELECT t.* FROM gateway_teams t WHERE 1=1`;
      const params = [];
      
      if (filters.status) {
        query += ' AND t.status = ?';
        params.push(filters.status);
      }
      
      if (filters.created_by) {
        query += ' AND t.created_by = ?';
        params.push(filters.created_by);
      }
      
      query += ' ORDER BY t.created_at DESC';
      
      if (filters.limit) {
        query += ' LIMIT ?';
        params.push(filters.limit);
      }
      
      const [rows] = await db.getPool().execute(query, params);
      
      // 为每个团队获取使用统计
      const teamsWithStats = await Promise.all(
        rows.map(async (team) => {
          const usageStats = await this.getTeamUsageStats(team.id);
          return {
            ...team,
            usage: usageStats
          };
        })
      );
      
      const result = {
        success: true,
        teams: teamsWithStats,
        total: teamsWithStats.length
      };
      
      this.saveToCache(cacheKey, result);
      return result;
      
    } catch (error) {
      console.error('获取团队列表失败:', error.message);
      return {
        success: false,
        error: '获取团队列表失败',
        message: error.message
      };
    }
  }
  
  /**
   * 获取团队使用统计
   */
  async getTeamUsageStats(teamId, period = 'today') {
    try {
      let dateCondition = '';
      let params = [teamId];
      
      switch (period) {
        case 'today':
          dateCondition = 'AND DATE(l.created_at) = CURDATE()';
          break;
        case 'yesterday':
          dateCondition = 'AND DATE(l.created_at) = DATE_SUB(CURDATE(), INTERVAL 1 DAY)';
          break;
        case 'this_week':
          dateCondition = 'AND YEARWEEK(l.created_at, 1) = YEARWEEK(CURDATE(), 1)';
          break;
        case 'this_month':
          dateCondition = 'AND YEAR(l.created_at) = YEAR(CURDATE()) AND MONTH(l.created_at) = MONTH(CURDATE())';
          break;
        case 'last_30_days':
          dateCondition = 'AND l.created_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)';
          break;
      }
      
      const [rows] = await db.getPool().execute(
        `SELECT 
          COALESCE(SUM(l.total_tokens), 0) as total_tokens,
          COALESCE(SUM(l.cost_cny), 0) as total_cost,
          COUNT(DISTINCT l.api_key_id) as active_keys_count,
          COUNT(*) as total_requests,
          COALESCE(AVG(l.total_tokens), 0) as avg_tokens_per_request
         FROM gateway_usage_logs l
         INNER JOIN gateway_api_keys k ON l.api_key_id = k.id
         WHERE k.team_id = ?
         ${dateCondition}`,
        params
      );
      
      const stats = rows[0];
      
      // 获取团队配额信息
      const [teamRows] = await db.getPool().execute(
        'SELECT quota_daily, quota_monthly FROM gateway_teams WHERE id = ?',
        [teamId]
      );
      
      const teamQuota = teamRows[0] || { quota_daily: 0, quota_monthly: 0 };
      
      // 计算使用率
      const dailyUsageRate = teamQuota.quota_daily > 0 ? stats.total_tokens / teamQuota.quota_daily : 0;
      const monthlyUsageRate = teamQuota.quota_monthly > 0 ? stats.total_tokens / teamQuota.quota_monthly : 0;
      
      return {
        tokens: parseInt(stats.total_tokens) || 0,
        cost: parseFloat(stats.total_cost) || 0,
        requests: parseInt(stats.total_requests) || 0,
        active_keys: parseInt(stats.active_keys_count) || 0,
        avg_tokens_per_request: parseFloat(stats.avg_tokens_per_request) || 0,
        quota: {
          daily: teamQuota.quota_daily,
          monthly: teamQuota.quota_monthly
        },
        usage_rate: {
          daily: Math.min(dailyUsageRate, 1),
          monthly: Math.min(monthlyUsageRate, 1)
        },
        period
      };
      
    } catch (error) {
      console.error('获取团队使用统计失败:', error.message);
      return {
        tokens: 0,
        cost: 0,
        requests: 0,
        active_keys: 0,
        avg_tokens_per_request: 0,
        quota: { daily: 0, monthly: 0 },
        usage_rate: { daily: 0, monthly: 0 },
        period,
        error: error.message
      };
    }
  }
  
  /**
   * 添加团队成员
   */
  async addTeamMember(teamId, userId, role = 'member') {
    try {
      // 检查用户是否已在团队中
      const [existing] = await db.getPool().execute(
        'SELECT id FROM gateway_users WHERE team_id = ? AND user_id = ?',
        [teamId, userId]
      );
      
      if (existing.length > 0) {
        return { success: false, error: '用户已在团队中' };
      }
      
      const [result] = await db.getPool().execute(
        `INSERT INTO gateway_users (team_id, user_id, role, joined_at)
         VALUES (?, ?, ?, NOW())`,
        [teamId, userId, role]
      );
      
      console.log(`✅ 团队成员添加成功: 团队 ${teamId}, 用户 ${userId}, 角色 ${role}`);
      
      return {
        success: true,
        member_id: result.insertId,
        message: '团队成员添加成功'
      };
      
    } catch (error) {
      console.error('添加团队成员失败:', error.message);
      return {
        success: false,
        error: '添加团队成员失败',
        message: error.message
      };
    }
  }
  
  /**
   * 移除团队成员
   */
  async removeTeamMember(teamId, userId) {
    try {
      const [result] = await db.getPool().execute(
        'DELETE FROM gateway_users WHERE team_id = ? AND user_id = ?',
        [teamId, userId]
      );
      
      if (result.affectedRows === 0) {
        return { success: false, error: '团队成员不存在' };
      }
      
      console.log(`✅ 团队成员移除成功: 团队 ${teamId}, 用户 ${userId}`);
      
      return {
        success: true,
        affected_rows: result.affectedRows,
        message: '团队成员移除成功'
      };
      
    } catch (error) {
      console.error('移除团队成员失败:', error.message);
      return {
        success: false,
        error: '移除团队成员失败',
        message: error.message
      };
    }
  }
  
  /**
   * 获取团队成员列表
   */
  async getTeamMembers(teamId) {
    try {
      const [rows] = await db.getPool().execute(
        `SELECT u.*, 
         (SELECT COUNT(*) FROM gateway_api_keys WHERE created_by = u.user_id AND team_id = ?) as created_keys_count
         FROM gateway_users u
         WHERE u.team_id = ?
         ORDER BY u.joined_at DESC`,
        [teamId, teamId]
      );
      
      return {
        success: true,
        members: rows,
        total: rows.length
      };
      
    } catch (error) {
      console.error('获取团队成员失败:', error.message);
      return {
        success: false,
        error: '获取团队成员失败',
        message: error.message
      };
    }
  }
  
  /**
   * 为团队创建API密钥
   */
  async createTeamApiKey(teamId, keyData) {
    try {
      const { name, description, quota_daily, quota_monthly, created_by } = keyData;
      
      // 检查团队配额
      const teamStats = await this.getTeamUsageStats(teamId, 'this_month');
      const teamRemainingQuota = teamStats.quota.monthly - teamStats.tokens;
      
      if (quota_monthly > teamRemainingQuota) {
        return {
          success: false,
          error: '团队月度配额不足',
          team_remaining_quota: teamRemainingQuota,
          requested_quota: quota_monthly
        };
      }
      
      // 生成API密钥
      const apiKey = `team_${teamId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      const [result] = await db.getPool().execute(
        `INSERT INTO gateway_api_keys 
         (api_key, type, name, description, quota_daily, quota_monthly, 
          team_id, created_by, status, created_at)
         VALUES (?, 'team', ?, ?, ?, ?, ?, ?, 'active', NOW())`,
        [apiKey, name, description, quota_daily || 10000, quota_monthly || 300000, teamId, created_by]
      );
      
      console.log(`✅ 团队API密钥创建成功: ${name} (团队: ${teamId})`);
      
      return {
        success: true,
        api_key: apiKey,
        key_id: result.insertId,
        message: '团队API密钥创建成功'
      };
      
    } catch (error) {
      console.error('创建团队API密钥失败:', error.message);
      return {
        success: false,
        error: '创建团队API密钥失败',
        message: error.message
      };
    }
  }
  
  /**
   * 获取团队的API密钥列表
   */
  async getTeamApiKeys(teamId) {
    try {
      const [rows] = await db.getPool().execute(
        `SELECT k.*,
         COALESCE((SELECT SUM(total_tokens) FROM gateway_usage_logs WHERE api_key_id = k.id AND DATE(created_at) = CURDATE()), 0) as today_usage,
         COALESCE((SELECT SUM(total_tokens) FROM gateway_usage_logs WHERE api_key_id = k.id AND MONTH(created_at) = MONTH(CURDATE())), 0) as month_usage
         FROM gateway_api_keys k
         WHERE k.team_id = ? AND k.status = 'active'
         ORDER BY k.created_at DESC`,
        [teamId]
      );
      
      return {
        success: true,
        api_keys: rows,
        total: rows.length
      };
      
    } catch (error) {
      console.error('获取团队API密钥失败:', error.message);
      return {
        success: false,
        error: '获取团队API密钥失败',
        message: error.message
      };
    }
  }
  
  /**
   * 检查团队预算并发送告警
   */
  async checkTeamBudget(teamId) {
    try {
      const teamStats = await this.getTeamUsageStats(teamId, 'this_month');
      
      const usageRate = teamStats.usage_rate.monthly;
      const alerts = [];
      
      // 检查预算告警级别
      if (usageRate >= 0.95) {
        alerts.push({
          level: 'CRITICAL',
          message: `团队月度预算使用超过95%（当前: ${(usageRate * 100).toFixed(1)}%）`,
          usage_rate: usageRate
        });
      } else if (usageRate >= 0.8) {
        alerts.push({
          level: 'WARNING',
          message: `团队月度预算使用超过80%（当前: ${(usageRate * 100).toFixed(1)}%）`,
          usage_rate: usageRate
        });
      }
      
      return {
        success: true,
        team_id: teamId,
        usage_rate: usageRate,
        alerts,
        stats: teamStats
      };
      
    } catch (error) {
      console.error('检查团队预算失败:', error.message);
      return {
        success: false,
        error: '检查团队预算失败',
        message: error.message
      };
    }
  }
  
  /**
   * 缓存管理
   */
  getFromCache(key) {
    const item = this.teamsCache.get(key);
    if (!item) return null;
    
    if (Date.now() - item.timestamp > this.cacheTTL) {
      this.teamsCache.delete(key);
      return null;
    }
    
    return item.data;
  }
  
  saveToCache(key, data) {
    this.teamsCache.set(key, {
      data,
      timestamp: Date.now()
    });
  }
  
  clearCache() {
    this.teamsCache.clear();
    console.log('✅ 团队缓存已清除');
  }
}

// 创建单例实例
const teamManager = new TeamManager();

module.exports = teamManager;