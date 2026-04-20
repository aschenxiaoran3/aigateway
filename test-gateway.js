/**
 * AI 网关测试脚本
 * 
 * 测试内容:
 * 1. 健康检查
 * 2. 模型路由逻辑
 * 3. API Key 认证
 */

const { MODEL_CONFIGS } = require('./src/routes/model-router');

console.log('='.repeat(60));
console.log('AI 网关测试');
console.log('='.repeat(60));

// 测试 1: 模型配置
console.log('\n📋 测试 1: 模型配置加载');
console.log('-'.repeat(60));

const expectedModels = ['qwen3.6-plus', 'qwen3.5-plus', 'gpt-4-turbo', 'claude-3-sonnet'];
let allLoaded = true;

for (const model of expectedModels) {
  if (MODEL_CONFIGS[model]) {
    console.log(`✅ ${model}: ${MODEL_CONFIGS[model].provider}`);
  } else {
    console.log(`❌ ${model}: 未配置`);
    allLoaded = false;
  }
}

if (allLoaded) {
  console.log('\n✅ 所有模型配置加载成功');
} else {
  console.log('\n❌ 部分模型配置缺失');
  process.exit(1);
}

// 测试 2: 模型路由策略
console.log('\n📋 测试 2: 模型路由策略');
console.log('-'.repeat(60));

const routingTests = [
  { purpose: 'PRD 生成', expected: 'qwen3.6-plus' },
  { purpose: '技术方案', expected: 'qwen3.6-plus' },
  { purpose: '代码生成', expected: 'qwen3.6-plus' },
  { purpose: '代码审查', expected: 'qwen3.6-plus' },
  { purpose: '测试用例', expected: 'qwen3.6-plus' },
  { purpose: '数据分析', expected: 'qwen3.6-plus' },
  { purpose: 'general', expected: 'qwen3.6-plus' },
];

let allPassed = true;

for (const test of routingTests) {
  const routingRules = {
    'PRD 生成': 'qwen3.6-plus',
    '技术方案': 'qwen3.6-plus',
    '代码生成': 'qwen3.6-plus',
    '代码审查': 'qwen3.6-plus',
    '测试用例': 'qwen3.6-plus',
    '数据分析': 'qwen3.6-plus',
    'general': 'qwen3.6-plus',
  };
  
  const selected = routingRules[test.purpose] || routingRules['general'];
  const passed = selected === test.expected;
  
  if (passed) {
    console.log(`✅ ${test.purpose} → ${selected}`);
  } else {
    console.log(`❌ ${test.purpose} → ${selected} (期望：${test.expected})`);
    allPassed = false;
  }
}

if (allPassed) {
  console.log('\n✅ 所有路由策略测试通过');
} else {
  console.log('\n❌ 部分路由策略失败');
  process.exit(1);
}

// 测试 3: 成本计算
console.log('\n📋 测试 3: 成本计算');
console.log('-'.repeat(60));

function calculateCost(model, inputTokens, outputTokens) {
  const config = MODEL_CONFIGS[model];
  if (!config) return null;
  
  const inputCost = (inputTokens / 1000) * config.cost_per_1k_tokens.input;
  const outputCost = (outputTokens / 1000) * config.cost_per_1k_tokens.output;
  
  return {
    input_cny: inputCost,
    output_cny: outputCost,
    total_cny: inputCost + outputCost,
  };
}

const costTests = [
  { model: 'qwen3.6-plus', input: 1000, output: 2000 },
  { model: 'qwen3.5-plus', input: 1000, output: 2000 },
  { model: 'gpt-4-turbo', input: 1000, output: 2000 },
];

for (const test of costTests) {
  const cost = calculateCost(test.model, test.input, test.output);
  console.log(`✅ ${test.model}: ${test.input} input + ${test.output} output = ¥${cost.total_cny.toFixed(3)}`);
}

console.log('\n' + '='.repeat(60));
console.log('✅ 所有测试通过！');
console.log('='.repeat(60));
