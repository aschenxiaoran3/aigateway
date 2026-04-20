'use strict';

/**
 * business-logic-mining.js  —  DeepWiki L3.5 business logic extractor.
 *
 * 入参来源：L3 semantic_mining 的 business_terms/business_actions/state_machines
 *          + data_contract_extraction 的 api_contracts/er_model/event_catalog
 *          + repo_understanding 的 topology.repos[].ruleComments / testMethods
 *
 * 产出 (asset key: business_logic_assets)：
 *   {
 *     business_rules: [{ rule_id, natural_text, trigger, source_type,
 *                        citations, confidence, domain_hint }],
 *     test_evidence:  [{ test_id, description, given, when, then, source_type,
 *                        citations, domain_hint }],
 *     state_machines_with_guards: [{ entity, states, transitions: [
 *       { from, to, trigger, guard, side_effects, citation }
 *     ] }],
 *     summary: { rule_count, test_evidence_count, state_machine_count, …}
 *   }
 *
 * 设计约束：
 *   - 纯函数 (no fs / no process / no network)
 *   - 所有抽取器对输入缺失都做降级（返回空数组），不抛异常
 *   - 不依赖 LLM，确保 dev/CI 可复现
 */

const {
  loadBusinessLexicon,
  containsStrongRuleTrigger,
  normalizeActionVerb,
  classifyDomain,
  isAntiPattern,
  containsSideEffect,
} = require('./business-lexicon');

function ensureArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  return [value];
}

function safeString(value) {
  if (value === undefined || value === null) return '';
  return String(value);
}

function trimToLimit(text, limit) {
  const s = safeString(text).trim();
  if (!s) return '';
  if (s.length <= limit) return s;
  return `${s.slice(0, Math.max(0, limit - 1))}…`;
}

// ---------------------------------------------------------------------------
// Extractor 1: extractRulesFromComments
// ---------------------------------------------------------------------------

/**
 * 把 topology.repos[].ruleComments + apiContracts.action + erModel.columns[].comment
 * 合并起来扫一遍强触发词，产出 business_rules。
 *
 * commentRecords 形如：
 *   [{ text, path, line_start?, line_end?, source_type? }]
 * apiContracts/erModel 在没有行号时也能用（citation 退化到 file-level）。
 */
function extractRulesFromComments(options) {
  const {
    commentRecords = [],
    apiContracts = [],
    erModel = [],
    lexicon = loadBusinessLexicon(),
    ruleIdPrefix = 'rule',
    maxRules = 64,
  } = options || {};

  const rules = [];
  const seen = new Set();

  const push = (candidate) => {
    if (rules.length >= maxRules) return;
    const natural = trimToLimit(candidate.natural_text, 240);
    if (!natural) return;
    if (isAntiPattern(natural, lexicon)) return;
    const key = `${candidate.source_type}::${natural}`;
    if (seen.has(key)) return;
    seen.add(key);
    rules.push({
      rule_id: `${ruleIdPrefix}-${String(rules.length + 1).padStart(3, '0')}`,
      natural_text: natural,
      trigger: candidate.trigger || null,
      source_type: candidate.source_type,
      citations: candidate.citations || [],
      confidence: Number(candidate.confidence || 0.5),
      domain_hint: candidate.domain_hint || null,
    });
  };

  for (const record of ensureArray(commentRecords)) {
    if (!record || typeof record !== 'object') continue;
    const text = safeString(record.text).trim();
    if (!text) continue;
    const trigger = containsStrongRuleTrigger(text, lexicon);
    if (!trigger) continue;
    const domain = classifyDomain(`${text} ${record.path || ''}`, lexicon);
    const citation = {
      path: safeString(record.path),
    };
    if (Number.isFinite(record.line_start)) citation.line_start = Number(record.line_start);
    if (Number.isFinite(record.line_end)) citation.line_end = Number(record.line_end);
    const hasChinese = /[\u4e00-\u9fa5]/.test(text);
    const normalizedSource = record.source_type && record.source_type !== 'code_comment'
      ? record.source_type
      : (hasChinese ? 'chinese_comment' : 'code_comment');
    push({
      natural_text: text,
      trigger,
      source_type: normalizedSource,
      citations: citation.path ? [citation] : [],
      confidence: citation.line_start ? 0.85 : 0.7,
      domain_hint: domain,
    });
  }

  for (const contract of ensureArray(apiContracts)) {
    if (!contract || typeof contract !== 'object') continue;
    const candidateText = [contract.businessAction, contract.action, contract.summary, contract.description]
      .map(safeString)
      .filter(Boolean)
      .join(' · ');
    if (!candidateText) continue;
    const trigger = containsStrongRuleTrigger(candidateText, lexicon);
    if (!trigger) continue;
    const domain = classifyDomain(`${candidateText} ${contract.path || ''}`, lexicon);
    push({
      natural_text: `${contract.method || ''} ${contract.path || ''} — ${candidateText}`.trim(),
      trigger,
      source_type: 'api_contract',
      citations: contract.path ? [{ path: safeString(contract.source || contract.path) }] : [],
      confidence: 0.65,
      domain_hint: domain,
    });
  }

  for (const table of ensureArray(erModel)) {
    if (!table || typeof table !== 'object') continue;
    const tableText = safeString(table.tableComment || table.comment);
    if (tableText) {
      const trigger = containsStrongRuleTrigger(tableText, lexicon);
      if (trigger) {
        push({
          natural_text: `表 ${safeString(table.table)} · ${tableText}`,
          trigger,
          source_type: 'sql_comment',
          citations: table.path ? [{ path: safeString(table.path) }] : [],
          confidence: 0.75,
          domain_hint: classifyDomain(`${tableText} ${table.table || ''}`, lexicon),
        });
      }
    }
    for (const column of ensureArray(table.columns)) {
      if (!column || typeof column !== 'object') continue;
      const colText = safeString(column.comment);
      if (!colText) continue;
      const trigger = containsStrongRuleTrigger(colText, lexicon);
      if (!trigger) continue;
      push({
        natural_text: `${safeString(table.table)}.${safeString(column.name)} · ${colText}`,
        trigger,
        source_type: 'sql_column_comment',
        citations: table.path ? [{ path: safeString(table.path) }] : [],
        confidence: 0.8,
        domain_hint: classifyDomain(`${colText} ${table.table || ''} ${column.name || ''}`, lexicon),
      });
    }
  }

  return rules;
}

// ---------------------------------------------------------------------------
// Extractor 2: extractRulesFromTestNames
// ---------------------------------------------------------------------------

/**
 * testMethods 形如：
 *   [{ name, path, line_start?, line_end?, framework?: 'junit'|'jest'|'pytest' }]
 *
 * 返回一组 test_evidence（not rules 本身）：
 *   { test_id, description, given, when, then, source_type, citations, domain_hint }
 */
function splitCamelAndUnderscore(name) {
  return safeString(name)
    .replace(/^(test|it|should|when|given)_*/i, '')
    .replace(/[_\-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseGivenWhenThen(rawName, lexicon) {
  if (!rawName) return null;
  const normalized = splitCamelAndUnderscore(rawName).toLowerCase();
  const tokens = normalized.split(' ').filter(Boolean);
  if (tokens.length < 3) {
    return {
      description: normalized,
      given: null,
      when: null,
      then: normalized,
    };
  }

  const junitSplitters = (lexicon.test_name_patterns.junit.splitters || []).map((s) => s.toLowerCase());
  // Find index of first splitter
  let whenIdx = -1;
  let whenWord = null;
  for (let i = 1; i < tokens.length; i += 1) {
    if (junitSplitters.includes(tokens[i])) {
      whenIdx = i;
      whenWord = tokens[i];
      break;
    }
  }

  // Find "given" / "if" downstream
  let givenIdx = -1;
  for (let i = Math.max(whenIdx + 1, 1); i < tokens.length; i += 1) {
    if (tokens[i] === 'given' || tokens[i] === 'if' || tokens[i] === 'when') {
      givenIdx = i;
      break;
    }
  }

  if (whenIdx < 0) {
    return {
      description: normalized,
      given: null,
      when: null,
      then: normalized,
    };
  }

  const thenPartEnd = givenIdx > whenIdx ? givenIdx : tokens.length;
  const thenTokens = tokens.slice(whenIdx + 1, thenPartEnd);
  const subjectTokens = tokens.slice(0, whenIdx);
  const givenTokens = givenIdx > whenIdx ? tokens.slice(givenIdx + 1) : [];

  return {
    description: normalized,
    given: givenTokens.join(' ').trim() || null,
    when: whenWord,
    then: `${subjectTokens.join(' ')} ${whenWord} ${thenTokens.join(' ')}`.trim(),
  };
}

function extractRulesFromTestNames(options) {
  const {
    testMethods = [],
    lexicon = loadBusinessLexicon(),
    testIdPrefix = 'test',
    maxTests = 96,
  } = options || {};

  const evidences = [];
  const seen = new Set();

  for (const method of ensureArray(testMethods)) {
    if (!method || typeof method !== 'object') continue;
    if (evidences.length >= maxTests) break;
    const rawName = safeString(method.name);
    if (!rawName) continue;
    if (isAntiPattern(rawName, lexicon)) continue;

    const parsed = parseGivenWhenThen(rawName, lexicon);
    if (!parsed) continue;
    const description = trimToLimit(parsed.description, 180);
    if (!description) continue;

    const key = `${method.path || ''}::${description}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const citation = { path: safeString(method.path) };
    if (Number.isFinite(method.line_start)) citation.line_start = Number(method.line_start);
    if (Number.isFinite(method.line_end)) citation.line_end = Number(method.line_end);

    evidences.push({
      test_id: `${testIdPrefix}-${String(evidences.length + 1).padStart(3, '0')}`,
      description,
      given: parsed.given,
      when: parsed.when,
      then: parsed.then,
      source_type: method.framework ? `test_${method.framework}` : 'test_name',
      citations: citation.path ? [citation] : [],
      domain_hint: classifyDomain(`${description} ${method.path || ''}`, lexicon),
    });
  }

  return evidences;
}

// ---------------------------------------------------------------------------
// Extractor 3: upgradeStateMachinesWithGuards
// ---------------------------------------------------------------------------

/**
 * 在现有 state_machines （来自 L3 deriveStateMachines）的基础上，拼接出
 * transitions：
 *   - trigger：优先拿 apiContracts[?businessAction~=entity + verb]，否则拿 eventCatalog[?event~=entity]
 *   - guard：从 commentRecords / testMethods 中找匹配 entity 和 guard keyword 的文本
 *   - side_effects：从 eventCatalog 中找同实体的事件
 *   - citation：优先使用 trigger 对应 path；没 path 时退化为 entity 名
 */
function findBestApiForTransition(entity, verb, apiContracts) {
  if (!entity) return null;
  const entityLower = entity.toLowerCase();
  const verbLower = (verb || '').toLowerCase();
  let best = null;
  let bestScore = 0;
  for (const contract of ensureArray(apiContracts)) {
    if (!contract || typeof contract !== 'object') continue;
    const haystack = [
      safeString(contract.businessAction),
      safeString(contract.action),
      safeString(contract.path),
      safeString(contract.source),
    ]
      .join(' ')
      .toLowerCase();
    if (!haystack) continue;
    let score = 0;
    if (haystack.includes(entityLower)) score += 2;
    if (verbLower && haystack.includes(verbLower)) score += 2;
    if (score > bestScore) {
      best = contract;
      bestScore = score;
    }
  }
  return bestScore > 0 ? best : null;
}

function findEventsForEntity(entity, eventCatalog) {
  if (!entity) return [];
  const entityLower = entity.toLowerCase();
  return ensureArray(eventCatalog)
    .filter((event) => {
      if (!event || typeof event !== 'object') return false;
      const text = `${safeString(event.event)} ${safeString(event.topic)}`.toLowerCase();
      return text.includes(entityLower);
    })
    .slice(0, 6);
}

const STATE_VERB_HINTS = [
  { verb: 'create', from: 'INIT', to: 'CREATED', triggers: ['create', 'created', 'new', 'submit', 'submitted', '创建', '新增', '新建'] },
  { verb: 'update', from: 'CREATED', to: 'UPDATED', triggers: ['update', 'updated', 'edit', 'modified', '更新', '修改'] },
  { verb: 'approve', from: 'PENDING', to: 'APPROVED', triggers: ['approve', 'approved', '批准', '审批', '通过'] },
  { verb: 'reject', from: 'PENDING', to: 'REJECTED', triggers: ['reject', 'rejected', '拒绝', '驳回'] },
  { verb: 'cancel', from: 'CREATED', to: 'CANCELLED', triggers: ['cancel', 'cancelled', '取消'] },
  { verb: 'complete', from: 'PROCESSING', to: 'COMPLETED', triggers: ['complete', 'completed', 'finished', '完成'] },
  { verb: 'pay', from: 'CREATED', to: 'PAID', triggers: ['pay', 'paid', 'payment', '支付', '付款'] },
  { verb: 'refund', from: 'PAID', to: 'REFUNDED', triggers: ['refund', 'refunded', '退款'] },
];

function upgradeStateMachinesWithGuards(options) {
  const {
    stateMachines = [],
    apiContracts = [],
    eventCatalog = [],
    commentRecords = [],
    lexicon = loadBusinessLexicon(),
  } = options || {};

  const results = [];
  for (const sm of ensureArray(stateMachines)) {
    if (!sm || typeof sm !== 'object') continue;
    const entity = safeString(sm.entity);
    const states = Array.isArray(sm.states) ? sm.states.map(safeString).filter(Boolean) : [];
    const transitions = [];

    // Derive transitions from verb hints that produce a state the SM actually owns.
    for (const hint of STATE_VERB_HINTS) {
      if (states.length && !states.some((s) => s.toUpperCase() === hint.to)) continue;
      const api = findBestApiForTransition(entity, hint.verb, apiContracts);
      const events = findEventsForEntity(entity, eventCatalog).filter((ev) => {
        const name = safeString(ev.event).toLowerCase();
        return hint.triggers.some((t) => name.includes(t));
      });
      if (!api && events.length === 0) continue;

      const guardMatches = ensureArray(commentRecords)
        .filter((rec) => {
          if (!rec || typeof rec !== 'object') return false;
          const text = safeString(rec.text);
          if (!text) return false;
          const lower = text.toLowerCase();
          if (!lower.includes(entity.toLowerCase())) return false;
          if (!hint.triggers.some((t) => lower.includes(t))) return false;
          const guardHit = [...lexicon.state_machine_guard_keywords.cn, ...lexicon.state_machine_guard_keywords.en]
            .some((kw) => kw && (text.includes(kw) || lower.includes(kw.toLowerCase())));
          return guardHit;
        })
        .slice(0, 2);

      const sideEffects = events.map((ev) => ({
        type: 'event_published',
        name: safeString(ev.event),
        topic: safeString(ev.topic),
      }));
      for (const rec of ensureArray(commentRecords)) {
        if (!rec) continue;
        const text = safeString(rec.text);
        if (!text) continue;
        if (!text.toLowerCase().includes(entity.toLowerCase())) continue;
        const se = containsSideEffect(text, lexicon);
        if (se) {
          sideEffects.push({ type: 'inferred_side_effect', hint: se, text: trimToLimit(text, 100) });
          if (sideEffects.length > 8) break;
        }
      }

      const citation = api && (api.path || api.source)
        ? { type: 'api', path: safeString(api.source || api.path), method: safeString(api.method || '') }
        : events[0]
          ? { type: 'event', name: safeString(events[0].event) }
          : { type: 'entity', name: entity };

      transitions.push({
        from: hint.from,
        to: hint.to,
        trigger: api
          ? `${safeString(api.method || 'POST')} ${safeString(api.path || '')}`.trim()
          : events[0]
            ? `event ${safeString(events[0].event)}`
            : normalizeActionVerb(hint.verb, lexicon) || hint.verb,
        guard: guardMatches.length
          ? trimToLimit(guardMatches.map((g) => safeString(g.text)).join(' / '), 160)
          : null,
        side_effects: sideEffects,
        citation,
      });
    }

    results.push({
      entity,
      states,
      source: safeString(sm.source || ''),
      transitions,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Main: deriveBusinessLogicAssets
// ---------------------------------------------------------------------------

function deriveBusinessLogicAssets(options) {
  const {
    config = {},
    topology = { repos: [] },
    dataContracts = {},
    semantic = {},
    lexicon = loadBusinessLexicon(),
  } = options || {};

  // Collect comment records across repos (rule comments from inventory).
  // Accept multiple aliases: ruleComments (camel), rule_comments (snake),
  // commentRecords (extractor-native).
  const commentRecords = [];
  for (const repo of ensureArray(topology.repos)) {
    if (!repo || typeof repo !== 'object') continue;
    const records = ensureArray(
      repo.ruleComments || repo.rule_comments || repo.commentRecords || repo.comment_records,
    );
    for (const rec of records) {
      if (!rec || typeof rec !== 'object') continue;
      commentRecords.push({
        text: safeString(rec.text),
        path: safeString(rec.path),
        line_start: Number.isFinite(rec.line_start) ? Number(rec.line_start) : undefined,
        line_end: Number.isFinite(rec.line_end) ? Number(rec.line_end) : undefined,
        source_type: rec.source_type || 'code_comment',
      });
    }
  }

  // Collect test methods across repos (aliases supported)
  const testMethods = [];
  for (const repo of ensureArray(topology.repos)) {
    if (!repo || typeof repo !== 'object') continue;
    const records = ensureArray(repo.testMethods || repo.test_methods);
    for (const rec of records) {
      if (!rec || typeof rec !== 'object') continue;
      testMethods.push({
        name: safeString(rec.name),
        path: safeString(rec.path),
        line_start: Number.isFinite(rec.line_start) ? Number(rec.line_start) : undefined,
        line_end: Number.isFinite(rec.line_end) ? Number(rec.line_end) : undefined,
        framework: safeString(rec.framework || ''),
      });
    }
  }

  // Config.requirements 也算一级业务规则来源
  for (const requirement of ensureArray(config && config.requirements)) {
    const text = safeString(requirement);
    if (!text) continue;
    commentRecords.push({
      text,
      path: 'config://requirements',
      source_type: 'requirement',
    });
  }

  const business_rules = extractRulesFromComments({
    commentRecords,
    apiContracts: ensureArray(dataContracts.apiContracts || dataContracts.api_contracts),
    erModel: ensureArray(dataContracts.erModel || dataContracts.er_model),
    lexicon,
  });

  const test_evidence = extractRulesFromTestNames({
    testMethods,
    lexicon,
  });

  const state_machines_with_guards = upgradeStateMachinesWithGuards({
    stateMachines: ensureArray(semantic.stateMachines || semantic.state_machines),
    apiContracts: ensureArray(dataContracts.apiContracts || dataContracts.api_contracts),
    eventCatalog: ensureArray(dataContracts.eventCatalog || dataContracts.event_catalog),
    commentRecords,
    lexicon,
  });

  const summary = {
    rule_count: business_rules.length,
    rule_by_source: business_rules.reduce((acc, rule) => {
      acc[rule.source_type] = (acc[rule.source_type] || 0) + 1;
      return acc;
    }, {}),
    test_evidence_count: test_evidence.length,
    state_machine_count: state_machines_with_guards.length,
    transition_count: state_machines_with_guards.reduce((acc, sm) => acc + ensureArray(sm.transitions).length, 0),
  };

  return {
    business_rules,
    test_evidence,
    state_machines_with_guards,
    summary,
  };
}

module.exports = {
  deriveBusinessLogicAssets,
  extractRulesFromComments,
  extractRulesFromTestNames,
  upgradeStateMachinesWithGuards,
};
