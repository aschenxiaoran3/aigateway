'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { KbSupervisor } = require('../src/deepwiki/health/kb-supervisor');

function createClock(start = 1_000_000) {
  let t = start;
  return {
    now: () => t,
    advance: (ms) => {
      t += ms;
    },
  };
}

test('markHealthy / markUnhealthy toggle state', () => {
  const clock = createClock();
  const sup = new KbSupervisor({ probe: async () => null, now: clock.now });
  assert.equal(sup.snapshot().healthy, false);
  sup.markHealthy();
  assert.equal(sup.snapshot().healthy, true);
  sup.markUnhealthy('DW_E_KB_UNREACHABLE', 'boom');
  const state = sup.snapshot();
  assert.equal(state.healthy, false);
  assert.equal(state.lastError.code, 'DW_E_KB_UNREACHABLE');
  assert.equal(state.failCount, 1);
});

test('check() updates state based on probe outcome', async () => {
  const clock = createClock();
  let failMode = true;
  const sup = new KbSupervisor({
    probe: async () => (failMode ? { code: 'DW_E_KB_UNREACHABLE', detail: 'down' } : null),
    now: clock.now,
  });
  const first = await sup.check();
  assert.equal(first.ok, false);
  assert.equal(sup.snapshot().failCount, 1);

  failMode = false;
  const second = await sup.check();
  assert.equal(second.ok, true);
  assert.equal(sup.snapshot().healthy, true);
  assert.equal(sup.snapshot().failCount, 0);
});

test('attemptHeal is gated on cooldown and max attempts', async () => {
  const clock = createClock();
  let execs = 0;
  const sup = new KbSupervisor({
    probe: async () => ({ code: 'DW_E_KB_UNREACHABLE' }),
    healCommand: 'echo heal',
    healCooldownMs: 1000,
    maxHealAttempts: 2,
    execFn: async () => { execs += 1; return 'ok'; },
    now: clock.now,
  });
  const first = await sup.attemptHeal();
  assert.equal(first.attempted, true);
  assert.equal(first.ok, true);
  assert.equal(execs, 1);

  // immediate second attempt blocked by cooldown
  const second = await sup.attemptHeal();
  assert.equal(second.attempted, false);
  assert.equal(execs, 1);

  clock.advance(1500);
  const third = await sup.attemptHeal();
  assert.equal(third.attempted, true);
  assert.equal(execs, 2);

  clock.advance(1500);
  const fourth = await sup.attemptHeal();
  // hit maxHealAttempts=2 already
  assert.equal(fourth.attempted, false);
});

test('attemptHeal disabled without heal command', async () => {
  const clock = createClock();
  const sup = new KbSupervisor({
    probe: async () => ({ code: 'DW_E_KB_UNREACHABLE' }),
    healCommand: '',
    execFn: async () => { throw new Error('should not be called'); },
    now: clock.now,
  });
  const result = await sup.attemptHeal();
  assert.equal(result.attempted, false);
});

test('ensureReady retries then succeeds', async () => {
  const clock = createClock();
  let seen = 0;
  const sup = new KbSupervisor({
    probe: async () => {
      seen += 1;
      if (seen >= 3) return null;
      return { code: 'DW_E_KB_UNREACHABLE' };
    },
    healCommand: 'echo ok',
    healCooldownMs: 0,
    maxHealAttempts: 5,
    execFn: async () => 'ok',
    now: clock.now,
  });
  const result = await sup.ensureReady({ attempts: 4, intervalMs: 0 });
  assert.equal(result.ok, true);
  assert.equal(result.attempts, 3);
  assert.equal(result.healed, true);
});

test('ensureReady fails after exhausting attempts', async () => {
  const clock = createClock();
  const sup = new KbSupervisor({
    probe: async () => ({ code: 'DW_E_KB_UNREACHABLE', detail: 'boom' }),
    healCommand: '',
    execFn: async () => 'ok',
    now: clock.now,
  });
  const result = await sup.ensureReady({ attempts: 2, intervalMs: 0 });
  assert.equal(result.ok, false);
  assert.equal(result.attempts, 2);
  assert.equal(result.lastError.code, 'DW_E_KB_UNREACHABLE');
});
