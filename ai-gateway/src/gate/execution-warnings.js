/**
 * 门禁执行记录软校验：仅产出 warnings，不阻断落库（与方案 §6.0 一致）
 */

const EPS = 1e-6;

/**
 * @param {unknown} ruleRow gateway_gate_rules 一行，含 rules_config；可为 null
 * @returns {Set<string>|null} 规则中声明的 check id 集合；无规则时 null
 */
function extractRuleCheckIds(ruleRow) {
  if (!ruleRow || typeof ruleRow !== 'object') return null;
  const cfg = ruleRow.rules_config;
  if (!cfg || typeof cfg !== 'object') return null;
  const checks = cfg.checks;
  if (!Array.isArray(checks)) return null;
  const set = new Set();
  for (const c of checks) {
    if (!c || typeof c !== 'object') continue;
    const id = c.id != null ? String(c.id) : c.check_id != null ? String(c.check_id) : null;
    if (id) set.add(id);
  }
  return set.size ? set : null;
}

/**
 * @param {Record<string, unknown>} body POST /executions 请求体
 * @param {object | null} ruleRow 当提供 rule_id 且查库成功时传入，否则 null
 * @returns {string[]}
 */
function collectExecutionWarnings(body, ruleRow) {
  const warnings = [];

  if (!body || typeof body !== 'object') {
    return ['请求体无效'];
  }

  const total =
    body.total_score != null && body.total_score !== ''
      ? Number(body.total_score)
      : null;
  const maxScore =
    body.max_score != null && body.max_score !== ''
      ? Number(body.max_score)
      : 100;

  if (total != null) {
    if (Number.isNaN(total)) {
      warnings.push('total_score 不是有效数字');
    } else if (total < 0 || total > maxScore) {
      warnings.push(`total_score (${total}) 不在 [0, ${maxScore}] 内`);
    }
  }

  const failed = body.failed_checks;
  if (Array.isArray(failed)) {
    failed.forEach((item, i) => {
      if (item && typeof item === 'object' && item.passed === true) {
        warnings.push(`failed_checks[${i}] 不应为 passed=true`);
      }
    });
  }

  const passedFlag = Boolean(body.passed);
  if (Array.isArray(failed) && failed.length > 0 && passedFlag) {
    warnings.push('passed=true 但 failed_checks 非空');
  }
  const resultsArr = body.check_results;
  const hasResultDetail =
    Array.isArray(resultsArr) &&
    resultsArr.some(
      (x) =>
        x &&
        typeof x === 'object' &&
        (x.passed === false || x.status === 'failed' || x.status === 'error')
    );
  if (
    !passedFlag &&
    (!failed || !Array.isArray(failed) || failed.length === 0) &&
    !hasResultDetail
  ) {
    warnings.push(
      'passed=false 但 failed_checks 为空且 check_results 中无明确未通过项'
    );
  }

  const ruleIds = extractRuleCheckIds(ruleRow);
  const results = resultsArr;

  if (body.rule_id != null && ruleRow == null) {
    warnings.push('提供了 rule_id 但规则不存在，无法校验 check_id 与 rules_config.checks 的一致性');
  }

  if (ruleIds && Array.isArray(results)) {
    results.forEach((item, i) => {
      if (!item || typeof item !== 'object') return;
      const cid =
        item.check_id != null ? String(item.check_id) : item.id != null ? String(item.id) : null;
      if (cid != null && !ruleIds.has(cid)) {
        warnings.push(
          `check_results[${i}].check_id="${cid}" 不在当前规则 rules_config.checks 中`
        );
      }
    });
  } else if (
    ruleRow &&
    extractRuleCheckIds(ruleRow) === null &&
    Array.isArray(results) &&
    results.length > 0
  ) {
    warnings.push('规则存在但未配置 rules_config.checks，无法校验 check_results 中的 check_id');
  } else if (!body.rule_id && Array.isArray(results) && results.length > 0) {
    warnings.push('未提供 rule_id，无法校验 check_id 与 rules_config.checks 的一致性');
  }

  if (Array.isArray(results) && total != null && !Number.isNaN(total)) {
    let sum = 0;
    let n = 0;
    for (const item of results) {
      if (item && typeof item === 'object' && typeof item.score === 'number') {
        sum += item.score;
        n += 1;
      }
    }
    if (n > 0 && Math.abs(sum - total) > EPS) {
      warnings.push(`分项 score 之和 (${sum}) 与 total_score (${total}) 不一致`);
    }
  }

  return warnings;
}

module.exports = {
  collectExecutionWarnings,
  extractRuleCheckIds,
};
