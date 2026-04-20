/**
 * 文档门禁统一输出契约（与 buildPromptPayload output_contract 对齐，供 API/UI 引用）
 */
const DOC_GATE_OUTPUT_SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'DocGateMergedResult',
  type: 'object',
  required: ['status', 'summary'],
  properties: {
    status: { type: 'string', enum: ['pass', 'warn', 'block'] },
    summary: { type: 'string' },
    score: { type: 'number', minimum: 0, maximum: 100 },
    checks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          label: { type: 'string' },
          status: { type: 'string', enum: ['pass', 'warn', 'block'] },
          evidence: { type: 'string' },
        },
      },
    },
    missing_inputs: { type: 'array', items: { type: 'string' } },
    risk_items: { type: 'array', items: { type: 'string' } },
    uninferable_items: { type: 'array', items: { type: 'string' } },
    missing_coverage_items: { type: 'array', items: { type: 'string' } },
    unbound_case_items: { type: 'array', items: { type: 'string' } },
    citations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          knowledge_asset_id: { type: ['number', 'null'] },
          asset_key: { type: 'string' },
          name: { type: 'string' },
          source_uri: { type: 'string' },
          source: { type: 'string' },
          score: { type: ['number', 'null'] },
          reason: { type: 'string' },
          excerpt: { type: 'string' },
        },
      },
    },
    evaluator_meta: {
      type: 'object',
      properties: {
        rule: { type: ['object', 'null'] },
        prompt: { type: ['object', 'null'] },
        coverage: { type: ['object', 'null'] },
        knowledge: { type: ['object', 'null'] },
      },
    },
  },
};

module.exports = { DOC_GATE_OUTPUT_SCHEMA };
