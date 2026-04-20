const express = require('express');
const request = require('supertest');

jest.mock('../src/db/mysql', () => ({
  getTeams: jest.fn(),
  getTeamById: jest.fn(),
  createTeam: jest.fn(),
  updateTeam: jest.fn(),
  deleteTeam: jest.fn(),
  getTeamMembers: jest.fn(),
  addTeamMember: jest.fn(),
  removeTeamMember: jest.fn()
}));

const db = require('../src/db/mysql');
const router = require('../src/routes/teams');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/teams', router);
  return app;
}

describe('teams routes', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = createApp();
  });

  test('GET / returns team list and exercises mojibake branches', async () => {
    db.getTeams.mockResolvedValue([
      { id: 1, name: null },
      { id: 2, name: '技术部' },
      { id: 3, name: 'plain' },
      { id: 4, name: 'Ā' },
      { id: 5, name: 'Ã' },
      { id: 6, name: '\u20AC' },
      { id: 7, name: 'Â©' },
      { id: 8, name: 'æŠ€æœ¯éƒ¨' }
    ]);

    const res = await request(app).get('/api/v1/teams?status=active&search=技');

    expect(res.status).toBe(200);
    expect(db.getTeams).toHaveBeenCalledWith({ status: 'active', search: '技' });
    expect(res.body.success).toBe(true);
    expect(res.body.total).toBe(8);
    expect(res.body.data[0].name).toBeNull();
    expect(res.body.data[1].name).toBe('技术部');
    expect(res.body.data[2].name).toBe('plain');
    expect(res.body.data[3].name).toBe('Ā');
    expect(res.body.data[4].name).toBe('Ã');
    expect(res.body.data[5].name).toBe('\u20AC');
    expect(res.body.data[6].name).toBe('Â©');
    expect(res.body.data[7].name).toBe('技术部');
  });

  test('GET / handles conversion catch branch', async () => {
    const spy = jest.spyOn(Map.prototype, 'get').mockImplementation(() => {
      throw new Error('force-map-get-error');
    });
    try {
      db.getTeams.mockResolvedValue([{ id: 1, name: 'æŠ€æœ¯éƒ¨' }]);
      const res = await request(app).get('/api/v1/teams');
      expect(res.status).toBe(200);
      expect(res.body.data[0].name).toBe('æŠ€æœ¯éƒ¨');
    } finally {
      spy.mockRestore();
    }
  });

  test('GET / returns 500 when db fails', async () => {
    db.getTeams.mockRejectedValue(new Error('db down'));
    const res = await request(app).get('/api/v1/teams');
    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
  });

  test('GET /:id returns 404 if not found', async () => {
    db.getTeamById.mockResolvedValue(null);
    const res = await request(app).get('/api/v1/teams/99');
    expect(res.status).toBe(404);
  });

  test('GET /:id returns 500 on error', async () => {
    db.getTeamById.mockRejectedValue(new Error('db err'));
    const res = await request(app).get('/api/v1/teams/1');
    expect(res.status).toBe(500);
  });

  test('GET /:id success', async () => {
    db.getTeamById.mockResolvedValue({ id: 1, name: '技术部' });
    const res = await request(app).get('/api/v1/teams/1');
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('技术部');
  });

  test('POST / validates required fields', async () => {
    const r1 = await request(app).post('/api/v1/teams').send({});
    const r2 = await request(app).post('/api/v1/teams').send({ name: 'A' });
    const r3 = await request(app).post('/api/v1/teams').send({ name: 'A', members: 1 });
    const r4 = await request(app)
      .post('/api/v1/teams')
      .send({ name: 'A', members: 1, quota_daily: 1 });

    expect(r1.status).toBe(400);
    expect(r2.status).toBe(400);
    expect(r3.status).toBe(400);
    expect(r4.status).toBe(400);
  });

  test('POST / creates team', async () => {
    db.createTeam.mockResolvedValue({ id: 1, name: '产品部' });
    const res = await request(app).post('/api/v1/teams').send({
      name: '产品部',
      members: 3,
      quota_daily: 1000,
      quota_monthly: 30000,
      description: 'desc',
      status: 'active'
    });

    expect(res.status).toBe(201);
    expect(db.createTeam).toHaveBeenCalled();
    expect(res.body.success).toBe(true);
    expect(res.body.data.name).toBe('产品部');
  });

  test('POST / handles createTeam returning null', async () => {
    db.createTeam.mockResolvedValue(null);
    const res = await request(app).post('/api/v1/teams').send({
      name: '空返回团队',
      members: 3,
      quota_daily: 1000,
      quota_monthly: 30000
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toBeNull();
  });

  test('POST / returns 500 on create error', async () => {
    db.createTeam.mockRejectedValue(new Error('insert failed'));
    const res = await request(app).post('/api/v1/teams').send({
      name: '研发部',
      members: 2,
      quota_daily: 1,
      quota_monthly: 1
    });
    expect(res.status).toBe(500);
  });

  test('PUT /:id returns 404 when missing', async () => {
    db.getTeamById.mockResolvedValue(null);
    const res = await request(app).put('/api/v1/teams/10').send({ name: 'x' });
    expect(res.status).toBe(404);
  });

  test('PUT /:id updates and strips immutable fields', async () => {
    db.getTeamById.mockResolvedValue({ id: 10, name: '旧' });
    db.updateTeam.mockResolvedValue({ id: 10, name: '新' });
    const res = await request(app).put('/api/v1/teams/10').send({
      id: 99,
      created_at: '2026-01-01',
      used_daily: 12,
      used_monthly: 99,
      name: '新'
    });
    expect(res.status).toBe(200);
    expect(db.updateTeam).toHaveBeenCalledWith('10', { name: '新' });
  });

  test('PUT /:id handles updateTeam returning null', async () => {
    db.getTeamById.mockResolvedValue({ id: 10, name: '旧' });
    db.updateTeam.mockResolvedValue(null);
    const res = await request(app).put('/api/v1/teams/10').send({ name: '新' });
    expect(res.status).toBe(200);
    expect(res.body.data).toBeNull();
  });

  test('PUT /:id returns 500 on update error', async () => {
    db.getTeamById.mockResolvedValue({ id: 1 });
    db.updateTeam.mockRejectedValue(new Error('update err'));
    const res = await request(app).put('/api/v1/teams/1').send({ name: 'x' });
    expect(res.status).toBe(500);
  });

  test('DELETE /:id returns 404 when missing', async () => {
    db.getTeamById.mockResolvedValue(null);
    const res = await request(app).delete('/api/v1/teams/2');
    expect(res.status).toBe(404);
  });

  test('DELETE /:id success and failure', async () => {
    db.getTeamById.mockResolvedValue({ id: 2 });
    db.deleteTeam.mockResolvedValue({ affectedRows: 1 });
    const ok = await request(app).delete('/api/v1/teams/2');
    expect(ok.status).toBe(200);

    db.getTeamById.mockResolvedValue({ id: 2 });
    db.deleteTeam.mockRejectedValue(new Error('delete err'));
    const bad = await request(app).delete('/api/v1/teams/2');
    expect(bad.status).toBe(500);
  });

  test('GET /:id/members success + not found + error', async () => {
    db.getTeamById.mockResolvedValueOnce({ id: 1 });
    db.getTeamMembers.mockResolvedValueOnce([{ id: 9, name: 'A' }]);
    const ok = await request(app).get('/api/v1/teams/1/members');
    expect(ok.status).toBe(200);
    expect(ok.body.total).toBe(1);

    db.getTeamById.mockResolvedValueOnce(null);
    const nf = await request(app).get('/api/v1/teams/1/members');
    expect(nf.status).toBe(404);

    db.getTeamById.mockRejectedValueOnce(new Error('member err'));
    const bad = await request(app).get('/api/v1/teams/1/members');
    expect(bad.status).toBe(500);
  });

  test('POST /:id/members validates and handles all branches', async () => {
    db.getTeamById.mockResolvedValueOnce({ id: 1 });
    const invalid = await request(app).post('/api/v1/teams/1/members').send({ name: 'u' });
    expect(invalid.status).toBe(400);

    db.getTeamById.mockResolvedValueOnce(null);
    const nf = await request(app).post('/api/v1/teams/1/members').send({ name: 'u', email: 'a@b.c' });
    expect(nf.status).toBe(404);

    db.getTeamById.mockResolvedValueOnce({ id: 1 });
    db.addTeamMember.mockResolvedValueOnce({ id: 7, name: 'u', email: 'a@b.c' });
    const ok = await request(app).post('/api/v1/teams/1/members').send({ name: 'u', email: 'a@b.c' });
    expect(ok.status).toBe(201);

    db.getTeamById.mockResolvedValueOnce({ id: 1 });
    db.addTeamMember.mockRejectedValueOnce(new Error('add err'));
    const bad = await request(app).post('/api/v1/teams/1/members').send({ name: 'u', email: 'a@b.c' });
    expect(bad.status).toBe(500);
  });

  test('DELETE /:id/members/:memberId all branches', async () => {
    db.getTeamById.mockResolvedValueOnce(null);
    const nf = await request(app).delete('/api/v1/teams/1/members/2');
    expect(nf.status).toBe(404);

    db.getTeamById.mockResolvedValueOnce({ id: 1 });
    db.removeTeamMember.mockResolvedValueOnce({ affectedRows: 1 });
    const ok = await request(app).delete('/api/v1/teams/1/members/2');
    expect(ok.status).toBe(200);

    db.getTeamById.mockResolvedValueOnce({ id: 1 });
    db.removeTeamMember.mockRejectedValueOnce(new Error('remove err'));
    const bad = await request(app).delete('/api/v1/teams/1/members/2');
    expect(bad.status).toBe(500);
  });
});
