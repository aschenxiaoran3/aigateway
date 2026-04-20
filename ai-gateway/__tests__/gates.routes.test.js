const express = require('express');
const request = require('supertest');

jest.mock('child_process', () => ({
  spawnSync: jest.fn(),
}));

jest.mock('fs', () => ({
  promises: {
    mkdir: jest.fn().mockResolvedValue(undefined),
    writeFile: jest.fn().mockResolvedValue(undefined),
    access: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('../src/db/mysql', () => ({
  listGateRules: jest.fn(),
  getGateRuleById: jest.fn(),
  createGateRule: jest.fn(),
  updateGateRule: jest.fn(),
  listGateExecutions: jest.fn(),
  createGateExecution: jest.fn(),
  getGateExecutionById: jest.fn(),
  getGateExecutionByClientRunId: jest.fn(),
}));

const db = require('../src/db/mysql');
const cp = require('child_process');
const fsm = require('fs').promises;
const router = require('../src/routes/gates');

function createApp() {
  const app = express();
  app.use(express.json({ limit: '12mb' }));
  app.use('/api/v1/gates', router);
  return app;
}

describe('gates routes', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    db.getGateExecutionByClientRunId.mockResolvedValue(null);
    fsm.access.mockResolvedValue(undefined);
    app = createApp();
  });

  test('GET /rules', async () => {
    db.listGateRules.mockResolvedValue([{ id: 1, gate_name: 'G' }]);
    const res = await request(app).get('/api/v1/gates/rules');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual([{ id: 1, gate_name: 'G' }]);
  });

  test('GET /rules merge=all_active returns single merged row', async () => {
    db.listGateRules.mockResolvedValue([
      {
        id: 10,
        gate_type: 'code',
        gate_name: 'A',
        status: 'active',
        rules_config: {
          checks: [{ id: 'x', name: 'c1', type: 'checklist', weight: 50 }],
          passCriteria: { min_total_score: 60 },
          spec_markdown: 'sa',
        },
      },
      {
        id: 20,
        gate_type: 'code',
        gate_name: 'B',
        status: 'active',
        rules_config: {
          checks: [{ id: 'y', name: 'c2', type: 'checklist', weight: 50 }],
          passCriteria: { min_total_score: 80 },
          spec_markdown: 'sb',
        },
      },
    ]);
    const res = await request(app).get(
      '/api/v1/gates/rules?gate_type=code&status=active&merge=all_active'
    );
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].rules_config._merged).toBe(true);
    expect(res.body.data[0].rules_config.passCriteria.min_total_score).toBe(80);
    expect(res.body.data[0].rules_config._merged_rule_ids).toEqual([10, 20]);
  });

  test('POST /rules creates and returns row', async () => {
    db.createGateRule.mockResolvedValue({ id: 2 });
    db.getGateRuleById.mockResolvedValue({
      id: 2,
      gate_type: 'prd',
      gate_name: 'N',
      version: '1.0.0',
      rules_config: { checks: [] },
      status: 'active',
    });
    const res = await request(app).post('/api/v1/gates/rules').send({
      gate_type: 'prd',
      gate_name: 'N',
      version: '1.0.0',
      rules_config: { checks: [] },
    });
    expect(res.status).toBe(201);
    expect(res.body.data.id).toBe(2);
    expect(db.createGateRule).toHaveBeenCalled();
  });

  test('POST /rules 400 without gate_type', async () => {
    const res = await request(app).post('/api/v1/gates/rules').send({ gate_name: 'x' });
    expect(res.status).toBe(400);
  });

  test('GET /rules/:id 404', async () => {
    db.getGateRuleById.mockResolvedValue(null);
    const res = await request(app).get('/api/v1/gates/rules/99');
    expect(res.status).toBe(404);
  });

  test('PATCH /rules/:id merges rules_config', async () => {
    db.getGateRuleById
      .mockResolvedValueOnce({
        id: 1,
        gate_name: 'R1',
        rules_config: { a: 1 },
      })
      .mockResolvedValueOnce({
        id: 1,
        gate_name: 'R1',
        rules_config: { a: 1, b: 2 },
      });
    db.updateGateRule.mockResolvedValue({ affectedRows: 1 });
    const res = await request(app)
      .patch('/api/v1/gates/rules/1')
      .send({ rules_config: { b: 2 } });
    expect(res.status).toBe(200);
    expect(res.body.data.rules_config.b).toBe(2);
    expect(res.body.data.gate_name).toBe('R1');
  });

  test('POST /rules/:id/upload', async () => {
    db.getGateRuleById
      .mockResolvedValueOnce({ id: 3, rules_config: {} })
      .mockResolvedValueOnce({
        id: 3,
        rules_config: { spec_file_path: 'x', spec_file_name: 'f.md' },
      });
    db.updateGateRule.mockResolvedValue({ affectedRows: 1 });
    const b64 = Buffer.from('hello').toString('base64');
    const res = await request(app)
      .post('/api/v1/gates/rules/3/upload')
      .send({ filename: 'spec.md', content_base64: b64 });
    expect(res.status).toBe(200);
    expect(res.body.data.rules_config.spec_file_name).toBe('f.md');
  });

  test('GET /executions', async () => {
    db.listGateExecutions.mockResolvedValue([{ id: 1, passed: true }]);
    const res = await request(app).get('/api/v1/gates/executions');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  test('POST /executions returns warnings and execution_id', async () => {
    db.createGateExecution.mockResolvedValue({ id: 10 });
    db.getGateExecutionById.mockResolvedValue({
      id: 10,
      gate_type: 'code',
      gate_name: 'Lint',
      passed: true,
      total_score: 80,
      max_score: 100,
      failed_checks: [{ check_id: 'x' }],
    });
    const res = await request(app).post('/api/v1/gates/executions').send({
      gate_type: 'code',
      gate_name: 'Lint',
      passed: true,
      total_score: 80,
      max_score: 100,
      failed_checks: [{ check_id: 'x' }],
    });
    expect(res.status).toBe(201);
    expect(res.body.data.id).toBe(10);
    expect(res.body.execution_id).toBe(10);
    expect(Array.isArray(res.body.warnings)).toBe(true);
    expect(res.body.warnings.length).toBeGreaterThan(0);
    expect(res.body.duplicate).toBe(false);
  });

  test('POST /executions idempotent by client_run_id', async () => {
    const existing = {
      id: 7,
      gate_type: 'prd',
      gate_name: 'R',
      passed: true,
      total_score: 100,
      max_score: 100,
    };
    db.getGateExecutionByClientRunId.mockResolvedValue(existing);
    const res = await request(app).post('/api/v1/gates/executions').send({
      client_run_id: 'uuid-1',
      gate_type: 'prd',
      gate_name: 'R',
      passed: true,
    });
    expect(res.status).toBe(200);
    expect(res.body.duplicate).toBe(true);
    expect(res.body.data.id).toBe(7);
    expect(db.createGateExecution).not.toHaveBeenCalled();
  });

  test('POST /executions persists meta fields', async () => {
    db.createGateExecution.mockResolvedValue({ id: 11 });
    db.getGateRuleById.mockResolvedValue({
      id: 2,
      rules_config: { checks: [{ id: 'a' }] },
    });
    db.getGateExecutionById.mockResolvedValue({
      id: 11,
      gate_type: 'prd',
      gate_name: 'G',
      passed: true,
      client_run_id: 'c1',
      execution_meta: { rule_id: 2, source: 'hermes' },
    });
    const res = await request(app)
      .post('/api/v1/gates/executions')
      .send({
        gate_type: 'prd',
        gate_name: 'G',
        passed: true,
        rule_id: 2,
        source: 'hermes',
        trace_id: 't1',
        client_run_id: 'c1',
      });
    expect(res.status).toBe(201);
    expect(db.createGateExecution).toHaveBeenCalled();
    const arg = db.createGateExecution.mock.calls[0][0];
    expect(arg.client_run_id).toBe('c1');
    expect(arg.execution_meta.source).toBe('hermes');
    expect(arg.execution_meta.trace_id).toBe('t1');
  });

  test('POST /executions 400', async () => {
    const res = await request(app).post('/api/v1/gates/executions').send({});
    expect(res.status).toBe(400);
  });

  test('POST /executions 413 when body too large', async () => {
    const big = 'x'.repeat(4 * 1024 * 1024 + 50);
    const res = await request(app)
      .post('/api/v1/gates/executions')
      .send({
        gate_type: 'code',
        gate_name: 'X',
        passed: true,
        pad: big,
      });
    expect(res.status).toBe(413);
  });

  test('POST /evaluate 501 when GATE_ENFORCEMENT_CLI unset', async () => {
    const prev = process.env.GATE_ENFORCEMENT_CLI;
    delete process.env.GATE_ENFORCEMENT_CLI;
    const res = await request(app).post('/api/v1/gates/evaluate').send({
      messages: [],
      assistantContent: 'x',
    });
    expect(res.status).toBe(501);
    process.env.GATE_ENFORCEMENT_CLI = prev;
  });

  test('POST /evaluate 400 without messages', async () => {
    process.env.GATE_ENFORCEMENT_CLI = '/tmp/fake-cli.js';
    const res = await request(app).post('/api/v1/gates/evaluate').send({
      assistantContent: 'x',
    });
    expect(res.status).toBe(400);
  });

  test('POST /evaluate 200 with spawn stdout', async () => {
    process.env.GATE_ENFORCEMENT_CLI = '/tmp/fake-cli.js';
    cp.spawnSync.mockReturnValue({
      status: 0,
      stdout: JSON.stringify({
        blocked: false,
        finalContent: 'out',
        record: null,
      }),
      stderr: '',
    });
    const res = await request(app).post('/api/v1/gates/evaluate').send({
      messages: [{ role: 'user', content: 'hi' }],
      assistantContent: 'assistant',
    });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.finalContent).toBe('out');
  });

  test('POST /evaluate 501 when CLI path not accessible', async () => {
    process.env.GATE_ENFORCEMENT_CLI = '/missing/cli.js';
    fsm.access.mockRejectedValueOnce(new Error('ENOENT'));
    const res = await request(app).post('/api/v1/gates/evaluate').send({
      messages: [{ role: 'user', content: 'hi' }],
      assistantContent: 'a',
    });
    expect(res.status).toBe(501);
    fsm.access.mockResolvedValue(undefined);
  });
});
