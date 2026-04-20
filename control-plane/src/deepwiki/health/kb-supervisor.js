'use strict';

const { DeepWikiError } = require('../errors/error-codes');
const { probeKnowledgeBase } = require('../preflight');

const DEFAULT_CHECK_INTERVAL_MS = 30 * 1000;
const DEFAULT_HEAL_COOLDOWN_MS = 60 * 1000;
const DEFAULT_MAX_HEAL_ATTEMPTS = 3;

/**
 * Maintains a small amount of cross-request state about KB health and optionally
 * triggers a user-configured self-heal command when checks fail.
 *
 * The heal command comes from KB_SELF_HEAL_CMD env var (empty by default).
 * Example configs:
 *   KB_SELF_HEAL_CMD="launchctl kickstart system/local.ai.knowledge-base"
 *   KB_SELF_HEAL_CMD="docker restart knowledge-base"
 */
class KbSupervisor {
  constructor({
    probe = probeKnowledgeBase,
    healCommand = process.env.KB_SELF_HEAL_CMD || '',
    healCooldownMs = DEFAULT_HEAL_COOLDOWN_MS,
    maxHealAttempts = DEFAULT_MAX_HEAL_ATTEMPTS,
    execFn = defaultExecFn,
    now = () => Date.now(),
  } = {}) {
    this.probe = probe;
    this.healCommand = String(healCommand || '').trim();
    this.healCooldownMs = Number(healCooldownMs) || DEFAULT_HEAL_COOLDOWN_MS;
    this.maxHealAttempts = Number(maxHealAttempts) || DEFAULT_MAX_HEAL_ATTEMPTS;
    this.execFn = execFn;
    this.now = now;
    this.state = {
      lastChecked: 0,
      healthy: false,
      lastError: null,
      failCount: 0,
      healAttempts: 0,
      lastHealedAt: 0,
      lastHealResult: null,
    };
  }

  snapshot() {
    return { ...this.state };
  }

  markHealthy() {
    this.state = {
      ...this.state,
      lastChecked: this.now(),
      healthy: true,
      lastError: null,
      failCount: 0,
    };
  }

  markUnhealthy(code, detail) {
    this.state = {
      ...this.state,
      lastChecked: this.now(),
      healthy: false,
      lastError: { code, detail: detail || null },
      failCount: (this.state.failCount || 0) + 1,
    };
  }

  async check(options = {}) {
    const result = await this.probe(options);
    if (result && result.code) {
      this.markUnhealthy(result.code, result.detail);
      return { ok: false, error: result };
    }
    this.markHealthy();
    return { ok: true };
  }

  canAttemptHeal() {
    if (!this.healCommand) return false;
    if (this.state.healAttempts >= this.maxHealAttempts) return false;
    if (this.now() - this.state.lastHealedAt < this.healCooldownMs) return false;
    return true;
  }

  async attemptHeal() {
    if (!this.canAttemptHeal()) {
      return { attempted: false, reason: 'cooldown_or_disabled' };
    }
    this.state = {
      ...this.state,
      healAttempts: (this.state.healAttempts || 0) + 1,
      lastHealedAt: this.now(),
    };
    try {
      const output = await this.execFn(this.healCommand);
      this.state = { ...this.state, lastHealResult: { ok: true, output: truncate(output) } };
      return { attempted: true, ok: true, output };
    } catch (error) {
      const detail = error && error.message;
      this.state = { ...this.state, lastHealResult: { ok: false, error: detail } };
      return { attempted: true, ok: false, error: detail };
    }
  }

  /**
   * Ensure KB is reachable, optionally triggering heal commands between retries.
   *
   * @param {{ attempts?: number, intervalMs?: number, probeOptions?: object }} opts
   * @returns {Promise<{ ok: boolean, attempts: number, healed: boolean, lastError: object|null }>}
   */
  async ensureReady(opts = {}) {
    const attempts = Math.max(1, Number(opts.attempts) || 3);
    const intervalMs = Number(opts.intervalMs) || 1500;
    let healed = false;
    let lastError = null;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const result = await this.check(opts.probeOptions || {});
      if (result.ok) {
        return { ok: true, attempts: attempt, healed, lastError: null };
      }
      lastError = result.error;
      if (attempt < attempts) {
        if (this.canAttemptHeal()) {
          const healResult = await this.attemptHeal();
          if (healResult.attempted && healResult.ok) {
            healed = true;
          }
        }
        await sleep(intervalMs);
      }
    }

    return { ok: false, attempts, healed, lastError };
  }

  toDeepWikiError() {
    const le = this.state.lastError;
    if (!le) return null;
    return new DeepWikiError(le.code || 'DW_E_KB_UNREACHABLE', le.detail);
  }

  reset() {
    this.state = {
      lastChecked: 0,
      healthy: false,
      lastError: null,
      failCount: 0,
      healAttempts: 0,
      lastHealedAt: 0,
      lastHealResult: null,
    };
  }
}

function defaultExecFn(command) {
  const { execSync } = require('child_process');
  return execSync(command, { stdio: ['ignore', 'pipe', 'pipe'], timeout: 10_000 }).toString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function truncate(value, max = 500) {
  const text = String(value == null ? '' : value);
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

let sharedSupervisor = null;

function getSharedSupervisor() {
  if (!sharedSupervisor) sharedSupervisor = new KbSupervisor();
  return sharedSupervisor;
}

function __resetSharedSupervisorForTests() {
  sharedSupervisor = null;
}

module.exports = {
  KbSupervisor,
  getSharedSupervisor,
  DEFAULT_CHECK_INTERVAL_MS,
  DEFAULT_HEAL_COOLDOWN_MS,
  DEFAULT_MAX_HEAL_ATTEMPTS,
  __resetSharedSupervisorForTests,
};
