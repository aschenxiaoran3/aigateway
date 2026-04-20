const express = require('express');
const request = require('supertest');

jest.mock('../src/db/mysql', () => ({
  getUsageStats: jest.fn(),
  getUsageTrend: jest.fn(),
  getModelUsage: jest.fn(),
  getTeamUsage: jest.fn(),
  getDistinctUsageModels: jest.fn(),
  getCostReport: jest.fn()
}));

const db = require('../src/db/mysql');
const router = require('../src/routes/usage');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/usage', router);
  return app;
}

describe('usage routes', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = createApp();
  });

  test('GET /stats returns normalized stats with explicit dates', async () => {
    db.getUsageStats.mockResolvedValue({
      total_tokens: '120',
      total_cost: '12.5',
      total_requests: '5',
      active_users: '2'
    });
    db.getUsageTrend.mockResolvedValue([{ date: '2026-04-09', tokens: 120 }]);

    const res = await request(app).get('/api/v1/usage/stats?start_date=2026-04-09T00:00:00.000Z&end_date=2026-04-09T00:01:00.000Z');
    expect(res.status).toBe(200);
    expect(res.body.data.total_tokens).toBe(120);
    expect(res.body.data.total_cost).toBe(12.5);
    expect(res.body.data.total_requests).toBe(5);
    expect(res.body.data.active_users).toBe(2);
    expect(res.body.data.tokens_per_min).toBe(120);
    expect(res.body.data.avg_cost_per_msg).toBe(2.5);
    expect(res.body.data.trend_days).toBe(1);
  });

  test('GET /stats handles zero requests and db failure', async () => {
    db.getUsageStats.mockResolvedValue({});
    db.getUsageTrend.mockResolvedValue([]);
    const ok = await request(app).get('/api/v1/usage/stats');
    expect(ok.status).toBe(200);
    expect(ok.body.data.avg_cost_per_msg).toBe(0);

    db.getUsageStats.mockRejectedValue(new Error('stats err'));
    const bad = await request(app).get('/api/v1/usage/stats');
    expect(bad.status).toBe(500);
  });

  test('GET /distinct-models', async () => {
    db.getDistinctUsageModels.mockResolvedValue(['qwen-plus', 'claude-sonnet-4']);
    const res = await request(app).get(
      '/api/v1/usage/distinct-models?start_date=2026-01-01&end_date=2026-01-02'
    );
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(['qwen-plus', 'claude-sonnet-4']);
    expect(db.getDistinctUsageModels).toHaveBeenCalled();
  });

  test('GET /distinct-models passes api_key_id scope', async () => {
    db.getDistinctUsageModels.mockResolvedValue(['qwen-plus']);
    const res = await request(app).get(
      '/api/v1/usage/distinct-models?start_date=2026-01-01&end_date=2026-01-02&api_key_id=5'
    );
    expect(res.status).toBe(200);
    expect(db.getDistinctUsageModels).toHaveBeenCalledWith(
      '2026-01-01',
      '2026-01-02',
      { api_key_id: 5 }
    );
    expect(res.body.data).toEqual(['qwen-plus']);
  });

  test('GET /distinct-models 500', async () => {
    db.getDistinctUsageModels.mockRejectedValue(new Error('db down'));
    const res = await request(app).get('/api/v1/usage/distinct-models');
    expect(res.status).toBe(500);
  });

  test('GET /distinct-models coerces null list to empty array', async () => {
    db.getDistinctUsageModels.mockResolvedValue(null);
    const res = await request(app).get('/api/v1/usage/distinct-models');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  test('GET /distinct-models ignores invalid api_key_id scope', async () => {
    db.getDistinctUsageModels.mockResolvedValue([]);
    await request(app).get('/api/v1/usage/distinct-models?api_key_id=bad');
    expect(db.getDistinctUsageModels).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      {}
    );
  });

  test('GET /stats forwards model and api_key_id filters', async () => {
    db.getUsageStats.mockResolvedValue({
      total_tokens: '10',
      total_cost: '1',
      total_requests: '1',
      active_users: '1',
    });
    db.getUsageTrend.mockResolvedValue([]);
    await request(app).get(
      '/api/v1/usage/stats?start_date=2026-04-01&end_date=2026-04-10&model=qwen-plus&api_key_id=3'
    );
    expect(db.getUsageStats).toHaveBeenCalledWith(
      '2026-04-01',
      '2026-04-10',
      expect.objectContaining({ model: 'qwen-plus', api_key_id: 3 })
    );
  });

  test('GET /stats ignores invalid api_key_id', async () => {
    db.getUsageStats.mockResolvedValue({
      total_tokens: '0',
      total_cost: '0',
      total_requests: '0',
      active_users: '0',
    });
    db.getUsageTrend.mockResolvedValue([]);
    await request(app).get('/api/v1/usage/stats?api_key_id=not-a-number');
    expect(db.getUsageStats).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      {}
    );
  });

  test('GET /trend and /models success + fallback + errors', async () => {
    db.getUsageTrend.mockResolvedValue([{ date: '2026-01-01', tokens: 1 }]);
    const t1 = await request(app).get('/api/v1/usage/trend');
    expect(t1.status).toBe(200);

    db.getUsageTrend.mockResolvedValue(null);
    const t2 = await request(app).get('/api/v1/usage/trend');
    expect(t2.status).toBe(200);
    expect(t2.body.data).toEqual([]);

    db.getUsageTrend.mockRejectedValue(new Error('trend err'));
    const t3 = await request(app).get('/api/v1/usage/trend');
    expect(t3.status).toBe(500);

    db.getModelUsage.mockResolvedValue([{ model: 'qwen3.6-plus', tokens: 1 }]);
    const m1 = await request(app).get('/api/v1/usage/models');
    expect(m1.status).toBe(200);

    db.getModelUsage.mockResolvedValue(null);
    const m2 = await request(app).get('/api/v1/usage/models');
    expect(m2.status).toBe(200);
    expect(m2.body.data).toEqual([]);

    db.getModelUsage.mockRejectedValue(new Error('model err'));
    const m3 = await request(app).get('/api/v1/usage/models');
    expect(m3.status).toBe(500);
  });

  test('GET /teams exercises mojibake branches and error', async () => {
    db.getTeamUsage.mockResolvedValue([
      { team: null },
      { team: '技术部' },
      { team: 'plain' },
      { team: 'Ā' },
      { team: 'Ã' },
      { team: '\u20AC' },
      { team: 'Â©' },
      { team: 'æŠ€æœ¯éƒ¨' }
    ]);

    const ok = await request(app).get('/api/v1/usage/teams');
    expect(ok.status).toBe(200);
    expect(ok.body.data[0].team).toBe('未关联团队');
    expect(ok.body.data[1].team).toBe('技术部');
    expect(ok.body.data[2].team).toBe('plain');
    expect(ok.body.data[3].team).toBe('Ā');
    expect(ok.body.data[4].team).toBe('Ã');
    expect(ok.body.data[5].team).toBe('\u20AC');
    expect(ok.body.data[6].team).toBe('Â©');
    expect(ok.body.data[7].team).toBe('技术部');

    const spy = jest.spyOn(Map.prototype, 'get').mockImplementation(() => {
      throw new Error('force-map-get-error');
    });
    try {
      db.getTeamUsage.mockResolvedValue([{ team: 'æŠ€æœ¯éƒ¨' }]);
      const catchCase = await request(app).get('/api/v1/usage/teams');
      expect(catchCase.status).toBe(200);
      expect(catchCase.body.data[0].team).toBe('æŠ€æœ¯éƒ¨');
    } finally {
      spy.mockRestore();
    }

    db.getTeamUsage.mockRejectedValue(new Error('team err'));
    const bad = await request(app).get('/api/v1/usage/teams');
    expect(bad.status).toBe(500);
  });

  test('GET /teams handles null team usage list fallback', async () => {
    db.getTeamUsage.mockResolvedValue(null);
    const res = await request(app).get('/api/v1/usage/teams');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  test('GET /cost/report success and error', async () => {
    db.getCostReport.mockResolvedValue({
      summary: { total_cost: 1, total_tokens: 2, avg_cost_per_1k: 3 },
      trend: [{ date: '2026-04-09', cost: 1, tokens: 2 }],
      byTeam: [{ team: 'æŠ€æœ¯éƒ¨', cost: 1, percentage: 100 }],
      byModel: [{ model: 'qwen3.6-plus', cost: 1, percentage: 100 }]
    });
    const ok = await request(app).get('/api/v1/usage/cost/report?start_date=2026-04-01&end_date=2026-04-30');
    expect(ok.status).toBe(200);
    expect(ok.body.data.by_team[0].team).toBe('技术部');

    db.getCostReport.mockResolvedValueOnce({
      summary: {},
      trend: [],
      byModel: []
    });
    const okFallback = await request(app).get('/api/v1/usage/cost/report');
    expect(okFallback.status).toBe(200);
    expect(okFallback.body.data.by_team).toEqual([]);

    db.getCostReport.mockRejectedValue(new Error('cost err'));
    const bad = await request(app).get('/api/v1/usage/cost/report');
    expect(bad.status).toBe(500);
  });
});
