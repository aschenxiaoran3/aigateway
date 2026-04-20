'use strict';

const { DeepWikiError } = require('./errors/error-codes');

const DEFAULT_STAGE_TIMEOUT_MS = Object.freeze({
  repository_scan: 10 * 60 * 1000,
  structure_mining: 10 * 60 * 1000,
  data_contract_extraction: 10 * 60 * 1000,
  semantic_mining: 10 * 60 * 1000,
  business_logic_mining: 10 * 60 * 1000,
  ddd_mapping: 5 * 60 * 1000,
  evidence_ranking: 5 * 60 * 1000,
  solution_derivation: 5 * 60 * 1000,
  diagram_generation: 5 * 60 * 1000,
  wiki_authoring: 10 * 60 * 1000,
  quality_gates: 5 * 60 * 1000,
  rag_ingest: 15 * 60 * 1000,
  knowledge_register: 5 * 60 * 1000,
  publish: 5 * 60 * 1000,
  retrieval_eval: 10 * 60 * 1000,
});

const FALLBACK_TIMEOUT_MS = 5 * 60 * 1000;

function resolveTimeoutMs(stageKey) {
  const key = String(stageKey || '').trim();
  if (!key) return FALLBACK_TIMEOUT_MS;
  const envVar = `DEEPWIKI_STAGE_TIMEOUT_MS_${key.toUpperCase()}`;
  const fromEnv = Number(process.env[envVar]);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
  const globalEnv = Number(process.env.DEEPWIKI_STAGE_TIMEOUT_MS);
  if (Number.isFinite(globalEnv) && globalEnv > 0) return globalEnv;
  const builtin = DEFAULT_STAGE_TIMEOUT_MS[key];
  if (Number.isFinite(builtin) && builtin > 0) return builtin;
  return FALLBACK_TIMEOUT_MS;
}

/**
 * Wrap any async function with a wall-clock timeout that throws DW_E_STAGE_TIMEOUT.
 *
 * @param {Function} fn async function to execute
 * @param {{ stageKey?: string, timeoutMs?: number, onTimeout?: Function }} opts
 * @returns {Promise<any>}
 */
async function withStageTimeout(fn, opts = {}) {
  const stageKey = String(opts.stageKey || '').trim() || 'unknown';
  const timeoutMs = Number.isFinite(opts.timeoutMs) && opts.timeoutMs > 0
    ? opts.timeoutMs
    : resolveTimeoutMs(stageKey);
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      if (typeof opts.onTimeout === 'function') {
        try {
          opts.onTimeout({ stageKey, timeoutMs });
        } catch (_) {
          // swallow
        }
      }
      reject(new DeepWikiError('DW_E_STAGE_TIMEOUT', `stage "${stageKey}" exceeded ${timeoutMs}ms`, {
        stageKey,
        timeoutMs,
      }));
    }, timeoutMs);
  });
  try {
    return await Promise.race([Promise.resolve().then(() => fn()), timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

module.exports = {
  withStageTimeout,
  resolveTimeoutMs,
  DEFAULT_STAGE_TIMEOUT_MS,
  FALLBACK_TIMEOUT_MS,
};
