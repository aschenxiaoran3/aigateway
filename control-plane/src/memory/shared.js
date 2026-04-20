const crypto = require('crypto');

const DEFAULT_MEMORY_POLICY = {
  enabled: false,
  capture_mode: 'hybrid',
  fact_extraction: true,
  retention_days: 365,
  redaction_mode: 'mask',
  max_recall_tokens: 800,
  metadata_json: {},
};

const MEMORY_COLLECTIONS = {
  dialogue: 'gateway_long_memory_dialogue',
  agent: 'gateway_long_memory_agent',
  codex: 'gateway_long_memory_codex',
};

function normalizeText(value) {
  if (value == null) return '';
  return String(value).trim();
}

function truncateText(value, limit = 240) {
  const text = normalizeText(value);
  if (!text) return '';
  return text.length > limit ? `${text.slice(0, Math.max(0, limit - 1))}...` : text;
}

function parseJson(value, fallback = null) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function stringifyJson(value, fallback = '{}') {
  try {
    return JSON.stringify(value ?? {});
  } catch {
    return fallback;
  }
}

function hashText(value = '') {
  return crypto.createHash('sha1').update(String(value || ''), 'utf8').digest('hex');
}

function dedupeStrings(items = []) {
  const seen = new Set();
  const output = [];
  for (const item of items) {
    const normalized = normalizeText(item);
    if (!normalized) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(normalized);
  }
  return output;
}

function splitSentences(text) {
  return dedupeStrings(
    normalizeText(text)
      .split(/[\n\r。！？!?]+/g)
      .map((item) => item.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
  );
}

function redactMemoryText(value) {
  let text = normalizeText(value);
  if (!text) return '';
  text = text
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, '$1[REDACTED]')
    .replace(/(api[_-]?key["'\s:=]+)([A-Za-z0-9._-]+)/gi, '$1[REDACTED]')
    .replace(/(token["'\s:=]+)([A-Za-z0-9._-]+)/gi, '$1[REDACTED]')
    .replace(/(password["'\s:=]+)([^\s"',]+)/gi, '$1[REDACTED]')
    .replace(/([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g, '[REDACTED_EMAIL]');
  return text;
}

function summarizeMemoryText(value, limit = 240) {
  return truncateText(redactMemoryText(value).replace(/\s+/g, ' '), limit);
}

function estimateTokenCount(value) {
  const text = normalizeText(value);
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

function deriveRoomKey(input = {}) {
  return (
    normalizeText(input.room) ||
    normalizeText(input.purpose) ||
    normalizeText(input.pipeline) ||
    'general'
  )
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, '-')
    .slice(0, 64) || 'general';
}

function deriveHallKey(value, role = 'user') {
  const text = normalizeText(value).toLowerCase();
  if (!text) return role === 'assistant' ? 'discoveries' : 'events';
  if (/默认|偏好|prefer|风格|口吻|language|中文|english/.test(text)) return 'preferences';
  if (/决定|采用|固定|统一|一期|phase|方案|policy/.test(text)) return 'advice';
  if (/发现|结论|架构|事实|原因|root cause|diagnosis/.test(text)) return 'discoveries';
  return 'events';
}

function selectMemoryCollection(scopeKey, sourceSystem = 'gateway') {
  const normalizedScope = normalizeText(scopeKey);
  const normalizedSource = normalizeText(sourceSystem).toLowerCase();
  if (normalizedSource === 'codex' || normalizedScope.startsWith('workspace:')) {
    return MEMORY_COLLECTIONS.codex;
  }
  if (normalizedScope.startsWith('agt:')) {
    return MEMORY_COLLECTIONS.agent;
  }
  return MEMORY_COLLECTIONS.dialogue;
}

function mergeMemoryPolicy(policy = {}) {
  return {
    ...DEFAULT_MEMORY_POLICY,
    ...(policy || {}),
    enabled: policy?.enabled === true,
    fact_extraction: policy?.fact_extraction !== false,
    retention_days: Number(policy?.retention_days || DEFAULT_MEMORY_POLICY.retention_days),
    max_recall_tokens: Number(policy?.max_recall_tokens || DEFAULT_MEMORY_POLICY.max_recall_tokens),
    metadata_json: parseJson(policy?.metadata_json, policy?.metadata_json || {}),
  };
}

function resolveMemoryPolicyChain(input = {}) {
  const policies = Array.isArray(input.policies) ? input.policies : [];
  const resolutionOrder = Array.isArray(input.resolution_order)
    ? input.resolution_order
    : ['scope_key', 'agent_spec', 'skill_package', 'project', 'api_key', 'global'];
  const matchedPolicies = [];
  for (const scopeType of resolutionOrder) {
    const scopeId = normalizeText(input[scopeType]);
    if (!scopeId) continue;
    const found = policies.find(
      (item) =>
        normalizeText(item.scope_type) === scopeType &&
        normalizeText(item.scope_id) === scopeId
    );
    if (found) {
      matchedPolicies.push(found);
      break;
    }
  }
  const globalPolicy = policies.find(
    (item) =>
      normalizeText(item.scope_type) === 'global' &&
      normalizeText(item.scope_id || 'default') === (normalizeText(input.global) || 'default')
  );
  const merged = mergeMemoryPolicy({
    ...(globalPolicy || {}),
    ...(matchedPolicies[0] || {}),
  });
  return {
    policy: merged,
    matched_policy: matchedPolicies[0] || null,
    global_policy: globalPolicy || null,
  };
}

function resolveMemoryScopeContext(input = {}) {
  const projectCode = normalizeText(input.project_code) || 'global';
  const subjectId =
    normalizeText(input.subject_id) ||
    normalizeText(input.user_id) ||
    normalizeText(input.api_key_id) ||
    'anonymous';
  const agentKey =
    normalizeText(input.agent_spec_id) ||
    normalizeText(input.skill_package_id) ||
    subjectId;
  const sourceSystem = normalizeText(input.source_system || 'gateway').toLowerCase() || 'gateway';
  const scopeKey =
    normalizeText(input.scope_key) ||
    (sourceSystem === 'codex'
      ? `workspace:${projectCode === 'global' ? 'ai-platform' : projectCode}`
      : normalizeText(input.agent_spec_id) || normalizeText(input.skill_package_id)
        ? `agt:${projectCode}:${agentKey}`
        : `dlg:${projectCode}:${subjectId}`);
  const threadKey =
    normalizeText(input.thread_key) ||
    normalizeText(input.conversation_id) ||
    normalizeText(input.session_id) ||
    normalizeText(input.trace_id) ||
    normalizeText(input.request_id) ||
    `thread:${hashText(`${scopeKey}:${Date.now()}`).slice(0, 16)}`;
  const roomKey = deriveRoomKey(input);
  return {
    scope_key: scopeKey,
    thread_key: threadKey,
    room_key: roomKey,
    subject_id: subjectId,
    project_code: projectCode,
    source_system: sourceSystem,
    collection: selectMemoryCollection(scopeKey, sourceSystem),
  };
}

function sanitizeMemoryUriSegment(value, fallback = 'unknown') {
  const normalized = normalizeText(value)
    .replace(/[^A-Za-z0-9:_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 191);
  return normalized || fallback;
}

function buildMemorySourceUri(input = {}, turnIndex = 0) {
  const context = resolveMemoryScopeContext(input);
  const index = Math.max(0, Number(turnIndex || 0));
  return `memory://${sanitizeMemoryUriSegment(context.scope_key, 'scope')}/${sanitizeMemoryUriSegment(
    context.thread_key,
    'thread'
  )}/turn/${index}`;
}

function normalizeTurnForFactInference(turn = {}) {
  return {
    role: normalizeText(turn.role || 'user').toLowerCase() || 'user',
    text: redactMemoryText(turn.content_text || turn.content_text_redacted || ''),
  };
}

function inferMemoryFactsFromTurns(turns = [], options = {}) {
  const subjectText = normalizeText(options.subject_text) || normalizeText(options.scope_key) || 'workspace';
  const facts = [];
  const seen = new Set();
  const addFact = (factType, predicate, sentence, confidence = 0.72) => {
    const objectText = truncateText(sentence, 400);
    const dedupeKey = `${factType}:${predicate}:${objectText}`;
    if (!objectText || seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    facts.push({
      fact_type: factType,
      subject_text: subjectText,
      predicate_text: predicate,
      object_text: objectText,
      confidence,
      metadata_json: {
        source: 'heuristic',
      },
    });
  };

  for (const currentTurn of turns.map(normalizeTurnForFactInference)) {
    if (currentTurn.role !== 'user') continue;
    const sentences = splitSentences(currentTurn.text);
    for (const sentence of sentences) {
      if (/记住|remember this/.test(sentence)) {
        addFact('note', 'remember', sentence, 0.82);
      }
      if (/默认|prefer|优先|请用|以后用|以后默认/.test(sentence)) {
        addFact('preference', 'preference', sentence, 0.8);
      }
      if (/采用|固定|统一|复用|一期|v1|phase 1|不引入|按项目|按 key|按key/.test(sentence)) {
        addFact('decision', 'decision', sentence, 0.76);
      }
      if (/风险|待补|未完成|后续|下一步|todo|blocker/i.test(sentence)) {
        addFact('risk', 'risk', sentence, 0.7);
      }
    }
  }
  return facts;
}

function buildMemoryRecallText(input = {}) {
  const maxTokens = Math.max(100, Number(input.max_recall_tokens || DEFAULT_MEMORY_POLICY.max_recall_tokens));
  const facts = Array.isArray(input.facts) ? input.facts : [];
  const turns = Array.isArray(input.turns) ? input.turns : [];
  const sections = [];

  if (facts.length) {
    sections.push(
      [
        'L0 Profile',
        ...facts.slice(0, 8).map((item) => `- ${normalizeText(item.object_text || item.predicate_text || '')}`),
      ].join('\n')
    );
  }
  const decisionTurns = turns.filter((item) => /决策|采用|固定|统一|一期|phase|risk|默认|偏好/i.test(normalizeText(item.summary_text || item.content_text_redacted || '')));
  if (decisionTurns.length) {
    sections.push(
      [
        'L1 Essential Story',
        ...decisionTurns.slice(0, 5).map((item) => `- ${summarizeMemoryText(item.summary_text || item.content_text_redacted || '', 220)}`),
      ].join('\n')
    );
  }
  if (turns.length) {
    sections.push(
      [
        'L2 Scoped Recall',
        ...turns.slice(0, 3).map((item) => {
          const role = normalizeText(item.role || 'memory') || 'memory';
          return `- ${role}: ${summarizeMemoryText(item.content_text_redacted || item.summary_text || '', 220)}`;
        }),
      ].join('\n')
    );
  }

  let output = sections.filter(Boolean).join('\n\n').trim();
  while (estimateTokenCount(output) > maxTokens && sections.length > 0) {
    sections.pop();
    output = sections.filter(Boolean).join('\n\n').trim();
  }
  return output;
}

module.exports = {
  DEFAULT_MEMORY_POLICY,
  MEMORY_COLLECTIONS,
  parseJson,
  stringifyJson,
  normalizeText,
  truncateText,
  hashText,
  redactMemoryText,
  summarizeMemoryText,
  estimateTokenCount,
  deriveRoomKey,
  deriveHallKey,
  selectMemoryCollection,
  mergeMemoryPolicy,
  resolveMemoryPolicyChain,
  resolveMemoryScopeContext,
  buildMemorySourceUri,
  inferMemoryFactsFromTurns,
  buildMemoryRecallText,
  splitSentences,
  dedupeStrings,
};
