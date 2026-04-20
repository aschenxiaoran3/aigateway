/**
 * 团队管理 API
 * 
 * 提供:
 * - 团队列表查询
 * - 创建团队
 * - 更新团队
 * - 删除团队
 * - 团队成员管理
 */

const express = require('express');
const router = express.Router();
const db = require('../db/mysql');

function maybeFixMojibake(text) {
  if (typeof text !== 'string' || !text) return text;
  if (/[\u3400-\u9fff]/.test(text)) return text;
  if (!/[\u00C0-\u024F]/.test(text)) return text;
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
    if (!/[\u3400-\u9fff]/.test(fixed)) return text;
    return fixed;
  } catch {
    return text;
  }
}

/**
 * GET /api/v1/teams
 * 获取团队列表
 */
router.get('/', async (req, res) => {
  try {
    const teamsRaw = await db.getTeams({
      status: req.query.status,
      search: req.query.search
    });
    const teams = teamsRaw.map((team) => ({
      ...team,
      name: maybeFixMojibake(team.name)
    }));
    
    res.json({
      success: true,
      data: teams,
      total: teams.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Failed to list teams:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to list teams',
    });
  }
});

/**
 * GET /api/v1/teams/:id
 * 获取团队详情
 */
router.get('/:id', async (req, res) => {
  try {
    const teamRaw = await db.getTeamById(req.params.id);
    const team = teamRaw ? { ...teamRaw, name: maybeFixMojibake(teamRaw.name) } : null;
    
    if (!team) {
      return res.status(404).json({
        success: false,
        error: 'Team not found',
      });
    }
    
    res.json({
      success: true,
      data: team,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Failed to get team:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get team',
    });
  }
});

/**
 * POST /api/v1/teams
 * 创建团队
 */
router.post('/', async (req, res) => {
  try {
    const { name, members, quota_daily, quota_monthly } = req.body;
    
    // 参数验证
    if (!name) {
      return res.status(400).json({
        success: false,
        error: 'Team name is required',
      });
    }
    
    if (!members || members <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Members must be greater than 0',
      });
    }
    
    if (!quota_daily || quota_daily <= 0) {
      return res.status(400).json({
        success: false,
        error: 'quota_daily must be greater than 0',
      });
    }
    
    if (!quota_monthly || quota_monthly <= 0) {
      return res.status(400).json({
        success: false,
        error: 'quota_monthly must be greater than 0',
      });
    }
    
    const teamRaw = await db.createTeam({
      name,
      members,
      quota_daily,
      quota_monthly,
      description: req.body.description,
      status: req.body.status || 'active'
    });
    const team = teamRaw ? { ...teamRaw, name: maybeFixMojibake(teamRaw.name) } : null;
    
    res.status(201).json({
      success: true,
      data: team,
      message: 'Team created successfully',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Failed to create team:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create team',
    });
  }
});

/**
 * PUT /api/v1/teams/:id
 * 更新团队
 */
router.put('/:id', async (req, res) => {
  try {
    const existingTeam = await db.getTeamById(req.params.id);
    
    if (!existingTeam) {
      return res.status(404).json({
        success: false,
        error: 'Team not found',
      });
    }
    
    const updates = { ...req.body };
    delete updates.id;
    delete updates.created_at;
    delete updates.used_daily;
    delete updates.used_monthly;
    const updatedTeamRaw = await db.updateTeam(req.params.id, updates);
    const updatedTeam = updatedTeamRaw ? { ...updatedTeamRaw, name: maybeFixMojibake(updatedTeamRaw.name) } : null;
    
    res.json({
      success: true,
      data: updatedTeam,
      message: 'Team updated successfully',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Failed to update team:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update team',
    });
  }
});

/**
 * DELETE /api/v1/teams/:id
 * 删除团队
 */
router.delete('/:id', async (req, res) => {
  try {
    const existingTeam = await db.getTeamById(req.params.id);
    
    if (!existingTeam) {
      return res.status(404).json({
        success: false,
        error: 'Team not found',
      });
    }
    
    await db.deleteTeam(req.params.id);
    
    res.json({
      success: true,
      message: 'Team deleted successfully',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Failed to delete team:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete team',
    });
  }
});

/**
 * GET /api/v1/teams/:id/members
 * 获取团队成员列表
 */
router.get('/:id/members', async (req, res) => {
  try {
    const team = await db.getTeamById(req.params.id);
    
    if (!team) {
      return res.status(404).json({
        success: false,
        error: 'Team not found',
      });
    }
    
    const members = await db.getTeamMembers(req.params.id);
    
    res.json({
      success: true,
      data: members,
      total: members.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Failed to get team members:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get team members',
    });
  }
});

/**
 * POST /api/v1/teams/:id/members
 * 添加团队成员
 */
router.post('/:id/members', async (req, res) => {
  try {
    const team = await db.getTeamById(req.params.id);
    
    if (!team) {
      return res.status(404).json({
        success: false,
        error: 'Team not found',
      });
    }
    
    const { name, role, email } = req.body;
    
    if (!name || !email) {
      return res.status(400).json({
        success: false,
        error: 'Name and email are required',
      });
    }
    
    const newMember = await db.addTeamMember(req.params.id, { name, role, email });
    
    res.status(201).json({
      success: true,
      data: newMember,
      message: 'Member added successfully',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Failed to add member:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to add member',
    });
  }
});

/**
 * DELETE /api/v1/teams/:id/members/:memberId
 * 移除团队成员
 */
router.delete('/:id/members/:memberId', async (req, res) => {
  try {
    const team = await db.getTeamById(req.params.id);
    
    if (!team) {
      return res.status(404).json({
        success: false,
        error: 'Team not found',
      });
    }
    
    await db.removeTeamMember(req.params.id, req.params.memberId);
    
    res.json({
      success: true,
      message: 'Member removed successfully',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Failed to remove member:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to remove member',
    });
  }
});

module.exports = router;
