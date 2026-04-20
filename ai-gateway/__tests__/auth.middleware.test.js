const express = require('express');
const request = require('supertest');

function buildApp(authMiddleware) {
  const app = express();
  app.get('/secure', authMiddleware, (req, res) => {
    res.json({
      ok: true,
      apiKey: req.apiKey,
      apiKeyId: req.apiKeyId,
      userId: req.userId,
      gatewayUserId: req.gatewayUserId,
      teamId: req.teamId,
      allowed_models: req.keyInfo.allowed_models
    });
  });
  return app;
}

function loadAuthWithDbMock(getApiKeyImpl) {
  jest.resetModules();
  jest.doMock('../src/db/mysql', () => ({
    getApiKey: jest.fn(getApiKeyImpl)
  }));
  const db = require('../src/db/mysql');
  const authMiddleware = require('../src/middleware/auth');
  return { db, authMiddleware };
}

describe('auth middleware', () => {
  const oldEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.ENABLE_DEV_KEY_FALLBACK = 'false';
  });

  afterAll(() => {
    process.env = oldEnv;
  });

  test('returns 401 when no api key provided', async () => {
    const { authMiddleware } = loadAuthWithDbMock(async () => null);
    const app = buildApp(authMiddleware);
    const res = await request(app).get('/secure');
    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe('API Key is required');
  });

  test('accepts x-api-key and parses allowed_models string + cache hit', async () => {
    const { db, authMiddleware } = loadAuthWithDbMock(async () => ({
      id: 10,
      type: 'team',
      team_id: 2,
      created_by: 99,
      allowed_models: '["qwen"]'
    }));
    const app = buildApp(authMiddleware);

    const r1 = await request(app).get('/secure').set('X-API-Key', 'k1');
    expect(r1.status).toBe(200);
    expect(r1.body.allowed_models).toEqual(['qwen']);
    expect(r1.body.apiKeyId).toBe(10);
    expect(r1.body.teamId).toBe(2);
    expect(r1.body.gatewayUserId).toBe(99);
    expect(r1.body.userId).toBe(99);

    const r2 = await request(app).get('/secure').set('X-API-Key', 'k1');
    expect(r2.status).toBe(200);
    expect(db.getApiKey).toHaveBeenCalledTimes(1);
  });

  test('non-positive created_by yields null gatewayUserId', async () => {
    const { authMiddleware } = loadAuthWithDbMock(async () => ({
      id: 13,
      type: 'user',
      team_id: null,
      created_by: 0,
      allowed_models: ['qwen'],
    }));
    const app = buildApp(authMiddleware);
    const res = await request(app).get('/secure').set('X-API-Key', 'k-zero');
    expect(res.status).toBe(200);
    expect(res.body.gatewayUserId).toBeNull();
    expect(res.body.userId).toBeNull();
  });

  test('null created_by yields null gatewayUserId and userId', async () => {
    const { authMiddleware } = loadAuthWithDbMock(async () => ({
      id: 12,
      type: 'proj',
      team_id: null,
      created_by: null,
      allowed_models: ['qwen'],
    }));
    const app = buildApp(authMiddleware);
    const res = await request(app).get('/secure').set('X-API-Key', 'k-null');
    expect(res.status).toBe(200);
    expect(res.body.apiKeyId).toBe(12);
    expect(res.body.gatewayUserId).toBeNull();
    expect(res.body.userId).toBeNull();
  });

  test('accepts authorization bearer and sets teamId null for non-team key', async () => {
    const { authMiddleware } = loadAuthWithDbMock(async () => ({
      id: 11,
      type: 'user',
      team_id: null,
      created_by: 88,
      allowed_models: ['qwen']
    }));
    const app = buildApp(authMiddleware);
    const res = await request(app).get('/secure').set('Authorization', 'Bearer k2');
    expect(res.status).toBe(200);
    expect(res.body.teamId).toBeNull();
    expect(res.body.apiKeyId).toBe(11);
    expect(res.body.userId).toBe(88);
  });

  test('returns 401 for invalid key when fallback disabled', async () => {
    process.env.ENABLE_DEV_KEY_FALLBACK = 'false';
    const { authMiddleware } = loadAuthWithDbMock(async () => null);
    const app = buildApp(authMiddleware);
    const res = await request(app).get('/secure').set('X-API-Key', 'unknown');
    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe('Invalid API Key');
  });

  test('allows known dev keys when fallback enabled and db throws', async () => {
    process.env.ENABLE_DEV_KEY_FALLBACK = 'true';
    const { authMiddleware } = loadAuthWithDbMock(async () => {
      throw new Error('db failed');
    });
    const app = buildApp(authMiddleware);

    const ok = await request(app).get('/secure').set('X-API-Key', 'test_team_key');
    expect(ok.status).toBe(200);
    expect(ok.body.teamId).toBe(1);
    expect(ok.body.apiKeyId).toBe(9001);
    expect(ok.body.userId).toBe(100);

    const bad = await request(app).get('/secure').set('X-API-Key', 'not_in_fallback');
    expect(bad.status).toBe(401);
  });
});
