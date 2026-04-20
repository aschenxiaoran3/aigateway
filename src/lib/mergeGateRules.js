'use strict';

/**
 * 将同一 gate_type 下多条 active 规则合并为一条虚拟规则，供评判器单次消费。
 * 与 ai-platform/ai-gateway 内同名文件保持语义一致（修改时请同步）。
 */

function getRuleSpec(rule) {
  if (!rule || typeof rule !== 'object') return '';
  const cfg = rule.rules_config || {};
  return (
    (typeof cfg.spec_markdown === 'string' && cfg.spec_markdown.trim() && cfg.spec_markdown) ||
    (typeof rule.spec_markdown === 'string' && rule.spec_markdown.trim() && rule.spec_markdown) ||
    (typeof cfg.description === 'string' && cfg.description) ||
    ''
  );
}

function slugPrefix(rule) {
  const rid = rule.id != null ? String(rule.id) : 'x';
  const raw = String(rule.gate_name || 'rule')
    .replace(/[^\w\u4e00-\u9fff]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32);
  return `r${rid}_${raw || 'n'}`;
}

function normalizeRuleForJudge(rule) {
  const cfg = { ...(rule.rules_config || {}) };
  const spec = getRuleSpec(rule);
  if (spec && typeof cfg.spec_markdown !== 'string') {
    cfg.spec_markdown = spec;
  }
  return { ...rule, rules_config: cfg };
}

/**
 * @param {object[]} rules 同 gate_type 的 active 规则列表（来自网关）
 * @returns {object} 单条虚拟规则
 */
function mergeGateRules(rules) {
  if (!Array.isArray(rules) || rules.length === 0) {
    throw new Error('mergeGateRules: rules must be a non-empty array');
  }
  if (rules.length === 1) {
    return normalizeRuleForJudge(rules[0]);
  }

  const gateType = rules[0].gate_type;
  const specSections = [];
  const mergedChecks = [];

  for (const rule of rules) {
    const prefix = slugPrefix(rule);
    const spec = getRuleSpec(rule);
    const rid = rule.id != null ? rule.id : '?';
    specSections.push(`## ${rule.gate_name || '规范'}（规则 id=${rid}）\n\n${spec}`);

    const cfg = rule.rules_config || {};
    const checks = Array.isArray(cfg.checks) ? cfg.checks : [];
    if (checks.length === 0) {
      mergedChecks.push({
        id: `${prefix}_compliance`,
        name: `${rule.gate_name || '规范'}：整体遵从`,
        type: 'checklist',
        weight: 10,
        message: `助手输出未体现《${rule.gate_name || '该规范'}》中的关键约束`,
      });
    } else {
      for (const ch of checks) {
        const oid = ch.id || ch.check_id || `c${mergedChecks.length}`;
        const newId = `${prefix}_${String(oid)}`.replace(/[^a-zA-Z0-9_-]/g, '_');
        mergedChecks.push({
          ...ch,
          id: newId,
          name: ch.name ? `${rule.gate_name}: ${ch.name}` : ch.name,
        });
      }
    }
  }

  const sumW = mergedChecks.reduce((s, c) => s + (Number(c.weight) || 0), 0) || 1;
  for (const c of mergedChecks) {
    const w = Number(c.weight) || 0;
    c.weight = Math.round((w * 1000) / sumW) / 10;
  }

  const mins = rules.map((r) => Number((r.rules_config || {}).passCriteria?.min_total_score) || 70);
  const minTotal = Math.max(...mins);

  const mergedSpec = specSections.join('\n\n---\n\n');
  const names = rules.map((r) => r.gate_name || '(未命名)');
  const gateName = `（合并${rules.length}条）${names.join('；')}`.slice(0, 480);

  const mergedIds = rules.map((r) => r.id).filter((x) => x != null);

  const summaryParts = [];
  const focusParts = [];
  for (const rule of rules) {
    const c = rule.rules_config || {};
    if (typeof c.spec_summary_for_judge === 'string' && c.spec_summary_for_judge.trim()) {
      summaryParts.push(`## ${rule.gate_name || '规范'}\n${c.spec_summary_for_judge.trim()}`);
    }
    if (typeof c.judge_focus === 'string' && c.judge_focus.trim()) {
      focusParts.push(`【${rule.gate_name || '规范'}】${c.judge_focus.trim()}`);
    }
  }
  const mergedSummary = summaryParts.length
    ? summaryParts.join('\n\n---\n\n').slice(0, 11800)
    : '';
  const mergedFocus = focusParts.length ? focusParts.join('\n').slice(0, 4000) : '';

  const rules_config = {
    checks: mergedChecks,
    passCriteria: { min_total_score: minTotal },
    spec_markdown: mergedSpec,
    description: `合并自 gateway_gate_rules.id: ${mergedIds.join(',')}`,
    _merged: true,
    _merged_rule_ids: mergedIds,
  };
  if (mergedSummary) {
    rules_config.spec_summary_for_judge = mergedSummary;
  }
  if (mergedFocus) {
    rules_config.judge_focus = mergedFocus;
  }

  return {
    id: rules[0].id,
    gate_type: gateType,
    gate_name: gateName,
    version: 'merged',
    status: 'active',
    spec_markdown: mergedSpec,
    rules_config,
  };
}

module.exports = {
  mergeGateRules,
  getRuleSpec,
  normalizeRuleForJudge,
};
