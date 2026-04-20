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

  const collectFromRepos = (camelKey, snakeKey) => {
    const result = [];
    for (const repo of ensureArray(topology.repos)) {
      if (!repo || typeof repo !== 'object') continue;
      const records = ensureArray(repo[camelKey] || repo[snakeKey]);
      for (const rec of records) {
        if (!rec || typeof rec !== 'object') continue;
        result.push(rec);
      }
    }
    return result;
  };

  const throwStatements = collectFromRepos('throwStatements', 'throw_statements');
  const exceptionHandlers = collectFromRepos('exceptionHandlers', 'exception_handlers');
  const validationAnnotations = collectFromRepos('validationAnnotations', 'validation_annotations');
  const assertionStatements = collectFromRepos('assertionStatements', 'assertion_statements');
  const calculationHints = collectFromRepos('calculationHints', 'calculation_hints');

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

  const apiContracts = ensureArray(dataContracts.apiContracts || dataContracts.api_contracts);
  const erModel = ensureArray(dataContracts.erModel || dataContracts.er_model);
  const eventCatalog = ensureArray(dataContracts.eventCatalog || dataContracts.event_catalog);

  const business_rules = extractRulesFromComments({
    commentRecords,
    apiContracts,
    erModel,
    lexicon,
  });

  const test_evidence = extractRulesFromTestNames({
    testMethods,
    lexicon,
  });

  const state_machines_with_guards = upgradeStateMachinesWithGuards({
    stateMachines: ensureArray(semantic.stateMachines || semantic.state_machines),
    apiContracts,
    eventCatalog,
    commentRecords,
    lexicon,
  });

  const scenarios = extractScenarios({
    testEvidence: test_evidence,
    throwStatements,
    commentRecords,
    apiContracts,
    lexicon,
  });

  const calculations = extractCalculations({
    calculationHints,
    commentRecords,
    lexicon,
  });

  const failure_modes = extractFailureModes({
    throwStatements,
    exceptionHandlers,
    commentRecords,
    lexicon,
  });

  const invariants = extractInvariants({
    validationAnnotations,
    assertionStatements,
    erModel,
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
    scenario_count: scenarios.length,
    scenario_by_type: scenarios.reduce((acc, s) => {
      acc[s.type] = (acc[s.type] || 0) + 1;
      return acc;
    }, {}),
    calculation_count: calculations.length,
    failure_mode_count: failure_modes.length,
    invariant_count: invariants.length,
    invariant_by_scope: invariants.reduce((acc, inv) => {
      const k = inv.scope || 'unknown';
      acc[k] = (acc[k] || 0) + 1;
      return acc;
    }, {}),
  };

  return {
    business_rules,
    test_evidence,
    state_machines_with_guards,
    scenarios,
    calculations,
    failure_modes,
    invariants,
    summary,
  };
}

// ---------------------------------------------------------------------------
// Extractor 4: extractScenarios
// ---------------------------------------------------------------------------
//
// 产出 happy / branch / exception 三类业务场景：
//   - happy 从测试 given-when-then
//   - branch 从含分支关键词的 rule_comments + apiContracts
//   - exception 从 throw_statements
// ---------------------------------------------------------------------------

const BRANCH_KEYWORD_REGEX = /\bif\b|\belse\b|\bwhen\b|\botherwise\b|\bunless\b|\bexcept\b|否则|如果|当|一旦|只有|仅当/i;

function extractScenarios(options) {
  const {
    testEvidence = [],
    throwStatements = [],
    commentRecords = [],
    apiContracts = [],
    lexicon = loadBusinessLexicon(),
    maxScenarios = 96,
  } = options || {};

  const scenarios = [];
  const seen = new Set();

  const push = (candidate) => {
    if (scenarios.length >= maxScenarios) return;
    const title = trimToLimit(candidate.title, 180);
    if (!title) return;
    const key = `${candidate.type}::${title}`;
    if (seen.has(key)) return;
    seen.add(key);
    scenarios.push({
      scenario_id: `scn-${String(scenarios.length + 1).padStart(3, '0')}`,
      type: candidate.type,
      title,
      preconditions: ensureArray(candidate.preconditions).filter(Boolean).map(safeString).slice(0, 4),
      steps: ensureArray(candidate.steps).filter(Boolean).map(safeString).slice(0, 6),
      expected_outcome: candidate.expected_outcome ? safeString(candidate.expected_outcome) : null,
      citations: ensureArray(candidate.citations).filter((c) => c && c.path),
      domain_hint: candidate.domain_hint || null,
      confidence: Number(candidate.confidence || 0.6),
    });
  };

  for (const evidence of ensureArray(testEvidence)) {
    if (!evidence || typeof evidence !== 'object') continue;
    const description = safeString(evidence.description).trim();
    if (!description) continue;
    const preconditions = evidence.given ? [safeString(evidence.given)] : [];
    const steps = evidence.when ? [safeString(evidence.when)] : [];
    const expected = evidence.then ? safeString(evidence.then) : null;
    push({
      type: 'happy',
      title: description,
      preconditions,
      steps,
      expected_outcome: expected,
      citations: evidence.citations,
      domain_hint: evidence.domain_hint,
      confidence: 0.75,
    });
  }

  for (const record of ensureArray(commentRecords)) {
    if (!record || typeof record !== 'object') continue;
    const text = safeString(record.text).trim();
    if (!text) continue;
    if (!BRANCH_KEYWORD_REGEX.test(text)) continue;
    if (isAntiPattern(text, lexicon)) continue;
    const citation = { path: safeString(record.path) };
    if (Number.isFinite(record.line_start)) citation.line_start = Number(record.line_start);
    if (Number.isFinite(record.line_end)) citation.line_end = Number(record.line_end);
    push({
      type: 'branch',
      title: text,
      preconditions: [],
      steps: [],
      expected_outcome: null,
      citations: citation.path ? [citation] : [],
      domain_hint: classifyDomain(`${text} ${record.path || ''}`, lexicon),
      confidence: 0.6,
    });
  }

  for (const contract of ensureArray(apiContracts)) {
    if (!contract || typeof contract !== 'object') continue;
    const text = [contract.businessAction, contract.action, contract.summary, contract.description]
      .map(safeString)
      .filter(Boolean)
      .join(' · ');
    if (!text) continue;
    if (!BRANCH_KEYWORD_REGEX.test(text)) continue;
    push({
      type: 'branch',
      title: `${contract.method || ''} ${contract.path || ''} — ${text}`.trim(),
      preconditions: [],
      steps: [],
      expected_outcome: null,
      citations: contract.source ? [{ path: safeString(contract.source) }] : [],
      domain_hint: classifyDomain(`${text} ${contract.path || ''}`, lexicon),
      confidence: 0.55,
    });
  }

  for (const throwRec of ensureArray(throwStatements)) {
    if (!throwRec || typeof throwRec !== 'object') continue;
    const exceptionType = safeString(throwRec.exception_type);
    if (!exceptionType) continue;
    const message = safeString(throwRec.message);
    const title = message
      ? `异常路径：${exceptionType} — ${message}`
      : `异常路径：抛出 ${exceptionType}`;
    const citation = { path: safeString(throwRec.path) };
    if (Number.isFinite(throwRec.line_start)) citation.line_start = Number(throwRec.line_start);
    if (Number.isFinite(throwRec.line_end)) citation.line_end = Number(throwRec.line_end);
    push({
      type: 'exception',
      title,
      preconditions: [],
      steps: [],
      expected_outcome: message || `${exceptionType} 被抛出`,
      citations: citation.path ? [citation] : [],
      domain_hint: classifyDomain(`${message} ${throwRec.path || ''}`, lexicon),
      confidence: 0.75,
    });
  }

  return scenarios;
}

// ---------------------------------------------------------------------------
// Extractor 5: extractCalculations
// ---------------------------------------------------------------------------
//
// 产出业务计算公式 + 边界约束：
//   - 从 calculation_hints（BigDecimal / Math.* / 金额/时间关键词）
//   - 从 rule_comments 里关联的边界文本（至少/至多/不得超过...）
// ---------------------------------------------------------------------------

const BOUNDARY_EXTRACT_REGEX = /(?:至少|不少于|不低于|大于等于|>=|最多|至多|不得超过|不超过|不大于|<=|大于|小于|>|<)\s*([0-9]+(?:\.[0-9]+)?[%a-zA-Z\u4e00-\u9fa5]*)/g;

function extractCalculations(options) {
  const {
    calculationHints = [],
    commentRecords = [],
    lexicon = loadBusinessLexicon(),
    maxCalculations = 48,
  } = options || {};

  const calculations = [];
  const seen = new Set();

  const push = (candidate) => {
    if (calculations.length >= maxCalculations) return;
    const formula = trimToLimit(candidate.formula_text, 200);
    if (!formula) return;
    const key = `${candidate.source_type}::${formula}`;
    if (seen.has(key)) return;
    seen.add(key);
    calculations.push({
      calc_id: `calc-${String(calculations.length + 1).padStart(3, '0')}`,
      formula_text: formula,
      keyword: candidate.keyword || null,
      source_type: candidate.source_type,
      boundaries: ensureArray(candidate.boundaries),
      citations: ensureArray(candidate.citations).filter((c) => c && c.path),
      domain_hint: candidate.domain_hint || null,
      confidence: Number(candidate.confidence || 0.6),
    });
  };

  for (const hint of ensureArray(calculationHints)) {
    if (!hint || typeof hint !== 'object') continue;
    const text = safeString(hint.text).trim();
    if (!text) continue;
    const citation = { path: safeString(hint.path) };
    if (Number.isFinite(hint.line_start)) citation.line_start = Number(hint.line_start);
    if (Number.isFinite(hint.line_end)) citation.line_end = Number(hint.line_end);
    const boundaries = [];
    let match;
    BOUNDARY_EXTRACT_REGEX.lastIndex = 0;
    while ((match = BOUNDARY_EXTRACT_REGEX.exec(text))) {
      boundaries.push({ bound: match[0].trim(), value: match[1] });
      if (boundaries.length > 4) break;
    }
    push({
      formula_text: text,
      keyword: safeString(hint.keyword || ''),
      source_type: hint.source_type === 'comment' ? 'calculation_comment' : 'calculation_code',
      boundaries,
      citations: citation.path ? [citation] : [],
      domain_hint: classifyDomain(`${text} ${hint.path || ''}`, lexicon),
      confidence: hint.source_type === 'code' ? 0.7 : 0.6,
    });
  }

  for (const record of ensureArray(commentRecords)) {
    if (!record || typeof record !== 'object') continue;
    const text = safeString(record.text).trim();
    if (!text) continue;
    const boundaries = [];
    let match;
    BOUNDARY_EXTRACT_REGEX.lastIndex = 0;
    while ((match = BOUNDARY_EXTRACT_REGEX.exec(text))) {
      boundaries.push({ bound: match[0].trim(), value: match[1] });
      if (boundaries.length > 4) break;
    }
    if (!boundaries.length) continue;
    const citation = { path: safeString(record.path) };
    if (Number.isFinite(record.line_start)) citation.line_start = Number(record.line_start);
    if (Number.isFinite(record.line_end)) citation.line_end = Number(record.line_end);
    push({
      formula_text: text,
      keyword: null,
      source_type: 'calculation_rule',
      boundaries,
      citations: citation.path ? [citation] : [],
      domain_hint: classifyDomain(`${text} ${record.path || ''}`, lexicon),
      confidence: 0.65,
    });
  }

  return calculations;
}

// ---------------------------------------------------------------------------
// Extractor 6: extractFailureModes
// ---------------------------------------------------------------------------
//
// 失败模式 + 补偿动作：
//   - trigger_condition: throw_statements 的 exception_type + message
//   - compensation: exception_handlers (Retryable / CircuitBreaker / Fallback / ExceptionHandler / catch)
//   - 通过文件路径归拢配对
// ---------------------------------------------------------------------------

function extractFailureModes(options) {
  const {
    throwStatements = [],
    exceptionHandlers = [],
    commentRecords = [],
    lexicon = loadBusinessLexicon(),
    maxModes = 64,
  } = options || {};

  const handlerIndex = new Map();
  for (const handler of ensureArray(exceptionHandlers)) {
    if (!handler || typeof handler !== 'object') continue;
    const key = safeString(handler.exception_type || handler.arguments || handler.annotation);
    const k2 = key.toLowerCase();
    if (!handlerIndex.has(k2)) handlerIndex.set(k2, []);
    handlerIndex.get(k2).push(handler);
  }

  const modes = [];
  const seen = new Set();

  const push = (candidate) => {
    if (modes.length >= maxModes) return;
    const condition = trimToLimit(candidate.trigger_condition, 220);
    if (!condition) return;
    const key = condition;
    if (seen.has(key)) return;
    seen.add(key);
    modes.push({
      failure_id: `fm-${String(modes.length + 1).padStart(3, '0')}`,
      trigger_condition: condition,
      exception_type: candidate.exception_type || null,
      error_message: candidate.error_message || null,
      compensation: ensureArray(candidate.compensation).filter(Boolean),
      citations: ensureArray(candidate.citations).filter((c) => c && c.path),
      domain_hint: candidate.domain_hint || null,
      confidence: Number(candidate.confidence || 0.6),
    });
  };

  for (const throwRec of ensureArray(throwStatements)) {
    if (!throwRec || typeof throwRec !== 'object') continue;
    const exceptionType = safeString(throwRec.exception_type);
    if (!exceptionType) continue;
    const message = safeString(throwRec.message);
    const condition = message
      ? `${exceptionType}: ${message}`
      : `抛出 ${exceptionType}`;
    const citation = { path: safeString(throwRec.path) };
    if (Number.isFinite(throwRec.line_start)) citation.line_start = Number(throwRec.line_start);
    if (Number.isFinite(throwRec.line_end)) citation.line_end = Number(throwRec.line_end);

    const compensation = [];
    const directHandlers = handlerIndex.get(exceptionType.toLowerCase()) || [];
    for (const handler of directHandlers.slice(0, 3)) {
      const label = handler.annotation
        ? `@${handler.annotation}${handler.arguments ? `(${handler.arguments})` : ''}`
        : handler.kind === 'catch'
          ? `catch(${handler.exception_type})`
          : 'handler';
      const handlerCite = { path: safeString(handler.path) };
      if (Number.isFinite(handler.line_start)) handlerCite.line_start = Number(handler.line_start);
      if (Number.isFinite(handler.line_end)) handlerCite.line_end = Number(handler.line_end);
      compensation.push({ kind: handler.kind || 'handler', text: label, citation: handlerCite.path ? handlerCite : null });
    }

    push({
      trigger_condition: condition,
      exception_type: exceptionType,
      error_message: message || null,
      compensation,
      citations: citation.path ? [citation] : [],
      domain_hint: classifyDomain(`${message} ${throwRec.path || ''}`, lexicon),
      confidence: 0.75,
    });
  }

  for (const handler of ensureArray(exceptionHandlers)) {
    if (!handler || typeof handler !== 'object') continue;
    if (handler.kind !== 'resilience') continue;
    const annotation = safeString(handler.annotation);
    if (!annotation) continue;
    const condition = `Resilience: @${annotation}${handler.arguments ? `(${handler.arguments})` : ''}`;
    const citation = { path: safeString(handler.path) };
    if (Number.isFinite(handler.line_start)) citation.line_start = Number(handler.line_start);
    if (Number.isFinite(handler.line_end)) citation.line_end = Number(handler.line_end);
    push({
      trigger_condition: condition,
      exception_type: null,
      error_message: null,
      compensation: [{ kind: 'resilience', text: `@${annotation}`, citation: citation.path ? citation : null }],
      citations: citation.path ? [citation] : [],
      domain_hint: null,
      confidence: 0.55,
    });
  }

  for (const record of ensureArray(commentRecords)) {
    if (!record || typeof record !== 'object') continue;
    const text = safeString(record.text);
    if (!text) continue;
    if (!/异常|失败|错误|fallback|compensation|补偿|回滚|rollback|重试|retry/i.test(text)) continue;
    if (!containsStrongRuleTrigger(text, lexicon)) continue;
    const citation = { path: safeString(record.path) };
    if (Number.isFinite(record.line_start)) citation.line_start = Number(record.line_start);
    if (Number.isFinite(record.line_end)) citation.line_end = Number(record.line_end);
    push({
      trigger_condition: text,
      exception_type: null,
      error_message: null,
      compensation: [],
      citations: citation.path ? [citation] : [],
      domain_hint: classifyDomain(`${text} ${record.path || ''}`, lexicon),
      confidence: 0.5,
    });
  }

  return modes;
}

// ---------------------------------------------------------------------------
// Extractor 7: extractInvariants
// ---------------------------------------------------------------------------
//
// 不变量约束：
//   - validation_annotations: @NotNull / @Size / @Min / @Max / …
//   - assertion_statements:   Preconditions.check* / Assert.* / Objects.requireNonNull / UNIQUE
//   - erModel.columns[notNull=true] 作为数据层不变量
// ---------------------------------------------------------------------------

function extractInvariants(options) {
  const {
    validationAnnotations = [],
    assertionStatements = [],
    erModel = [],
    lexicon = loadBusinessLexicon(),
    maxInvariants = 96,
  } = options || {};

  const invariants = [];
  const seen = new Set();

  const push = (candidate) => {
    if (invariants.length >= maxInvariants) return;
    const condition = trimToLimit(candidate.condition, 220);
    if (!condition) return;
    const key = `${candidate.source_type}::${condition}`;
    if (seen.has(key)) return;
    seen.add(key);
    invariants.push({
      invariant_id: `inv-${String(invariants.length + 1).padStart(3, '0')}`,
      condition,
      scope: candidate.scope || null,
      source_type: candidate.source_type,
      citations: ensureArray(candidate.citations).filter((c) => c && c.path),
      domain_hint: candidate.domain_hint || null,
      confidence: Number(candidate.confidence || 0.7),
    });
  };

  for (const annotation of ensureArray(validationAnnotations)) {
    if (!annotation || typeof annotation !== 'object') continue;
    const name = safeString(annotation.annotation);
    if (!name) continue;
    const args = safeString(annotation.arguments);
    const condition = args ? `@${name}(${args})` : `@${name}`;
    const citation = { path: safeString(annotation.path) };
    if (Number.isFinite(annotation.line_start)) citation.line_start = Number(annotation.line_start);
    if (Number.isFinite(annotation.line_end)) citation.line_end = Number(annotation.line_end);
    push({
      condition,
      scope: 'field_validation',
      source_type: 'validation_annotation',
      citations: citation.path ? [citation] : [],
      domain_hint: classifyDomain(`${condition} ${annotation.path || ''}`, lexicon),
      confidence: 0.8,
    });
  }

  for (const stmt of ensureArray(assertionStatements)) {
    if (!stmt || typeof stmt !== 'object') continue;
    const call = safeString(stmt.assertion);
    if (!call) continue;
    const args = safeString(stmt.arguments);
    const condition = args ? `${call}(${args})` : call;
    const citation = { path: safeString(stmt.path) };
    if (Number.isFinite(stmt.line_start)) citation.line_start = Number(stmt.line_start);
    if (Number.isFinite(stmt.line_end)) citation.line_end = Number(stmt.line_end);
    const scope = stmt.source_type === 'sql_unique'
      ? 'database_unique'
      : stmt.source_type === 'java_unique'
        ? 'entity_unique'
        : stmt.source_type === 'inline_assert'
          ? 'runtime_assert'
          : 'guard_call';
    push({
      condition,
      scope,
      source_type: stmt.source_type || 'assertion',
      citations: citation.path ? [citation] : [],
      domain_hint: classifyDomain(`${condition} ${stmt.path || ''}`, lexicon),
      confidence: stmt.source_type === 'sql_unique' || stmt.source_type === 'java_unique' ? 0.85 : 0.75,
    });
  }

  for (const table of ensureArray(erModel)) {
    if (!table || typeof table !== 'object') continue;
    for (const col of ensureArray(table.columns)) {
      if (!col || typeof col !== 'object') continue;
      if (!col.notNull && !col.primary && !col.unique) continue;
      const tableName = safeString(table.table);
      const colName = safeString(col.name);
      if (!tableName || !colName) continue;
      const flags = [];
      if (col.notNull) flags.push('NOT NULL');
      if (col.primary) flags.push('PRIMARY KEY');
      if (col.unique) flags.push('UNIQUE');
      const condition = `${tableName}.${colName} ${flags.join(' / ')}`;
      const citation = { path: safeString(table.path) };
      push({
        condition,
        scope: 'database_schema',
        source_type: 'er_column',
        citations: citation.path ? [citation] : [],
        domain_hint: classifyDomain(`${condition}`, lexicon),
        confidence: 0.8,
      });
    }
  }

  return invariants;
}

module.exports = {
  deriveBusinessLogicAssets,
  extractRulesFromComments,
  extractRulesFromTestNames,
  upgradeStateMachinesWithGuards,
  extractScenarios,
  extractCalculations,
  extractFailureModes,
  extractInvariants,
};
