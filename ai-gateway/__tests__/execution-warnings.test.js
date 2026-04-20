const {
  collectExecutionWarnings,
  extractRuleCheckIds,
} = require('../src/gate/execution-warnings');

describe('extractRuleCheckIds', () => {
  test('reads id from checks', () => {
    const set = extractRuleCheckIds({
      rules_config: { checks: [{ id: 'a' }, { check_id: 'b' }] },
    });
    expect(set && [...set].sort()).toEqual(['a', 'b'].sort());
  });

  test('null when no checks', () => {
    expect(extractRuleCheckIds({ rules_config: {} })).toBeNull();
  });
});

describe('collectExecutionWarnings', () => {
  test('total_score out of range', () => {
    const w = collectExecutionWarnings(
      { passed: false, total_score: 200, max_score: 100, failed_checks: [] },
      null
    );
    expect(w.some((x) => x.includes('total_score'))).toBe(true);
  });

  test('passed true but failed_checks non-empty', () => {
    const w = collectExecutionWarnings(
      {
        passed: true,
        total_score: 80,
        failed_checks: [{ passed: false, check_id: 'x' }],
      },
      null
    );
    expect(w.some((x) => x.includes('passed=true'))).toBe(true);
  });

  test('failed_checks item should not be passed true', () => {
    const w = collectExecutionWarnings(
      {
        passed: false,
        total_score: 0,
        failed_checks: [{ passed: true }],
      },
      null
    );
    expect(w.some((x) => x.includes('不应为 passed=true'))).toBe(true);
  });

  test('unknown check_id vs rule', () => {
    const rule = {
      rules_config: {
        checks: [{ id: 'only' }],
      },
    };
    const w = collectExecutionWarnings(
      {
        passed: false,
        rule_id: 1,
        total_score: 0,
        check_results: [{ check_id: 'other', score: 0 }],
      },
      rule
    );
    expect(w.some((x) => x.includes('不在当前规则'))).toBe(true);
  });

  test('score sum mismatch', () => {
    const w = collectExecutionWarnings(
      {
        passed: false,
        total_score: 9,
        check_results: [
          { check_id: 'a', score: 5 },
          { check_id: 'b', score: 5 },
        ],
      },
      null
    );
    expect(w.some((x) => x.includes('之和'))).toBe(true);
  });

  test('no warning when failures only in check_results', () => {
    const w = collectExecutionWarnings(
      {
        passed: false,
        total_score: 0,
        check_results: [{ check_id: 'a', passed: false, score: 0 }],
      },
      null
    );
    expect(w.some((x) => x.includes('failed_checks 为空'))).toBe(false);
  });
});
