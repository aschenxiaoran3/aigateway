'use strict';

const fs = require('fs');
const path = require('path');
const { DeepWikiError, SEVERITY, isKnownErrorCode } = require('./errors/error-codes');

const DEFAULT_PROBE_TIMEOUT_MS = 5000;

function normalizeText(value) {
  return String(value == null ? '' : value).trim();
}

function parseDisabledCodes() {
  const raw = normalizeText(process.env.DEEPWIKI_PREFLIGHT_DISABLE);
  if (!raw) return new Set();
  return new Set(
    raw
      .split(',')
      .map((item) => normalizeText(item))
      .filter(Boolean)
  );
}

async function probeKnowledgeBase({ searchUrl, timeoutMs } = {}) {
  const url = normalizeText(searchUrl || process.env.KNOWLEDGE_BASE_SEARCH_URL);
  if (!url) {
    return {
      code: 'DW_E_KB_UNREACHABLE',
      detail: 'KNOWLEDGE_BASE_SEARCH_URL not configured',
    };
  }
  const healthUrl = deriveHealthUrl(url);
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Number(timeoutMs || DEFAULT_PROBE_TIMEOUT_MS));
    const response = await fetch(healthUrl, { method: 'GET', signal: controller.signal });
    clearTimeout(timer);
    if (!response.ok) {
      return { code: 'DW_E_KB_UNREACHABLE', detail: `healthz HTTP ${response.status}`, healthUrl };
    }
    let payload = null;
    try {
      payload = await response.json();
    } catch (_) {
      payload = null;
    }
    const minVersion = normalizeText(process.env.KNOWLEDGE_BASE_MIN_VERSION);
    if (minVersion && payload && normalizeText(payload.version) && payload.version < minVersion) {
      return {
        code: 'DW_E_KB_VERSION_MISMATCH',
        detail: `KB version ${payload.version} < required ${minVersion}`,
        healthUrl,
      };
    }
    return null;
  } catch (error) {
    return { code: 'DW_E_KB_UNREACHABLE', detail: error && error.message, healthUrl };
  }
}

function deriveHealthUrl(searchUrl) {
  try {
    const u = new URL(searchUrl);
    u.pathname = '/healthz';
    u.search = '';
    return u.toString();
  } catch (_) {
    return searchUrl.replace(/\/[^/]*$/, '/healthz');
  }
}

function probeKnowledgeBaseVenv({ venvPath } = {}) {
  const target = normalizeText(venvPath || process.env.KNOWLEDGE_BASE_VENV_PATH);
  if (!target) return null; // opt-in
  try {
    const stats = fs.statSync(target);
    if (!stats.isDirectory()) {
      return { code: 'DW_E_KB_VENV_MISSING', detail: `not a directory: ${target}` };
    }
    const pythonPath = path.join(target, 'bin', 'python');
    if (!fs.existsSync(pythonPath)) {
      return { code: 'DW_E_KB_VENV_MISSING', detail: `missing bin/python under ${target}` };
    }
    return null;
  } catch (error) {
    return { code: 'DW_E_KB_VENV_MISSING', detail: error && error.message };
  }
}

async function probeDatabase({ db } = {}) {
  if (!db || typeof db.query !== 'function') {
    return { code: 'DW_E_DB_WRITE_FAIL', detail: 'db handle missing query()' };
  }
  try {
    await db.query('SELECT 1');
    return null;
  } catch (error) {
    return { code: 'DW_E_DB_WRITE_FAIL', detail: error && error.message };
  }
}

function probeRepoAccess({ repoPath } = {}) {
  const target = normalizeText(repoPath);
  if (!target) {
    return { code: 'DW_E_REPO_UNREADABLE', detail: 'repoPath empty' };
  }
  try {
    fs.accessSync(target, fs.constants.R_OK);
    return null;
  } catch (error) {
    return { code: 'DW_E_REPO_UNREADABLE', detail: `${target}: ${error && error.message}` };
  }
}

function probeBranchExists({ repoPath, branch, execFn } = {}) {
  const target = normalizeText(repoPath);
  const branchName = normalizeText(branch);
  if (!target || !branchName) return null; // optional when branch is blank
  const runner = execFn || defaultBranchChecker;
  try {
    const ok = runner(target, branchName);
    if (!ok) {
      return { code: 'DW_E_BRANCH_MISSING', detail: `branch "${branchName}" not in ${target}` };
    }
    return null;
  } catch (error) {
    return { code: 'DW_E_BRANCH_MISSING', detail: error && error.message };
  }
}

function defaultBranchChecker(repoPath, branchName) {
  const { execFileSync } = require('child_process');
  try {
    const out = execFileSync(
      'git',
      ['-C', repoPath, 'rev-parse', '--verify', '--quiet', `refs/heads/${branchName}`],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );
    return Boolean(String(out || '').trim());
  } catch (_) {
    // fallback: check remote
    try {
      execFileSync(
        'git',
        ['-C', repoPath, 'rev-parse', '--verify', '--quiet', `refs/remotes/origin/${branchName}`],
        { stdio: ['ignore', 'pipe', 'pipe'] }
      );
      return true;
    } catch (_err) {
      return false;
    }
  }
}

async function probeLlmEndpoint({ llmUrl, timeoutMs } = {}) {
  const url = normalizeText(llmUrl || process.env.LLM_BASE_URL);
  if (!url) return null; // optional
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Number(timeoutMs || DEFAULT_PROBE_TIMEOUT_MS));
    const response = await fetch(url, { method: 'GET', signal: controller.signal });
    clearTimeout(timer);
    // LLM base URLs often 401/404 on GET without auth, that still proves TCP reachability
    if (response.status >= 500) {
      return { code: 'DW_E_LLM_ENDPOINT_DOWN', detail: `HTTP ${response.status}` };
    }
    return null;
  } catch (error) {
    return { code: 'DW_E_LLM_ENDPOINT_DOWN', detail: error && error.message };
  }
}

function probeConfigDrift({ expectedKbUrl, reportedKbUrl } = {}) {
  const expected = normalizeText(expectedKbUrl || process.env.KNOWLEDGE_BASE_SEARCH_URL);
  const reported = normalizeText(reportedKbUrl);
  if (!expected || !reported) return null;
  try {
    const a = new URL(expected);
    const b = new URL(reported);
    if (a.host !== b.host) {
      return {
        code: 'DW_E_CONFIG_DRIFT',
        detail: `expected KB host ${a.host}, got ${b.host}`,
      };
    }
    return null;
  } catch (_) {
    return null;
  }
}

/**
 * Run a battery of probes and collect failures.
 * Each probe is skippable via DEEPWIKI_PREFLIGHT_DISABLE env var (comma-separated codes).
 *
 * @param {object} opts
 * @param {string} [opts.repoPath]
 * @param {string} [opts.branch]
 * @param {object} [opts.db]
 * @param {Array<{name,code,run}>} [opts.extraProbes]
 * @returns {Promise<{ ok: boolean, failures: object[], skipped: string[] }>}
 */
async function runPreflight(opts = {}) {
  const disabled = parseDisabledCodes();
  const skipped = [];
  const failures = [];

  const probes = [
    { name: 'knowledge_base', code: 'DW_E_KB_UNREACHABLE', run: () => probeKnowledgeBase(opts) },
    { name: 'knowledge_base_venv', code: 'DW_E_KB_VENV_MISSING', run: () => probeKnowledgeBaseVenv(opts) },
    { name: 'database', code: 'DW_E_DB_WRITE_FAIL', run: () => probeDatabase(opts) },
    { name: 'repo_access', code: 'DW_E_REPO_UNREADABLE', run: () => probeRepoAccess(opts) },
    { name: 'branch_exists', code: 'DW_E_BRANCH_MISSING', run: () => probeBranchExists(opts) },
    { name: 'llm_endpoint', code: 'DW_E_LLM_ENDPOINT_DOWN', run: () => probeLlmEndpoint(opts) },
    { name: 'config_drift', code: 'DW_E_CONFIG_DRIFT', run: () => probeConfigDrift(opts) },
    ...(Array.isArray(opts.extraProbes) ? opts.extraProbes : []),
  ];

  for (const probe of probes) {
    if (disabled.has(probe.code)) {
      skipped.push(probe.code);
      continue;
    }
    let result;
    try {
      result = await probe.run();
    } catch (error) {
      result = {
        code: isKnownErrorCode(probe.code) ? probe.code : 'DW_E_PREFLIGHT_FAILED',
        detail: error && error.message,
      };
    }
    if (result && result.code) {
      failures.push({
        probe: probe.name,
        code: result.code,
        detail: result.detail || null,
      });
    }
  }

  return {
    ok: failures.length === 0,
    failures,
    skipped,
  };
}

function formatFailuresAsError(failures) {
  if (!Array.isArray(failures) || !failures.length) return null;
  const detail = failures
    .map((item) => `${item.probe}:${item.code}${item.detail ? ` (${item.detail})` : ''}`)
    .join('; ');
  return new DeepWikiError('DW_E_PREFLIGHT_FAILED', detail, { failures });
}

module.exports = {
  runPreflight,
  formatFailuresAsError,
  probeKnowledgeBase,
  probeKnowledgeBaseVenv,
  probeDatabase,
  probeRepoAccess,
  probeBranchExists,
  probeLlmEndpoint,
  probeConfigDrift,
  DEFAULT_PROBE_TIMEOUT_MS,
  SEVERITY,
};
