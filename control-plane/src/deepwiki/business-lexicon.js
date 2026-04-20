'use strict';

/**
 * business-lexicon.js
 *
 * 加载 ai-rules/skills/knowledge-os/doc-standards/business-lexicon.yaml 并暴露
 * 一组纯函数原语，供 business-logic-mining.js / page-builder.js 调用。
 *
 * 设计目标：
 *   - 零运行依赖（只依赖 js-yaml，控制面已经 pin 了这个包）
 *   - 单例懒加载 + 可通过 loadBusinessLexicon(path) 注入测试替身
 *   - 所有匹配原语都返回 boolean / 原字符串，不做 side effect
 */

const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const DEFAULT_LEXICON_PATH = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  'ai-rules',
  'skills',
  'knowledge-os',
  'doc-standards',
  'business-lexicon.yaml'
);

const FALLBACK_LEXICON = Object.freeze({
  version: 0,
  action_verbs: [],
  rule_triggers: { strong_cn: [], strong_en: [], weak_cn: [], weak_en: [] },
  test_name_patterns: {
    junit: { prefixes: ['test', 'should'], splitters: ['should', 'when'] },
    jest_it: { lead_words_en: ['should'], lead_words_cn: ['应'] },
  },
  domain_specific: {},
  state_machine_guard_keywords: { cn: [], en: [] },
  side_effect_keywords: { cn: [], en: [] },
  anti_patterns: [],
});

let cachedLexicon = null;
let cachedPath = null;

function normalizeArrayOfStrings(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
}

function normalizeLexicon(raw) {
  const safe = raw && typeof raw === 'object' ? raw : {};
  const rt = safe.rule_triggers || {};
  const sm = safe.state_machine_guard_keywords || {};
  const se = safe.side_effect_keywords || {};
  const tnp = safe.test_name_patterns || {};
  const junit = tnp.junit || {};
  const jestIt = tnp.jest_it || {};
  const domainSpecific = safe.domain_specific && typeof safe.domain_specific === 'object' ? safe.domain_specific : {};

  const normalizedDomainSpecific = {};
  for (const [key, value] of Object.entries(domainSpecific)) {
    if (!value || typeof value !== 'object') continue;
    normalizedDomainSpecific[key] = {
      labels: normalizeArrayOfStrings(value.labels),
      key_entities: normalizeArrayOfStrings(value.key_entities),
      key_states: normalizeArrayOfStrings(value.key_states),
    };
  }

  const actionVerbs = Array.isArray(safe.action_verbs)
    ? safe.action_verbs
        .map((item) => {
          if (!item || typeof item !== 'object') return null;
          const canonical = typeof item.canonical === 'string' ? item.canonical.trim() : '';
          if (!canonical) return null;
          return {
            canonical,
            aliases: normalizeArrayOfStrings(item.aliases),
          };
        })
        .filter(Boolean)
    : [];

  return {
    version: Number(safe.version || 0),
    action_verbs: actionVerbs,
    rule_triggers: {
      strong_cn: normalizeArrayOfStrings(rt.strong_cn),
      strong_en: normalizeArrayOfStrings(rt.strong_en).map((s) => s.toLowerCase()),
      weak_cn: normalizeArrayOfStrings(rt.weak_cn),
      weak_en: normalizeArrayOfStrings(rt.weak_en).map((s) => s.toLowerCase()),
    },
    test_name_patterns: {
      junit: {
        prefixes: normalizeArrayOfStrings(junit.prefixes).map((s) => s.toLowerCase()),
        splitters: normalizeArrayOfStrings(junit.splitters).map((s) => s.toLowerCase()),
      },
      jest_it: {
        lead_words_en: normalizeArrayOfStrings(jestIt.lead_words_en).map((s) => s.toLowerCase()),
        lead_words_cn: normalizeArrayOfStrings(jestIt.lead_words_cn),
      },
    },
    domain_specific: normalizedDomainSpecific,
    state_machine_guard_keywords: {
      cn: normalizeArrayOfStrings(sm.cn),
      en: normalizeArrayOfStrings(sm.en).map((s) => s.toLowerCase()),
    },
    side_effect_keywords: {
      cn: normalizeArrayOfStrings(se.cn),
      en: normalizeArrayOfStrings(se.en).map((s) => s.toLowerCase()),
    },
    anti_patterns: normalizeArrayOfStrings(safe.anti_patterns),
  };
}

/**
 * 加载 lexicon。
 * - 默认从仓库 ai-rules/.../business-lexicon.yaml 读取；
 * - 如果文件不存在或解析失败，返回 FALLBACK_LEXICON（不抛异常，保证主流水线不被拖死）；
 * - 通过 filePath 参数可注入测试用 lexicon。
 */
function loadBusinessLexicon(filePath) {
  const resolved = filePath || DEFAULT_LEXICON_PATH;
  if (cachedLexicon && cachedPath === resolved) {
    return cachedLexicon;
  }
  try {
    if (!fs.existsSync(resolved)) {
      cachedLexicon = FALLBACK_LEXICON;
      cachedPath = resolved;
      return cachedLexicon;
    }
    const text = fs.readFileSync(resolved, 'utf8');
    const parsed = yaml.load(text);
    cachedLexicon = Object.freeze(normalizeLexicon(parsed));
    cachedPath = resolved;
    return cachedLexicon;
  } catch (err) {
    // 故意不 rethrow：lexicon 读不出来不应该阻塞 DeepWiki 主流程。
    cachedLexicon = FALLBACK_LEXICON;
    cachedPath = resolved;
    return cachedLexicon;
  }
}

function resetLexiconCache() {
  cachedLexicon = null;
  cachedPath = null;
}

function lowercase(value) {
  return typeof value === 'string' ? value.toLowerCase() : '';
}

/**
 * 判断一段文本中是否含有规则触发词（强触发：几乎必然是一条业务规则）。
 */
function containsStrongRuleTrigger(text, lexicon) {
  if (!text) return null;
  const lex = lexicon || loadBusinessLexicon();
  const lower = lowercase(text);
  for (const word of lex.rule_triggers.strong_cn) {
    if (typeof text === 'string' && text.includes(word)) return word;
  }
  for (const word of lex.rule_triggers.strong_en) {
    if (lower.includes(word)) return word;
  }
  return null;
}

/**
 * 把任意动作/谓词（中英文）归一化为 canonical 动作名。
 * 命中不到返回 null（而不是空串，方便调用方 if (action) 判断）。
 */
function normalizeActionVerb(token, lexicon) {
  if (!token) return null;
  const lex = lexicon || loadBusinessLexicon();
  const lower = lowercase(token);
  for (const entry of lex.action_verbs) {
    if (entry.canonical.toLowerCase() === lower) return entry.canonical;
    if (entry.aliases.some((alias) => alias === token || alias.toLowerCase() === lower)) {
      return entry.canonical;
    }
  }
  return null;
}

/**
 * 根据类名/表名/路径推断所属领域 key（key 来自 lexicon.domain_specific）。
 * 多领域命中时按 score 排序，返回分数最高的 key。
 */
function classifyDomain(text, lexicon) {
  if (!text) return null;
  const lex = lexicon || loadBusinessLexicon();
  const lower = lowercase(text);
  let bestKey = null;
  let bestScore = 0;
  for (const [key, spec] of Object.entries(lex.domain_specific)) {
    let score = 0;
    for (const label of spec.labels) {
      if (label && (text.includes(label) || lower.includes(label.toLowerCase()))) score += 2;
    }
    for (const entity of spec.key_entities) {
      if (entity && lower.includes(entity.toLowerCase())) score += 1;
    }
    for (const state of spec.key_states) {
      if (state && lower.includes(state.toLowerCase())) score += 0.5;
    }
    if (score > bestScore) {
      bestKey = key;
      bestScore = score;
    }
  }
  return bestKey;
}

/**
 * 判断 text 是否是一个反模式（TODO / FIXME / XXX / legacy 等）。
 */
function isAntiPattern(text, lexicon) {
  if (!text) return false;
  const lex = lexicon || loadBusinessLexicon();
  const lower = lowercase(text);
  return lex.anti_patterns.some((word) => {
    if (!word) return false;
    const wLower = word.toLowerCase();
    return lower.includes(wLower);
  });
}

/**
 * 判断 text 中是否包含副作用语义。
 */
function containsSideEffect(text, lexicon) {
  if (!text) return null;
  const lex = lexicon || loadBusinessLexicon();
  const lower = lowercase(text);
  for (const word of lex.side_effect_keywords.cn) {
    if (text.includes(word)) return word;
  }
  for (const word of lex.side_effect_keywords.en) {
    if (lower.includes(word)) return word;
  }
  return null;
}

module.exports = {
  DEFAULT_LEXICON_PATH,
  FALLBACK_LEXICON,
  loadBusinessLexicon,
  resetLexiconCache,
  containsStrongRuleTrigger,
  normalizeActionVerb,
  classifyDomain,
  isAntiPattern,
  containsSideEffect,
};
