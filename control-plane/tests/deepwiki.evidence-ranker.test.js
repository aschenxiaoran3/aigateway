'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { rankEvidence } = require('../src/deepwiki/skills/evidence-ranker');

test('evidence-ranker · genuine test sources get a positive test_boost instead of penalty', () => {
  const evidence = [
    {
      type: 'api',
      source: 'src/main/java/com/x/order/OrderController.java',
    },
    {
      type: 'api',
      source: 'src/test/java/com/x/order/OrderControllerTest.java',
    },
  ];
  const ranked = rankEvidence(evidence);
  const main = ranked.find((item) => item.source.includes('OrderController.java') && !item.source.includes('Test'));
  const testCase = ranked.find((item) => item.source.includes('OrderControllerTest'));
  assert.ok(main && testCase, 'both items must be ranked');
  assert.strictEqual(main.factors.test_boost, 0, 'main src should not be boosted');
  assert.strictEqual(testCase.factors.test_boost, 0.15, 'genuine test source must be boosted');
  assert.strictEqual(testCase.factors.test_penalty, 0, 'legacy test_penalty must be zeroed out');
  assert.ok(testCase.finalScore > 0, 'test evidence must not be punished into a trivially low score');
});

test('evidence-ranker · mock/fixture/stub sources are excluded from boost (still penalized via noise)', () => {
  const evidence = [
    {
      type: 'api',
      source: 'src/test/fixtures/order-fixture.json',
    },
    {
      type: 'api',
      source: 'src/test/mocks/OrderMock.java',
    },
  ];
  const ranked = rankEvidence(evidence);
  for (const item of ranked) {
    assert.strictEqual(item.factors.test_boost, 0, `fixture/mock should not be boosted: ${item.source}`);
    assert.ok(item.factors.noise_penalty <= 0, `fixture/mock should retain noise penalty: ${item.source}`);
  }
});

test('evidence-ranker · test sources are no longer treated as pollution', () => {
  const evidence = [
    { type: 'api', source: 'src/test/java/com/x/order/OrderServiceTest.java' },
    { type: 'api', source: 'src/test/java/com/x/bill/BillingServiceTest.java' },
    { type: 'api', source: 'src/main/java/com/x/order/OrderController.java' },
  ];
  const ranked = rankEvidence(evidence);
  const topFactors = ranked.slice(0, 3).map((item) => item.factors);
  const anyNegativeTestPenalty = topFactors.some((factors) => Number(factors.test_penalty || 0) < 0);
  assert.strictEqual(anyNegativeTestPenalty, false, 'no item should carry a negative test_penalty after the inversion');
});
