function normalizeText(value) {
  return String(value || '').trim();
}

function resolveResearchProvider(options = {}) {
  return (
    normalizeText(options.requestedProvider) ||
    normalizeText(options.repoSyncProvider) ||
    normalizeText(options.defaultProvider) ||
    normalizeText(options.fallbackProvider) ||
    'qwen_dashscope_native'
  );
}

function shouldLetGatewayChooseDiagramProvider(providerStrategy = '') {
  const normalized = normalizeText(providerStrategy);
  return !normalized || normalized === 'codex_only' || normalized === 'project_override';
}

function buildDiagramSynthesisGatewayPayload(traceId, userContent, options = {}) {
  const letGatewayChooseProvider = shouldLetGatewayChooseDiagramProvider(options.provider_strategy);
  const requestedModel = normalizeText(options.diagram_model) || (letGatewayChooseProvider ? '' : normalizeText(options.model));
  const payload = {
    purpose: 'deepwiki',
    mode: 'diagram_synthesis',
    trace_id: traceId,
    provider_strategy: normalizeText(options.provider_strategy) || undefined,
    output_format: 'json',
    messages: [{ role: 'user', content: userContent }],
  };

  if (requestedModel) {
    payload.research_model = requestedModel;
  }

  if (!letGatewayChooseProvider && normalizeText(options.provider)) {
    payload.research_provider = normalizeText(options.provider);
  }

  return payload;
}

module.exports = {
  buildDiagramSynthesisGatewayPayload,
  resolveResearchProvider,
  shouldLetGatewayChooseDiagramProvider,
};
