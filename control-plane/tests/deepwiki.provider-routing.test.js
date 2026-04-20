const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildDiagramSynthesisGatewayPayload,
  resolveResearchProvider,
} = require('../src/deepwiki/provider-routing');

test('buildDiagramSynthesisGatewayPayload lets gateway choose provider for codex_only', () => {
  const payload = buildDiagramSynthesisGatewayPayload('trace-demo', 'diagram input', {
    provider: 'weelinking_openai_compatible',
    model: 'deep-research',
    provider_strategy: 'codex_only',
  });

  assert.equal(payload.provider_strategy, 'codex_only');
  assert.equal(payload.research_provider, undefined);
  assert.equal(payload.research_model, undefined);
  assert.deepEqual(payload.messages, [{ role: 'user', content: 'diagram input' }]);
});

test('buildDiagramSynthesisGatewayPayload keeps explicit provider settings for default strategy', () => {
  const payload = buildDiagramSynthesisGatewayPayload('trace-demo', 'diagram input', {
    provider: 'weelinking_openai_compatible',
    model: 'deep-research',
    provider_strategy: 'default',
    diagram_model: 'diagram-specialist',
  });

  assert.equal(payload.research_provider, 'weelinking_openai_compatible');
  assert.equal(payload.research_model, 'diagram-specialist');
});

test('resolveResearchProvider prefers configured default provider over fallback', () => {
  const provider = resolveResearchProvider({
    requestedProvider: '',
    repoSyncProvider: '',
    defaultProvider: 'weelinking_openai_compatible',
    fallbackProvider: 'qwen_dashscope_native',
  });

  assert.equal(provider, 'weelinking_openai_compatible');
});
