const assert = require('node:assert/strict');
const path = require('path');
const test = require('node:test');

const { resolveTemplateExecution } = require('../src/approval/templates');
const { parseDecision } = require('../src/approval/store');

test('resolveTemplateExecution builds git pull plan from whitelisted template', () => {
  const plan = resolveTemplateExecution('git_pull', '/tmp/demo-repo', {
    remote: 'origin',
    branch: 'main',
  });

  assert.equal(plan.command, 'git');
  assert.deepEqual(plan.args, ['pull', '--ff-only', 'origin', 'main']);
  assert.equal(plan.cwd, path.resolve('/tmp/demo-repo'));
  assert.equal(plan.summary, 'git pull --ff-only origin main');
});

test('resolveTemplateExecution builds npm deploy plan with default script', () => {
  const plan = resolveTemplateExecution('npm_run_deploy', '/tmp/demo-app', {});

  assert.equal(plan.command, 'npm');
  assert.deepEqual(plan.args, ['run', 'deploy']);
  assert.equal(plan.cwd, path.resolve('/tmp/demo-app'));
});

test('parseDecision maps approval button answers to task states', () => {
  assert.deepEqual(parseDecision('批准执行'), {
    decision: 'approved',
    status: 'approved_pending_execution',
  });
  assert.deepEqual(parseDecision('稍后处理'), {
    decision: 'deferred',
    status: 'deferred',
  });
  assert.deepEqual(parseDecision('拒绝'), {
    decision: 'rejected',
    status: 'rejected',
  });
});
