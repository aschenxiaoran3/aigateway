const express = require('express');
const request = require('supertest');

jest.mock('../src/db/mysql', () => ({
  getSettings: jest.fn(),
  upsertSettings: jest.fn()
}));

const db = require('../src/db/mysql');
const router = require('../src/routes/settings');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/settings', router);
  return app;
}

describe('settings routes', () => {
  let app;
  const oldEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.PORT = '3001';
    process.env.HOST = '0.0.0.0';
    process.env.DB_HOST = 'db-host';
    process.env.DB_PORT = '3306';
    process.env.DB_NAME = 'db-name';
    process.env.DB_USER = 'db-user';
    process.env.LOG_LEVEL = 'info';
    app = createApp();
  });

  afterAll(() => {
    process.env = oldEnv;
  });

  test('GET / merges defaults and db settings', async () => {
    db.getSettings.mockResolvedValue({ gateway_port: 4000, custom: true });
    const res = await request(app).get('/api/v1/settings');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.gateway_port).toBe(4000);
    expect(res.body.data.db_host).toBe('db-host');
    expect(res.body.data.custom).toBe(true);
  });

  test('GET / uses hard default values when env is missing', async () => {
    delete process.env.PORT;
    delete process.env.HOST;
    delete process.env.DB_HOST;
    delete process.env.DB_PORT;
    delete process.env.DB_NAME;
    delete process.env.DB_USER;
    delete process.env.LOG_LEVEL;
    db.getSettings.mockResolvedValue({});

    const res = await request(app).get('/api/v1/settings');
    expect(res.status).toBe(200);
    expect(res.body.data.gateway_port).toBe(3001);
    expect(res.body.data.gateway_host).toBe('0.0.0.0');
    expect(res.body.data.db_port).toBe(3306);
    expect(res.body.data.log_level).toBe('info');
  });

  test('GET / returns 500 on error', async () => {
    db.getSettings.mockRejectedValue(new Error('get err'));
    const res = await request(app).get('/api/v1/settings');
    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
  });

  test('PUT / persists settings and handles empty payload', async () => {
    db.upsertSettings.mockResolvedValue(true);
    db.getSettings.mockResolvedValue({ log_level: 'debug' });

    const r1 = await request(app).put('/api/v1/settings').send({ log_level: 'debug' });
    expect(r1.status).toBe(200);
    expect(db.upsertSettings).toHaveBeenCalledWith({ log_level: 'debug' });
    expect(r1.body.data.log_level).toBe('debug');

    const r2 = await request(app).put('/api/v1/settings').send();
    expect(r2.status).toBe(200);
    expect(db.upsertSettings).toHaveBeenCalledWith({});
  });

  test('GET / masks secret values and PUT / keeps secret when empty string is sent', async () => {
    db.getSettings
      .mockResolvedValueOnce({ deepwiki_weelinking_api_key: 'super-secret-key', deepwiki_weelinking_enabled: true })
      .mockResolvedValueOnce({ deepwiki_weelinking_api_key: 'super-secret-key', deepwiki_weelinking_enabled: true });
    db.upsertSettings.mockResolvedValue(true);

    const getRes = await request(app).get('/api/v1/settings');
    expect(getRes.status).toBe(200);
    expect(getRes.body.data.deepwiki_weelinking_api_key).toMatch(/\*+-key$/);

    const putRes = await request(app).put('/api/v1/settings').send({
      deepwiki_weelinking_api_key: '',
      deepwiki_weelinking_enabled: true,
    });
    expect(putRes.status).toBe(200);
    expect(db.upsertSettings).toHaveBeenCalledWith({
      deepwiki_weelinking_enabled: true,
    });
  });

  test('PUT / handles undefined req.body fallback', async () => {
    db.upsertSettings.mockResolvedValue(true);
    db.getSettings.mockResolvedValue({});
    const rawApp = express();
    rawApp.use('/api/v1/settings', router);
    const res = await request(rawApp).put('/api/v1/settings');
    expect(res.status).toBe(200);
    expect(db.upsertSettings).toHaveBeenCalledWith({});
  });

  test('PUT / returns 500 on error', async () => {
    db.upsertSettings.mockRejectedValue(new Error('put err'));
    const res = await request(app).put('/api/v1/settings').send({ log_level: 'warn' });
    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
  });
});
